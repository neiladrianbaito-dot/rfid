import { useState, useEffect, useRef } from "react";
import {
  useListTransactions,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/hooks/use-theme";
import {
  Search, Zap, History, ChevronLeft, ChevronRight,
  Eye, CheckCircle2, XCircle, Clock, Bus, CreditCard,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

type FareRoute = {
  id: number;
  origin: string;
  destination: string;
  fare_amount: number;
};

// ── Payment method label map (same as TransactionDetailModal) ─────────────────

function formatPaymentMethod(method?: string | null): string {
  if (!method) return "—";
  const map: Record<string, string> = {
    gcash: "GCash",
    paymaya: "Maya",
    card: "Card",
    grab_pay: "GrabPay",
    billease: "BillEase",
    dob: "Online Banking",
    dob_ubp: "UnionBank",
    qrph: "QR Ph",
  };
  const key = method.toLowerCase().trim();
  return map[key] ?? method.charAt(0).toUpperCase() + method.slice(1);
}

// ── Receipt Modal ─────────────────────────────────────────────────────────────

function ReceiptModal({
  tx,
  routes,
  onClose,
  isDark,
}: {
  tx: any | null;
  routes: FareRoute[];
  onClose: () => void;
  isDark: boolean;
}) {
  if (!tx) return null;

  const isFare = tx.type === "Fare";
  const amount = Math.abs(Number(tx.amount)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Match route by route_id — same logic as TransactionDetailModal
  const matchedRoute = isFare && tx.route_id
    ? routes.find((r) => r.id === tx.route_id) ?? null
    : null;

  // Payment method is a plain string field on the transaction
  const paymentMethodLabel = !isFare
    ? formatPaymentMethod(tx.payment_method)
    : null;

  const StatusIcon =
    tx.status === "Failed" ? XCircle
    : tx.status === "Pending" ? Clock
    : CheckCircle2;

  // Ring/icon color follows the TYPE theme (Fare = red, Top-up = green)
  const statusRingClass = isFare
    ? isDark
      ? "ring-red-900 bg-red-950/40 text-red-400"
      : "ring-red-100 bg-red-50 text-red-600"
    : isDark
      ? "ring-emerald-900 bg-emerald-950/40 text-emerald-400"
      : "ring-emerald-100 bg-emerald-50 text-emerald-600";

  const amountColor = isFare
    ? isDark ? "text-red-400" : "text-red-600"
    : isDark ? "text-emerald-400" : "text-emerald-600";
  const accentColor = isFare ? "from-red-500 to-rose-400" : "from-emerald-500 to-cyan-400";
  const closeBg = isFare ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700";

  return (
    <Dialog open={!!tx} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >

        {/* a11y — DialogContent needs a Title + Description for screen readers */}
        <VisuallyHidden>
          <DialogTitle>Transaction Receipt</DialogTitle>
          <DialogDescription>
            Details for transaction #{tx.id}, a {isFare ? "fare deduction" : "balance top-up"} of ₱{amount}, status {tx.status}.
          </DialogDescription>
        </VisuallyHidden>

        {/* Accent stripe */}
        <div className={`h-1 w-full bg-gradient-to-r ${accentColor}`} />

        <div className="px-5 pt-5 pb-6 space-y-5">

          {/* Status + amount hero */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${statusRingClass}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {isFare ? "Fare Deduction" : "Balance Top-up"}
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${amountColor}`}>
              {isFare ? "−" : "+"}₱{amount}
            </p>
          </div>

          {/* Dashed divider */}
          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          {/* Detail rows */}
          <div className={`rounded-xl overflow-hidden border divide-y ${isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"}`}>
            {[
              { label: "Transaction ID", value: `#${tx.id}`, mono: true },
              {
                label: "Timestamp",
                value: new Date(tx.timestamp || tx.created_at).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              },
              { label: "Card UID", value: tx.card_uid || tx.cardUid || "—", mono: true, accent: isDark ? "text-blue-400" : "text-blue-600" },
              { label: "Full Name", value: tx.full_name || tx.fullName || "—", bold: true },
              { label: "Status", value: tx.status },
            ].map(({ label, value, mono, accent, bold }) => (
              <div key={label} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isDark ? "bg-slate-950/60" : "bg-slate-50"}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  {label}
                </span>
                <span className={`text-xs text-right truncate max-w-[60%] ${mono ? "font-mono" : ""} ${bold ? "font-bold" : "font-medium"} ${accent ?? (isDark ? "text-slate-300" : "text-slate-700")}`}>
                  {value}
                </span>
              </div>
            ))}

            {/* Route — Fare only, matched from Supabase fare_routes */}
            {isFare && (
              <div className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isDark ? "bg-slate-950/60" : "bg-slate-50"}`}>
                <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  <Bus className="w-3.5 h-3.5" />
                  Route
                </span>
                <span className={`text-xs font-medium text-right truncate max-w-[60%] ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {matchedRoute
                    ? `${matchedRoute.origin} → ${matchedRoute.destination}`
                    : <span className={isDark ? "text-slate-600" : "text-slate-400"}>—</span>
                  }
                </span>
              </div>
            )}

            {/* Payment method — Top-up only, read from tx.payment_method */}
            {!isFare && (
              <div className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isDark ? "bg-slate-950/60" : "bg-slate-50"}`}>
                <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  <CreditCard className="w-3.5 h-3.5" />
                  Payment method
                </span>
                <span className={`text-xs font-medium text-right truncate max-w-[60%] ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {paymentMethodLabel}
                </span>
              </div>
            )}
          </div>

          {/* Total line */}
          <div className={`border-t border-dashed pt-3 flex items-center justify-between ${isDark ? "border-slate-800" : "border-slate-200"}`}>
            <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {isFare ? "Amount deducted" : "Amount credited"}
            </span>
            <span className={`text-sm font-bold ${amountColor}`}>
              {isFare ? "−" : "+"}₱{amount}
            </span>
          </div>

          {/* Close button */}
          <Button
            onClick={onClose}
            className={`w-full text-white font-semibold uppercase text-[11px] tracking-widest ${closeBg} transition-colors cursor-pointer`}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const { isDark } = useTheme();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewTx, setViewTx] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [routes, setRoutes] = useState<FareRoute[]>([]);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  // ── Fetch fare_routes from Supabase once (same as dashboard) ──────────────
  useEffect(() => {
    const loadRoutes = async () => {
      const { data, error } = await supabase
        .from("fare_routes")
        .select("id, origin, destination, fare_amount")
        .order("id");
      if (!error && data) setRoutes(data as FareRoute[]);
    };
    loadRoutes();

    const channel = supabase
      .channel("admin_fare_routes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fare_routes" }, loadRoutes)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Transactions query ────────────────────────────────────────────────────
  const params: any = {};
  if (search) params.search = search;
  if (typeFilter !== "all") params.type = typeFilter;
  if (statusFilter !== "all") params.status = statusFilter;

  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);

  const { data: transactions, isLoading, refetch: refetchTransactions } =
    useListTransactions(params, { query: { refetchOnWindowFocus: true } });

  useRealtimeRefetch(["transactions"], () => { refetchTransactions(); });

  const transactionList = Array.isArray(transactions) ? transactions : [];
  const totalPages = Math.max(1, Math.ceil(transactionList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = transactionList.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    if (transactionList.length === 0) return;
    const topId = transactionList[0]?.id;
    if (prevTopIdRef.current !== null && topId !== prevTopIdRef.current) {
      setNewRowId(topId);
      setTimeout(() => setNewRowId(null), 800);
    }
    prevTopIdRef.current = topId;
    setLastUpdated(new Date());
  }, [transactionList]);

  const statusColor = (status: string) => {
    if (isDark) {
      switch (status) {
        case "Success": return "bg-emerald-950/40 text-emerald-400 border-emerald-900";
        case "Failed":  return "bg-red-950/40 text-red-400 border-red-900";
        case "Pending": return "bg-amber-950/40 text-amber-400 border-amber-900";
        default:        return "bg-slate-800 text-slate-400 border-slate-700";
      }
    }
    switch (status) {
      case "Success": return "bg-emerald-50 text-emerald-600 border-emerald-200";
      case "Failed":  return "bg-red-50 text-red-600 border-red-200";
      case "Pending": return "bg-amber-50 text-amber-600 border-amber-200";
      default:        return "bg-slate-100 text-slate-500 border-slate-200";
    }
  };

  const formatAmount = (amount: number) =>
    Math.abs(amount).toLocaleString("en-PH", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });

  return (
    <div className={`space-y-8 h-full min-h-0 flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`}>
      <style>{`
        @keyframes row-pulse {
          0%   { background-color: transparent; }
          50%  { background-color: rgba(37,99,235,0.08); }
          100% { background-color: transparent; }
        }
        .row-pulse { animation: row-pulse 0.8s ease-in-out; }
        @keyframes realtime-dot { 0%,100% { opacity:1; } 50% { opacity:0.2; } }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <History className="text-blue-500" size={26} />
            Transaction Logs
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Monitor all Fare deductions and Top-ups in real-time
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
            <Zap className="text-blue-500" size={16} />
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>Live Telemetry Active</span>
          </div>
          {lastUpdated && (
            <span className={`text-[10px] font-mono pr-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Last sync: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <Card className={`shadow-sm flex flex-col overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />

        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex flex-col lg:flex-row gap-4 items-center">
            <div className="flex items-center gap-2 mr-2 shrink-0">
              <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${
                isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
              }`}>
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                LIVE
              </span>
            </div>
            <div className="relative flex-1 w-full">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
              <Input
                placeholder="Search card UID or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`pl-10 font-medium text-sm focus-visible:ring-blue-500 ${
                  isDark
                    ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                }`}
              />
            </div>
            <div className="flex gap-3 w-full lg:w-auto">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Types</SelectItem>
                  <SelectItem value="Fare" className="cursor-pointer">Fare</SelectItem>
                  <SelectItem value="Top-up" className="cursor-pointer">Top-up</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Status</SelectItem>
                  <SelectItem value="Success" className="cursor-pointer">Success</SelectItem>
                  <SelectItem value="Failed" className="cursor-pointer">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-6">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : (
            <>
              <div className="relative mt-6 flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className={`sticky top-0 z-10 border-b ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Timestamp</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card UID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Full Name</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Type</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Amount</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-32">
                          <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                            <History size={48} className="mb-2" />
                            <p className="text-xs font-semibold uppercase tracking-widest">No records found</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedList.map((tx: any) => (
                        <TableRow
                          key={tx.id}
                          className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                            newRowId === tx.id ? "row-pulse" : ""
                          }`}
                        >
                          <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                            {new Date(tx.timestamp || tx.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                            {tx.card_uid || tx.cardUid}
                          </TableCell>
                          <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                            {tx.full_name || tx.fullName}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] font-semibold ${
                              tx.type === "Fare"
                                ? isDark ? "border-red-900 text-red-400 bg-red-950/40" : "border-red-200 text-red-600 bg-red-50"
                                : isDark ? "border-emerald-900 text-emerald-400 bg-emerald-950/40" : "border-emerald-200 text-emerald-600 bg-emerald-50"
                            }`}>
                              {tx.type}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-sm font-semibold ${
                            tx.type === "Fare"
                              ? isDark ? "text-red-400" : "text-red-600"
                              : isDark ? "text-emerald-400" : "text-emerald-600"
                          }`}>
                            {tx.type === "Fare" ? "−" : "+"}₱{formatAmount(Number(tx.amount))}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] font-semibold ${statusColor(tx.status)}`}>
                              {tx.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost" size="icon"
                                className={`h-8 w-8 cursor-pointer ${isDark ? "text-blue-400 hover:text-blue-300 hover:bg-blue-950/40" : "text-blue-500 hover:text-blue-700 hover:bg-blue-50"}`}
                                onClick={() => setViewTx(tx)}
                                title="View receipt"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className={`flex items-center justify-between pt-4 border-t mt-2 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                <span className={`text-xs font-mono uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Showing{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {transactionList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, transactionList.length)}
                  </span>{" "}
                  of <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{transactionList.length}</span> records
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}>
                    <ChevronLeft className="w-3 h-3 mr-1" />Prev
                  </Button>
                  <span className={`text-xs font-semibold px-2 tabular-nums ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                    <span className="text-blue-500">{safePage}</span>
                    <span className={isDark ? "text-slate-700" : "text-slate-300"}> / {totalPages}</span>
                  </span>
                  <Button variant="ghost" size="sm" disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}>
                    Next<ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Receipt Modal */}
      <ReceiptModal tx={viewTx} routes={routes} onClose={() => setViewTx(null)} isDark={isDark} />
    </div>
  );
}