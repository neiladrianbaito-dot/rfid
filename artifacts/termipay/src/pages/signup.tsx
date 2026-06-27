import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreditCard, Eye, EyeOff, Loader2, User, Mail, Lock, CheckCircle2 } from "lucide-react";
import { buildApiUrl } from "@/lib/api-url";

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

    let canW = 0;
    let canH = 0;
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
        case "top":    return [randomNumFrom(min, max), randomNumFrom(0.05, max)];
        case "right":  return [randomNumFrom(min, -0.05), randomNumFrom(min, max)];
        case "bottom": return [randomNumFrom(min, max), randomNumFrom(min, -0.05)];
        case "left":   return [randomNumFrom(0.05, max), randomNumFrom(min, max)];
      }
    };

    const getRandomParticle = (): Particle => {
      const pos = randomArrayItem(["top", "right", "bottom", "left"] as const);
      const [vx, vy] = getRandomSpeed(pos);
      const base = { vx, vy, alpha: 1, phase: randomNumFrom(0, 10) };
      switch (pos) {
        case "top":    return { ...base, x: randomSidePos(canW), y: -R };
        case "right":  return { ...base, x: canW + R, y: randomSidePos(canH) };
        case "bottom": return { ...base, x: randomSidePos(canW), y: canH + R };
        case "left":   return { ...base, x: -R, y: randomSidePos(canH) };
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
        if (p.isMouse) { next.push(p); return; }
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
      if (particles.length < BALL_NUM) particles.push(getRandomParticle());
    };

    const render = () => {
      ctx.clearRect(0, 0, canW, canH);
      renderParticles();
      renderLines();
      updateParticles();
      addParticleIfNeeded();
      rafId = window.requestAnimationFrame(render);
    };

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

    const handleWindowMouseMove = (e: MouseEvent) => setMouseParticlePos(e.clientX, e.clientY);
    const handleWindowMouseOut  = (e: MouseEvent) => { if (!e.relatedTarget) clearMouseParticle(); };
    const handleTouchStart = (e: TouchEvent) => { const t = e.touches[0]; if (t) setMouseParticlePos(t.clientX, t.clientY); };
    const handleTouchMove  = (e: TouchEvent) => { e.preventDefault(); const t = e.touches[0]; if (t) setMouseParticlePos(t.clientX, t.clientY); };
    const handleTouchEnd   = () => clearMouseParticle();

    resize();
    initParticles(BALL_NUM);
    rafId = window.requestAnimationFrame(render);

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseout", handleWindowMouseOut);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    canvas.addEventListener("touchmove",  handleTouchMove,  { passive: false });
    canvas.addEventListener("touchend",   handleTouchEnd);
    canvas.addEventListener("touchcancel",handleTouchEnd);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseout", handleWindowMouseOut);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove",  handleTouchMove);
      canvas.removeEventListener("touchend",   handleTouchEnd);
      canvas.removeEventListener("touchcancel",handleTouchEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 bg-[#020617] overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(30,41,59,0.5)_0%,_rgba(2,6,23,1)_100%)]" />
      <div className="absolute top-[-5%] right-[-5%] w-[30%] h-[30%] bg-blue-500/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-5%] left-[-5%] w-[30%] h-[30%] bg-emerald-500/10 rounded-full blur-[100px]" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};

async function checkFullNameMatch(fullName: string): Promise<{ fullName: string; status?: string }> {
  const response = await fetch(
    buildApiUrl(`/auth/check-full-name?fullName=${encodeURIComponent(fullName)}`)
  );
  const payload = await response.json();
  if (!response.ok) {
    const msg = payload?.message || payload?.error || "Full name not found in the system.";
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

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      const payload = (await res.json()) as { success?: boolean; message?: string };

      if (!res.ok) {
        setError(payload?.message || "Signup failed. Please try again.");
        return;
      }

      setSuccess("Account created! Redirecting to sign in...");
      window.setTimeout(() => setLocation("/signin"), 1400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 py-8 sm:p-6 relative overflow-hidden">
      <ParticleNetworkBackground />

      <div className="w-full max-w-[420px] z-10">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 mb-4">
            <CreditCard className="h-7 w-7 sm:h-8 sm:w-8 text-blue-400" />
          </div>
          {/* Single line, no wrap, scales with viewport */}
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight italic whitespace-nowrap">
            JOIN THE NETWORK
          </h1>
          <p className="text-slate-500 text-[10px] uppercase tracking-[0.25em] mt-2">
            Digital Transit Network
          </p>
        </div>

        {/* Card */}
        <Card className="bg-slate-900/40 backdrop-blur-xl border-slate-800 shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500" />
          <CardHeader className="pb-4 px-5 sm:px-6 pt-5 sm:pt-6">
            <CardTitle className="text-lg sm:text-xl text-white">Create Account</CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              Enter your details to get started with your digital wallet.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-5 sm:px-6 pb-5 sm:pb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] animate-in fade-in slide-in-from-top-1">
                  {error}
                </div>
              )}
              {success && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] flex items-center gap-2 animate-in zoom-in-95">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {success}
                </div>
              )}

              {/* Full Name */}
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                  Full Name
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                  <Input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Dela Cruz"
                    disabled={isSubmitting}
                    required
                    autoComplete="name"
                    className="bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 h-11 text-white text-sm transition-all"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    disabled={isSubmitting}
                    required
                    autoComplete="email"
                    className="bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 h-11 text-white text-sm transition-all"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">
                  Security Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={isSubmitting}
                    required
                    autoComplete="new-password"
                    className="bg-slate-950/50 border-slate-700 focus:border-blue-500/50 pl-10 pr-10 h-11 text-white text-sm transition-all"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1 -mr-1"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-11 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-900/20 text-sm mt-2"
                disabled={isSubmitting}
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
            <div className="mt-5 pt-5 border-t border-slate-800">
              <p className="text-sm text-slate-500 text-center">
                Already have an account?{" "}
                <Link href="/signin" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                  Sign In
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="mt-6 text-[10px] text-slate-600 text-center uppercase tracking-[0.2em]">
          Fare Collection System v1.0
        </p>
      </div>
    </div>
  );
}