import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyAdminToken } from "./admin-token";

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Blocks the request unless the caller is an authenticated admin who is
 * either a super_admin, or a staff account with permission = 'full_access'.
 * Always re-checks permission fresh from the DB (never trusts the token).
 *
 * Usage:
 *   router.patch("/users/:id", requireFullAccess, async (req, res) => { ... });
 *   router.delete("/users/:id", requireFullAccess, async (req, res) => { ... });
 */
export async function requireFullAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ success: false, message: "Not authenticated" });
    return;
  }

  const adminUser = verifyAdminToken(token);
  if (!adminUser) {
    res.status(401).json({ success: false, message: "Invalid token" });
    return;
  }

  const role = (adminUser as any).role === "super_admin" ? "super_admin" : "staff";
  if (role === "super_admin") {
    (req as any).admin = { ...adminUser, role, permission: "full_access" };
    next();
    return;
  }

  const result = await db.execute(sql`
    select permission from admins where username = ${adminUser.username} limit 1
  `);
  const rows: any[] = Array.isArray(result) ? result : (result as any).rows ?? [];
  const permission = rows[0]?.permission === "view_only" ? "view_only" : "full_access";

  if (permission === "view_only") {
    res.status(403).json({
      success: false,
      message: "Your account is set to view-only. Contact a Super Admin to request full access.",
    });
    return;
  }

  (req as any).admin = { ...adminUser, role, permission };
  next();
}