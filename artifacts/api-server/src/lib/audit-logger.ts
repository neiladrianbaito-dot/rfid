// server/lib/audit-logger.ts
//
// Central place that writes every audit trail entry.
// Uses the SAME Drizzle `db` connection as the rest of the app —
// no separate Supabase client / service role key needed.

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

interface LogAuditParams {
  user: string;          // username/email of whoever performed the action
  action: AuditAction;
  entity: string;         // "Admin", "User", "Scholars", "Database", etc.
  details: string;        // human-readable line, e.g. `${user} updated scholar: ${fullName}`
}

/**
 * Writes one row to audit_logs. Fire-and-forget by design — an audit log
 * failure should never block or fail the actual request. Errors are
 * swallowed and only logged to the server console.
 */
export async function logAudit({ user, action, entity, details }: LogAuditParams): Promise<void> {
  try {
    await db.execute(sql`
      insert into audit_logs ("user", action, entity, details)
      values (${user}, ${action}, ${entity}, ${details})
    `);
  } catch (error) {
    console.error("[audit] failed to write log:", error);
  }
}