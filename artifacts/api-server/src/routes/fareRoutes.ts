import { Router, type IRouter, type Request } from "express";
import { eq, ne } from "drizzle-orm";
import { db, fareRoutesTable } from "@workspace/db";
import {
  ListRoutesResponse,
  CreateRouteBody,
  UpdateRouteParams,
  UpdateRouteBody,
  UpdateRouteResponse,
  DeleteRouteParams,
  ToggleRouteParams,
  ToggleRouteResponse,
} from "@workspace/api-zod";
import { verifyAdminToken } from "../lib/admin-token";
import { logAudit } from "../lib/audit-logger";
import { requireAdmin, requireFullAccess } from "../middleware/permission-middleware";
import {
  requireAdminOrDriver,
  requireAdminOrDriverWrite,
} from "../middleware/driver-or-admin";

const router: IRouter = Router();

function formatRoute(r: typeof fareRoutesTable.$inferSelect) {
  return {
    ...r,
    fareAmount: Number(r.fareAmount),
  };
}

// ── Who's making this request? ──────────────────────────────────────────────
// The guards below set req.adminUser (admins, or "driver:<email>" for
// drivers). Falls back to decoding an admin token, then "unknown".

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function getActorFromRequest(req: Request): string {
  if (req.adminUser?.username) return req.adminUser.username;
  const token = getBearerToken(req.headers.authorization);
  if (!token) return "unknown";
  const adminUser = verifyAdminToken(token);
  return adminUser?.username ?? "unknown";
}

// ── Postgres foreign key violation helper ───────────────────────────────────
function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  if (err.code === "23503") return true;
  const cause = err.cause as Record<string, unknown> | undefined;
  if (cause?.code === "23503") return true;
  const message = String(err.message ?? "").toLowerCase();
  if (message.includes("foreign key constraint")) return true;
  const causeMessage = String(cause?.message ?? "").toLowerCase();
  if (causeMessage.includes("foreign key constraint")) return true;
  return false;
}

