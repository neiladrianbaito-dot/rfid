import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreditCard, Lock, User, Loader2, Eye, EyeOff, AlertCircle, Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";

const FORCE_LOGGED_OUT_KEY = "termipay_force_logged_out";
const AUTH_TOKEN_KEY = "termipay_auth_token";
const THEME_KEY = "termipay_theme";

type Theme = "light" | "dark";

const ParticleNetworkBackground = ({ theme }: { theme: Theme }) => {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <img
        src="/Back.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
  );
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY) as Theme | null;
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  };

  const isDark = theme === "dark";

  const loginMutation = useLogin({
    mutation: {
      onSuccess: async (data) => {
        window.localStorage.removeItem(FORCE_LOGGED_OUT_KEY);
        const token = (data as any)?.token;
        if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
        queryClient.clear();
        queryClient.setQueryData(getGetMeQueryKey(), data);
        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/");
      },
      onError: (err: any) => {
        setError(err.response?.data?.message || "Invalid username or password");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError("Please enter both username and password"); return; }
    setError("");
    loginMutation.mutate({ data: { username, password } });
  };

  return (
    <div
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-8"
      data-testid="login-page"
    >
      <ParticleNetworkBackground theme={theme} />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        data-testid="button-theme-toggle"
        className={`fixed top-5 right-5 z-20 flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors ${
          isDark
            ? "bg-slate-950/80 border-slate-700 text-blue-300 hover:border-blue-500"
            : "bg-white border-slate-200 text-blue-600 hover:border-blue-400 shadow-sm"
        }`}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-sm z-10"
      >
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-6">
          <motion.div
            animate={{ boxShadow: ["0 0 0px rgba(37,99,235,0.35)", "0 8px 28px rgba(37,99,235,0.45)", "0 0 0px rgba(37,99,235,0.35)"] }}
            transition={{ duration: 2.5, repeat: Infinity }}
            className="flex items-center justify-center w-14 h-14 rounded-3xl border-2 border-blue-400 overflow-hidden mb-4"
          >
            <img
              src="/calbayog.png"
              alt="Calbayog Logo"
              className="w-full h-full object-cover"
            />
          </motion.div>

          <h1
            className={`text-2xl font-black tracking-tight uppercase italic leading-tight text-center transition-colors ${
              isDark ? "text-white" : "text-slate-900"
            }`}
            data-testid="text-app-title"
          >
            Fare <span className={isDark ? "text-blue-400" : "text-blue-600"}>Collection</span> System
          </h1>
          <p className={`text-[10px] mt-1 font-semibold tracking-widest uppercase text-center transition-colors ${
            isDark ? "text-blue-200/50" : "text-slate-400"
          }`}>
            LTC Calbayog City
          </p>
        </div>

        {/* Card */}
        <div
          className={`relative border-2 rounded-3xl overflow-hidden backdrop-blur-2xl transition-colors duration-300 ${
            isDark
              ? "bg-slate-950/80 border-slate-800 shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
              : "bg-white border-slate-200 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
          }`}
        >
          {/* Top accent line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500" />

          <div className="px-6 pt-7 pb-7">
            <p className={`text-xs text-center mb-5 tracking-wide transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Admin authentication
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error */}
              {error && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-medium ${
                  isDark ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-red-50 border-red-200 text-red-600"
                }`}>
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* Username */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="username"
                  className={`font-semibold uppercase text-[10px] tracking-wider transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}
                >
                  Username
                </Label>
                <div className="relative">
                  <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${isDark ? "text-slate-600" : "text-slate-400"}`} />
                  <Input
                    id="username"
                    type="text"
                    placeholder="ADMIN_ID"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`pl-9 h-10 text-sm border-2 rounded-xl transition-colors focus:ring-1 focus:ring-blue-500/30 ${
                      isDark
                        ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
                        : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                    }`}
                    required
                    disabled={loginMutation.isPending}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="password"
                  className={`font-semibold uppercase text-[10px] tracking-wider transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}
                >
                  Password
                </Label>
                <div className="relative">
                  <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${isDark ? "text-slate-600" : "text-slate-400"}`} />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`pl-9 pr-9 h-10 text-sm border-2 rounded-xl transition-colors focus:ring-1 focus:ring-blue-500/30 ${
                      isDark
                        ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
                        : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                    }`}
                    required
                    disabled={loginMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors ${
                      isDark ? "text-slate-600 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
                    }`}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-11 text-sm font-bold uppercase tracking-widest bg-blue-600 hover:bg-blue-500 text-white transition-all rounded-xl shadow-[0_4px_16px_rgba(37,99,235,0.4)] hover:shadow-[0_6px_22px_rgba(37,99,235,0.5)] mt-1"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting…
                  </span>
                ) : (
                  "Log In"
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <p className={`text-center text-[10px] mt-5 font-semibold uppercase tracking-widest transition-colors ${
          isDark ? "text-slate-700" : "text-slate-400"
        }`}>
          © 2026 LTC Calbayog City · V1.0
        </p>
      </motion.div>
    </div>
  );
}