import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreditCard, Lock, User, Loader2, Eye, EyeOff, AlertCircle, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

const FORCE_LOGGED_OUT_KEY = "termipay_force_logged_out";
const AUTH_TOKEN_KEY = "termipay_auth_token";

const ParticleNetworkBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const BALL_NUM = 45;
    const R = 1.8;
    const ALPHA_F = 0.025;
    const DIS_LIMIT = 120;
    const BALL_COLOR = { r: 37, g: 99, b: 235 }; // blue-600

    type Particle = {
      x: number; y: number; vx: number; vy: number;
      alpha: number; phase: number; isMouse?: boolean;
    };

    let canW = window.innerWidth;
    let canH = window.innerHeight;
    let particles: Particle[] = [];
    let rafId = 0;
    let mouseParticle: Particle | null = null;

    const randomNumFrom = (min: number, max: number) => Math.random() * (max - min) + min;
    const randomSidePos = (len: number) => Math.ceil(Math.random() * len);
    const randomArrayItem = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

    const getRandomSpeed = (pos: "top" | "right" | "bottom" | "left"): [number, number] => {
      const mn = -0.5, mx = 0.5;
      switch (pos) {
        case "top":    return [randomNumFrom(mn, mx), randomNumFrom(0.05, mx)];
        case "right":  return [randomNumFrom(mn, -0.05), randomNumFrom(mn, mx)];
        case "bottom": return [randomNumFrom(mn, mx), randomNumFrom(mn, -0.05)];
        case "left":   return [randomNumFrom(0.05, mx), randomNumFrom(mn, mx)];
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

    const dist = (a: Particle, b: Particle) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);

    const initParticles = (n: number) => {
      particles = Array.from({ length: n }, () => {
        const [vx, vy] = getRandomSpeed("top");
        return { x: randomSidePos(canW), y: randomSidePos(canH), vx, vy, alpha: 1, phase: randomNumFrom(0, 10) };
      });
    };

    const resize = () => {
      canW = window.innerWidth; canH = window.innerHeight;
      canvas.width = canW; canvas.height = canH;
    };

    const render = () => {
      ctx.clearRect(0, 0, canW, canH);

      // Draw dots
      particles.forEach((p) => {
        if (p.isMouse) return;
        ctx.fillStyle = `rgba(${BALL_COLOR.r},${BALL_COLOR.g},${BALL_COLOR.b},${p.alpha * 0.55})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const d = dist(particles[i], particles[j]);
          if (d < DIS_LIMIT) {
            ctx.strokeStyle = `rgba(${BALL_COLOR.r},${BALL_COLOR.g},${BALL_COLOR.b},${(1 - d / DIS_LIMIT) * 0.22})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Update
      particles = particles.filter((p) => {
        if (p.isMouse) return true;
        p.x += p.vx; p.y += p.vy; p.phase += ALPHA_F;
        p.alpha = Math.abs(Math.cos(p.phase));
        return p.x > -50 && p.x < canW + 50 && p.y > -50 && p.y < canH + 50;
      });
      if (particles.length < BALL_NUM) particles.push(getRandomParticle());

      rafId = requestAnimationFrame(render);
    };

    const setMouse = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      if (!mouseParticle) {
        mouseParticle = { x: 0, y: 0, vx: 0, vy: 0, alpha: 1, phase: 0, isMouse: true };
        particles.push(mouseParticle);
      }
      mouseParticle.x = cx - rect.left;
      mouseParticle.y = cy - rect.top;
    };
    const clearMouse = () => { particles = particles.filter(p => !p.isMouse); mouseParticle = null; };

    const onMouseMove = (e: MouseEvent) => setMouse(e.clientX, e.clientY);
    const onMouseOut  = (e: MouseEvent) => { if (!e.relatedTarget) clearMouse(); };
    const onTouchStart = (e: TouchEvent) => { const t = e.touches[0]; if (t) setMouse(t.clientX, t.clientY); };
    const onTouchMove  = (e: TouchEvent) => { e.preventDefault(); const t = e.touches[0]; if (t) setMouse(t.clientX, t.clientY); };
    const onTouchEnd   = () => clearMouse();

    resize(); initParticles(BALL_NUM); rafId = requestAnimationFrame(render);
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseout", onMouseOut);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseout", onMouseOut);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 bg-white overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

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
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-slate-50"
      data-testid="login-page"
    >
      <ParticleNetworkBackground />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-sm z-10"
      >
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-6">
          <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-blue-600 text-white mb-4 shadow-sm">
            <CreditCard className="w-7 h-7" />
          </div>

          <h1
            className="text-2xl font-bold text-slate-900 tracking-tight text-center"
            data-testid="text-app-title"
          >
            Fare <span className="text-blue-600">Collection</span> System
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 font-medium tracking-wide text-center">
            LTC Calbayog City
          </p>
        </div>

        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-6 pb-7">
            <div className="flex items-center justify-center gap-1.5 text-slate-400 text-xs mb-5">
              <ShieldCheck size={13} />
              <span>Admin authentication</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs font-medium">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* Username */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="username"
                  className="text-slate-500 font-semibold uppercase text-[10px] tracking-wider"
                >
                  Username
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="Admin ID"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-9 h-10 text-sm bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg"
                    required
                    disabled={loginMutation.isPending}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="password"
                  className="text-slate-500 font-semibold uppercase text-[10px] tracking-wider"
                >
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-9 h-10 text-sm bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg"
                    required
                    disabled={loginMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors rounded-lg shadow-sm mt-1"
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
        <p className="text-center text-[10px] text-slate-400 mt-5 font-medium tracking-wide">
          © 2026 LTC Calbayog City · V1.0
        </p>
      </motion.div>
    </div>
  );
}