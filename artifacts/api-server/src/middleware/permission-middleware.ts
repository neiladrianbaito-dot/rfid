// ─────────────────────────────────────────────────────────────────────────
// ADD THIS to your existing middleware/permission-middleware.ts
// (kept as a separate file here since your original wasn't provided —
// merge it in rather than importing this file directly, so req.adminUser's
// type declaration stays in one place.)
// ─────────────────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";
import { isPermitted, type PermissionKey } from "../lib/permissions";

// requireAdmin already runs first in every route below (it's what
// populates req.adminUser) — requirePermission assumes it has, exactly
// like requireFullAccess and requireSuperAdmin already do in this file.
//
// Usage:
//   router.delete("/admin/users/:id", requireAdmin, requirePermission("user.delete"), handler)
//
// On failure this returns the SAME shape as your other guards
// (403 + { error, code }) so the frontend's existing error handling and
// the "Please contact administrator" modal both work off `code === "FORBIDDEN"`
// without any new plumbing.
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
        error: "You do not have permission to perform this action.",
        code: "FORBIDDEN",
        permission: key,
      });
      return;
    }

    next();
  };
}