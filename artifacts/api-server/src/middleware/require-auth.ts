import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyAdminToken } from "../lib/admin-token";
import { verifyUserToken } from "../lib/user-token";

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
 * Drivers may ONLY use:
 *   GET   /routes
 *   POST  /routes
 *   PATCH /routes/:id
 *   PATCH /routes/:id/toggle
 *   GET   /dashboard/stats          (their own Earned today + Total taps)
 *   GET   /dashboard/my-routes      (which active routes belong to them)
 *   POST  /dashboard/claim-device   (take ownership of a reader device)
 * Everything else stays admin-only.
 */
const DRIVER_RULES: { methods: Set<string>; path: RegExp }[] = [
  {
    methods: new Set(["GET", "POST", "PATCH"]),
    path: /\/routes(\/[^/]+)?(\/toggle)?\/?$/,
  },
  {
    methods: new Set(["GET"]),
    path: /\/dashboard\/(stats|my-routes)\/?$/,
  },
  {
    methods: new Set(["POST"]),
    path: /\/dashboard\/claim-device\/?$/,
  },
];

function driverMayAccess(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = req.originalUrl.split("?")[0];
  return DRIVER_RULES.some((rule) => rule.methods.has(method) && rule.path.test(path));
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

  // 1) Admin token (unchanged)
  const adminUser = verifyAdminToken(token);
  if (adminUser) {
    (req as any).adminUser = adminUser;
    next();
    return;
  }

  // 2) Driver token — only for allowed endpoints
  try {
    const driver = await resolveDriver(token);
    if (driver) {
      if (!driverMayAccess(req)) {
        res.status(403).json({ error: "Drivers can only access fare routes and their own stats." });
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