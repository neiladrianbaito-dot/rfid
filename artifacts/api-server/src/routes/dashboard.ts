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

/**
 * REAL trips of the logged-in driver, built from the `transactions` table.
 *
 * A "trip" = a run of Fare taps on the SAME route (origin → destination) where
 * no two taps are more than TRIP_GAP_MINUTES apart. A new trip starts when the
 * route changes (e.g. the return direction) or after a long pause.
 *
 * Only taps of the reader device(s) the driver owns are included
 * (same rule as /dashboard/stats).
 *
 * Query: ?days=1 (today, default) ... ?days=31
 * Returns: { trips: [{ key, origin, destination, startedAt, endedAt, taps, fare }] }  newest first
 */
const TRIP_GAP_MINUTES = 30;

router.get("/dashboard/my-trips", async (req, res): Promise<void> => {
  try {
    const driver = (req as any).driverUser as { id: string } | undefined;
    if (!driver) {
      res.json({ trips: [] });
      return;
    }
    const me = String(driver.id);

    const daysRaw = Number(req.query.days);
    const days = Number.isFinite(daysRaw) ? Math.min(31, Math.max(1, Math.floor(daysRaw))) : 1;
    const daysBack = days - 1;

    const raw = await db.execute(sql`
      with fares as (
        select
          t."timestamp" as ts,
          t.status,
          abs(t.amount) as amount,
          t.origin,
          t.destination,
          coalesce(t.route_id::text, '') || '|' || coalesce(t.origin, '') || '|' || coalesce(t.destination, '') as route_key
        from transactions t
        where t.type = 'Fare'
          and t."timestamp" >= (
            (date_trunc('day', now() at time zone 'Asia/Manila') - (${daysBack}::int * interval '1 day'))
            at time zone 'Asia/Manila'
          )
          and (
            t.driver_id = ${me}
            or (
              t.driver_id is null
              and t.device_id in (select d.device_id from devices d where d.driver_id = ${me})
            )
          )
      ),
      flagged as (
        select
          fares.*,
          case
            when lag(ts) over (order by ts) is null then 1
            when ts - lag(ts) over (order by ts) > (${TRIP_GAP_MINUTES}::int * interval '1 minute') then 1
            when route_key is distinct from lag(route_key) over (order by ts) then 1
            else 0
          end as is_new
        from fares
      ),
      grouped as (
        select
          flagged.*,
          sum(is_new) over (order by ts rows between unbounded preceding and current row) as trip_no
        from flagged
      )
      select
        trip_no,
        min(ts) as started_at,
        max(ts) as ended_at,
        count(*)::int as taps,
        coalesce(sum(case when status = 'Success' then amount else 0 end), 0) as fare,
        max(origin) as origin,
        max(destination) as destination
      from grouped
      group by trip_no
      order by min(ts) desc
    `);

    const rows = extractRows<{
      trip_no: string | number;
      started_at: string | Date;
      ended_at: string | Date;
      taps: number;
      fare: string | number;
      origin: string | null;
      destination: string | null;
    }>(raw);

    res.json({
      trips: rows.map((r) => ({
        key: `${days}-${String(r.trip_no)}`,
        origin: r.origin ?? null,
        destination: r.destination ?? null,
        startedAt: new Date(r.started_at).toISOString(),
        endedAt: new Date(r.ended_at).toISOString(),
        taps: Number(r.taps) || 0,
        fare: Math.abs(Number(r.fare)) || 0,
      })),
    });
  } catch (error) {
    console.error("my-trips error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Account-wide route reset markers. The owner always comes from the verified
// custom driver token attached by requireAuth, never from browser input.
function getDriverId(req: any): string | null {
  const id = req.driverUser?.id;
  return id === null || id === undefined ? null : String(id);
}

router.get("/dashboard/route-resets", async (req, res): Promise<void> => {
  try {
    const owner = getDriverId(req);
    if (!owner) {
      res.status(403).json({ error: "Drivers only" });
      return;
    }

    const raw = await db.execute(sql`
      select route_id, device_id, created_at
      from public.driver_route_resets
      where owner = ${owner}
      order by created_at desc
    `);
    const rows = extractRows<{
      route_id: string;
      device_id: string | null;
      created_at: string | Date;
    }>(raw);

    res.json({
      rows: rows.map((row) => ({
        route_id: String(row.route_id),
        device_id: row.device_id ? String(row.device_id) : null,
        created_at: new Date(row.created_at).toISOString(),
      })),
    });
  } catch (error) {
    console.error("GET /dashboard/route-resets error:", error);
    res.status(500).json({ error: "Failed to load route resets" });
  }
});

router.post("/dashboard/route-resets", async (req, res): Promise<void> => {
  try {
    const owner = getDriverId(req);
    if (!owner) {
      res.status(403).json({ error: "Drivers only" });
      return;
    }

    if (!Array.isArray(req.body?.routeIds)) {
      res.status(400).json({ error: "routeIds must be an array" });
      return;
    }

    const routeIds = Array.from(
      new Set(
        req.body.routeIds
          .filter((id: unknown) => id !== null && id !== undefined)
          .map((id: unknown) => String(id).trim())
          .filter((id: string) => id.length > 0)
      )
    );
    if (routeIds.length === 0) {
      res.status(400).json({ error: "At least one route ID is required" });
      return;
    }

    const deviceId =
      typeof req.body.deviceId === "string" && req.body.deviceId.trim()
        ? req.body.deviceId.trim()
        : null;

    for (const routeId of routeIds) {
      await db.execute(sql`
        insert into public.driver_route_resets
          (owner, route_id, device_id, created_at)
        values (${owner}, ${routeId}, ${deviceId}, now())
        on conflict (owner, route_id)
        do update set
          device_id = coalesce(
            excluded.device_id,
            driver_route_resets.device_id
          ),
          created_at = now()
      `);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("POST /dashboard/route-resets error:", error);
    res.status(500).json({ error: "Failed to save route resets" });
  }
});

router.delete("/dashboard/route-resets", async (req, res): Promise<void> => {
  try {
    const owner = getDriverId(req);
    if (!owner) {
      res.status(403).json({ error: "Drivers only" });
      return;
    }

    if (!Array.isArray(req.body?.routeIds)) {
      res.status(400).json({ error: "routeIds must be an array" });
      return;
    }

    const routeIds = Array.from(
      new Set(
        req.body.routeIds
          .filter((id: unknown) => id !== null && id !== undefined)
          .map((id: unknown) => String(id).trim())
          .filter((id: string) => id.length > 0)
      )
    );
    if (routeIds.length === 0) {
      res.status(400).json({ error: "At least one route ID is required" });
      return;
    }

    for (const routeId of routeIds) {
      await db.execute(sql`
        delete from public.driver_route_resets
        where owner = ${owner} and route_id = ${routeId}
      `);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /dashboard/route-resets error:", error);
    res.status(500).json({ error: "Failed to restore routes" });
  }
});

router.patch(
  "/dashboard/route-resets/clear-device",
  async (req, res): Promise<void> => {
    try {
      const owner = getDriverId(req);
      if (!owner) {
        res.status(403).json({ error: "Drivers only" });
        return;
      }

      await db.execute(sql`
        update public.driver_route_resets
        set device_id = null
        where owner = ${owner} and device_id is not null
      `);
      res.json({ success: true });
    } catch (error) {
      console.error("PATCH /dashboard/route-resets/clear-device error:", error);
      res.status(500).json({ error: "Failed to clear saved device" });
    }
  }
);
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
