import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Permission keys ──────────────────────────────────────────────────────
// Keep this list in sync with db/002_permission_matrix.sql's
// permission_catalog seed. It exists as a TS union so route files get
// autocomplete + a compile error if they typo a key, instead of a string
// that silently never matches.
export const PERMISSION_KEYS = [
  "user.card.create",
  "user.card.disable",
  "user.edit",
  "user.delete",
  "fare.route.add",
  "fare.route.edit",
  "fare.route.activate",
  "fare.route.delete",
  "reports.download.pdf",
  "reports.download.excel",
  "disbursement.trigger",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

// ── In-memory cache ──────────────────────────────────────────────────────
// The matrix changes rarely (a super admin flips a checkbox occasionally)
// but is read on nearly every write request, so cache it and invalidate on
// write. A TTL is kept as a safety net against multi-instance deployments
// where one instance's cache doesn't see another instance's write.
type Matrix = Record<string, Partial<Record<PermissionKey, boolean>>>;

let cache: Matrix | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

export function invalidatePermissionCache(): void {
  cache = null;
}

export async function loadPermissionMatrix(): Promise<Matrix> {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;

  const rows = extractRows<{ role: string; permission_key: string; allowed: boolean }>(
    await db.execute(sql`select role, permission_key, allowed from role_permissions`)
  );

  const matrix: Matrix = {};
  for (const row of rows) {
    matrix[row.role] ??= {};
    matrix[row.role][row.permission_key as PermissionKey] = row.allowed;
  }

  cache = matrix;
  cacheLoadedAt = Date.now();
  return matrix;
}

// ── Effective-permission check ───────────────────────────────────────────
// super_admin is ALWAYS allowed, regardless of what's stored in the table —
// this mirrors the existing normalizePermission() belt-and-braces pattern
// in auth.ts, so a bad row in role_permissions can never lock out every
// super admin.
export async function isPermitted(role: string, key: PermissionKey): Promise<boolean> {
  if (role === "super_admin") return true;
  const matrix = await loadPermissionMatrix();
  return matrix[role]?.[key] === true;
}

// Returns the full key→boolean map for one role, used by GET /auth/me and
// GET /admin/permissions/mine so the frontend can decide what to
// disable without one round-trip per button.
export async function getEffectivePermissions(role: string): Promise<Record<PermissionKey, boolean>> {
  const result = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) {
    result[key] = await isPermitted(role, key);
  }
  return result;
}