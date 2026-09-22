import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyAdminToken } from "../lib/admin-token";
import { isPermitted, type PermissionKey } from "../lib/permissions";

export const VIEW_ONLY_MESSAGE =
  "Your account is set to View Only. You can browse records, but adding, editing, and deleting are disabled. Please contact a Super Admin if you need access.";

export const SUPER_ADMIN_ONLY_MESSAGE =
  "Only a Super Admin can perform this action.";

export type AdminRole = "staff" | "super_admin";
export type PermissionLevel = "full_access" | "view_only";

export type AdminContext = {
  username: string;
  name?: string;
  role: AdminRole;
  permission: PermissionLevel;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminUser?: AdminContext;
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

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

let permissionColumnReady = false;

export async function ensurePermissionColumn(): Promise<void> {
  if (permissionColumnReady) return;
  await db.execute(sql`
    alter table public.admins
    add column if not exists permission text default 'full_access'
  `);
  permissionColumnReady = true;
}

export function normalizeRole(role: unknown): AdminRole {
  return role === "super_admin" ? "super_admin" : "staff";
}

export function normalizePermission(permission: unknown, role: unknown): PermissionLevel {
  // Super Admin is ALWAYS full access, whatever the column says.
  if (role === "super_admin") return "full_access";
  return permission === "view_only" ? "view_only" : "full_access";
}

/**
 * Verifies the admin token and loads the LIVE role/permission straight from
 * the admins table.
 *
 * Never trust the token for permission: it is signed at login time and goes
 * stale the moment a Super Admin changes someone's access level. A staff
 * member downgraded to view_only must be blocked immediately, without having
 * to log out and back in.
 */
export async function loadAdminContext(authorization?: string): Promise<AdminContext | null> {
  const token = getBearerToken(authorization);
  if (!token) return null;

  const decoded = verifyAdminToken(token);
  if (!decoded) return null;

  await ensurePermissionColumn();

  const raw = await db.execute(sql`
    select username, full_name, role, status, permission
    from admins
    where username = ${decoded.username}
    limit 1
  `);

  const row = extractRows<{
    username: string;
    full_name: string | null;
    role: string | null;
    status: string | null;
    permission: string | null;
  }>(raw)[0];

  // Supabase-only admin with no legacy `admins` row — fall back to the token
  // so we don't accidentally lock them out of the whole dashboard.
  if (!row) {
    const role = normalizeRole((decoded as any).role);
    return {
      username: decoded.username,
      name: (decoded as any).name,
      role,
      permission: "full_access",
    };
  }

  if (row.status === "Disabled") return null;

  const role = normalizeRole(row.role);
  return {
    username: row.username,
    name: row.full_name ?? undefined,
    role,
    permission: normalizePermission(row.permission, role),
  };
}

// ── middleware ───────────────────────────────────────────────────────────────

/** Any authenticated admin (staff or super_admin). Use on READ routes. */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const admin = await loadAdminContext(req.headers.authorization);
    if (!admin) {
      res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" });
      return;
    }
    req.adminUser = admin;
    next();
  } catch (error) {
    console.error("requireAdmin error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Blocks CREATE / UPDATE / DELETE for any admin whose permission is
 * "view_only". Super Admins always pass.
 *
 * Put this on EVERY write route in the app — not just /admin/staff/*.
 * A hidden button on the frontend does not stop a direct API call made
 * with a saved token.
 */
export async function requireFullAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const admin = req.adminUser ?? (await loadAdminContext(req.headers.authorization));
    if (!admin) {
      res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" });
      return;
    }
    req.adminUser = admin;

    if (admin.permission === "view_only") {
      res.status(403).json({
        error: VIEW_ONLY_MESSAGE,
        message: VIEW_ONLY_MESSAGE,
        code: "VIEW_ONLY",
        permission: "view_only",
      });
      return;
    }

    next();
  } catch (error) {
    console.error("requireFullAccess error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/** Super Admin only (staff management, access-level changes). */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const admin = req.adminUser ?? (await loadAdminContext(req.headers.authorization));
    if (!admin) {
      res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" });
      return;
    }
    req.adminUser = admin;

    if (admin.role !== "super_admin") {
      res.status(403).json({
        error: SUPER_ADMIN_ONLY_MESSAGE,
        message: SUPER_ADMIN_ONLY_MESSAGE,
        code: "SUPER_ADMIN_ONLY",
      });
      return;
    }

    next();
  } catch (error) {
    console.error("requireSuperAdmin error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Blanket guard: mount this ONCE before your admin routers so every
 * non-GET request under /api/admin is checked, even on routes you forget
 * to decorate individually.
 *
 *   app.use("/api/admin", blockWritesForViewOnly);
 */
export async function blockWritesForViewOnly(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  return requireFullAccess(req, res, next);
}

/**
 * Fine-grained permission check (e.g. "user.delete"). Assumes requireAdmin
 * (or requireFullAccess/requireSuperAdmin) already ran and populated
 * req.adminUser — same convention as every other guard in this file.
 *
 * Usage:
 *   router.delete("/admin/users/:id", requireAdmin, requirePermission("user.delete"), handler)
 *
 * On failure this returns the same shape as the other guards
 * (403 + { error, code }) so existing frontend error handling keyed off
 * `code === "FORBIDDEN"` works without new plumbing.
 */
export function requirePermission(key: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const adminUser = req.adminUser;
    if (!adminUser) {
      res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" });
      return;
    }

    const allowed = await isPermitted(adminUser.role, key);
    if (!allowed) {
      res.status(403).json({
        error: "You do not have permission to perform this action. Please contact your administrator",
        code: "FORBIDDEN",
        permission: key,
      });
      return;
    }

    next();
  };
}