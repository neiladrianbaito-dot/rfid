import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreditCard, Eye, EyeOff, Loader2, Lock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";

type TokenState = "loading" | "valid" | "invalid" | "expired" | "used";

/**
 * Particle Network Background
 * Dots drift in from the edges, fade in/out, and link to nearby
 * neighbors with thin lines. Mouse/touch position joins the network.
 *
 * Mouse/touch listeners are attached at the WINDOW level (not just the
 * canvas) so the particle network keeps tracking the cursor even when
 * it's hovering over foreground UI like the reset-password card, since
 * the canvas sits behind everything (-z-10).
 */
const ParticleNetworkBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    // Matches the page's blue accent (blue-500: #3b82f6)
    const BALL_COLOR = { r: 96, g: 165, b: 250 };

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
    let mouseParticle: Particle | null = null;

    const randomNumFrom = (min: number, max: number) => Math.random() * (max - min) + min;
    const randomSidePos = (length: number) => Math.ceil(Math.random() * length);
    const randomArrayItem = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

    const getRandomSpeed = (pos: "top" | "right" | "bottom" | "left"): [number, number] => {
      const min = -0.6;
      const max = 0.6;
      switch (pos) {
        case "top":
          return [randomNumFrom(min, max), randomNumFrom(0.05, max)];
        case "right":
          return [randomNumFrom(min, -0.05), randomNumFrom(min, max)];
        case "bottom":
          return [randomNumFrom(min, max), randomNumFrom(min, -0.05)];
        case "left":
          return [randomNumFrom(0.05, max), randomNumFrom(min, max)];
      }
    };

    const getRandomParticle = (): Particle => {
      const pos = randomArrayItem(["top", "right", "bottom", "left"] as const);
      const [vx, vy] = getRandomSpeed(pos);
      const base = { vx, vy, alpha: 1, phase: randomNumFrom(0, 10) };
      switch (pos) {
        case "top":
          return { ...base, x: randomSidePos(canW), y: -R };
        case "right":
          return { ...base, x: canW + R, y: randomSidePos(canH) };
        case "bottom":
          return { ...base, x: randomSidePos(canW), y: canH + R };
        case "left":
          return { ...base, x: -R, y: randomSidePos(canH) };
      }
    };

    const getDisOf = (a: Particle, b: Particle) => {
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
      particles.forEach((p) => {
        if (p.isMouse) return;
        ctx.fillStyle = `rgba(${BALL_COLOR.r},${BALL_COLOR.g},${BALL_COLOR.b},${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
      });
    };

    const renderLines = () => {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const fraction = getDisOf(particles[i], particles[j]) / DIS_LIMIT;
          if (fraction < 1) {
            const alpha = (1 - fraction) * 0.5;
            ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
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
        if (p.x > -50 && p.x < canW + 50 && p.y > -50 && p.y < canH + 50) {
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

    const handleResize = () => resize();

    // Shared helper: convert viewport coords -> canvas-relative coords,
    // and create/update the mouse particle.
    const setMouseParticlePos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (!mouseParticle) {
        mouseParticle = { x: 0, y: 0, vx: 0, vy: 0, alpha: 1, phase: 0, isMouse: true };
        particles.push(mouseParticle);
      }
      mouseParticle.x = clientX - rect.left;
      mouseParticle.y = clientY - rect.top;
    };

    const clearMouseParticle = () => {
      particles = particles.filter((p) => !p.isMouse);
      mouseParticle = null;
    };

    // Mouse — attached on window so it keeps working even over
    // foreground UI (Card, inputs, buttons) since the canvas sits at -z-10.
    const handleWindowMouseMove = (e: MouseEvent) => {
      setMouseParticlePos(e.clientX, e.clientY);
    };
    const handleWindowMouseOut = (e: MouseEvent) => {
      // relatedTarget is null when the cursor actually leaves the browser window
      if (!e.relatedTarget) {
        clearMouseParticle();
      }
    };

    // Touch — tap/drag joins the network the same way a mouse hover does
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) setMouseParticlePos(touch.clientX, touch.clientY);
    };
    const handleTouchMove = (e: TouchEvent) => {
      // Prevent the page from scrolling while dragging a finger across the background
      e.preventDefault();
      const touch = e.touches[0];
      if (touch) setMouseParticlePos(touch.clientX, touch.clientY);
    };
    const handleTouchEnd = () => {
      clearMouseParticle();
    };

    resize();
    initParticles(BALL_NUM);
    rafId = window.requestAnimationFrame(render);

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseout", handleWindowMouseOut);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseout", handleWindowMouseOut);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 bg-[#020617] overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(30,41,59,0.5)_0%,_rgba(2,6,23,1)_100%)]" />
      {/* Keep the original blue/emerald accent glows behind the particles */}
      <div className="absolute top-[-5%] right-[-5%] w-[30%] h-[30%] bg-blue-500/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-5%] left-[-5%] w-[30%] h-[30%] bg-emerald-500/10 rounded-full blur-[100px]" />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
};

// ── Shell moved OUTSIDE the component so it never re-mounts on re-render ──────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <ParticleNetworkBackground />
      <div className="w-full max-w-[420px] z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 mb-4">
            <CreditCard className="h-8 w-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight italic">RESET PASSWORD</h1>
          <p className="text-slate-500 text-xs uppercase tracking-[0.3em] mt-2">Digital Transit Network</p>
        </div>
        {children}
        <p className="mt-8 text-[10px] text-slate-600 text-center uppercase tracking-[0.2em]">
          Automated Transit Wallet System v2.0
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [tokenState, setTokenState] = useState<TokenState>("loading");
  const [tokenMessage, setTokenMessage] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenState("invalid");
      setTokenMessage("No reset token found. Please use the link from your email.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(buildApiUrl(`/auth/user/verify-reset-token?token=${encodeURIComponent(token)}`));
        const data = (await res.json()) as { valid?: boolean; message?: string };

        if (res.status === 410) {
          const msg = data.message ?? "";
          setTokenState(msg.toLowerCase().includes("used") ? "used" : "expired");
          setTokenMessage(msg);
        } else if (!res.ok || !data.valid) {
          setTokenState("invalid");
          setTokenMessage(data.message ?? "Invalid or expired reset link.");
        } else {
          setTokenState("valid");
        }
      } catch {
        setTokenState("invalid");
        setTokenMessage("Could not reach the server. Please try again.");
      }
    })();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(buildApiUrl("/auth/user/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string };

      if (!res.ok || !data.success) {
        setError(data.message ?? "Failed to reset password. Please try again.");
        return;
      }

      setSuccess(true);
      setTimeout(() => setLocation("/signin"), 3000);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (tokenState === "loading") {
    return (
      <Shell>
        <Card className="bg-slate-900/40 backdrop-blur-xl border-slate-800 shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
            <p className="text-slate-400 text-sm">Verifying your reset link…</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Invalid / expired / used ──────────────────────────────────────────────
  if (tokenState !== "valid") {
    const isUsed = tokenState === "used";
    const isExpired = tokenState === "expired";

    return (
      <Shell>
        <Card className="bg-slate-900/40 backdrop-blur-xl border-slate-800 shadow-2xl overflow-hidden">
          <div className={`h-1 w-full bg-gradient-to-r ${isUsed ? "from-amber-500 to-orange-500" : "from-red-500 to-rose-500"}`} />
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            {isUsed ? (
              <AlertTriangle className="h-10 w-10 text-amber-400" />
            ) : (
              <XCircle className="h-10 w-10 text-red-400" />
            )}
            <div>
              <p className="text-white font-bold text-base mb-1">
                {isUsed ? "Link Already Used" : isExpired ? "Link Expired" : "Invalid Link"}
              </p>
              <p className="text-slate-400 text-sm">{tokenMessage}</p>
            </div>
            {(isExpired || isUsed) && (
              <Button
                className="mt-2 bg-blue-600 hover:bg-blue-500 text-white font-bold"
                onClick={() => setLocation("/signin")}
              >
                Request a new link
              </Button>
            )}
            {tokenState === "invalid" && (
              <Button
                variant="outline"
                className="mt-2 border-slate-600 text-slate-300"
                onClick={() => setLocation("/signin")}
              >
                Back to Sign In
              </Button>
            )}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (success) {
    return (
      <Shell>
        <Card className="bg-slate-900/40 backdrop-blur-xl border-slate-800 shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <div>
              <p className="text-white font-bold text-base mb-1">Password Reset!</p>
              <p className="text-slate-400 text-sm">
                Your password has been updated. Redirecting you to sign in…
              </p>
            </div>
            <Loader2 className="h-4 w-4 text-slate-500 animate-spin" />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <Shell>
      <Card className="bg-slate-900/40 backdrop-blur-xl border-slate-800 shadow-2xl overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />
        <CardHeader className="pb-4">
          <CardTitle className="text-xl text-white">Set New Password</CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            Choose a strong password. This link can only be used once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] animate-in fade-in slide-in-from-top-1">
                {error}
              </div>
            )}

            {/* New Password */}
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                New Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={isSubmitting}
                  required
                  className="bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 pr-10 h-11 text-white transition-all"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  onClick={() => setShowNew((p) => !p)}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {/* Strength indicator */}
              <div className="flex gap-1 mt-1 px-1">
                {[8, 12, 16].map((threshold, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      newPassword.length >= threshold
                        ? i === 0 ? "bg-red-500" : i === 1 ? "bg-amber-500" : "bg-emerald-500"
                        : "bg-slate-700"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                Confirm Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  disabled={isSubmitting}
                  required
                  className={`bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 pr-10 h-11 text-white transition-all ${
                    confirmPassword && confirmPassword !== newPassword ? "border-red-500/50" : ""
                  } ${confirmPassword && confirmPassword === newPassword ? "border-emerald-500/50" : ""}`}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  onClick={() => setShowConfirm((p) => !p)}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-[10px] text-red-400 ml-1">Passwords do not match</p>
              )}
              {confirmPassword && confirmPassword === newPassword && (
                <p className="text-[10px] text-emerald-400 ml-1">Passwords match ✓</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg shadow-blue-900/20 mt-2"
              disabled={isSubmitting}
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