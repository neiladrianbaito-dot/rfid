import { Router, type IRouter } from "express";
import { verifyAdminToken } from "../lib/admin-token";
import { getEffectivePermissions } from "../lib/permissions";

const router: IRouter = Router();

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

// ── GET /admin/permissions/mine ─────────────────────────────────────────────
// Returns the full key→boolean map for the CALLING staff member's own role,
// so the frontend can grey out buttons without one round-trip per action.
// This is intentionally NOT gated by requirePermission — every authenticated
// staff member needs to know their own permissions, otherwise the UI can't
// render at all. It's still gated by "is this a valid admin session" though.
router.get("/admin/permissions/mine", async (req, res): Promise<void> => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: "Missing or malformed Authorization header" });
      return;
    }

    const adminUser = verifyAdminToken(token);
    if (!adminUser) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    const permissions = await getEffectivePermissions(adminUser.role);
    res.json({ role: adminUser.role, permissions });
  } catch (error) {
    console.error("[GET /admin/permissions/mine] error:", error);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

export default router;