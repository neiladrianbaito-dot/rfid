// server/lib/audit-logger.ts
//
// Central place that writes every audit trail entry.
// Uses the SAME Drizzle `db` connection as the rest of the app —
// no separate Supabase client / service role key needed.

import type { Request } from "express";
import { isIP } from "node:net";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "RESTORE"
  | "EXPORT";

export type AuditStatus = "success" | "failed";

interface LogAuditParams {
  user?: string | null;   // username/email; falls back to "unknown" when empty
  action: AuditAction;
  entity: string;         // "Admin", "User", "Scholars", "Database", etc.
  details: string;        // human-readable line
  status?: AuditStatus;   // defaults to "success"
  req?: Request;          // pass the Express request so the IP is captured
  ip?: string | null;     // or pass an IP directly (overrides req)
}

const MAX_USER = 120;
const MAX_ENTITY = 80;
const MAX_DETAILS = 1000;

const clip = (value: string, max: number) =>
  value.length > max ? value.slice(0, max - 1) + "…" : value;

/**
 * Best-effort client IP from an Express request.
 *
 * IMPORTANT: for req.ip to be the real client and not your proxy, set this
 * once in app.ts:
 *     app.set("trust proxy", 1);
 *
 * Returns null if nothing valid is found, so the inet column never receives
 * a malformed value (which would make the insert fail).
 */
export function getClientIp(req?: Request): string | null {
  if (!req) return null;

  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  // req.ip already respects Express's "trust proxy" setting, so it is the
  // safest source. We do NOT read the first X-Forwarded-For entry ourselves:
  // that value is supplied by the client and can be faked.
  // cf-connecting-ip is only honoured if you are really behind Cloudflare
  // (set TRUST_CLOUDFLARE=true), because otherwise anyone can send it.
  const candidates = [
    process.env["TRUST_CLOUDFLARE"] === "true" ? header("cf-connecting-ip") : undefined,
    req.ip,
    req.socket?.remoteAddress,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    let ip = raw.trim();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7); // IPv4-mapped IPv6 → IPv4
    if (isIP(ip)) return ip;
  }
  return null;
}

/**
 * Writes one row to audit_logs. Fire-and-forget by design — an audit log
 * failure should never block or fail the actual request. Errors are
 * swallowed and only logged to the server console.
 */
export async function logAudit({
  user,
  action,
  entity,
  details,
  status = "success",
  req,
  ip,
}: LogAuditParams): Promise<void> {
  try {
    const actor = user && user.trim() ? clip(user.trim(), MAX_USER) : "unknown";
    const clientIp = ip ?? getClientIp(req);

    await db.execute(sql`
      insert into audit_logs ("user", action, entity, details, ip_address, status)
      values (
        ${actor},
        ${action},
        ${clip(entity, MAX_ENTITY)},
        ${clip(details, MAX_DETAILS)},
        ${clientIp}::inet,
        ${status}
      )
    `);
  } catch (error) {
    console.error("[audit] failed to write log:", error);
  }
}