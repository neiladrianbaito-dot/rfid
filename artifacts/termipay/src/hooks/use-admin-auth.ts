import { useEffect, useState, useCallback } from "react";

export type AdminRole = "staff" | "super_admin";
export type AdminPermission = "full_access" | "view_only";

interface AdminAuthState {
  username: string | null;
  name: string | null;
  role: AdminRole | null;
  permission: AdminPermission | null;
  isSuperAdmin: boolean;
  isViewOnly: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// 👈 ASSUMPTION #1: change this if your login page stores the admin token
// under a different localStorage key (or in a cookie / context instead).
const ADMIN_TOKEN_KEY = "admin_token";

// 👈 ASSUMPTION #2: change this if your API isn't served at a relative path.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export function useAdminAuth(): AdminAuthState {
  const [username, setUsername] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [permission, setPermission] = useState<AdminPermission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const token = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (!token) {
        if (!cancelled) {
          setUsername(null);
          setName(null);
          setRole(null);
          setPermission(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        // Always ask the server for the CURRENT permission — never trust a
        // value cached in the token or in localStorage, since a super admin
        // may have flipped this account to view_only after the token was
        // issued. /auth/me already reads permission fresh from the DB.
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          throw new Error(`/auth/me failed with status ${res.status}`);
        }

        const data = await res.json();
        if (cancelled) return;

        setUsername(data.username ?? null);
        setName(data.name ?? null);
        setRole((data.role as AdminRole) ?? "staff");
        setPermission((data.permission as AdminPermission) ?? "full_access");
      } catch (err) {
        if (!cancelled) {
          console.error("useAdminAuth: failed to load /auth/me", err);
          setError(err instanceof Error ? err.message : "Failed to load admin session");
          // Fail closed: on error, don't silently grant full access.
          setRole(null);
          setPermission(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const isSuperAdmin = role === "super_admin";
  // Mirrors the backend's isViewOnly(): view-only only ever applies to staff.
  const isViewOnly = !isSuperAdmin && permission === "view_only";

  return { username, name, role, permission, isSuperAdmin, isViewOnly, isLoading, error, refresh };
}