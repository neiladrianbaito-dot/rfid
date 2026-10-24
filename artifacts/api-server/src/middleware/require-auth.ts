import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyAdminToken } from "../lib/admin-token";
import { verifyUserToken } from "../lib/user-token";

// Replace the contents of your existing requireAuth file with this one.

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
  return Array.isArray(r.rows) ? (r.rows as T[]) : [];
}

/**
 * Drivers may ONLY use the fare-route endpoints:
 *   GET   /routes
 *   POST  /routes
 *   PATCH /routes/:id
 *   PATCH /routes/:id/toggle
 * Everything else (users, transactions, audit logs, DELETE ...) stays admin-only.
 */
const DRIVER_ALLOWED_METHODS = new Set(["GET", "POST", "PATCH"]);
const DRIVER_ALLOWED_PATH = /\/routes(\/[^/]+)?(\/toggle)?\/?$/;

function driverMayAccess(req: Request): boolean {
  if (!DRIVER_ALLOWED_METHODS.has(req.method.toUpperCase())) return false;
  const path = req.originalUrl.split("?")[0];
  return DRIVER_ALLOWED_PATH.test(path);
}

async function resolveDriver(token: string) {
  let payload: any = null;
  try {
    payload = verifyUserToken(token);
  } catch {
    return null;
  }
  if (!payload?.id) return null;

  const raw = await db.execute(sql`
    select id as uid, full_name, email, role
    from auth_users
    where id = ${payload.id}
    limit 1
  `);
  const row = extractRows<{ uid: string; full_name: string; email: string; role: string }>(raw)[0];
  if (!row || row.role !== "driver") return null;

  return { id: row.uid, email: row.email, fullName: row.full_name };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // 1) Admin token (unchanged behaviour)
  const adminUser = verifyAdminToken(token);
  if (adminUser) {
    (req as any).adminUser = adminUser;
    next();
    return;
  }

  // 2) Driver token — only for the fare-route endpoints
  try {
    const driver = await resolveDriver(token);
    if (driver) {
      if (!driverMayAccess(req)) {
        res.status(403).json({ error: "Drivers can only manage fare routes." });
        return;
      }
      (req as any).driverUser = driver;
      (req as any).adminUser = {
        username: `driver:${driver.email}`,
        name: driver.fullName,
        role: "staff",
        permission: "full_access",
      };
      next();
      return;
    }
  } catch (error) {
    console.error("requireAuth driver check error:", error);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(401).json({ error: "Invalid token" });
}