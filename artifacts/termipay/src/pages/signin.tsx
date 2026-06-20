import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreditCard, Eye, EyeOff, Loader2, Mail, Lock } from "lucide-react";
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

/**
 * Particle Network Background
 * Dots drift in from the edges, fade in/out, and link to nearby
 * neighbors with thin lines. Mouse/touch position joins the network.
 *
 * Mouse/touch listeners are attached at the WINDOW level (not just the
 * canvas) so the particle network keeps tracking the cursor even when
 * it's hovering over foreground UI like the Sign In card, since the
 * canvas sits behind everything (-z-10).
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

  function redirectToPaymongoDashboard() {
    const basePath = (import.meta.env.BASE_URL || "").replace(/\/$/, "");
    const target = `${basePath}/paymongo-dashboard`;
    try {
      setLocation("/paymongo-dashboard");
      window.setTimeout(() => {
        if (!window.location.pathname.endsWith("/paymongo-dashboard")) {
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
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = (await response.json()) as { message?: string; token?: string };
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
      setForgotMessage(data?.message || "Check your inbox for reset instructions.");
    } catch {
      setForgotError("Could not reach the server. Try again later.");
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <ParticleNetworkBackground />

      <div className="w-full max-w-[420px] z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 mb-4">
            <CreditCard className="h-8 w-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight italic">ACCESS THE SYSTEM</h1>
          <p className="text-slate-500 text-xs uppercase tracking-[0.3em] mt-2">Digital Transit Network</p>
        </div>

        <Card className="bg-slate-900/40 backdrop-blur-xl border-slate-800 shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />
          <CardHeader className="pb-4">
            <CardTitle className="text-xl text-white">Sign In</CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              Welcome back. Please authenticate to access your wallet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] animate-in fade-in slide-in-from-top-1">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    disabled={isSubmitting}
                    required
                    className="bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 h-11 text-white transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                {/* Password label only — no forgot link here */}
                <Label htmlFor="password" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                  Security Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={isSubmitting}
                    required
                    className="bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 pr-10 h-11 text-white transition-all"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* ✅ Forgot password now BELOW the password field */}
              <div className="flex justify-end -mt-2">
                <button
                  type="button"
                  className="text-[10px] font-semibold text-blue-400 hover:text-blue-300"
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

              <Button
                type="submit"
                className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg shadow-blue-900/20"
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

            <div className="mt-6 pt-6 border-t border-slate-800">
              <p className="text-sm text-slate-500 text-center">
                No account yet?{" "}
                <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                  Sign Up
                </Link>
              </p>
            </div>

            <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
              <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Reset your password</DialogTitle>
                  <DialogDescription className="text-slate-400 text-xs">
                    Enter your registered email and we will send you a secure reset link valid for 1 hour.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleForgotSubmit} className="space-y-3">
                  {forgotError && (
                    <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{forgotError}</div>
                  )}
                  {forgotMessage && (
                    <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                      {forgotMessage}
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="forgot-email" className="text-[10px] uppercase text-slate-500">
                      Email
                    </Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="bg-slate-950/50 border-slate-700 text-white"
                      disabled={forgotBusy}
                      required
                    />
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button type="button" variant="outline" className="border-slate-600" onClick={() => setForgotOpen(false)}>
                      Close
                    </Button>
                    <Button type="submit" className="bg-blue-600 hover:bg-blue-500" disabled={forgotBusy}>
                      {forgotBusy ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sending…
                        </span>
                      ) : (
                        "Send reset link"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <p className="mt-8 text-[10px] text-slate-600 text-center uppercase tracking-[0.2em]">
          Automated Transit Wallet System v2.0
        </p>
      </div>
    </div>
  );
}