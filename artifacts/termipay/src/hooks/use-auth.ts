import { useCallback, useEffect, useState } from "react";
import { useGetMe, getGetMeQueryKey, useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

const FORCE_LOGGED_OUT_KEY = "termipay_force_logged_out";
const AUTH_TOKEN_KEY = "termipay_auth_token";

export function useAuth() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Clear the force logged out flag on mount if token exists
  // This prevents the flag from blocking re-login
  useEffect(() => {
    const hasToken = !!window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (hasToken) {
      window.localStorage.removeItem(FORCE_LOGGED_OUT_KEY);
    }
  }, []);

  const forceLoggedOut =
    typeof window !== "undefined" &&
    window.localStorage.getItem(FORCE_LOGGED_OUT_KEY) === "1";

  const hasAuthToken =
    typeof window !== "undefined" &&
    !!window.localStorage.getItem(AUTH_TOKEN_KEY);

  const { data: user, isLoading, error, refetch } = useGetMe({
    queryKey: getGetMeQueryKey(),
    query: {
      enabled: !forceLoggedOut && hasAuthToken,
      retry: false,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 5,
    },
  } as any);

  // Once query settles, mark init done
  useEffect(() => {
    if (!isLoading) {
      setIsInitializing(false);
    }
  }, [isLoading]);

  const isApiOfflineError =
    !!error &&
    typeof error === "object" &&
    "message" in (error as Record<string, unknown>) &&
    String((error as Record<string, unknown>).message)
      .toLowerCase()
      .includes("failed to fetch");

  const isUnauthorizedError =
    !!error &&
    ((typeof error === "object" &&
      (("status" in (error as Record<string, unknown>) &&
        Number((error as Record<string, unknown>).status) === 401) ||
        ("response" in (error as Record<string, unknown>) &&
          typeof (error as Record<string, unknown>).response === "object" &&
          !!(error as any).response &&
          Number((error as any).response?.status) === 401))) ||
      (typeof error === "object" &&
        "message" in (error as Record<string, unknown>) &&
        String((error as Record<string, unknown>).message)
          .toLowerCase()
          .includes("unauthorized")));

  const effectiveUser = hasAuthToken ? user : null;

  // FIX: On 401, clear token but do NOT redirect here — let ProtectedRoute handle it
  useEffect(() => {
    if (!isUnauthorizedError) return;
    console.warn("TermiPay: 401 received — clearing token");
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.setItem(FORCE_LOGGED_OUT_KEY, "1");
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
  }, [isUnauthorizedError, queryClient]);

  const logoutMutation = useLogout();

  async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  }

  const logout = useCallback(async () => {
    console.log("TermiPay: Triggering Workspace Logout...");
    setIsLoggingOut(true);

    const forceRedirect = () => {
      try {
        setLocation("/login");
      } catch {
        const basePath = (import.meta.env.BASE_URL || "").replace(/\/$/, "");
        window.location.replace(`${window.location.origin}${basePath}/login`);
      }
    };

    const redirectTimer = window.setTimeout(forceRedirect, 1500);

    try {
      window.localStorage.setItem(FORCE_LOGGED_OUT_KEY, "1");
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      await withTimeout(queryClient.cancelQueries(), 1000);
      logoutMutation.mutate(undefined as any);
    } catch (err) {
      console.warn("TermiPay: API logout error (ignoring for redirect)", err);
    } finally {
      window.clearTimeout(redirectTimer);
      queryClient.clear();
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      forceRedirect();
      setIsLoggingOut(false);
    }
  }, [queryClient, logoutMutation, setLocation]);

  const resolvedIsLoading =
    forceLoggedOut || !hasAuthToken
      ? false
      : isInitializing || isLoading;

  return {
    user: effectiveUser ?? null,
    isLoading: resolvedIsLoading,
    error,
    isAuthenticated:
      forceLoggedOut || !hasAuthToken
        ? false
        : isApiOfflineError || isUnauthorizedError
        ? false
        : !!effectiveUser,
    logout,
    isLoggingOut,
    refetchUser: refetch,
  };
}