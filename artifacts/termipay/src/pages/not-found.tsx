import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { RadioTower, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // lightweight film-grain noise, throttled, respects reduced-motion
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let raf: number;
    let last = 0;

    const drawNoise = () => {
      const { width: w, height: h } = canvas;
      const imageData = ctx.createImageData(w, h);
      const buffer = new Uint32Array(imageData.data.buffer);
      for (let i = 0; i < buffer.length; i++) {
        if (Math.random() > 0.5) buffer[i] = 0xff000000;
      }
      ctx.putImageData(imageData, 0, 0);
    };

    const loop = (ts: number) => {
      if (ts - last > 90) {
        drawNoise();
        last = ts;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0b0d0c] relative overflow-hidden font-mono">
      {/* ambient noise + scanlines + vignette */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 opacity-[0.05] z-[3]"
      />
      <div
        className="pointer-events-none fixed inset-0 z-[4]"
        style={{
          background:
            "repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)",
          mixBlendMode: "overlay",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-[4]"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      <Card className="w-full max-w-md mx-4 relative z-10 bg-[#121513] border-[#1f2622] text-[#d7ded9]">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-1 text-[11px] tracking-[0.18em] uppercase text-[#7c8a83]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff7b54] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff7b54]" />
            </span>
            connection lost
          </div>

          <div className="flex items-start gap-3 mt-4 mb-2">
            <RadioTower className="h-7 w-7 text-[#7CFFB2] shrink-0 mt-1" />
            <h1 className="text-2xl font-bold text-[#d7ded9] leading-tight">
              404 — this page didn't make it to air
            </h1>
          </div>

          <p className="mt-3 text-sm text-[#7c8a83] leading-relaxed">
            Nothing's broadcasting at{" "}
            <code className="bg-[#0b0d0c] border border-[#1f2622] px-1.5 py-0.5 rounded text-[#4ea878] text-xs">
              this address
            </code>
            . Check the URL for typos, or did you forget to add the page to
            the router?
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <a
              href="/"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-[#7CFFB2] text-[#06120c] text-sm font-semibold px-4 py-2.5 hover:bg-[#4ea878] transition-colors"
            >
              <Home className="h-4 w-4" />
              Back to home
            </a>
            <button
              onClick={() => window.history.back()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-[#1f2622] text-[#d7ded9] text-sm px-4 py-2.5 hover:border-[#4ea878] hover:text-[#7CFFB2] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Go back
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}