// READ: admins (any permission) or drivers
router.get("/routes", requireAdminOrDriver, async (_req, res): Promise<void> => {
  try {
    const routes = await db.select().from(fareRoutesTable);
    res.json(ListRoutesResponse.parse(routes.map(formatRoute)));
  } catch (error) {
    console.error("[GET /routes] error:", error);
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

// WRITE: drivers or admins with full access
router.post("/routes", requireAdminOrDriverWrite, async (req, res): Promise<void> => {
  const parsed = CreateRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [route] = await db
      .insert(fareRoutesTable)
      .values({
        origin: parsed.data.origin,
        destination: parsed.data.destination,
        fareAmount: String(parsed.data.fareAmount),
        isActive: true,
      })
      .returning();

    try {
      await logAudit({
        user: getActorFromRequest(req),
        action: "CREATE",
        entity: "Fare Route",
        details: `created route: ${route.origin} → ${route.destination} (₱${Number(route.fareAmount)})`,
      });
    } catch (auditError) {
      console.error("[POST /routes] audit log failed:", auditError);
    }

    res.status(201).json(formatRoute(route));
  } catch (error) {
    console.error("[POST /routes] error:", error);
    res.status(500).json({ error: "Failed to create route" });
  }
});

// Public endpoint — no auth required (used by the ESP32 reader)
router.get("/routes/active", async (_req, res): Promise<void> => {
  try {
    const routes = await db
      .select()
      .from(fareRoutesTable)
      .where(eq(fareRoutesTable.isActive, true));
    res.json(routes.map(formatRoute));
  } catch (error) {
    console.error("[GET /routes/active] error:", error);
    res.status(500).json({ error: "Failed to fetch active routes" });
  }
});

// PATCH /routes/:id — audit log records the ACTUAL changed values (old -> new)
router.patch("/routes/:id", requireAdminOrDriverWrite, async (req, res): Promise<void> => {
  const params = UpdateRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, any> = {};
  if (parsed.data.origin !== undefined) updateData.origin = parsed.data.origin;
  if (parsed.data.destination !== undefined) updateData.destination = parsed.data.destination;
  if (parsed.data.fareAmount !== undefined) updateData.fareAmount = String(parsed.data.fareAmount);
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  try {
    const [beforeRoute] = await db
      .select()
      .from(fareRoutesTable)
      .where(eq(fareRoutesTable.id, params.data.id));

    if (!beforeRoute) {
      res.status(404).json({ error: "Route not found" });
      return;
    }

    const [route] = await db
      .update(fareRoutesTable)
      .set(updateData)
      .where(eq(fareRoutesTable.id, params.data.id))
      .returning();

    if (!route) {
      res.status(404).json({ error: "Route not found" });
      return;
    }

    const changed = Object.entries(updateData).filter(([col, newVal]) => {
      const oldVal = (beforeRoute as Record<string, unknown>)[col];
      return String(oldVal ?? "") !== String(newVal ?? "");
    });

    if (changed.length > 0) {
      const changesSummary = changed
        .map(([col, newVal]) => {
          const oldVal = (beforeRoute as Record<string, unknown>)[col];
          const oldDisplay =
            oldVal === null || oldVal === undefined || oldVal === "" ? "—" : String(oldVal);
          const newDisplay =
            newVal === null || newVal === undefined || newVal === "" ? "—" : String(newVal);
          return `${col}: "${oldDisplay}" → "${newDisplay}"`;
        })
        .join("; ");

      try {
        await logAudit({
          user: getActorFromRequest(req),
          action: "UPDATE",
          entity: "Fare Route",
          details: `updated route: ${route.origin} → ${route.destination} — ${changesSummary}`,
        });
      } catch (auditError) {
        console.error("[PATCH /routes/:id] audit log failed:", auditError);
      }
    }

    res.json(UpdateRouteResponse.parse(formatRoute(route)));
  } catch (error) {
    console.error("[PATCH /routes/:id] error:", error);
    res.status(500).json({ error: "Failed to update route" });
  }
});

// DELETE: admins with full access only (drivers use Reset in the UI instead)
router.delete("/routes/:id", requireAdmin, requireFullAccess, async (req, res): Promise<void> => {
  const params = DeleteRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const [route] = await db
      .delete(fareRoutesTable)
      .where(eq(fareRoutesTable.id, params.data.id))
      .returning();

    if (!route) {
      res.status(404).json({ error: "Route not found" });
      return;
    }

    try {
      await logAudit({
        user: getActorFromRequest(req),
        action: "DELETE",
        entity: "Fare Route",
        details: `deleted route: ${route.origin} → ${route.destination} (₱${Number(route.fareAmount)})`,
      });
    } catch (auditError) {
      console.error("[DELETE /routes/:id] audit log failed:", auditError);
    }

    res.sendStatus(204);
  } catch (error) {
    console.error("[DELETE /routes/:id] delete failed:", error);

    if (isForeignKeyViolation(error)) {
      res.status(409).json({
        error:
          "Cannot delete this route — it is still referenced by existing transactions or records. Try deactivating it instead.",
      });
      return;
    }

    res.status(500).json({ error: "Failed to delete route" });
  }
});

router.patch("/routes/:id/toggle", requireAdminOrDriverWrite, async (req, res): Promise<void> => {
  const params = ToggleRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Accept an optional deviceId so the linked RFID reader gets persisted
  // when a route is activated.
  const rawDeviceId = (req.body as Record<string, unknown> | undefined)?.deviceId;
  const deviceId =
    typeof rawDeviceId === "string" && rawDeviceId.trim().length > 0
      ? rawDeviceId.trim()
      : undefined;

  try {
    const [existing] = await db
      .select()
      .from(fareRoutesTable)
      .where(eq(fareRoutesTable.id, params.data.id));

    if (!existing) {
      res.status(404).json({ error: "Route not found" });
      return;
    }

    const willBeActive = !existing.isActive;

    if (willBeActive) {
      // Deactivate every other route and clear their linked device too.
      await db
        .update(fareRoutesTable)
        .set({ isActive: false, deviceId: null })
        .where(ne(fareRoutesTable.id, params.data.id));
    }

    const updateData: Record<string, any> = { isActive: willBeActive };
    if (willBeActive) {
      updateData.deviceId = deviceId ?? null;
    } else {
      updateData.deviceId = null;
    }

    const [route] = await db
      .update(fareRoutesTable)
      .set(updateData)
      .where(eq(fareRoutesTable.id, params.data.id))
      .returning();

    try {
      await logAudit({
        user: getActorFromRequest(req),
        action: "UPDATE",
        entity: "Fare Route",
        details: willBeActive
          ? `activated route: ${route.origin} → ${route.destination} (deactivated all others)${
              deviceId ? ` — linked device ${deviceId}` : ""
            }`
          : `deactivated route: ${route.origin} → ${route.destination}`,
      });
    } catch (auditError) {
      console.error("[PATCH /routes/:id/toggle] audit log failed:", auditError);
    }

    res.json(ToggleRouteResponse.parse(formatRoute(route)));
  } catch (error) {
    console.error("[PATCH /routes/:id/toggle] error:", error);
    res.status(500).json({ error: "Failed to toggle route" });
  }
});

export default router;