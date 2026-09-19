import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@/lib/api-url";

/* =========================================================
   AUTH CALLBACK PAGE
   Route this at /auth/callback
   Supabase redirects here after Google OAuth completes.
   ========================================================= */

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      // Supabase JS automatically parses the OAuth redirect and
      // stores the session, so we just need to fetch it here.
      const { data, error: sessionError } =
        await supabase.auth.getSession();

      if (cancelled) return;

      if (sessionError || !data.session) {
        setError(
          sessionError?.message ||
            "Could not complete sign in. Please try again."
        );
        return;
      }

      const accessToken = data.session.access_token;

      try {
        // Sync the Google-authenticated user with your own backend
        // (the one behind buildApiUrl), since that's the source of
        // truth for your app's user records. We send the Supabase
        // access token, NOT the raw email/fullName — the backend
        // verifies the token itself and only trusts what Supabase
        // confirms, so the request can't be spoofed. The backend
        // UPSERTs: if a user with this email already exists, it's
        // linked/reused; otherwise a new one is auto-created.
        const res = await fetch(buildApiUrl("/auth/oauth-sync"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          // At this point the account is meant to auto-create, so
          // a failure here means something actually went wrong
          // server-side (db error, validation, etc.) — not a
          // "not found" case.
          setError(
            payload?.message ||
              "Something went wrong finishing sign in. Please try again."
          );
          return;
        }

        // Store the token the same way the regular sign-in flow does,
        // so /user-dashboard (and PaymongoRoute's check) recognizes
        // this session.
        window.localStorage.setItem("termipay_user_auth_token", payload.token);

        setLocation("/user-dashboard");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong.";

        setError(msg);
      }
    }

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [setLocation]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4 text-center">
      {error ? (
        <>
          <p className="text-sm text-red-500 max-w-sm">{error}</p>
          <button
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
            onClick={() => setLocation("/signin")}
          >
            Back to Sign In
          </button>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <p className="text-sm text-slate-500">Signing you in...</p>
        </>
      )}
    </div>
  );
}