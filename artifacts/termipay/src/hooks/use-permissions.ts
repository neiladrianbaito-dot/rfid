import { useEffect, useState, useCallback } from "react";

export type PermissionKey =
  | "user.card.create"
  | "user.card.disable"
  | "user.edit"
  | "user.delete"
  | "fare.route.add"
  | "fare.route.edit"
  | "fare.route.activate"
  | "fare.route.delete"
  | "reports.download.pdf"
  | "reports.download.excel"
  | "disbursement.trigger";

type PermissionMap = Partial<Record<PermissionKey, boolean>>;

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function getAuthHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("termipay_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── usePermissions ────────────────────────────────────────────────────────
// Single source of truth for "can the logged-in admin do X" on the
// frontend. Reads the map straight from GET /auth/me (already the source
// of truth for role/canManage), so there's no separate fetch and no risk
// of the button state drifting out of sync with what the backend will
// actually enforce.
//
// IMPORTANT: this is a UI convenience only. The backend's
// requirePermission() middleware is what actually stops unauthorized
// writes — this hook exists so Staff sees a disabled button *before*
// wasting a round trip on something that will 403 anyway.
export function usePermissions() {
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
        headers: { ...getAuthHeaders() },
      });
      if (!response.ok) return;
      const data = await response.json();
      setRole(data.role ?? null);
      setPermissions(data.permissions ?? {});
    } catch (error) {
      console.error("Failed to load permissions:", error);
    } finally {
      setLoaded(true);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // super_admin is always allowed everywhere, mirroring the backend's
  // isPermitted() hard-coded check — a stale/missing permissions map can
  // never accidentally lock out a super admin's UI.
  const can = useCallback(
    (key: PermissionKey): boolean => {
      if (role === "super_admin") return true;
      return permissions[key] === true;
    },
    [role, permissions]
  );

  return { can, role, permissions, loaded, refresh };
}