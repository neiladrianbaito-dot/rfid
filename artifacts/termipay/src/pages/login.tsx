import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreditCard, Lock, User, Loader2, Shield, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

const FORCE_LOGGED_OUT_KEY = "termipay_force_logged_out";
const AUTH_TOKEN_KEY = "termipay_auth_token";

/**
 * Particle Network Background
 * Dots drift in from the edges, fade in/out, and link to nearby
 * neighbors with thin lines. Mouse/touch position joins the network.
 *
 * NOTE: mouse/touch listeners are attached at the WINDOW level (not just
 * the canvas) so the particle network keeps tracking the cursor even when
 * it's hovering over foreground elements like the login Card, which sit
 * above the canvas (the canvas is -z-10).
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
    // Touch listeners stay on the canvas itself (touch doesn't bubble the
    // same concern as hover, and we want preventDefault scoped to it)
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
        if (token) {
          window.localStorage.setItem(AUTH_TOKEN_KEY, token);
        }
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
    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }
    setError("");
    loginMutation.mutate({ data: { username, password } });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6" data-testid="login-page">
      <ParticleNetworkBackground />

      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg z-10"
      >
        <div className="text-center mb-10">
          <motion.div 
            animate={{ boxShadow: ["0 0 20px #3b82f6", "0 0 40px #3b82f6", "0 0 20px #3b82f6"] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-blue-600 text-white mb-6 border border-blue-400"
          >
            <CreditCard className="w-10 h-10" />
          </motion.div>
          <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic" data-testid="text-app-title">
            Fare <span className="text-blue-500">Collection</span> System
          </h1>
          <p className="text-blue-200/60 mt-2 font-semibold tracking-widest text-xs uppercase">
            Local Transport Cooperative (Calbayog City)
          </p>
        </div>

        <Card className="bg-slate-950/80 border-slate-800 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden relative">
          {/* Top accent glow */}
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
          
          <CardHeader className="text-center pt-8 pb-4">
            <CardTitle className="text-2xl text-white font-bold tracking-tight">Admin Authentication</CardTitle>
            <CardDescription className="text-slate-400">Secure access to transit management</CardDescription>
          </CardHeader>

          <CardContent className="px-10 pb-10">
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 text-red-400 text-sm font-bold border border-red-500/20 animate-pulse">
                  {error}
                </div>
              )}
              
              <div className="space-y-3">
                <Label htmlFor="username" className="text-slate-300 font-bold uppercase text-[11px] tracking-wider ml-1">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="ADMIN_ID"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-11 h-12 bg-slate-900/50 border-slate-700 text-white focus:border-blue-500 focus:ring-blue-500/20"
                    required
                    disabled={loginMutation.isPending}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="password" className="text-slate-300 font-bold uppercase text-[11px] tracking-wider ml-1">Secure Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-11 pr-11 h-12 bg-slate-900/50 border-slate-700 text-white focus:border-blue-500 focus:ring-blue-500/20"
                    required
                    disabled={loginMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-14 text-lg font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)]"
                disabled={loginMutation.isPending}
              >   
                {loginMutation.isPending ? (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Connecting...
                  </div>
                ) : (
                  "Log In"
                )}
              </Button>
            </form>
            
            <div className="mt-8 pt-6 border-t border-slate-800/50">
              <div className="flex items-center justify-center gap-2 text-slate-500">
                <Shield className="w-3 h-3" />
                <p className="text-[10px] text-center uppercase tracking-widest font-black">
                  Encrypted
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <p className="text-center text-xs text-slate-600 mt-10 font-bold uppercase tracking-widest">
          © 2026 LTC Calbayog City • System V1.0
        </p>
      </motion.div>
    </div>
  );
}