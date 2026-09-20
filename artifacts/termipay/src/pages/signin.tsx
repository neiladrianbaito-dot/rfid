import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Mail, Lock, Sun, Moon } from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";
import { supabase } from "@/lib/supabase";
import { useAuthTheme } from "@/lib/auth-theme";
import AuthBackground from "@/components/auth-background";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const USER_AUTH_TOKEN_KEY = "termipay_user_auth_token";

export default function SigninPage() {
  const [, setLocation] = useLocation();
  const { theme, isDark, toggleTheme } = useAuthTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");

  const busy = isSubmitting || isGoogleSubmitting;

  /* Shared style tokens */
  const fieldClass = isDark
    ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
    : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500";

  const labelClass = `text-[9px] sm:text-[10px] font-bold uppercase tracking-widest ml-1 ${
    isDark ? "text-slate-400" : "text-slate-500"
  }`;

  const iconClass = `absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 pointer-events-none ${
    isDark ? "text-slate-600" : "text-slate-400"
  }`;

  const errorClass = `p-2.5 sm:p-3 rounded-lg border text-[11px] ${
    isDark
      ? "bg-red-500/10 border-red-500/20 text-red-400"
      : "bg-red-50 border-red-200 text-red-600"
  }`;

  function redirectToPaymongoDashboard() {
    const basePath = (import.meta.env.BASE_URL || "").replace(/\/$/, "");
    const target = `${basePath}/user-dashboard`;

    try {
      setLocation("/user-dashboard");

      window.setTimeout(() => {
        if (!window.location.pathname.endsWith("/user-dashboard")) {
          window.location.assign(target);
        }
      }, 50);
    } catch {
      window.location.assign(target);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(buildApiUrl("/auth/user-signin"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await response.json()) as {
        message?: string;
        token?: string;
      };

      if (!response.ok) {
        setError(data?.message || "Invalid email or password");
        return;
      }

      if (!data.token) {
        setError("Signin response is missing token. Please try again.");
        return;
      }

      window.localStorage.setItem(USER_AUTH_TOKEN_KEY, data.token);
      redirectToPaymongoDashboard();
    } catch {
      setError("Unable to connect to server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignin() {
    setError("");
    setIsGoogleSubmitting(true);

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        setIsGoogleSubmitting(false);
      }
      // On success the browser redirects to Google, so we intentionally
      // keep isGoogleSubmitting = true.
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start Google sign in."
      );
      setIsGoogleSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = forgotEmail.trim().toLowerCase();

    if (!trimmed || !trimmed.includes("@")) {
      setForgotError("Enter a valid email address.");
      return;
    }

    setForgotError("");
    setForgotMessage("");
    setForgotBusy(true);

    try {
      const response = await fetch(buildApiUrl("/auth/user/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      const data = (await response.json()) as { message?: string };

      setForgotMessage(
        data?.message || "Check your inbox for reset instructions."
      );
    } catch {
      setForgotError("Could not reach the server. Try again later.");
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div
     // BAGO NA
className={`auth-smooth min-h-[100dvh] flex items-center justify-center px-3 py-4 sm:p-6 relative overflow-x-hidden ${
        isDark ? "text-white" : "text-slate-900"
      }`}
    >
      <AuthBackground theme={theme} />

      {/* Theme Toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`fixed top-3 right-3 sm:top-5 sm:right-5 z-20 flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 transition-colors duration-200 ${
          isDark
            ? "bg-slate-950/80 border-slate-700 text-blue-300 hover:border-blue-500"
            : "bg-white border-slate-200 text-blue-600 hover:border-blue-400 shadow-sm"
        }`}
      >
        {isDark ? (
          <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        ) : (
          <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        )}
      </button>

      <div className="w-full max-w-[340px] sm:max-w-[420px] z-10 animate-in fade-in duration-300">
        {/* Header */}
        <div className="text-center mb-4 sm:mb-8">
          <div className="inline-flex items-center justify-center mb-2 sm:mb-4">
            <img
              src="/calbayog.png"
              alt="Calbayog Logo"
              className="h-11 w-11 sm:h-20 sm:w-20 object-contain rounded-lg"
            />
          </div>

          <h1
            className={`text-lg sm:text-3xl font-black tracking-tight italic whitespace-nowrap ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            ACCESS THE WALLET
          </h1>

          <p
            className={`text-[9px] sm:text-[10px] uppercase tracking-[0.2em] sm:tracking-[0.25em] mt-1.5 sm:mt-2 ${
              isDark ? "text-slate-500" : "text-slate-400"
            }`}
          >
            Digital Transit Network
          </p>
        </div>

        {/* Card */}
        <Card
          className={`overflow-hidden ${
            isDark
              ? "bg-slate-950/80 border-slate-800 shadow-[0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-md"
              : "bg-white/90 border-slate-200 shadow-[0_8px_40px_rgba(15,23,42,0.08)] backdrop-blur-md"
          }`}
        >
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />

          <CardHeader className="pb-3 px-4 sm:px-6 pt-4 sm:pt-6 space-y-1">
            <CardTitle
              className={`text-base sm:text-xl ${
                isDark ? "text-white" : "text-slate-900"
              }`}
            >
              Sign In
            </CardTitle>

            <CardDescription className="text-[11px] sm:text-xs text-slate-500">
              Welcome back. Please authenticate to access your wallet.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
            {/* Google */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignin}
              disabled={busy}
              className={`w-full h-10 sm:h-11 text-[13px] sm:text-sm font-semibold gap-2 border-2 ${
                isDark
                  ? "bg-slate-900/60 border-slate-700/70 text-white hover:bg-slate-900 hover:border-slate-600"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {isGoogleSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.8z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11C3.25 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.27A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.27 5.39l4-3.11z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.61l4 3.11C6.22 6.86 8.87 4.75 12 4.75z"
                  />
                </svg>
              )}
              {isGoogleSubmitting
                ? "Redirecting to Google..."
                : "Continue with Google"}
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-3.5 sm:my-5">
              <div
                className={`h-px flex-1 ${
                  isDark ? "bg-slate-800" : "bg-slate-200"
                }`}
              />
              <span
                className={`text-[9px] sm:text-[10px] uppercase tracking-widest ${
                  isDark ? "text-slate-600" : "text-slate-400"
                }`}
              >
                or sign in with email
              </span>
              <div
                className={`h-px flex-1 ${
                  isDark ? "bg-slate-800" : "bg-slate-200"
                }`}
              />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              {error && <div className={errorClass}>{error}</div>}

              {/* Email */}
              <div className="space-y-1 sm:space-y-1.5">
                <Label htmlFor="email" className={labelClass}>
                  Email Address
                </Label>

                <div className="relative">
                  <Mail className={iconClass} />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    disabled={busy}
                    required
                    autoComplete="email"
                    className={`pl-9 sm:pl-10 h-10 sm:h-11 text-sm border-2 ${fieldClass}`}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1 sm:space-y-1.5">
                <Label htmlFor="password" className={labelClass}>
                  Security Password
                </Label>

                <div className="relative">
                  <Lock className={iconClass} />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={busy}
                    required
                    autoComplete="current-password"
                    className={`pl-9 sm:pl-10 pr-10 h-10 sm:h-11 text-sm border-2 ${fieldClass}`}
                  />

                  <button
                    type="button"
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 -mr-1 ${
                      isDark
                        ? "text-slate-600 hover:text-slate-300"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Forgot password */}
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  className={`text-[10px] sm:text-[11px] font-semibold py-1 ${
                    isDark
                      ? "text-blue-400 hover:text-blue-300"
                      : "text-blue-600 hover:text-blue-500"
                  }`}
                  onClick={() => {
                    setForgotOpen(true);
                    setForgotEmail(email.trim());
                    setForgotMessage("");
                    setForgotError("");
                  }}
                >
                  Forgot password?
                </button>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-10 sm:h-11 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold shadow-lg shadow-blue-900/20 text-[13px] sm:text-sm"
                disabled={busy}
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Authenticating...
                  </span>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

            {/* Sign up link */}
            <div
              className={`mt-4 pt-4 sm:mt-5 sm:pt-5 border-t ${
                isDark ? "border-slate-800" : "border-slate-200"
              }`}
            >
              <p className="text-xs sm:text-sm text-center text-slate-500">
                No account yet?{" "}
                <Link
                  href="/signup"
                  className={`font-medium ${
                    isDark
                      ? "text-blue-400 hover:text-blue-300"
                      : "text-blue-600 hover:text-blue-500"
                  }`}
                >
                  Sign Up
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p
          className={`mt-4 sm:mt-6 text-[9px] sm:text-[10px] text-center uppercase tracking-[0.2em] ${
            isDark ? "text-slate-700" : "text-slate-400"
          }`}
        >
          Fare Collection System v1.0
        </p>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent
          className={`w-[calc(100vw-2rem)] max-w-[340px] sm:max-w-sm mx-auto rounded-2xl max-h-[85dvh] overflow-y-auto p-4 sm:p-6 gap-0 ${
            isDark
              ? "bg-slate-950 border-slate-800 text-white"
              : "bg-white border-slate-200 text-slate-900"
          }`}
        >
          <DialogHeader className="mb-3 sm:mb-4">
            <DialogTitle
              className={`text-sm sm:text-base font-semibold ${
                isDark ? "text-white" : "text-slate-900"
              }`}
            >
              Reset your password
            </DialogTitle>

            <DialogDescription
              className={`text-[11px] sm:text-xs mt-1 leading-relaxed ${
                isDark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Enter your registered email and we'll send you a secure reset
              link valid for 1 hour.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleForgotSubmit} className="space-y-3 sm:space-y-4">
            {forgotError && <div className={errorClass}>{forgotError}</div>}

            {forgotMessage && (
              <div
                className={`p-2.5 sm:p-3 rounded-lg border text-[11px] leading-relaxed ${
                  isDark
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-emerald-50 border-emerald-200 text-emerald-600"
                }`}
              >
                {forgotMessage}
              </div>
            )}

            <div className="space-y-1 sm:space-y-1.5">
              <Label htmlFor="forgot-email" className={labelClass}>
                Email Address
              </Label>

              <Input
                id="forgot-email"
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                className={`h-10 sm:h-11 text-sm border-2 ${fieldClass}`}
                disabled={forgotBusy}
                required
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className={`h-10 sm:h-11 w-full sm:w-auto text-[13px] sm:text-sm ${
                  isDark
                    ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                    : "border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => setForgotOpen(false)}
              >
                Cancel
              </Button>

              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 sm:h-11 w-full sm:w-auto text-[13px] sm:text-sm"
                disabled={forgotBusy}
              >
                {forgotBusy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </span>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}