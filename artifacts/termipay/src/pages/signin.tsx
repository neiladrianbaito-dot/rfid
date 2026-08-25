import { useState, useEffect, useRef } from "react";
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
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Lock,
  Sun,
  Moon,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const USER_AUTH_TOKEN_KEY = "termipay_user_auth_token";
const THEME_KEY = "termipay_theme";

type Theme = "light" | "dark";

const ParticleNetworkBackground = ({ theme }: { theme: Theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);

  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const BALL_NUM = 60;
    const R = 2;
    const ALPHA_F = 0.03;
    const DIS_LIMIT = 140;
    const LINE_WIDTH = 0.8;

    const COLORS = {
      light: { r: 37, g: 99, b: 235 },
      dark: { r: 96, g: 165, b: 250 },
    };

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      phase: number;
      isMouse?: boolean;
    };

    let canW = 0;
    let canH = 0;
    let particles: Particle[] = [];
    let rafId = 0;
    let mouseParticle: Particle | null = null;

    const randomNumFrom = (min: number, max: number) =>
      Math.random() * (max - min) + min;

    const randomSidePos = (length: number) =>
      Math.ceil(Math.random() * length);

    const randomArrayItem = <T,>(arr: T[]) =>
      arr[Math.floor(Math.random() * arr.length)];

    const getRandomSpeed = (
      pos: "top" | "right" | "bottom" | "left"
    ): [number, number] => {
      const min = -0.6;
      const max = 0.6;

      switch (pos) {
        case "top":
          return [
            randomNumFrom(min, max),
            randomNumFrom(0.05, max),
          ];
        case "right":
          return [
            randomNumFrom(min, -0.05),
            randomNumFrom(min, max),
          ];
        case "bottom":
          return [
            randomNumFrom(min, max),
            randomNumFrom(min, -0.05),
          ];
        case "left":
          return [
            randomNumFrom(0.05, max),
            randomNumFrom(min, max),
          ];
      }
    };

    const getRandomParticle = (): Particle => {
      const pos = randomArrayItem([
        "top",
        "right",
        "bottom",
        "left",
      ] as const);

      const [vx, vy] = getRandomSpeed(pos);

      const base = {
        vx,
        vy,
        alpha: 1,
        phase: randomNumFrom(0, 10),
      };

      switch (pos) {
        case "top":
          return {
            ...base,
            x: randomSidePos(canW),
            y: -R,
          };
        case "right":
          return {
            ...base,
            x: canW + R,
            y: randomSidePos(canH),
          };
        case "bottom":
          return {
            ...base,
            x: randomSidePos(canW),
            y: canH + R,
          };
        case "left":
          return {
            ...base,
            x: -R,
            y: randomSidePos(canH),
          };
      }
    };

    const getDistance = (a: Particle, b: Particle) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;

      return Math.sqrt(dx * dx + dy * dy);
    };

    const initParticles = (num: number) => {
      particles = [];

      for (let i = 0; i < num; i++) {
        const [vx, vy] = getRandomSpeed("top");

        particles.push({
          x: randomSidePos(canW),
          y: randomSidePos(canH),
          vx,
          vy,
          alpha: 1,
          phase: randomNumFrom(0, 10),
        });
      }
    };

    const resize = () => {
      canW = window.innerWidth;
      canH = window.innerHeight;

      canvas.width = canW;
      canvas.height = canH;
    };

    const renderParticles = () => {
      const c = COLORS[themeRef.current];

      particles.forEach((p) => {
        if (p.isMouse) return;

        ctx.fillStyle = `rgba(
          ${c.r},
          ${c.g},
          ${c.b},
          ${p.alpha * 0.75}
        )`;

        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      });
    };

    const renderLines = () => {
      const c = COLORS[themeRef.current];

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const distance =
            getDistance(particles[i], particles[j]);

          if (distance < DIS_LIMIT) {
            const alpha =
              (1 - distance / DIS_LIMIT) * 0.35;

            ctx.strokeStyle = `rgba(
              ${c.r},
              ${c.g},
              ${c.b},
              ${alpha}
            )`;

            ctx.lineWidth = LINE_WIDTH;

            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
            ctx.closePath();
          }
        }
      }
    };

    const updateParticles = () => {
      const next: Particle[] = [];

      particles.forEach((p) => {
        if (p.isMouse) {
          next.push(p);
          return;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.phase += ALPHA_F;
        p.alpha = Math.abs(Math.cos(p.phase));

        if (
          p.x > -50 &&
          p.x < canW + 50 &&
          p.y > -50 &&
          p.y < canH + 50
        ) {
          next.push(p);
        }
      });

      particles = next;
    };

    const addParticleIfNeeded = () => {
      if (particles.length < BALL_NUM) {
        particles.push(getRandomParticle());
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, canW, canH);

      renderParticles();
      renderLines();
      updateParticles();
      addParticleIfNeeded();

      rafId = window.requestAnimationFrame(render);
    };

    const setMouseParticlePos = (
      clientX: number,
      clientY: number
    ) => {
      const rect = canvas.getBoundingClientRect();

      if (!mouseParticle) {
        mouseParticle = {
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          alpha: 1,
          phase: 0,
          isMouse: true,
        };

        particles.push(mouseParticle);
      }

      mouseParticle.x = clientX - rect.left;
      mouseParticle.y = clientY - rect.top;
    };

    const clearMouseParticle = () => {
      particles = particles.filter((p) => !p.isMouse);
      mouseParticle = null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      setMouseParticlePos(e.clientX, e.clientY);
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        clearMouseParticle();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];

      if (touch) {
        setMouseParticlePos(touch.clientX, touch.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      const touch = e.touches[0];

      if (touch) {
        setMouseParticlePos(touch.clientX, touch.clientY);
      }
    };

    const handleTouchEnd = () => {
      clearMouseParticle();
    };

    resize();
    initParticles(BALL_NUM);
    rafId = window.requestAnimationFrame(render);

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseOut);

    canvas.addEventListener(
      "touchstart",
      handleTouchStart,
      { passive: true }
    );

    canvas.addEventListener(
      "touchmove",
      handleTouchMove,
      { passive: false }
    );

    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.cancelAnimationFrame(rafId);

      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseOut);

      canvas.removeEventListener(
        "touchstart",
        handleTouchStart
      );

      canvas.removeEventListener(
        "touchmove",
        handleTouchMove
      );

      canvas.removeEventListener(
        "touchend",
        handleTouchEnd
      );

      canvas.removeEventListener(
        "touchcancel",
        handleTouchEnd
      );
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 -z-10 overflow-hidden transition-colors duration-300 ${
        theme === "dark"
          ? "bg-[#020617]"
          : "bg-white"
      }`}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          theme === "dark"
            ? "bg-[radial-gradient(ellipse_at_50%_35%,rgba(30,41,59,0.6)_0%,rgba(2,6,23,1)_70%)]"
            : "bg-[radial-gradient(ellipse_at_50%_35%,rgba(37,99,235,0.08)_0%,rgba(255,255,255,1)_65%)]"
        }`}
      />

      <div
        className={`absolute top-[-5%] right-[-5%] w-[30%] h-[30%] rounded-full blur-[100px] transition-colors duration-300 ${
          theme === "dark"
            ? "bg-blue-500/10"
            : "bg-blue-500/5"
        }`}
      />

      <div
        className={`absolute bottom-[-5%] left-[-5%] w-[30%] h-[30%] rounded-full blur-[100px] transition-colors duration-300 ${
          theme === "dark"
            ? "bg-emerald-500/10"
            : "bg-emerald-500/5"
        }`}
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
};

