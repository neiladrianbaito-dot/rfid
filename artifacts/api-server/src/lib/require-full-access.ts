import type { Request, Response, NextFunction } from "express";
import { verifyAdminToken } from "../lib/admin-token";
import { db, sql } from "@workspace/db"; // adjust import to match your actual db export

/**
 * Blocks write actions (add/edit/delete) for any admin whose permission is
 * "view_only". Super Admins always pass (their permission is forced to
 * full_access at the DB layer, but we double-check here too).
 *
 * Use this on every create/update/delete route across the app — not just
 * /admin/staff/* — otherwise a view_only staff member can still call the
 * API directly with their saved token even if the button is hidden on the
 * frontend.
 *
 * Usage:
 *   router.post("/admin/users", requireFullAccess, async (req, res) => { ... });
 *   router.patch("/admin/users/:id", requireFullAccess, async (req, res) => { ... });
 *   router.delete("/admin/users/:id", requireFullAccess, async (req, res) => { ... });
 *
 * Must run AFTER an admin-auth check that sets req.adminUser, or it does
 * its own token verification if none is present yet (see below).
 */
export async function requireFullAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (!token) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const adminUser = verifyAdminToken(token);
    if (!adminUser) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const role = (adminUser as any).role === "super_admin" ? "super_admin" : "staff";
    if (role === "super_admin") {
      next();
      return;
    }

    const result = await db.execute(sql`
      select permission from admins where username = ${adminUser.username} limit 1
    `);
    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    const permission = rows[0]?.permission === "view_only" ? "view_only" : "full_access";

    if (permission === "view_only") {
      res.status(403).json({ error: "Your account is set to View Only. This action is not allowed." });
      return;
    }

    next();
  } catch (error) {
    console.error("requireFullAccess error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}