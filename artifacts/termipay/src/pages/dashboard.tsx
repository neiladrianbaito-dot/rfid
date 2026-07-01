import {
  useGetDashboardStats,
  useGetRevenueTrend,
} from "@workspace/api-client-react";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Fingerprint, CreditCard, Route, Activity, Zap, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch"; // ayusin ang path kung saan mo nilagay

const formatPeso = (value: number) =>
  `P${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
  const { user } = useAuth();
  const [latency, setLatency] = useState<number>(-1);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const prevRevenueRef = useRef<number | null>(null);
  const [revenueFlash, setRevenueFlash] = useState(false);

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useGetDashboardStats({
    query: {
      refetchOnWindowFocus: true,
    },
  });

  const {
    data: trend,
    isLoading: trendLoading,
    refetch: refetchTrend,
  } = useGetRevenueTrend({
    query: {
      refetchOnWindowFocus: true,
    },
  });

  // Realtime: tuwing may pagbabago sa transactions, fare_routes, o users,
  // mag-re-refetch ang stats at trend queries. Walang nakatakdang interval na.
  useRealtimeRefetch(["transactions", "fare_routes", "users"], () => {
    refetchStats();
    refetchTrend();
  });

  useEffect(() => {
    if (!stats) return;
    const current = Math.abs(Number(stats.totalRevenueToday) || 0);

    if (prevRevenueRef.current !== null && current !== prevRevenueRef.current) {
      setRevenueFlash(true);
      setTimeout(() => setRevenueFlash(false), 800);
    }

    prevRevenueRef.current = current;
    setLastUpdated(new Date());
  }, [stats]);

  useEffect(() => {
    const edgeFunctionUrl = "https://bpznyktrerwtnpqjrvgz.supabase.co/functions/v1/create-checkout";

    const pingEdgeFunction = async () => {
      const startTime = Date.now();
      try {
        await fetch(edgeFunctionUrl, { method: "OPTIONS" });
        setLatency(Date.now() - startTime);
      } catch {
        setLatency(999);
      }
    };

    pingEdgeFunction();
    // 15s imbes na 3s — sapat na ito para sa latency indicator,
    // hindi na rin ito tinatamaan ng polling problem dati
    const intervalId = window.setInterval(pingEdgeFunction, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  const getLatencyMeta = (value: number) => {
    if (value < 0) return { label: "Checking", colorClass: "text-slate-400" };
    if (value < 100) return { label: "Stable", colorClass: "text-emerald-400" };
    if (value <= 300) return { label: "Average", colorClass: "text-amber-400" };
    return { label: "Lagging", colorClass: "text-red-400" };
  };

  const latencyMeta = getLatencyMeta(latency);

  const sanitizedTrend = (Array.isArray(trend) ? trend : []).map((d: any) => ({
    ...d,
    revenue: Math.abs(Number(d.revenue) || 0),
  }));

  const statCards = [
    {
      title: "Total Revenue Today",
      value: stats?.totalRevenueToday != null
        ? formatPeso(Math.abs(Number(stats.totalRevenueToday)))
        : "P0.00",
      icon: DollarSign,
      glow: "shadow-[0_0_20px_rgba(16,185,129,0.3)]",
      border: "border-emerald-500/50",
      text: "text-emerald-400",
      bg: "bg-emerald-500/10",
      bar: "bg-emerald-400",
      flash: revenueFlash,
    },
    {
      title: "Total Taps Today",
      value: stats?.totalTapsToday ?? "0",
      icon: Fingerprint,
      glow: "shadow-[0_0_20px_rgba(59,130,246,0.3)]",
      border: "border-blue-500/50",
      text: "text-blue-400",
      bg: "bg-blue-500/10",
      bar: "bg-blue-400",
      flash: false,
    },
    {
      title: "Registered Cards",
      value: stats?.registeredCards ?? "0",
      icon: CreditCard,
      glow: "shadow-[0_0_20px_rgba(168,85,247,0.3)]",
      border: "border-purple-500/50",
      text: "text-purple-400",
      bg: "bg-purple-500/10",
      bar: "bg-purple-400",
      flash: false,
    },
    {
      title: "Active Routes",
      value: stats?.activeRoutes ?? "0",
      icon: Route,
      glow: "shadow-[0_0_20px_rgba(245,158,11,0.3)]",
      border: "border-amber-500/50",
      text: "text-amber-400",
      bg: "bg-amber-500/10",
      bar: "bg-amber-400",
      flash: false,
    },
  ];

  return (
    <div
      className="space-y-5 lg:space-y-8 min-h-screen bg-[#020617] text-slate-200 p-3 lg:p-6"
      data-testid="dashboard-page"
    >
      <style>{`
        @keyframes card-pulse {
          0% { box-shadow: 0 0 20px rgba(16,185,129,0.3); }
          50% { box-shadow: 0 0 40px rgba(16,185,129,0.7); }
          100% { box-shadow: 0 0 20px rgba(16,185,129,0.3); }
        }
        .card-pulse { animation: card-pulse 0.8s ease-in-out; }

        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }
      `}</style>

      {/* Top HUD Section */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 lg:gap-6 border-b border-slate-800 pb-5 lg:pb-8">
        <div>
          <div className="flex items-center gap-1.5 lg:gap-2 mb-1.5 lg:mb-2 flex-wrap">
            <div className="px-1.5 py-0.5 lg:px-2 lg:py-1 bg-blue-500/20 border border-blue-500/50 rounded text-[8px] lg:text-[10px] font-bold text-blue-400 uppercase tracking-widest">
              System Live
            </div>
            <div className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <ShieldCheck size={12} /> Secure Connection
            </div>
            <span className="flex items-center gap-1 text-[8px] lg:text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5 lg:px-2 lg:py-0.5">
              <span className="realtime-dot h-1 w-1 lg:h-1.5 lg:w-1.5 rounded-full bg-emerald-400 inline-block" />
              LIVE
            </span>
          </div>
          <h2 className="text-2xl lg:text-4xl font-black text-white tracking-tighter uppercase italic flex items-center gap-2 lg:gap-3">
            <Activity className="text-blue-500 animate-pulse shrink-0" size={22} />
            Centralized <span className="text-blue-500">Dashboard</span>
          </h2>
          <p className="text-slate-400 text-[11px] lg:text-xs font-medium mt-1">
            Authenticated as:{" "}
            <span className="text-blue-400 font-bold underline decoration-blue-500/30 underline-offset-4">
              {user?.name || "Root_Admin"}
            </span>
          </p>
        </div>

        <div className="flex gap-3 lg:gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Network Latency</p>
            <p className={`text-xs font-mono ${latencyMeta.colorClass}`}>
              {latency >= 0 ? `${latency}ms (${latencyMeta.label})` : latencyMeta.label}
            </p>
          </div>
          <div className="h-10 w-[1px] bg-slate-800 hidden sm:block" />
          <div className="flex flex-col items-start lg:items-end gap-1">
            <div className="flex items-center gap-1.5 lg:gap-2 px-2.5 py-1.5 lg:px-4 lg:py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <Zap className="text-blue-400 animate-pulse" size={14} />
              <span className="text-[9px] lg:text-[10px] font-black text-blue-400 uppercase tracking-tighter">
                Live Telemetry Active
              </span>
            </div>
            {lastUpdated && (
              <span className="text-[9px] lg:text-[10px] text-slate-600 font-mono pr-1">
                Last sync: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid — 2 cols on mobile (native-app feel), 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-6">
        {statCards.map((card, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card
              className={`relative overflow-hidden bg-slate-900/30 border-slate-800 backdrop-blur-xl transition-all duration-300 hover:border-slate-600 ${card.glow} ${card.flash ? "card-pulse" : ""}`}
            >
              <CardContent className="p-3 lg:p-6">
                {statsLoading ? (
                  <Skeleton className="h-12 lg:h-16 w-full bg-slate-800/50" />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[8px] lg:text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] lg:tracking-[0.2em] mb-1 truncate">
                        {card.title}
                      </p>
                      <p
                        className="text-lg lg:text-3xl font-black text-white tracking-tight truncate"
                        data-testid={`text-stat-${i}`}
                      >
                        {card.value}
                      </p>
                    </div>
                    <div
                      className={`w-8 h-8 lg:w-12 lg:h-12 rounded-lg lg:rounded-xl border flex items-center justify-center shrink-0 ${card.bg} ${card.border} ${card.text}`}
                    >
                      <card.icon size={16} className="lg:hidden" strokeWidth={2.5} />
                      <card.icon size={24} className="hidden lg:block" strokeWidth={2.5} />
                    </div>
                  </div>
                )}
              </CardContent>
              {/* Bottom decorative bar — explicit bg class per card so Tailwind includes it */}
              <div className={`absolute bottom-0 left-0 h-[2px] w-full ${card.bar}`} />
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Revenue Area Chart */}
      <Card className="bg-slate-900/20 border-slate-800 backdrop-blur-2xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-3 lg:p-4">
          <Zap size={14} className="text-blue-500/30" />
        </div>

        <CardHeader className="border-b border-slate-800/50 p-3 lg:p-6">
          <CardTitle className="text-[11px] lg:text-sm font-black text-slate-400 uppercase tracking-[0.2em] lg:tracking-[0.3em] italic flex items-center gap-2">
            <div className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
            Revenue Stream Projection
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 lg:pt-10 px-2 lg:px-6">
          {trendLoading ? (
            <Skeleton className="h-[220px] lg:h-[350px] w-full bg-slate-800/30" />
          ) : (
            <div className="h-[220px] lg:h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sanitizedTrend} margin={{ left: -20, right: 10 }}>
                  <defs>
                    <linearGradient id="neonGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => {
                      if (!d) return "";
                      const date = new Date(d + "T00:00:00");
                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    }}
                    stroke="#475569"
                    fontSize={9}
                    fontWeight={800}
                    dy={10}
                  />
                  <YAxis
                    stroke="#475569"
                    fontSize={9}
                    fontWeight={800}
                    width={40}
                    tickFormatter={(v: number) => `P${v.toLocaleString("en-US")}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(2, 6, 23, 0.95)",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                      backdropFilter: "blur(8px)",
                      color: "#fff",
                      fontSize: "11px",
                    }}
                    itemStyle={{ color: "#3b82f6", textTransform: "uppercase", fontSize: "10px", fontWeight: "900" }}
                    formatter={(value: number) => [formatPeso(Math.abs(Number(value) || 0)), "Revenue"]}
                    labelFormatter={(label: string) => {
                      if (!label) return "";
                      const date = new Date(label + "T00:00:00");
                      return date
                        .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                        .toUpperCase();
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#neonGradient)"
                    animationDuration={2500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}