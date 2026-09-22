import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logAudit } from "../lib/audit-logger";
import {
  requireAdmin,
  requireSuperAdmin,
} from "../middleware/permission-middleware";
import {
  PERMISSION_KEYS,
  getEffectivePermissions,
  invalidatePermissionCache,
  type PermissionKey,
} from "../lib/permissions";

const router: IRouter = Router();

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

// ── GET /admin/permissions/mine ──────────────────────────────────────────
// READ-ONLY, any authenticated admin (including Staff / view_only). This is
// what the frontend's usePermissions() hook calls to decide which buttons
// to disable. Cheap: served from the 30s in-process cache.
router.get("/admin/permissions/mine", requireAdmin, async (req, res): Promise<void> => {
  try {
    const permissions = await getEffectivePermissions(req.adminUser!.role);
    res.json({ success: true, role: req.adminUser!.role, permissions });
  } catch (error) {
    console.error("Get my permissions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/permissions ───────────────────────────────────────────────
// Full matrix + catalog, for rendering the checkbox grid in Settings.
// Super Admin only — Staff never needs to see the whole matrix, only their
// own slice (served above).
router.get("/admin/permissions", requireAdmin, requireSuperAdmin, async (_req, res): Promise<void> => {
  try {
    const catalogRaw = await db.execute(sql`
      select permission_key, label, module, sort_order
      from permission_catalog
      order by module, sort_order
    `);
    const rulesRaw = await db.execute(sql`
      select role, permission_key, allowed from role_permissions
    `);

    res.json({
      success: true,
      catalog: extractRows(catalogRaw),
      rules: extractRows(rulesRaw),
      roles: ["staff", "super_admin"],
    });
  } catch (error) {
    console.error("Get permission matrix error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /admin/permissions ─────────────────────────────────────────────
// Body: { role: "staff", permission_key: "user.delete", allowed: true }
// Super Admin only. A super_admin's own row is never editable — they're
// always full access, mirrors the hard-coded check in isPermitted().
router.patch("/admin/permissions", requireAdmin, requireSuperAdmin, async (req, res): Promise<void> => {
  try {
    const adminUser = req.adminUser!;
    const body = req.body as { role?: string; permission_key?: string; allowed?: boolean };

    const role = body?.role;
    const permissionKey = body?.permission_key as PermissionKey | undefined;
    const allowed = body?.allowed;

    if (role !== "staff") {
      // Only "staff" is editable today. super_admin is intentionally
      // excluded — expand this allow-list if you introduce more roles.
      res.status(400).json({ error: "Only the 'staff' role's permissions can be changed." });
      return;
    }
    if (!permissionKey || !PERMISSION_KEYS.includes(permissionKey)) {
      res.status(400).json({ error: "Unknown permission_key." });
      return;
    }
    if (typeof allowed !== "boolean") {
      res.status(400).json({ error: "allowed must be a boolean." });
      return;
    }

    await db.execute(sql`
      insert into role_permissions (role, permission_key, allowed, updated_by, updated_at)
      values (${role}, ${permissionKey}, ${allowed}, ${adminUser.username}, now())
      on conflict (role, permission_key)
      do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now()
    `);

    invalidatePermissionCache();

    await logAudit({
      user: adminUser.username,
      action: "UPDATE",
      entity: "Permission",
      details: `${adminUser.username} set "${permissionKey}" for role "${role}" to ${allowed}`,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Update permission error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;