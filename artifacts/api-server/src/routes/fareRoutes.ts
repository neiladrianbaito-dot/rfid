import { Router, type IRouter } from "express";
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
import { z } from "zod/v4";
import { verifyAdminToken } from "../lib/admin-token";
import { logAudit } from "../lib/audit-logger";

const router: IRouter = Router();

function formatRoute(r: typeof fareRoutesTable.$inferSelect) {
  return {
    ...r,
    fareAmount: Number(r.fareAmount),
  };
}

// ✅ NEW: validates the optional deviceId sent when activating a route.
// If your @workspace/api-zod package already exports a ToggleRouteBody
// schema, import and use that instead of this local one for consistency.
const ToggleRouteBody = z
  .object({
    deviceId: z.string().min(1).optional(),
  })
  .optional();

// ── Who's making this request? ──────────────────────────────────────────────
// Same pattern as users.ts — best-effort actor resolution for the audit
// trail. Falls back to "unknown" rather than blocking the request.

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function getActorFromRequest(authorization?: string): string {
  const token = getBearerToken(authorization);
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

router.get("/routes", async (_req, res): Promise<void> => {
  try {
    const routes = await db.select().from(fareRoutesTable);
    res.json(ListRoutesResponse.parse(routes.map(formatRoute)));
  } catch (error) {
    console.error("[GET /routes] error:", error);
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

router.post("/routes", async (req, res): Promise<void> => {
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
        user: getActorFromRequest(req.headers.authorization),
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

// Public endpoint — no auth required
router.get("/routes/active", async (_req, res): Promise<void> => {
  try {
    const routes = await db.select().from(fareRoutesTable)
      .where(eq(fareRoutesTable.isActive, true));
    res.json(routes.map(formatRoute));
  } catch (error) {
    console.error("[GET /routes/active] error:", error);
    res.status(500).json({ error: "Failed to fetch active routes" });
  }
});

router.patch("/routes/:id", async (req, res): Promise<void> => {
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
    const [route] = await db
      .update(fareRoutesTable)
      .set(updateData)
      .where(eq(fareRoutesTable.id, params.data.id))
      .returning();

    if (!route) {
      res.status(404).json({ error: "Route not found" });
      return;
    }

    try {
      await logAudit({
        user: getActorFromRequest(req.headers.authorization),
        action: "UPDATE",
        entity: "Fare Route",
        details: `updated route: ${route.origin} → ${route.destination} — fields changed: ${Object.keys(updateData).join(", ")}`,
      });
    } catch (auditError) {
      console.error("[PATCH /routes/:id] audit log failed:", auditError);
    }

    res.json(UpdateRouteResponse.parse(formatRoute(route)));
  } catch (error) {
    console.error("[PATCH /routes/:id] error:", error);
    res.status(500).json({ error: "Failed to update route" });
  }
});

router.delete("/routes/:id", async (req, res): Promise<void> => {
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
        user: getActorFromRequest(req.headers.authorization),
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

router.patch("/routes/:id/toggle", async (req, res): Promise<void> => {
  const params = ToggleRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // ✅ NEW: read + validate the optional deviceId sent when activating.
  const bodyParsed = ToggleRouteBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const requestedDeviceId = bodyParsed.data?.deviceId;

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
      // Deactivate every other route AND clear their assigned device,
      // since only one route (and one reader) should be live at a time.
      await db
        .update(fareRoutesTable)
        .set({ isActive: false, deviceId: null })
        .where(ne(fareRoutesTable.id, params.data.id));
    }

    // ✅ NEW: persist deviceId when activating, clear it when deactivating.
    const [route] = await db
      .update(fareRoutesTable)
      .set({
        isActive: willBeActive,
        deviceId: willBeActive ? requestedDeviceId ?? null : null,
      })
      .where(eq(fareRoutesTable.id, params.data.id))
      .returning();

    try {
      await logAudit({
        user: getActorFromRequest(req.headers.authorization),
        action: "UPDATE",
        entity: "Fare Route",
        details: willBeActive
          ? `activated route: ${route.origin} → ${route.destination} (device: ${route.deviceId ?? "none"}, deactivated all others)`
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