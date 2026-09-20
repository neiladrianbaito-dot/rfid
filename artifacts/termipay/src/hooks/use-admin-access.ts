import { useEffect, useState, useCallback } from "react";

export type AdminRole = "staff" | "super_admin";
export type PermissionLevel = "full_access" | "view_only";

export interface AdminAccess {
  role: AdminRole | null;
  permission: PermissionLevel;
  loaded: boolean;
  isSuperAdmin: boolean;
  /** True only when the account is allowed to add/edit/delete anything. */
  canManage: boolean;
  refresh: () => void;
}

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function getAuthHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("termipay_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Drop this into ANY admin page that has add/edit/delete controls.
 * It hits /api/auth/me (same endpoint Settings.tsx uses) and gives you
 * back a single `canManage` boolean so every page enforces the same rule:
 *
 *   const { canManage, loaded } = useAdminAccess();
 *   {loaded && canManage && <Button onClick={...}>Add</Button>}
 *
 * IMPORTANT: this only controls what's shown in the UI. The actual
 * create/update/delete API routes must ALSO reject view_only staff
 * server-side (see permission-middleware.ts) — a hidden button does not
 * stop a direct API call with a saved token.
 */
export function useAdminAccess(): AdminAccess {
  const [role, setRole] = useState<AdminRole | null>(null);
  const [permission, setPermission] = useState<PermissionLevel>("full_access");
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);

    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
          headers: { ...getAuthHeaders() },
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (response.ok && data.role) {
          setRole(data.role === "super_admin" ? "super_admin" : "staff");
          setPermission(data.permission === "view_only" ? "view_only" : "full_access");
        } else {
          setRole(null);
        }
      } catch (error) {
        console.error("useAdminAccess: failed to load /auth/me", error);
        if (!cancelled) setRole(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const isSuperAdmin = role === "super_admin";
  // Super Admin is always full_access on the backend. Staff is gated by
  // their stored permission. Anyone not loaded yet is treated as
  // non-managing so buttons don't flash visible then disappear.
  const canManage = loaded && (isSuperAdmin || permission === "full_access");

  return { role, permission, loaded, isSuperAdmin, canManage, refresh };
}