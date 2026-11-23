import { Router, type IRouter } from "express";
import { logAudit } from "../lib/audit-logger";
import { verifyAdminToken } from "../lib/admin-token";

const router: IRouter = Router();

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

// ── POST /audit/log-export ──────────────────────────────────────────────────
// Called by the frontend right when a user triggers an Excel export or opens
// the print/PDF dialog. Never blocks the actual export — always resolves
// with 200 even if the audit write itself fails internally (logAudit()
// already swallows its own errors and just console.errors them).
router.post("/audit/log-export", async (req, res): Promise<void> => {
  try {
    const token = getBearerToken(req.headers.authorization);
    const adminUser = token ? verifyAdminToken(token) : null;

    const body = (req.body ?? {}) as { entity?: string; format?: string; details?: string };
    const entity = body.entity?.trim() || "Report";
    const format = body.format?.trim() || "File";

    if (!adminUser) {
      // No / invalid / expired token → unauthenticated attempt.
      // Record it as FAILED with user "unknown" + the caller's IP.
      // Don't trust client-supplied `details` here; write our own line.
      await logAudit({
        user: "unknown",
        action: "EXPORT",
        entity,
        details: token
          ? `Export attempt with invalid or expired token (${entity} as ${format})`
          : `Unauthenticated export attempt (${entity} as ${format})`,
        status: "failed",
        req,
      });
      res.status(200).json({ success: false });
      return;
    }

    const actor = adminUser.username;
    await logAudit({
      user: actor,
      action: "EXPORT",
      entity,
      details: body.details?.trim() || `${actor} exported ${entity} as ${format}`,
      status: "success",
      req,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Log export audit error:", error);
    // Never block the actual export/download because of a logging failure
    res.status(200).json({ success: false });
  }
});

export default router;