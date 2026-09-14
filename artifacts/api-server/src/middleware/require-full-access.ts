import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyAdminToken } from "../lib/admin-token";

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

/**
 * Middleware para sa lahat ng POST/PUT/PATCH/DELETE routes
 * (maliban sa /admin/staff/* na may sarili nang super_admin check).
 *
 * Hindi ito umaasa sa role/permission na naka-encode sa JWT —
 * fresh na kinukuha sa DB kada request, dahil baka bago lang
 * binago ng super admin ang access ng account.
 */
export async function requireFullAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getBearerToken(req.headers.authorization);
    const adminUser = token ? verifyAdminToken(token) : null;

    if (!adminUser) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const role = (adminUser as any).role === "super_admin" ? "super_admin" : "staff";

    if (role === "super_admin") {
      next();
      return;
    }

    const rows = await db.execute(sql`
      select permission from admins where username = ${adminUser.username} limit 1
    `);
    const permission = extractRows<{ permission: string | null }>(rows)[0]?.permission;

    if (permission === "view_only") {
      res.status(403).json({
        error: "View-only account. Hindi pinapayagan ang aksyong ito (create, update, o delete).",
      });
      return;
    }

    next();
  } catch (error) {
    console.error("requireFullAccess error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}