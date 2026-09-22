import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Blocks any route status changes if a Super Admin locked down the route.
 * Assumes requireAdmin has already run to populate req.adminUser.
 */
export async function blockStaffIfRouteLocked(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Looks for route identifiers across possible incoming structural styles
    const routeId = req.body.p_route_id || req.body.routeId || req.params.routeId;

    if (!routeId) {
      next();
      return;
    }

    // Query status safely via your existing Drizzle connection setup
    const result = await db.execute(sql`
      select is_admin_locked 
      from public.fare_routes 
      where id = ${routeId} 
      limit 1
    `);

    // Safely extract rows across diverse raw engine drivers
    const rows = (Array.isArray(result) ? result : (result as any).rows) || [];
    const route = rows[0] as { is_admin_locked: boolean | null } | undefined;

    if (!route) {
      res.status(404).json({ error: "Route not found" });
      return;
    }

    // Reject non-super_admin ("staff") operations if lock configuration is true
    if (route.is_admin_locked === true) {
      const admin = req.adminUser;
      
      if (!admin || admin.role !== "super_admin") {
        res.status(403).json({
          error: "This route has been locked by a Super Administrator. Staff are not permitted to change its status.",
          message: "This route has been locked by a Super Administrator. Staff are not permitted to change its status.",
          code: "ROUTE_LOCKED_BY_ADMIN",
        });
        return;
      }
    }

    next();
  } catch (error) {
    console.error("blockStaffIfRouteLocked middleware error:", error);
    res.status(500).json({ error: "Internal server error validation check." });
  }
}
