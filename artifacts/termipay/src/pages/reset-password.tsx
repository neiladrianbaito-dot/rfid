import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
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
  Lock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Sun,
  Moon,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";

type TokenState =
  | "loading"
  | "valid"
  | "invalid"
  | "expired"
  | "used";

type Theme = "light" | "dark";

const THEME_KEY = "termipay_theme";

/* =========================================================
   PARTICLE NETWORK BACKGROUND
   ========================================================= */

const ParticleNetworkBackground = ({
  theme,
}: {
  theme: Theme;
}) => {
  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  const themeRef =
    useRef<Theme>(theme);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) return;

    const BALL_NUM = 60;
    const R = 2;
    const ALPHA_F = 0.03;
    const DIS_LIMIT = 140;
    const LINE_WIDTH = 0.8;

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      phase: number;
      isMouse?: boolean;
    };

    let canW = window.innerWidth;
    let canH = window.innerHeight;

    let particles: Particle[] = [];

    let rafId = 0;

    let mouseParticle:
      | Particle
      | null = null;

    const randomNumFrom = (
      min: number,
      max: number
    ) =>
      Math.random() *
        (max - min) +
      min;

    const randomSidePos = (
      length: number
    ) =>
      Math.ceil(
        Math.random() * length
      );

    const randomArrayItem = <T,>(
      arr: T[]
    ) =>
      arr[
        Math.floor(
          Math.random() *
            arr.length
        )
      ];

    const getRandomSpeed = (
      pos:
        | "top"
        | "right"
        | "bottom"
        | "left"
    ): [number, number] => {
      const min = -0.6;
      const max = 0.6;

      switch (pos) {
        case "top":
          return [
            randomNumFrom(
              min,
              max
            ),
            randomNumFrom(
              0.05,
              max
            ),
          ];

        case "right":
          return [
            randomNumFrom(
              min,
              -0.05
            ),
            randomNumFrom(
              min,
              max
            ),
          ];

        case "bottom":
          return [
            randomNumFrom(
              min,
              max
            ),
            randomNumFrom(
              min,
              -0.05
            ),
          ];

        case "left":
          return [
            randomNumFrom(
              0.05,
              max
            ),
            randomNumFrom(
              min,
              max
            ),
          ];
      }
    };

    const getRandomParticle =
      (): Particle => {
        const pos =
          randomArrayItem([
            "top",
            "right",
            "bottom",
            "left",
          ] as const);

        const [vx, vy] =
          getRandomSpeed(pos);

        const base = {
          vx,
          vy,
          alpha: 1,
          phase:
            randomNumFrom(
              0,
              10
            ),
        };

        switch (pos) {
          case "top":
            return {
              ...base,
              x: randomSidePos(
                canW
              ),
              y: -R,
            };

          case "right":
            return {
              ...base,
              x: canW + R,
              y: randomSidePos(
                canH
              ),
            };

          case "bottom":
            return {
              ...base,
              x: randomSidePos(
                canW
              ),
              y: canH + R,
            };

          case "left":
            return {
              ...base,
              x: -R,
              y: randomSidePos(
                canH
              ),
            };
        }
      };

    const getDistance = (
      a: Particle,
      b: Particle
    ) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;

      return Math.sqrt(
        dx * dx + dy * dy
      );
    };

    const initParticles = (
      num: number
    ) => {
      particles = [];

      for (
        let i = 0;
        i < num;
        i++
      ) {
        const [vx, vy] =
          getRandomSpeed(
            "top"
          );

        particles.push({
          x: randomSidePos(
            canW
          ),
          y: randomSidePos(
            canH
          ),
          vx,
          vy,
          alpha: 1,
          phase:
            randomNumFrom(
              0,
              10
            ),
        });
      }
    };

    const resize = () => {
      canW =
        window.innerWidth;

      canH =
        window.innerHeight;

      canvas.width = canW;
      canvas.height = canH;
    };

    const renderParticles = () => {
      const isDark =
        themeRef.current ===
        "dark";

      const color = isDark
        ? "96,165,250"
        : "37,99,235";

      particles.forEach(
        (p) => {
          if (p.isMouse) return;

          const alpha =
            p.alpha *
            (isDark
              ? 0.75
              : 0.45);

          ctx.fillStyle =
            `rgba(${color},${alpha})`;

          ctx.beginPath();

          ctx.arc(
            p.x,
            p.y,
            R,
            0,
            Math.PI * 2,
            true
          );

          ctx.closePath();

          ctx.fill();
        }
      );
    };

    const renderLines = () => {
      const isDark =
        themeRef.current ===
        "dark";

      const color = isDark
        ? "96,165,250"
        : "37,99,235";

      for (
        let i = 0;
        i < particles.length;
        i++
      ) {
        for (
          let j = i + 1;
          j < particles.length;
          j++
        ) {
          const fraction =
            getDistance(
              particles[i],
              particles[j]
            ) /
            DIS_LIMIT;

          if (fraction < 1) {
            const alpha =
              (1 - fraction) *
              (isDark
                ? 0.35
                : 0.16);

            ctx.strokeStyle =
              `rgba(${color},${alpha})`;

            ctx.lineWidth =
              LINE_WIDTH;

            ctx.beginPath();

            ctx.moveTo(
              particles[i].x,
              particles[i].y
            );

            ctx.lineTo(
              particles[j].x,
              particles[j].y
            );

            ctx.stroke();

            ctx.closePath();
          }
        }
      }
    };

    const updateParticles =
      () => {
        const next: Particle[] =
          [];

        particles.forEach(
          (p) => {
            if (p.isMouse) {
              next.push(p);
              return;
            }

            p.x += p.vx;
            p.y += p.vy;

            p.phase += ALPHA_F;

            p.alpha =
              Math.abs(
                Math.cos(
                  p.phase
                )
              );

            if (
              p.x > -50 &&
              p.x <
                canW + 50 &&
              p.y > -50 &&
              p.y <
                canH + 50
            ) {
              next.push(p);
            }
          }
        );

        particles = next;
      };

    const addParticleIfNeeded =
      () => {
        if (
          particles.length <
          BALL_NUM
        ) {
          particles.push(
            getRandomParticle()
          );
        }
      };

    const render = () => {
      ctx.clearRect(
        0,
        0,
        canW,
        canH
      );

      renderParticles();
      renderLines();
      updateParticles();
      addParticleIfNeeded();

      rafId =
        window.requestAnimationFrame(
          render
        );
    };

    const setMouseParticlePos =
      (
        clientX: number,
        clientY: number
      ) => {
        const rect =
          canvas.getBoundingClientRect();

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

          particles.push(
            mouseParticle
          );
        }

        mouseParticle.x =
          clientX - rect.left;

        mouseParticle.y =
          clientY - rect.top;
      };

    const clearMouseParticle =
      () => {
        particles =
          particles.filter(
            (p) =>
              !p.isMouse
          );

        mouseParticle = null;
      };

    const handleMouseMove = (
      e: MouseEvent
    ) => {
      setMouseParticlePos(
        e.clientX,
        e.clientY
      );
    };

    const handleMouseOut = (
      e: MouseEvent
    ) => {
      if (!e.relatedTarget) {
        clearMouseParticle();
      }
    };

    const handleTouchStart = (
      e: TouchEvent
    ) => {
      const touch =
        e.touches[0];

      if (touch) {
        setMouseParticlePos(
          touch.clientX,
          touch.clientY
        );
      }
    };

    const handleTouchMove = (
      e: TouchEvent
    ) => {
      e.preventDefault();

      const touch =
        e.touches[0];

      if (touch) {
        setMouseParticlePos(
          touch.clientX,
          touch.clientY
        );
      }
    };

    const handleTouchEnd =
      () => {
        clearMouseParticle();
      };

    resize();

    initParticles(
      BALL_NUM
    );

    rafId =
      window.requestAnimationFrame(
        render
      );

    window.addEventListener(
      "resize",
      resize
    );

    window.addEventListener(
      "mousemove",
      handleMouseMove
    );

    window.addEventListener(
      "mouseout",
      handleMouseOut
    );

    canvas.addEventListener(
      "touchstart",
      handleTouchStart,
      {
        passive: true,
      }
    );

    canvas.addEventListener(
      "touchmove",
      handleTouchMove,
      {
        passive: false,
      }
    );

    canvas.addEventListener(
      "touchend",
      handleTouchEnd
    );

    canvas.addEventListener(
      "touchcancel",
      handleTouchEnd
    );

    return () => {
      window.cancelAnimationFrame(
        rafId
      );

      window.removeEventListener(
        "resize",
        resize
      );

      window.removeEventListener(
        "mousemove",
        handleMouseMove
      );

      window.removeEventListener(
        "mouseout",
        handleMouseOut
      );

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

  const isDark =
    theme === "dark";

  return (
    <div
      className={`fixed inset-0 -z-10 overflow-hidden transition-colors duration-300 ${
        isDark
          ? "bg-[#020617]"
          : "bg-white"
      }`}
    >
      <div
        className={`absolute inset-0 transition-all duration-300 ${
          isDark
            ? "bg-[radial-gradient(circle_at_50%_50%,_rgba(30,41,59,0.5)_0%,_rgba(2,6,23,1)_100%)]"
            : "bg-[radial-gradient(circle_at_50%_35%,_rgba(37,99,235,0.08)_0%,_rgba(255,255,255,1)_75%)]"
        }`}
      />

      <div
        className={`absolute top-[-5%] right-[-5%] w-[30%] h-[30%] rounded-full blur-[100px] ${
          isDark
            ? "bg-blue-500/10"
            : "bg-blue-500/5"
        }`}
      />

      <div
        className={`absolute bottom-[-5%] left-[-5%] w-[30%] h-[30%] rounded-full blur-[100px] ${
          isDark
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

/* =========================================================
   SHELL
   ========================================================= */

function Shell({
  children,
  theme,
  toggleTheme,
}: {
  children: React.ReactNode;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const isDark =
    theme === "dark";

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

      {/* Theme Toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={
          isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
        }
        className={`fixed top-5 right-5 z-30 flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300 ${
          isDark
            ? "bg-slate-950/80 border-slate-700 text-blue-300 hover:border-blue-500 hover:bg-slate-900"
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
            className={`inline-flex items-center justify-center p-3 rounded-2xl border mb-4 transition-colors duration-300 ${
              isDark
                ? "bg-blue-500/10 border-blue-500/20"
                : "bg-blue-50 border-blue-100"
            }`}
          >
            <CreditCard
              className={`h-7 w-7 sm:h-8 sm:w-8 ${
                isDark
                  ? "text-blue-400"
                  : "text-blue-600"
              }`}
            />
          </div>

          <h1
            className={`text-2xl sm:text-3xl font-black tracking-tight italic transition-colors duration-300 ${
              isDark
                ? "text-white"
                : "text-slate-900"
            }`}
          >
            RESET PASSWORD
          </h1>

          <p
            className={`text-[10px] uppercase tracking-[0.25em] mt-2 ${
              isDark
                ? "text-slate-500"
                : "text-slate-400"
            }`}
          >
            Digital Transit Network
          </p>
        </div>

        {children}

        <p
          className={`mt-6 text-[10px] text-center uppercase tracking-[0.2em] ${
            isDark
              ? "text-slate-700"
              : "text-slate-400"
          }`}
        >
          Fare Collection System v1.0
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   RESET PASSWORD PAGE
   ========================================================= */

export default function ResetPasswordPage() {
  const [, setLocation] =
    useLocation();

  const token =
    new URLSearchParams(
      window.location.search
    ).get("token") ?? "";

  const [
    tokenState,
    setTokenState,
  ] =
    useState<TokenState>(
      "loading"
    );

  const [
    tokenMessage,
    setTokenMessage,
  ] = useState("");

  const [
    newPassword,
    setNewPassword,
  ] = useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    showNew,
    setShowNew,
  ] = useState(false);

  const [
    showConfirm,
    setShowConfirm,
  ] = useState(false);

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState(false);

  /* =======================================================
     THEME
     ======================================================= */

  const [theme, setTheme] =
    useState<Theme>("light");

  useEffect(() => {
    const stored =
      window.localStorage.getItem(
        THEME_KEY
      ) as Theme | null;

    if (
      stored === "dark" ||
      stored === "light"
    ) {
      setTheme(stored);
      return;
    }

    const systemDark =
      window.matchMedia?.(
        "(prefers-color-scheme: dark)"
      ).matches;

    setTheme(
      systemDark
        ? "dark"
        : "light"
    );
  }, []);

  const toggleTheme = () => {
    setTheme((previous) => {
      const next =
        previous === "light"
          ? "dark"
          : "light";

      window.localStorage.setItem(
        THEME_KEY,
        next
      );

      return next;
    });
  };

  const isDark =
    theme === "dark";

  /* =======================================================
     VERIFY TOKEN
     ======================================================= */

  useEffect(() => {
    if (!token) {
      setTokenState("invalid");

      setTokenMessage(
        "No reset token found. Please use the link from your email."
      );

      return;
    }

    (async () => {
      try {
        const res =
          await fetch(
            buildApiUrl(
              `/auth/user/verify-reset-token?token=${encodeURIComponent(
                token
              )}`
            )
          );

        const data =
          (await res.json()) as {
            valid?: boolean;
            message?: string;
          };

        if (res.status === 410) {
          const msg =
            data.message ?? "";

          setTokenState(
            msg
              .toLowerCase()
              .includes("used")
              ? "used"
              : "expired"
          );

          setTokenMessage(msg);
        } else if (
          !res.ok ||
          !data.valid
        ) {
          setTokenState(
            "invalid"
          );

          setTokenMessage(
            data.message ??
              "Invalid or expired reset link."
          );
        } else {
          setTokenState(
            "valid"
          );
        }
      } catch {
        setTokenState(
          "invalid"
        );

        setTokenMessage(
          "Could not reach the server. Please try again."
        );
      }
    })();
  }, [token]);

  /* =======================================================
     SUBMIT
     ======================================================= */

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    setError("");

    if (newPassword.length < 8) {
      setError(
        "Password must be at least 8 characters."
      );

      return;
    }

    if (
      newPassword !==
      confirmPassword
    ) {
      setError(
        "Passwords do not match."
      );

      return;
    }

    setIsSubmitting(true);

    try {
      const res =
        await fetch(
          buildApiUrl(
            "/auth/user/reset-password"
          ),
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              token,
              newPassword,
            }),
          }
        );

      const data =
        (await res.json()) as {
          success?: boolean;
          message?: string;
        };

      if (
        !res.ok ||
        !data.success
      ) {
        setError(
          data.message ??
            "Failed to reset password. Please try again."
        );

        return;
      }

      setSuccess(true);
    } catch {
      setError(
        "Could not reach the server. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /* =======================================================
     CARD CLASS
     ======================================================= */

  const cardClass = isDark
    ? "bg-slate-950/80 border-slate-800 shadow-[0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
    : "bg-white/90 border-slate-200 shadow-[0_8px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl";

  const inputClass = isDark
    ? "bg-slate-900/60 border-slate-700/70 text-white placeholder:text-slate-600 focus:border-blue-500"
    : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500";

  const labelClass = isDark
    ? "text-slate-400"
    : "text-slate-500";

  /* =======================================================
     LOADING
     ======================================================= */

  if (
    tokenState ===
    "loading"
  ) {
    return (
      <Shell
        theme={theme}
        toggleTheme={
          toggleTheme
        }
      >
        <Card
          className={`overflow-hidden ${cardClass}`}
        >
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />

          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <Loader2
              className={`h-8 w-8 animate-spin ${
                isDark
                  ? "text-blue-400"
                  : "text-blue-600"
              }`}
            />

            <p
              className={`text-sm ${
                isDark
                  ? "text-slate-400"
                  : "text-slate-500"
              }`}
            >
              Verifying your reset
              link…
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  /* =======================================================
     INVALID / EXPIRED / USED
     ======================================================= */

  if (
    tokenState !==
    "valid"
  ) {
    const isUsed =
      tokenState === "used";

    const isExpired =
      tokenState ===
      "expired";

    return (
      <Shell
        theme={theme}
        toggleTheme={
          toggleTheme
        }
      >
        <Card
          className={`overflow-hidden ${cardClass}`}
        >
          <div
            className={`h-1 w-full bg-gradient-to-r ${
              isUsed
                ? "from-amber-500 to-orange-500"
                : "from-red-500 to-rose-500"
            }`}
          />

          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            {isUsed ? (
              <AlertTriangle
                className={`h-10 w-10 ${
                  isDark
                    ? "text-amber-400"
                    : "text-amber-600"
                }`}
              />
            ) : (
              <XCircle
                className={`h-10 w-10 ${
                  isDark
                    ? "text-red-400"
                    : "text-red-600"
                }`}
              />
            )}

            <div>
              <p
                className={`font-bold text-base mb-1 ${
                  isDark
                    ? "text-white"
                    : "text-slate-900"
                }`}
              >
                {isUsed
                  ? "Link Already Used"
                  : isExpired
                  ? "Link Expired"
                  : "Invalid Link"}
              </p>

              <p
                className={`text-sm ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                {tokenMessage}
              </p>
            </div>

            {(isExpired ||
              isUsed) && (
              <Button
                className="mt-2 bg-blue-600 hover:bg-blue-500 text-white font-bold"
                onClick={() =>
                  setLocation(
                    "/signin"
                  )
                }
              >
                Request a new
                link
              </Button>
            )}

            {tokenState ===
              "invalid" && (
              <Button
                variant="outline"
                className={
                  isDark
                    ? "mt-2 border-slate-600 text-slate-300 hover:bg-slate-800"
                    : "mt-2 border-slate-300 text-slate-700 hover:bg-slate-50"
                }
                onClick={() =>
                  setLocation(
                    "/signin"
                  )
                }
              >
                Back to Sign In
              </Button>
            )}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  /* =======================================================
     SUCCESS
     ======================================================= */

  if (success) {
    return (
      <Shell
        theme={theme}
        toggleTheme={
          toggleTheme
        }
      >
        <Card
          className={`overflow-hidden ${cardClass}`}
        >
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />

          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2
              className={`h-10 w-10 ${
                isDark
                  ? "text-emerald-400"
                  : "text-emerald-600"
              }`}
            />

            <div>
              <p
                className={`font-bold text-base mb-1 ${
                  isDark
                    ? "text-white"
                    : "text-slate-900"
                }`}
              >
                Password Reset!
              </p>

              <p
                className={`text-sm ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Your password has
                been updated
                successfully.
              </p>
            </div>

            <Button
              className="mt-2 w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all shadow-lg shadow-emerald-900/20 inline-flex items-center justify-center gap-2"
              onClick={() =>
                setLocation(
                  "/signin"
                )
              }
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  /* =======================================================
     MAIN FORM
     ======================================================= */

  return (
    <Shell
      theme={theme}
      toggleTheme={
        toggleTheme
      }
    >
      <Card
        className={`overflow-hidden ${cardClass}`}
      >
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />

        <CardHeader className="pb-4 px-5 sm:px-6 pt-5 sm:pt-6">
          <CardTitle
            className={`text-xl ${
              isDark
                ? "text-white"
                : "text-slate-900"
            }`}
          >
            Set New Password
          </CardTitle>

          <CardDescription
            className={`text-xs ${
              isDark
                ? "text-slate-500"
                : "text-slate-500"
            }`}
          >
            Choose a strong
            password. This link
            can only be used once.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 sm:px-6 pb-5 sm:pb-6">
          <form
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* Error */}
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

            {/* =================================================
                NEW PASSWORD
                ================================================= */}

            <div className="space-y-1.5">
              <Label
                htmlFor="new-password"
                className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${labelClass}`}
              >
                New Password
              </Label>

              <div className="relative">
                <Lock
                  className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${
                    isDark
                      ? "text-slate-600"
                      : "text-slate-400"
                  }`}
                />

                <Input
                  id="new-password"
                  type={
                    showNew
                      ? "text"
                      : "password"
                  }
                  value={newPassword}
                  onChange={(e) =>
                    setNewPassword(
                      e.target.value
                    )
                  }
                  placeholder="At least 8 characters"
                  disabled={
                    isSubmitting
                  }
                  required
                  autoComplete="new-password"
                  className={`pl-10 pr-10 h-11 text-sm border-2 transition-all ${inputClass}`}
                />

                <button
                  type="button"
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 transition-colors ${
                    isDark
                      ? "text-slate-600 hover:text-slate-300"
                      : "text-slate-400 hover:text-slate-600"
                  }`}
                  onClick={() =>
                    setShowNew(
                      (p) => !p
                    )
                  }
                  aria-label={
                    showNew
                      ? "Hide new password"
                      : "Show new password"
                  }
                >
                  {showNew ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Strength */}
              <div className="flex gap-1 mt-1 px-1">
                {[8, 12, 16].map(
                  (
                    threshold,
                    i
                  ) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                        newPassword.length >=
                        threshold
                          ? i === 0
                            ? "bg-red-500"
                            : i === 1
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                          : isDark
                          ? "bg-slate-700"
                          : "bg-slate-200"
                      }`}
                    />
                  )
                )}
              </div>
            </div>

            {/* =================================================
                CONFIRM PASSWORD
                ================================================= */}

            <div className="space-y-1.5">
              <Label
                htmlFor="confirm-password"
                className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${labelClass}`}
              >
                Confirm Password
              </Label>

              <div className="relative">
                <Lock
                  className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${
                    isDark
                      ? "text-slate-600"
                      : "text-slate-400"
                  }`}
                />

                <Input
                  id="confirm-password"
                  type={
                    showConfirm
                      ? "text"
                      : "password"
                  }
                  value={
                    confirmPassword
                  }
                  onChange={(e) =>
                    setConfirmPassword(
                      e.target.value
                    )
                  }
                  placeholder="Repeat your password"
                  disabled={
                    isSubmitting
                  }
                  required
                  autoComplete="new-password"
                  className={`pl-10 pr-10 h-11 text-sm border-2 transition-all ${inputClass} ${
                    confirmPassword &&
                    confirmPassword !==
                      newPassword
                      ? "border-red-500/60"
                      : ""
                  } ${
                    confirmPassword &&
                    confirmPassword ===
                      newPassword
                      ? "border-emerald-500/60"
                      : ""
                  }`}
                />

                <button
                  type="button"
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 transition-colors ${
                    isDark
                      ? "text-slate-600 hover:text-slate-300"
                      : "text-slate-400 hover:text-slate-600"
                  }`}
                  onClick={() =>
                    setShowConfirm(
                      (p) => !p
                    )
                  }
                  aria-label={
                    showConfirm
                      ? "Hide confirmation password"
                      : "Show confirmation password"
                  }
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {confirmPassword &&
                confirmPassword !==
                  newPassword && (
                  <p
                    className={`text-[10px] ml-1 ${
                      isDark
                        ? "text-red-400"
                        : "text-red-600"
                    }`}
                  >
                    Passwords do not
                    match
                  </p>
                )}

              {confirmPassword &&
                confirmPassword ===
                  newPassword && (
                  <p
                    className={`text-[10px] ml-1 ${
                      isDark
                        ? "text-emerald-400"
                        : "text-emerald-600"
                    }`}
                  >
                    Passwords match ✓
                  </p>
                )}
            </div>

            {/* =================================================
                SUBMIT
                ================================================= */}

            <Button
              type="submit"
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-900/20 mt-2"
              disabled={
                isSubmitting
              }
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save New Password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}