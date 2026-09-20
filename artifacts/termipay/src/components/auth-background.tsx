import { useEffect, useRef } from "react";
import type { Theme } from "@/lib/auth-theme";

const COLORS = {
  light: { rgb: "37,99,235", dot: 0.45, line: 0.18 },
  dark: { rgb: "96,165,250", dot: 0.75, line: 0.35 },
};

export default function AuthBackground({ theme }: { theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    let ballNum = 60;
    let canW = 0;
    let canH = 0;
    let particles: Particle[] = [];
    let rafId = 0;
    let mouseParticle: Particle | null = null;

    const randomNumFrom = (min: number, max: number) =>
      Math.random() * (max - min) + min;

    const randomSidePos = (length: number) =>
      Math.ceil(Math.random() * length);

    const randomArrayItem = <T,>(arr: readonly T[]) =>
      arr[Math.floor(Math.random() * arr.length)];

    type Side = "top" | "right" | "bottom" | "left";

    const getRandomSpeed = (pos: Side): [number, number] => {
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
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Ignore small height changes (mobile address bar show/hide).
      // Resetting canvas size clears it and causes visible flicker.
      if (canW !== 0 && w === canW && Math.abs(h - canH) < 150) return;

      canW = w;
      canH = h;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      // Fewer particles on phones = smoother + less battery use
      ballNum = w < 640 ? 35 : 60;
    };

    const renderParticles = () => {
      const c = COLORS[themeRef.current];

      particles.forEach((p) => {
        if (p.isMouse) return;
        ctx.fillStyle = `rgba(${c.rgb},${p.alpha * c.dot})`;
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
          const distance = getDistance(particles[i], particles[j]);

          if (distance < DIS_LIMIT) {
            const alpha = (1 - distance / DIS_LIMIT) * c.line;
            ctx.strokeStyle = `rgba(${c.rgb},${alpha})`;
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
      if (particles.length < ballNum) {
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

    const handleMouseMove = (e: MouseEvent) => {
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

      mouseParticle.x = e.clientX - rect.left;
      mouseParticle.y = e.clientY - rect.top;
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        particles = particles.filter((p) => !p.isMouse);
        mouseParticle = null;
      }
    };

    resize();
    initParticles(ballNum);
    rafId = window.requestAnimationFrame(render);

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseOut);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseOut);
    };
  }, []);

  const isDark = theme === "dark";

  return (
    <div
      className={`fixed inset-0 -z-10 overflow-hidden ${
        isDark ? "bg-[#020617]" : "bg-white"
      }`}
    >
      <div
        className={`absolute inset-0 ${
          isDark
            ? "bg-[radial-gradient(ellipse_at_50%_35%,rgba(30,41,59,0.6)_0%,rgba(2,6,23,1)_70%)]"
            : "bg-[radial-gradient(ellipse_at_50%_35%,rgba(37,99,235,0.08)_0%,rgba(255,255,255,1)_70%)]"
        }`}
      />

      <div
        className={`absolute top-[-5%] right-[-5%] w-[30%] h-[30%] rounded-full blur-[100px] ${
          isDark ? "bg-blue-500/10" : "bg-blue-500/5"
        }`}
      />

      <div
        className={`absolute bottom-[-5%] left-[-5%] w-[30%] h-[30%] rounded-full blur-[100px] ${
          isDark ? "bg-emerald-500/10" : "bg-emerald-500/5"
        }`}
      />

      <canvas ref={canvasRef} className="absolute top-0 left-0" />
    </div>
  );
}