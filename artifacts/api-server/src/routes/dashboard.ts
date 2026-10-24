import { Router, type IRouter } from "express";
import { sql, eq, gte, and } from "drizzle-orm";
import { db, transactionsTable, usersTable, fareRoutesTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRevenueTrendResponse,
  GetReportSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const APP_TIME_ZONE = "Asia/Manila";

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  return Array.isArray(r.rows) ? (r.rows as T[]) : [];
}

function getTodayInAppTz(): { year: number; month: number; day: number; dateStr: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return { year, month, day, dateStr };
}

function getLast7DatesInAppTz(): string[] {
  const { year, month, day } = getTodayInAppTz();
  const baseUtc = new Date(Date.UTC(year, month - 1, day));

  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(baseUtc);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  return dates;
}

/**
 * Today's stats.
 *  - Admin  -> totals for the whole system (unchanged).
 *  - Driver -> ONLY taps of the reader device(s) that driver owns
 *              (req.driverUser is set by requireAuth).
 */
router.get("/dashboard/stats", async (req, res): Promise<void> => {
  try {
    const { dateStr: todayDate } = getTodayInAppTz();
    const driver = (req as any).driverUser as { id: string } | undefined;

    let revenueToday = 0;
    let tapsToday = 0;

    if (driver) {
      const me = String(driver.id);
      const raw = await db.execute(sql`
        select
          coalesce(sum(case when t.status = 'Success' then abs(t.amount) else 0 end), 0) as revenue,
          count(*)::int as taps
        from transactions t
        where t.type = 'Fare'
          and to_char(t."timestamp" at time zone 'Asia/Manila', 'YYYY-MM-DD') = ${todayDate}
          and (
            t.driver_id = ${me}
            or (
              t.driver_id is null
              and t.device_id in (select d.device_id from devices d where d.driver_id = ${me})
            )
          )
      `);
      const row = extractRows<{ revenue: string | number; taps: number }>(raw)[0];
      revenueToday = Math.abs(Number(row?.revenue) || 0);
      tapsToday = Number(row?.taps) || 0;
    } else {
      const [revenueResult] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)`,
        })
        .from(transactionsTable)
        .where(
          and(
            sql`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') = ${todayDate}`,
            eq(transactionsTable.type, "Fare"),
            eq(transactionsTable.status, "Success")
          )
        );

      const [tapsResult] = await db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(transactionsTable)
        .where(
          and(
            sql`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') = ${todayDate}`,
            eq(transactionsTable.type, "Fare")
          )
        );

      revenueToday = Number(revenueResult.total);
      tapsToday = tapsResult.count;
    }

    const [cardsResult] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(usersTable);

    const [routesResult] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(fareRoutesTable)
      .where(eq(fareRoutesTable.isActive, true));

    res.json(
      GetDashboardStatsResponse.parse({
        totalRevenueToday: revenueToday,
        totalTapsToday: tapsToday,
        registeredCards: cardsResult.count,
        activeRoutes: routesResult.count,
      })
    );
  } catch (error) {
    console.error("dashboard/stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Which ACTIVE routes belong to the logged-in driver.
 * Legacy fix: reader devices that have an active route but no owner yet are
 * claimed by the first driver who calls this (first come, first served).
 */
router.get("/dashboard/my-routes", async (req, res): Promise<void> => {
  try {
    const driver = (req as any).driverUser as { id: string } | undefined;
    if (!driver) {
      res.json({ routeIds: [] });
      return;
    }
    const me = String(driver.id);

    await db.execute(sql`
      update devices
      set driver_id = ${me}
      where driver_id is null
        and device_id in (
          select fr.device_id from fare_routes fr
          where fr.is_active = true and fr.device_id is not null
        )
    `);

    const raw = await db.execute(sql`
      select fr.id
      from fare_routes fr
      join devices d on d.device_id = fr.device_id
      where fr.is_active = true
        and d.driver_id = ${me}
    `);
    const rows = extractRows<{ id: string | number }>(raw);

    res.json({ routeIds: rows.map((r) => String(r.id)) });
  } catch (error) {
    console.error("my-routes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Driver takes ownership of a reader device BEFORE activating a route on it.
 * A device can only belong to one driver at a time:
 *   - free (no owner)                      -> claimed
 *   - already mine                         -> ok
 *   - owned by someone else but has no
 *     active route anymore (stale claim)   -> claimed
 *   - owned by someone else with an active
 *     route                                -> 409 "in use"
 * Body: { deviceId: string }
 */
router.post("/dashboard/claim-device", async (req, res): Promise<void> => {
  try {
    const driver = (req as any).driverUser as { id: string } | undefined;
    if (!driver) {
      res.status(403).json({ error: "Drivers only" });
      return;
    }
    const me = String(driver.id);

    const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
    if (!deviceId) {
      res.status(400).json({ error: "deviceId is required" });
      return;
    }

    const claimed = extractRows(
      await db.execute(sql`
        update devices
        set driver_id = ${me}
        where device_id = ${deviceId}
          and (
            driver_id is null
            or driver_id = ${me}
            or not exists (
              select 1 from fare_routes fr
              where fr.device_id = devices.device_id and fr.is_active = true
            )
          )
        returning device_id
      `)
    );

    if (claimed.length > 0) {
      res.json({ success: true, deviceId });
      return;
    }

    const exists = extractRows(
      await db.execute(sql`select 1 from devices where device_id = ${deviceId} limit 1`)
    );
    if (exists.length === 0) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    res.status(409).json({ error: "This device is already in use by another driver." });
  } catch (error) {
    console.error("claim-device error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/revenue-trend", async (_req, res): Promise<void> => {
  const dateSeries = getLast7DatesInAppTz();
  const sevenDaysAgo = new Date(`${dateSeries[0]}T00:00:00`);

  const rows = await db
    .select({
      date: sql<string>`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`,
      revenue: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)`,
    })
    .from(transactionsTable)
    .where(
      and(
        gte(transactionsTable.timestamp, sevenDaysAgo),
        eq(transactionsTable.type, "Fare"),
        eq(transactionsTable.status, "Success")
      )
    )
    .groupBy(sql`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`);

  const result: { date: string; revenue: number }[] = [];
  for (const dateStr of dateSeries) {
    const found = rows.find((r) => r.date === dateStr);
    result.push({
      date: dateStr,
      revenue: found ? Number(found.revenue) : 0,
    });
  }

  res.json(GetRevenueTrendResponse.parse(result));
});

router.get("/reports/summary", async (_req, res): Promise<void> => {
  const dateSeries = getLast7DatesInAppTz();
  const sevenDaysAgo = new Date(`${dateSeries[0]}T00:00:00`);

  const rows = await db
    .select({
      date: sql<string>`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`,
      revenue: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)`,
    })
    .from(transactionsTable)
    .where(
      and(
        gte(transactionsTable.timestamp, sevenDaysAgo),
        eq(transactionsTable.type, "Fare"),
        eq(transactionsTable.status, "Success")
      )
    )
    .groupBy(sql`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${transactionsTable.timestamp} AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')`);

  const dailyBreakdown: { date: string; revenue: number }[] = [];
  for (const dateStr of dateSeries) {
    const found = rows.find((r) => r.date === dateStr);
    dailyBreakdown.push({
      date: dateStr,
      revenue: found ? Number(found.revenue) : 0,
    });
  }

  const totalRevenue7Days = dailyBreakdown.reduce((sum, d) => sum + d.revenue, 0);
  const averageDailyRevenue = totalRevenue7Days / 7;

  // Total taps for 7 days (only Fare transactions)
  const [tapsResult] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(transactionsTable)
    .where(
      and(
        gte(transactionsTable.timestamp, sevenDaysAgo),
        eq(transactionsTable.type, "Fare")
      )
    );

  res.json(
    GetReportSummaryResponse.parse({
      totalRevenue7Days,
      averageDailyRevenue: Math.round(averageDailyRevenue * 100) / 100,
      totalTaps7Days: tapsResult.count,
      dailyBreakdown,
    })
  );
});

export default router;