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
    if (value < 100) return { label: "Stable", colorClass: "text-emerald-600" };
    if (value <= 300) return { label: "Average", colorClass: "text-amber-600" };
    return { label: "Lagging", colorClass: "text-red-600" };
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
      border: "border-emerald-100",
      text: "text-emerald-600",
      bg: "bg-emerald-50",
      bar: "bg-emerald-500",
      flash: revenueFlash,
    },
    {
      title: "Total Taps Today",
      value: stats?.totalTapsToday ?? "0",
      icon: Fingerprint,
      border: "border-blue-100",
      text: "text-blue-600",
      bg: "bg-blue-50",
      bar: "bg-blue-500",
      flash: false,
    },
    {
      title: "Registered Cards",
      value: stats?.registeredCards ?? "0",
      icon: CreditCard,
      border: "border-purple-100",
      text: "text-purple-600",
      bg: "bg-purple-50",
      bar: "bg-purple-500",
      flash: false,
    },
    {
      title: "Active Routes",
      value: stats?.activeRoutes ?? "0",
      icon: Route,
      border: "border-amber-100",
      text: "text-amber-600",
      bg: "bg-amber-50",
      bar: "bg-amber-500",
      flash: false,
    },
  ];

  return (
    <div className="space-y-8 min-h-screen bg-slate-50 text-slate-800 p-2 lg:p-6" data-testid="dashboard-page">
      <style>{`
        @keyframes card-pulse {
          0% { box-shadow: 0 0 0 rgba(16,185,129,0); }
          50% { box-shadow: 0 0 0 4px rgba(16,185,129,0.15); }
          100% { box-shadow: 0 0 0 rgba(16,185,129,0); }
        }
        .card-pulse { animation: card-pulse 0.8s ease-in-out; }

        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }
      `}</style>

      {/* Top HUD Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="px-2 py-1 bg-blue-50 border border-blue-100 rounded text-[10px] font-semibold text-blue-700 uppercase tracking-widest">
              System Live
            </div>
            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              <ShieldCheck size={12} /> Secure Connection
            </div>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
              <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
              LIVE
            </span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Activity className="text-blue-600" size={28} />
            Centralized Dashboard
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Authenticated as: <span className="text-blue-600 font-semibold">{user?.name || "Root_Admin"}</span>
          </p>
        </div>

        <div className="flex gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Network Latency</p>
            <p className={`text-xs font-mono ${latencyMeta.colorClass}`}>
              {latency >= 0 ? `${latency}ms (${latencyMeta.label})` : latencyMeta.label}
            </p>
          </div>
          <div className="h-10 w-[1px] bg-slate-200 hidden sm:block" />
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <Zap className="text-blue-600" size={16} />
              <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Live Telemetry Active</span>
            </div>
            {lastUpdated && (
              <span className="text-[10px] text-slate-400 font-mono pr-1">
                Last sync: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className={`relative overflow-hidden bg-white border-slate-200 shadow-sm transition-all duration-300 hover:shadow-md hover:border-slate-300 ${card.flash ? "card-pulse" : ""}`}>
              <CardContent className="p-6">
                {statsLoading ? (
                  <Skeleton className="h-16 w-full bg-slate-100" />
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                        {card.title}
                      </p>
                      <p className="text-2xl font-bold text-slate-900 tracking-tight" data-testid={`text-stat-${i}`}>
                        {card.value}
                      </p>
                    </div>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${card.bg} ${card.border} ${card.text}`}>
                      <card.icon size={22} strokeWidth={2.2} />
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
      <Card className="bg-white border-slate-200 shadow-sm relative overflow-hidden">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-600" />
            Revenue Stream Projection
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-10">
          {trendLoading ? (
            <Skeleton className="h-[350px] w-full bg-slate-100" />
          ) : (
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sanitizedTrend}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="4 4"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => {
                      if (!d) return "";
                      const date = new Date(d + "T00:00:00");
                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    }}
                    stroke="#94a3b8"
                    fontSize={11}
                    fontWeight={600}
                    dy={10}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    fontWeight={600}
                    tickFormatter={(v: number) => `P${v.toLocaleString("en-US")}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      color: "#0f172a",
                    }}
                    itemStyle={{ color: "#2563eb", textTransform: "uppercase", fontSize: "10px", fontWeight: "700" }}
                    formatter={(value: number) => [formatPeso(Math.abs(Number(value) || 0)), "Revenue"]}
                    labelFormatter={(label: string) => {
                      if (!label) return "";
                      const date = new Date(label + "T00:00:00");
                      return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#revenueGradient)"
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