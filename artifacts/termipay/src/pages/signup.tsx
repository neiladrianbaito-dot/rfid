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
import {
  Eye,
  EyeOff,
  Loader2,
  User,
  Mail,
  Lock,
  CheckCircle2,
  Sun,
  Moon,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";
import { supabase } from "@/lib/supabase";
import { useAuthTheme } from "@/lib/auth-theme";
import AuthBackground from "@/components/auth-background";

/* =========================================================
   FULL NAME CHECK
   ========================================================= */

async function checkFullNameMatch(fullName: string): Promise<{
  fullName: string;
  status?: string;
}> {
  const response = await fetch(
    buildApiUrl(
      `/auth/check-full-name?fullName=${encodeURIComponent(fullName)}`
    )
  );

  const payload = await response.json();

  if (!response.ok) {
    const msg =
      payload?.message || payload?.error || "Full name not found in the system.";
    throw new Error(msg);
  }

  const data = payload?.user ?? payload;

  if (!data || !data.fullName) {
    throw new Error("Full name not found in the system.");
  }

  return {
    fullName: data.fullName ?? data.full_name,
    status: data.status,
  };
}

/* =========================================================
   SIGN UP PAGE
   ========================================================= */

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { theme, isDark, toggleTheme } = useAuthTheme();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

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

  /* =======================================================
     SIGN UP (email / password)
     ======================================================= */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError("");
    setSuccess("");

    const fullNameTrim = fullName.trim();
    const emailTrim = email.trim().toLowerCase();

    if (!fullNameTrim || !emailTrim || !password) {
      setError("Please fill in all fields.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      try {
        await checkFullNameMatch(fullNameTrim);
      } catch (nameErr) {
        const msg =
          nameErr instanceof Error
            ? nameErr.message
            : "We couldn't find this name in our records. Please check with your admin.";
        setError(msg);
        return;
      }

      const res = await fetch(buildApiUrl("/auth/signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullNameTrim,
          email: emailTrim,
          password,
        }),
      });

      const payload = (await res.json()) as {
        success?: boolean;
        message?: string;
      };

      if (!res.ok) {
        setError(payload?.message || "Signup failed. Please try again.");
        return;
      }

      setSuccess("Account created! Redirecting to sign in...");

      window.setTimeout(() => {
        setLocation("/signin");
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  /* =======================================================
     SIGN UP / SIGN IN WITH GOOGLE (Supabase OAuth)
     ======================================================= */

  async function handleGoogleSignup() {
    setError("");
    setSuccess("");
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

  /* =======================================================
     UI
     ======================================================= */

  return (
    <div
      // BAGO NA
className={`auth-smooth w-[calc(100vw-2rem)] max-w-[340px] sm:max-w-sm mx-auto rounded-2xl
        isDark ? "text-white" : "text-slate-900"
      }`}
    >
      <AuthBackground theme={theme} />

      {/* Theme Toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`fixed top-3 right-3 sm:top-5 sm:right-5 z-30 flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 transition-colors duration-200 ${
          isDark
            ? "bg-slate-950/80 border-slate-700 text-blue-300 hover:border-blue-500 hover:bg-slate-900"
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
            JOIN THE NETWORK
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
              Create Account
            </CardTitle>

            <CardDescription className="text-[11px] sm:text-xs text-slate-500">
              Enter your details to get started with your digital wallet.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
            {/* Google */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignup}
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
                or sign up with email
              </span>
              <div
                className={`h-px flex-1 ${
                  isDark ? "bg-slate-800" : "bg-slate-200"
                }`}
              />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              {error && (
                <div
                  className={`p-2.5 sm:p-3 rounded-lg border text-[11px] ${
                    isDark
                      ? "bg-red-500/10 border-red-500/20 text-red-400"
                      : "bg-red-50 border-red-200 text-red-600"
                  }`}
                >
                  {error}
                </div>
              )}

              {success && (
                <div
                  className={`p-2.5 sm:p-3 rounded-lg border text-[11px] flex items-center gap-2 ${
                    isDark
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-emerald-50 border-emerald-200 text-emerald-600"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {success}
                </div>
              )}

              {/* Full Name */}
              <div className="space-y-1 sm:space-y-1.5">
                <Label htmlFor="fullName" className={labelClass}>
                  Full Name
                </Label>

                <div className="relative">
                  <User className={iconClass} />
                  <Input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Dela Cruz"
                    disabled={busy}
                    required
                    autoComplete="name"
                    className={`pl-9 sm:pl-10 h-10 sm:h-11 text-sm border-2 ${fieldClass}`}
                  />
                </div>
              </div>

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
                    autoComplete="new-password"
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

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-10 sm:h-11 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold shadow-lg shadow-blue-900/20 text-[13px] sm:text-sm mt-1 sm:mt-2"
                disabled={busy}
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Initializing...
                  </span>
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>

            {/* Sign in link */}
            <div
              className={`mt-4 pt-4 sm:mt-5 sm:pt-5 border-t ${
                isDark ? "border-slate-800" : "border-slate-200"
              }`}
            >
              <p className="text-xs sm:text-sm text-center text-slate-500">
                Already have an account?{" "}
                <Link
                  href="/signin"
                  className={`font-medium ${
                    isDark
                      ? "text-blue-400 hover:text-blue-300"
                      : "text-blue-600 hover:text-blue-500"
                  }`}
                >
                  Sign In
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
    </div>
  );
}