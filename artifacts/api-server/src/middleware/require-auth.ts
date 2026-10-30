import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyAdminToken } from "../lib/admin-token";
import { verifyUserToken } from "../lib/user-token";

type RouteRule = { methods: Set<string>; path: RegExp };

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const value = result as Record<string, unknown>;
  return Array.isArray(value.rows) ? (value.rows as T[]) : [];
}

// Keep the existing driver access boundaries and add the account reset API.
const DRIVER_RULES: RouteRule[] = [
  {
    methods: new Set(["GET", "POST", "PATCH"]),
    path: /\/routes(?:\/[^/]+(?:\/toggle)?)?\/?$/,
  },
  {
    methods: new Set(["GET"]),
    path: /\/dashboard\/(stats|my-routes|my-trips|route-resets)\/?$/,
  },
  {
    methods: new Set(["POST"]),
    path: /\/dashboard\/(claim-device|route-resets)\/?$/,
  },
  {
    methods: new Set(["DELETE"]),
    path: /\/dashboard\/route-resets\/?$/,
  },
  {
    methods: new Set(["PATCH"]),
    path: /\/dashboard\/route-resets\/clear-device\/?$/,
  },
];

// Admin tokens are denied on routes and driver-only dashboard endpoints.
const DRIVER_ONLY_RULES: RouteRule[] = [
  {
    methods: new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: /\/routes(?:\/(?!active\/?$)[^/]+(?:\/toggle)?)?\/?$/,
  },
  {
    methods: new Set(["GET"]),
    path: /\/dashboard\/(my-routes|my-trips|route-resets)\/?$/,
  },
  {
    methods: new Set(["POST"]),
    path: /\/dashboard\/(claim-device|route-resets)\/?$/,
  },
  {
    methods: new Set(["DELETE"]),
    path: /\/dashboard\/route-resets\/?$/,
  },
  {
    methods: new Set(["PATCH"]),
    path: /\/dashboard\/route-resets\/clear-device\/?$/,
  },
];

function getPath(req: Request): string {
  return req.originalUrl.split("?")[0];
}

function matches(rules: RouteRule[], req: Request): boolean {
  const method = req.method.toUpperCase();
  const path = getPath(req);
  return rules.some((rule) => rule.methods.has(method) && rule.path.test(path));
}

function driverMayAccess(req: Request): boolean {
  return matches(DRIVER_RULES, req);
}

function isDriverOnlyEndpoint(req: Request): boolean {
  return matches(DRIVER_ONLY_RULES, req);
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
  const row = extractRows<{
    uid: string | number;
    full_name: string;
    email: string;
    role: string;
  }>(raw)[0];

  if (!row || row.role !== "driver") return null;

  // This database ID is the canonical account key used by route reset records.
  return {
    id: String(row.uid),
    email: row.email,
    fullName: row.full_name,
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Admin tokens cannot call driver-only routes or reset endpoints.
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

  try {
    const driver = await resolveDriver(token);
    if (!driver) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    if (!driverMayAccess(req)) {
      res.status(403).json({
        error: "Drivers can only access fare routes and their own dashboard data.",
      });
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
  } catch (error) {
    console.error("requireAuth driver check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