export default function SigninPage() {
  const [, setLocation] = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");

  // Same theme behavior as Admin Login
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(
      THEME_KEY
    ) as Theme | null;

    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    } else if (
      window.matchMedia?.(
        "(prefers-color-scheme: dark)"
      ).matches
    ) {
      setTheme("dark");
    }
  }, []);

  const toggleTheme = () => {
    setTheme((previous) => {
      const next =
        previous === "light" ? "dark" : "light";

      window.localStorage.setItem(THEME_KEY, next);

      return next;
    });
  };

  const isDark = theme === "dark";

  function redirectToPaymongoDashboard() {
    const basePath = (
      import.meta.env.BASE_URL || ""
    ).replace(/\/$/, "");

    const target = `${basePath}/user-dashboard`;

    try {
      setLocation("/user-dashboard");

      window.setTimeout(() => {
        if (
          !window.location.pathname.endsWith(
            "/user-dashboard"
          )
        ) {
          window.location.assign(target);
        }
      }, 50);
    } catch {
      window.location.assign(target);
    }
  }

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    if (!email.trim() || !password) {
      setError(
        "Please enter both email and password."
      );
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        buildApiUrl("/auth/user-signin"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        }
      );

      const data = (await response.json()) as {
        message?: string;
        token?: string;
      };

      if (!response.ok) {
        setError(
          data?.message ||
            "Invalid email or password"
        );
        return;
      }

      if (!data.token) {
        setError(
          "Signin response is missing token. Please try again."
        );
        return;
      }

      window.localStorage.setItem(
        USER_AUTH_TOKEN_KEY,
        data.token
      );

      redirectToPaymongoDashboard();
    } catch {
      setError(
        "Unable to connect to server. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    const trimmed = forgotEmail
      .trim()
      .toLowerCase();

    if (!trimmed || !trimmed.includes("@")) {
      setForgotError(
        "Enter a valid email address."
      );
      return;
    }

    setForgotError("");
    setForgotMessage("");
    setForgotBusy(true);

    try {
      const response = await fetch(
        buildApiUrl(
          "/auth/user/forgot-password"
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: trimmed,
          }),
        }
      );

      const data = (await response.json()) as {
        message?: string;
      };

      setForgotMessage(
        data?.message ||
          "Check your inbox for reset instructions."
      );
    } catch {
      setForgotError(
        "Could not reach the server. Try again later."
      );
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div
      className={`min-h-screen min-h-[100dvh] flex items-center justify-center px-4 py-8 sm:p-6 relative overflow-hidden transition-colors duration-300 ${
        isDark
          ? "text-white"
          : "text-slate-900"
      }`}
    >
      <ParticleNetworkBackground
        theme={theme}
      />

      {/* Theme Toggle - same style/behavior as Admin Login */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={
          isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
        }
        className={`fixed top-5 right-5 z-20 flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300 ${
          isDark
            ? "bg-slate-950/80 border-slate-700 text-blue-300 hover:border-blue-500"
            : "bg-white border-slate-200 text-blue-600 hover:border-blue-400 shadow-sm"
        }`}
      >
        {isDark ? (
          <Sun className="w-4 h-4" />
        ) : (
          <Moon className="w-4 h-4" />
        )}
      </button>

      <div className="w-full max-w-[420px] z-10">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div
            className={`inline-flex items-center justify-center p-3 rounded-2xl border mb-4 overflow-hidden transition-colors duration-300 ${
              isDark
                ? "bg-blue-500/10 border-blue-500/20"
                : "bg-blue-50 border-blue-100"
            }`}
          >
            <img
              src="/calbayog.jpg"
              alt="Calbayog Logo"
              className="h-7 w-7 sm:h-8 sm:w-8 object-cover rounded-lg"
            />
          </div>

          <h1
            className={`text-2xl sm:text-3xl font-black tracking-tight italic whitespace-nowrap transition-colors duration-300 ${
              isDark
                ? "text-white"
                : "text-slate-900"
            }`}
          >
            ACCESS THE WALLET
          </h1>

          <p
            className={`text-[10px] uppercase tracking-[0.25em] mt-2 transition-colors duration-300 ${
              isDark
                ? "text-slate-500"
                : "text-slate-400"
            }`}
          >
            Digital Transit Network
          </p>
        </div>

        {/* Card */}
        <Card
          className={`overflow-hidden transition-all duration-300 ${
            isDark
              ? "bg-slate-950/80 border-slate-800 shadow-[0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              : "bg-white/90 border-slate-200 shadow-[0_8px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl"
          }`}
        >
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />

          <CardHeader className="pb-4 px-5 sm:px-6 pt-5 sm:pt-6">
            <CardTitle
              className={`text-lg sm:text-xl transition-colors ${
                isDark
                  ? "text-white"
                  : "text-slate-900"
              }`}
            >
              Sign In
            </CardTitle>

            <CardDescription
              className={`text-xs transition-colors ${
                isDark
                  ? "text-slate-500"
                  : "text-slate-500"
              }`}
            >
              Welcome back. Please authenticate to
              access your wallet.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-5 sm:px-6 pb-5 sm:pb-6">
            <form
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {error && (
                <div
                  className={`p-3 rounded-lg border text-[11px] animate-in fade-in slide-in-from-top-1 ${
                    isDark
                      ? "bg-red-500/10 border-red-500/20 text-red-400"
                      : "bg-red-50 border-red-200 text-red-600"
                  }`}
                >
                  {error}
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className={`text-[10px] font-bold uppercase tracking-widest ml-1 transition-colors ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  Email Address
                </Label>

                <div className="relative">
                  <Mail
                    className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none transition-colors ${
                      isDark
                        ? "text-slate-600"
                        : "text-slate-400"
                    }`}
                  />

                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) =>
                      setEmail(e.target.value)
                    }
                    placeholder="name@example.com"
                    disabled={isSubmitting}
                    required
                    autoComplete="email"
                    className={`pl-10 h-11 text-sm border-2 transition-all ${
                      isDark
                        ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
                        : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                    }`}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="password"
                  className={`text-[10px] font-bold uppercase tracking-widest ml-1 transition-colors ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  Security Password
                </Label>

                <div className="relative">
                  <Lock
                    className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none transition-colors ${
                      isDark
                        ? "text-slate-600"
                        : "text-slate-400"
                    }`}
                  />

                  <Input
                    id="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
                    placeholder="••••••••"
                    disabled={isSubmitting}
                    required
                    autoComplete="current-password"
                    className={`pl-10 pr-10 h-11 text-sm border-2 transition-all ${
                      isDark
                        ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
                        : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                    }`}
                  />

                  <button
                    type="button"
                    className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors p-1 -mr-1 ${
                      isDark
                        ? "text-slate-600 hover:text-slate-300"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                    onClick={() =>
                      setShowPassword(
                        (prev) => !prev
                      )
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Forgot password */}
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  className={`text-[11px] font-semibold transition-colors py-1 ${
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
                className="w-full h-11 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-900/20 text-sm"
                disabled={isSubmitting}
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

            {/* Sign up */}
            <div
              className={`mt-5 pt-5 border-t transition-colors ${
                isDark
                  ? "border-slate-800"
                  : "border-slate-200"
              }`}
            >
              <p
                className={`text-sm text-center transition-colors ${
                  isDark
                    ? "text-slate-500"
                    : "text-slate-500"
                }`}
              >
                No account yet?{" "}
                <Link
                  href="/signup"
                  className={`font-medium transition-colors ${
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
          className={`mt-6 text-[10px] text-center uppercase tracking-[0.2em] transition-colors ${
            isDark
              ? "text-slate-700"
              : "text-slate-400"
          }`}
        >
          Fare Collection System v1.0
        </p>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
      >
        <DialogContent
          className={`w-[calc(100vw-2rem)] max-w-sm mx-auto rounded-2xl max-h-[85dvh] overflow-y-auto p-5 sm:p-6 gap-0 transition-colors ${
            isDark
              ? "bg-slate-950 border-slate-800 text-white"
              : "bg-white border-slate-200 text-slate-900"
          }`}
        >
          <DialogHeader className="mb-4">
            <DialogTitle
              className={`text-base font-semibold ${
                isDark
                  ? "text-white"
                  : "text-slate-900"
              }`}
            >
              Reset your password
            </DialogTitle>

            <DialogDescription
              className={`text-xs mt-1 leading-relaxed ${
                isDark
                  ? "text-slate-400"
                  : "text-slate-500"
              }`}
            >
              Enter your registered email and we'll
              send you a secure reset link valid for
              1 hour.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleForgotSubmit}
            className="space-y-4"
          >
            {forgotError && (
              <div
                className={`p-3 rounded-lg border text-xs leading-relaxed ${
                  isDark
                    ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : "bg-red-50 border-red-200 text-red-600"
                }`}
              >
                {forgotError}
              </div>
            )}

            {forgotMessage && (
              <div
                className={`p-3 rounded-lg border text-xs leading-relaxed ${
                  isDark
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-emerald-50 border-emerald-200 text-emerald-600"
                }`}
              >
                {forgotMessage}
              </div>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="forgot-email"
                className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Email Address
              </Label>

              <Input
                id="forgot-email"
                type="email"
                value={forgotEmail}
                onChange={(e) =>
                  setForgotEmail(e.target.value)
                }
                placeholder="name@example.com"
                autoComplete="email"
                className={`h-11 text-sm border-2 ${
                  isDark
                    ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
                    : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                }`}
                disabled={forgotBusy}
                required
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className={`h-11 w-full sm:w-auto text-sm ${
                  isDark
                    ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                    : "border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() =>
                  setForgotOpen(false)
                }
              >
                Cancel
              </Button>

              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-11 w-full sm:w-auto text-sm"
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