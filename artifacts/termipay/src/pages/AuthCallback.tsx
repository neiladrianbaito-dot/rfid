import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, AlertCircle } from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";
import { supabase } from "@/lib/supabase";
import { useAuthTheme } from "@/lib/auth-theme";
import AuthBackground from "@/components/auth-background";

type Role = "commuter" | "driver";

const AUTH_ROLE_KEY = "termipay_auth_role";

const ROLE_CONFIG: Record<
  Role,
  { label: string; tokenKey: string; dashboard: string }
> = {
  commuter: {
    label: "Commuter",
    tokenKey: "termipay_user_auth_token",
    dashboard: "/user-dashboard",
  },
  driver: {
    label: "Driver",
    tokenKey: "termipay_driver_auth_token",
    dashboard: "/driver-dashboard",
  },
};

function readRequestedRole(): Role {
  const fromUrl = new URLSearchParams(window.location.search).get("role");
  if (fromUrl === "driver" || fromUrl === "commuter") return fromUrl;

  try {
    const fromStorage = window.localStorage.getItem(AUTH_ROLE_KEY);
    if (fromStorage === "driver" || fromStorage === "commuter") {
      return fromStorage;
    }
  } catch {
    /* ignore storage errors */
  }

  return "commuter";
}

export default function AuthCallbackPage() {
  const [, setLocation] = useLocation();
  const { theme, isDark } = useAuthTheme();

  const requestedRole = readRequestedRole();

  const [error, setError] = useState("");
  const [errorRole, setErrorRole] = useState<Role>(requestedRole);

  // Prevents the sync from running twice (React StrictMode / re-renders)
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function finishSignin() {
      try {
        // Supabase reads the tokens from the URL automatically.
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !data.session?.access_token) {
          setError("Google sign in did not complete. Please try again.");
          return;
        }

        const response = await fetch(buildApiUrl("/auth/oauth-sync"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            role: requestedRole,
          }),
        });

        const payload = (await response.json()) as {
          message?: string;
          token?: string;
          role?: Role;
        };

        if (!response.ok) {
          // Account exists under the other role
          if (payload.role === "driver" || payload.role === "commuter") {
            setErrorRole(payload.role);
          }
          setError(payload?.message || "Could not sign in with Google.");
          await supabase.auth.signOut();
          return;
        }

        if (!payload.token) {
          setError("Sign in response is missing a token. Please try again.");
          await supabase.auth.signOut();
          return;
        }

        // Always trust the role returned by the server, not the URL.
        const finalRole: Role =
          payload.role === "driver" ? "driver" : "commuter";
        const cfg = ROLE_CONFIG[finalRole];

        window.localStorage.setItem(cfg.tokenKey, payload.token);
        window.localStorage.setItem(AUTH_ROLE_KEY, finalRole);

        // Clear the other role's token so the wrong dashboard can't open
        const other: Role = finalRole === "driver" ? "commuter" : "driver";
        window.localStorage.removeItem(ROLE_CONFIG[other].tokenKey);

        const basePath = (import.meta.env.BASE_URL || "").replace(/\/$/, "");

        setLocation(cfg.dashboard);

        window.setTimeout(() => {
          if (!window.location.pathname.endsWith(cfg.dashboard)) {
            window.location.assign(`${basePath}${cfg.dashboard}`);
          }
        }, 50);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to connect to server. Please try again."
        );
      }
    }

    void finishSignin();
  }, [requestedRole, setLocation]);

  return (
    <div
      className={`auth-smooth min-h-[100dvh] flex items-center justify-center px-3 py-4 relative overflow-x-hidden ${
        isDark ? "text-white" : "text-slate-900"
      }`}
    >
      <AuthBackground theme={theme} />

      <div className="w-full max-w-[340px] sm:max-w-[420px] z-10">
        <div
          className={`rounded-2xl border p-6 text-center backdrop-blur-md ${
            isDark
              ? "bg-slate-950/80 border-slate-800"
              : "bg-white/90 border-slate-200"
          }`}
        >
          {error ? (
            <div className="space-y-4">
              <AlertCircle className="mx-auto h-8 w-8 text-red-500" />

              <p
                className={`text-sm ${
                  isDark ? "text-red-400" : "text-red-600"
                }`}
              >
                {error}
              </p>

              <Link
                href={`/signin?role=${errorRole}`}
                className={`inline-block text-sm font-semibold ${
                  isDark
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-blue-600 hover:text-blue-500"
                }`}
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
              <p
                className={`text-sm ${
                  isDark ? "text-slate-300" : "text-slate-600"
                }`}
              >
                Signing you in as {ROLE_CONFIG[requestedRole].label}...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}