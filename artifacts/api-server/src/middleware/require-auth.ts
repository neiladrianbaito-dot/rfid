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
 *   GET   /dashboard/my-trips       (their real trips: route, time, taps, fare)
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
    path: /\/dashboard\/(stats|my-routes|my-trips)\/?$/,
  },
  {
    methods: new Set(["POST"]),
    path: /\/dashboard\/claim-device\/?$/,
  },
];

/**
 * Endpoints that belong to DRIVERS ONLY.
 * Admin tokens get 403 here (admin no longer manages fare routes).
 * NOTE: GET /dashboard/stats is NOT in this list, because the admin
 * dashboard still uses it for system-wide totals.
 */
const DRIVER_ONLY_RULES: { methods: Set<string>; path: RegExp }[] = [
  {
    methods: new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: /\/routes\/(?!active\/?$)[^/]+(\/toggle)?\/?$|\/routes\/?$/,
  },
  {
    methods: new Set(["GET"]),
    path: /\/dashboard\/(my-routes|my-trips)\/?$/,
  },
  {
    methods: new Set(["POST"]),
    path: /\/dashboard\/claim-device\/?$/,
  },
];

function getPath(req: Request): string {
  return req.originalUrl.split("?")[0];
}

function driverMayAccess(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = getPath(req);
  return DRIVER_RULES.some((rule) => rule.methods.has(method) && rule.path.test(path));
}

function isDriverOnlyEndpoint(req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = getPath(req);
  return DRIVER_ONLY_RULES.some((rule) => rule.methods.has(method) && rule.path.test(path));
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

  // 1) Admin token: NO access to driver-only endpoints (fare routes are managed by drivers)
  const adminUser = verifyAdminToken(token);
  if (adminUser) {
    if (isDriverOnlyEndpoint(req)) {
      res.status(403).json({ error: "Fare routes are managed by drivers only." });
      return;
    }
    (req as any).adminUser = adminUser;
    next();
    return;
  }

  // 2) Driver token: only for allowed endpoints
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