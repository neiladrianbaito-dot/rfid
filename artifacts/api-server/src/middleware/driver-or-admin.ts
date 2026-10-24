import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyUserToken } from "../lib/user-token";
import { requireAdmin, requireFullAccess } from "./permission-middleware";

// Put this file at: src/middleware/driver-or-admin.ts

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
 * Returns the driver's identity if the Bearer token is a valid USER token
 * AND the account's role in auth_users is "driver". Otherwise null.
 */
async function resolveDriver(req: Request) {
  const token = getBearerToken(req.headers.authorization);
  if (!token) return null;

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

/**
 * Attach a stand-in adminUser so existing handlers that read
 * req.adminUser!.username (audit logs, etc.) keep working for drivers.
 */
function attachDriver(req: Request, driver: { id: string; email: string; fullName: string }) {
  (req as any).driverUser = driver;
  (req as any).adminUser = {
    username: `driver:${driver.email}`,
    name: driver.fullName,
    role: "staff",
    permission: "full_access",
  };
}

/** READ endpoints: allow admins (any permission) OR drivers. */
export async function requireAdminOrDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const driver = await resolveDriver(req);
    if (driver) {
      attachDriver(req, driver);
      return next();
    }
  } catch (err) {
    console.error("requireAdminOrDriver error:", err);
  }
  return requireAdmin(req, res, next);
}

/** WRITE endpoints: allow drivers OR admins with full_access. */
export async function requireAdminOrDriverWrite(req: Request, res: Response, next: NextFunction) {
  try {
    const driver = await resolveDriver(req);
    if (driver) {
      attachDriver(req, driver);
      return next();
    }
  } catch (err) {
    console.error("requireAdminOrDriverWrite error:", err);
  }
  // requireAdmin reloads the LIVE role/permission, so a view_only admin is
  // still blocked even though the global requireAuth already set req.adminUser.
  return requireAdmin(req, res, () => {
    void requireFullAccess(req, res, next);
  });
}