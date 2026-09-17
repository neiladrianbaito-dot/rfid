import { useState, useEffect, useRef, useMemo } from "react";
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
  Eye, CheckCircle2, XCircle, Clock, Route, CreditCard, ArrowLeftRight,
  ArrowRightLeft, ReceiptText,
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

// A "card" here is really the row from `users` that a card is tied to.
// NOTE: adjust `card_uid` / `full_name` below if your `users` table uses
// different column names — these mirror the fields transactions expose.
type TransferCard = {
  id: number;
  card_uid?: string | null;
  cardUid?: string | null;
  full_name?: string | null;
  fullName?: string | null;
};

type TransferStatus = "pending" | "completed" | "failed";

type CardTransfer = {
  id: number;
  source_card_id: number;
  target_card_id: number;
  amount: number;
  reason: string;
  source_balance_before: number | null;
  target_balance_before: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  source: TransferCard | null;
  target: TransferCard | null;
};

// ── View / tab definitions ──────────────────────────────────────────────────
// Underline-style tabs (same treatment as the Reports page's tab bar)
// instead of the old segmented pill switch.
type TxView = "topup" | "fare" | "transfers";

// ── Transaction type normalizer ────────────────────────────────────────────
// The backend/db may store this as "Fare", "fare", "TopUp", "top_up",
// "Top Up", "TOP-UP", etc. This forces a single canonical label everywhere
// in the UI, regardless of how it's spelled/cased at the source.
type TxType = "Fare" | "Top-up";

function normalizeTxType(type?: string | null): TxType {
  const key = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "fare") return "Fare";
  // Everything else (topup, top-up, TopUp, etc.) is treated as Top-up.
  return "Top-up";
}

// Same idea as normalizeTxType — normalize whatever `status` comes back as
// on card_balance_transfers ("pending", "Pending", "COMPLETED", etc.) into a
// single canonical label.
function normalizeTransferStatus(status?: string | null): TransferStatus {
  const key = (status ?? "").toLowerCase().trim();
  if (key === "completed" || key === "complete" || key === "success") return "completed";
  if (key === "failed" || key === "failure" || key === "error") return "failed";
  return "pending";
}

function cardUidOf(card?: TransferCard | null): string {
  return card?.card_uid || card?.cardUid || "—";
}

function fullNameOf(card?: TransferCard | null): string {
  return card?.full_name || card?.fullName || "Unknown";
}

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

// ── Payment method logo map (same pattern as TransactionDetailModal) ──────────
// Only GCash has a dedicated logo right now; extend this as more logos are
// added to /public (e.g. "/paymaya.svg", "/grabpay.svg", etc).
function getPaymentMethodLogo(method?: string | null): string | null {
  if (!method) return null;
  const key = method.toLowerCase().trim();
  if (key === "gcash") return "/gcash.svg";
  return null;
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

  const isFare = normalizeTxType(tx.type) === "Fare";
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
  const paymentMethodLogo = !isFare
    ? getPaymentMethodLogo(tx.payment_method)
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
                  <Route className="w-3.5 h-3.5" />
                  Route
                </span>
                <span className={`text-xs font-medium text-right max-w-[60%] flex items-center justify-end gap-1 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {matchedRoute
                    ? (
                      <>
                        <span className="truncate">{matchedRoute.origin}</span>
                        <ArrowLeftRight className="w-3 h-3 shrink-0 opacity-60" />
                        <span className="truncate">{matchedRoute.destination}</span>
                      </>
                    )
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
                <span className={`flex items-center justify-end gap-1.5 text-xs font-medium text-right truncate max-w-[60%] ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {paymentMethodLogo && (
                    <img
                      src={paymentMethodLogo}
                      alt={paymentMethodLabel ?? ""}
                      className="h-7 sm:h-8 w-auto max-w-[44px] object-contain shrink-0"
                    />
                  )}
                  <span className="truncate">{paymentMethodLabel}</span>
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

// ── Transfer Detail Modal ──────────────────────────────────────────────────────
// Same receipt-style treatment as ReceiptModal, but for a card_balance_transfers
// row: who sent it (source card), who received it (target card), how much, why,
// and whether it went through.

function TransferModal({
  transfer,
  onClose,
  isDark,
}: {
  transfer: CardTransfer | null;
  onClose: () => void;
  isDark: boolean;
}) {
  if (!transfer) return null;

  const status = normalizeTransferStatus(transfer.status);
  const amount = Math.abs(Number(transfer.amount)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const StatusIcon =
    status === "failed" ? XCircle
    : status === "pending" ? Clock
    : CheckCircle2;

  const statusRingClass = isDark
    ? "ring-blue-900 bg-blue-950/40 text-blue-400"
    : "ring-blue-100 bg-blue-50 text-blue-600";

  return (
    <Dialog open={!!transfer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Card Balance Transfer</DialogTitle>
          <DialogDescription>
            Transfer #{transfer.id}, ₱{amount} from card {cardUidOf(transfer.source)} to card{" "}
            {cardUidOf(transfer.target)}, status {transfer.status}.
          </DialogDescription>
        </VisuallyHidden>

        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-400" />

        <div className="px-5 pt-5 pb-6 space-y-5">
          {/* Status + amount hero */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${statusRingClass}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Card Balance Transfer
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${isDark ? "text-blue-400" : "text-blue-600"}`}>
              ₱{amount}
            </p>
          </div>

          {/* From → To */}
          <div className={`flex items-center gap-2 rounded-xl border p-3 ${isDark ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>From</p>
              <p className={`text-xs font-mono font-semibold truncate ${isDark ? "text-blue-400" : "text-blue-600"}`}>{cardUidOf(transfer.source)}</p>
              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{fullNameOf(transfer.source)}</p>
            </div>
            <ArrowRightLeft className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
            <div className="flex-1 min-w-0 text-right">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>To</p>
              <p className={`text-xs font-mono font-semibold truncate ${isDark ? "text-blue-400" : "text-blue-600"}`}>{cardUidOf(transfer.target)}</p>
              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{fullNameOf(transfer.target)}</p>
            </div>
          </div>

          {/* Dashed divider */}
          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          {/* Detail rows */}
          <div className={`rounded-xl overflow-hidden border divide-y ${isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"}`}>
            {[
              { label: "Transfer ID", value: `#${transfer.id}`, mono: true },
              {
                label: "Requested",
                value: new Date(transfer.created_at).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              },
              ...(transfer.completed_at
                ? [{
                    label: "Completed",
                    value: new Date(transfer.completed_at).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  }]
                : []),
              { label: "Reason", value: transfer.reason || "—" },
              ...(transfer.source_balance_before != null
                ? [{ label: "Source balance before", value: `₱${Number(transfer.source_balance_before).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`, mono: true }]
                : []),
              ...(transfer.target_balance_before != null
                ? [{ label: "Target balance before", value: `₱${Number(transfer.target_balance_before).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`, mono: true }]
                : []),
              { label: "Status", value: status.charAt(0).toUpperCase() + status.slice(1) },
            ].map(({ label, value, mono }) => (
              <div key={label} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isDark ? "bg-slate-950/60" : "bg-slate-50"}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  {label}
                </span>
                <span className={`text-xs text-right truncate max-w-[60%] font-medium ${mono ? "font-mono" : ""} ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <Button
            onClick={onClose}
            className="w-full text-white font-semibold uppercase text-[11px] tracking-widest bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
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

  // Three tabs now: Top-up, Fare, and Transfer — each shows its own full set
  // of columns inline (no need to open the receipt modal to see payment
  // method, transaction id, or route). Rendered as GCash-style underline
  // tabs, same treatment as the Reports page tab bar.
  const [activeView, setActiveView] = useState<TxView>("topup");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewTx, setViewTx] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [routes, setRoutes] = useState<FareRoute[]>([]);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  // ── Transfers state ───────────────────────────────────────────────────────
  const [transfers, setTransfers] = useState<CardTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transferSearch, setTransferSearch] = useState("");
  const [transferStatusFilter, setTransferStatusFilter] = useState<string>("all");
  const [transferPage, setTransferPage] = useState(1);
  const [viewTransfer, setViewTransfer] = useState<CardTransfer | null>(null);
  const [transfersLastUpdated, setTransfersLastUpdated] = useState<Date | null>(null);
  const [newTransferRowId, setNewTransferRowId] = useState<number | null>(null);
  const prevTopTransferIdRef = useRef<number | null>(null);

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

  // ── Fetch card_balance_transfers from Supabase, joined with the source /
  // target `users` rows so we can show each card's UID + owner name. ────────
  // If your `users` table doesn't expose `card_uid` / `full_name` directly,
  // adjust the select() column list below to match.
  useEffect(() => {
    const loadTransfers = async () => {
      setTransfersLoading(true);
      const { data, error } = await supabase
        .from("card_balance_transfers")
        .select(`
          id, source_card_id, target_card_id, amount, reason,
          source_balance_before, target_balance_before, status,
          created_at, completed_at,
          source:users!card_balance_transfers_source_card_id_fkey(id, card_uid, full_name),
          target:users!card_balance_transfers_target_card_id_fkey(id, card_uid, full_name)
        `)
        .order("created_at", { ascending: false });
      if (!error && data) setTransfers(data as unknown as CardTransfer[]);
      setTransfersLoading(false);
    };
    loadTransfers();

    const channel = supabase
      .channel("admin_card_balance_transfers")
      .on("postgres_changes", { event: "*", schema: "public", table: "card_balance_transfers" }, loadTransfers)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Transactions query ────────────────────────────────────────────────────
  // `type` is no longer sent to the backend — the DB can have inconsistent
  // spellings ("topup", "TopUp", "top_up", etc.), so an exact-match
  // server-side filter can silently exclude valid rows. Instead we fetch
  // everything (search/status still filtered server-side) and split it into
  // the Top-up / Fare tabs ourselves using normalizeTxType.
  const params: any = {};
  if (search) params.search = search;
  if (statusFilter !== "all") params.status = statusFilter;

  useEffect(() => { setPage(1); }, [search, statusFilter, activeView]);
  useEffect(() => { setTransferPage(1); }, [transferSearch, transferStatusFilter]);

  const { data: transactions, isLoading, refetch: refetchTransactions } =
    useListTransactions(params, { query: { refetchOnWindowFocus: true } });

  useRealtimeRefetch(["transactions"], () => { refetchTransactions(); });

  const rawTransactionList = Array.isArray(transactions) ? transactions : [];

  // Split once into the two type-based tabs. Memoized so these arrays keep
  // the same reference across re-renders when nothing relevant changed —
  // without this, `.filter()` would return a brand-new array every render,
  // which retriggers the effect below (it depends on the list), which calls
  // setLastUpdated → re-render → new filtered array → effect fires again,
  // forever (React error #185 / "Maximum update depth exceeded").
  const topupList = useMemo(
    () => rawTransactionList.filter((tx: any) => normalizeTxType(tx.type) === "Top-up"),
    [rawTransactionList],
  );
  const fareList = useMemo(
    () => rawTransactionList.filter((tx: any) => normalizeTxType(tx.type) === "Fare"),
    [rawTransactionList],
  );
  const currentTypeList = activeView === "fare" ? fareList : topupList;

  const totalPages = Math.max(1, Math.ceil(currentTypeList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = currentTypeList.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    if (activeView === "transfers") return;
    if (currentTypeList.length === 0) return;
    const topId = currentTypeList[0]?.id;
    if (prevTopIdRef.current !== null && topId !== prevTopIdRef.current) {
      setNewRowId(topId);
      setTimeout(() => setNewRowId(null), 800);
    }
    prevTopIdRef.current = topId;
    setLastUpdated(new Date());
  }, [currentTypeList, activeView]);

  // ── Transfers filtering/search (client-side, same pattern as transactions) ─
  const filteredTransferList = useMemo(() => {
    let list = transfers;
    if (transferStatusFilter !== "all") {
      list = list.filter((t) => normalizeTransferStatus(t.status) === transferStatusFilter);
    }
    const q = transferSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const haystack = [
          cardUidOf(t.source), fullNameOf(t.source),
          cardUidOf(t.target), fullNameOf(t.target),
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    return list;
  }, [transfers, transferStatusFilter, transferSearch]);

  const transferTotalPages = Math.max(1, Math.ceil(filteredTransferList.length / PAGE_SIZE));
  const safeTransferPage = Math.min(transferPage, transferTotalPages);
  const transferStartIndex = (safeTransferPage - 1) * PAGE_SIZE;
  const paginatedTransferList = filteredTransferList.slice(transferStartIndex, transferStartIndex + PAGE_SIZE);

  useEffect(() => {
    if (filteredTransferList.length === 0) return;
    const topId = filteredTransferList[0]?.id;
    if (prevTopTransferIdRef.current !== null && topId !== prevTopTransferIdRef.current) {
      setNewTransferRowId(topId);
      setTimeout(() => setNewTransferRowId(null), 800);
    }
    prevTopTransferIdRef.current = topId;
    setTransfersLastUpdated(new Date());
  }, [filteredTransferList]);

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

  const transferStatusColor = (status: TransferStatus) => {
    if (isDark) {
      switch (status) {
        case "completed": return "bg-emerald-950/40 text-emerald-400 border-emerald-900";
        case "failed":    return "bg-red-950/40 text-red-400 border-red-900";
        default:          return "bg-amber-950/40 text-amber-400 border-amber-900";
      }
    }
    switch (status) {
      case "completed": return "bg-emerald-50 text-emerald-600 border-emerald-200";
      case "failed":    return "bg-red-50 text-red-600 border-red-200";
      default:          return "bg-amber-50 text-amber-600 border-amber-200";
    }
  };

  const formatAmount = (amount: number) =>
    Math.abs(amount).toLocaleString("en-PH", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });

  const isFareView = activeView === "fare";
  const isTransferView = activeView === "transfers";

  // ── Tab definitions for the underline tab bar (same visual treatment as
  // REPORT_TABS on the Reports page: icon + label + border-b-2 indicator). ──
  const TX_TABS: { key: TxView; label: string; icon: typeof CreditCard; count: number }[] = [
    { key: "topup", label: "Top-up", icon: CreditCard, count: topupList.length },
    { key: "fare", label: "Fare", icon: Route, count: fareList.length },
    { key: "transfers", label: "Transfer", icon: ArrowRightLeft, count: transfers.length },
  ];

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
            Monitor all Top-ups, Fare deductions, and Card Transfers in real-time
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
            <Zap className="text-blue-500" size={16} />
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>Live Telemetry Active</span>
          </div>
          {(isTransferView ? transfersLastUpdated : lastUpdated) && (
            <span className={`text-[10px] font-mono pr-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Last sync: {(isTransferView ? transfersLastUpdated : lastUpdated)!.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* View switch: Top-up / Fare / Transfer — GCash-style flat underline
          tabs (line indicator on the active tab, no pill/card background),
          matching the tab bar on the Reports page. */}
      <div className={`flex items-center gap-6 overflow-x-auto border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        {TX_TABS.map(({ key, label, icon: Icon, count }) => {
          const active = activeView === key;
          return (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              data-testid={`button-tab-${key}`}
              className={`relative flex items-center gap-1.5 pb-2.5 -mb-px whitespace-nowrap text-xs font-semibold transition-colors cursor-pointer border-b-2 ${
                active
                  ? isDark ? "text-blue-400 border-blue-400" : "text-blue-600 border-blue-600"
                  : isDark ? "text-slate-500 border-transparent hover:text-slate-300" : "text-slate-400 border-transparent hover:text-slate-600"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className={`text-[10px] font-mono px-1.5 rounded ${isDark ? "bg-slate-700/60 text-slate-300" : "bg-slate-200 text-slate-600"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {!isTransferView ? (
      <Card className={`shadow-sm flex flex-col overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${isFareView ? "from-red-500 to-rose-400" : "from-emerald-500 to-cyan-400"}`} />

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
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Txn ID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Timestamp</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card UID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Full Name</TableHead>
                      {isFareView ? (
                        <>
                          <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Origin</TableHead>
                          <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Destination</TableHead>
                        </>
                      ) : (
                        <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Payment Method</TableHead>
                      )}
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Amount</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-32">
                          <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                            <History size={48} className="mb-2" />
                            <p className="text-xs font-semibold uppercase tracking-widest">No records found</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedList.map((tx: any) => {
                        const matchedRoute = isFareView && tx.route_id
                          ? routes.find((r) => r.id === tx.route_id) ?? null
                          : null;
                        const paymentMethodLabel = !isFareView ? formatPaymentMethod(tx.payment_method) : null;
                        const paymentMethodLogo = !isFareView ? getPaymentMethodLogo(tx.payment_method) : null;
                        return (
                          <TableRow
                            key={tx.id}
                            className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                              newRowId === tx.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              #{tx.id}
                            </TableCell>
                            <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {new Date(tx.timestamp || tx.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                              {tx.card_uid || tx.cardUid}
                            </TableCell>
                            <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              {tx.full_name || tx.fullName}
                            </TableCell>
                            {isFareView ? (
                              <>
                                <TableCell className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                  {matchedRoute ? matchedRoute.origin : <span className={isDark ? "text-slate-600" : "text-slate-400"}>—</span>}
                                </TableCell>
                                <TableCell className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                  {matchedRoute ? matchedRoute.destination : <span className={isDark ? "text-slate-600" : "text-slate-400"}>—</span>}
                                </TableCell>
                              </>
                            ) : (
                              <TableCell className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                <div className="flex items-center gap-1.5">
                                  {paymentMethodLogo && (
                                    <img src={paymentMethodLogo} alt="" className="h-4 w-auto max-w-[28px] object-contain shrink-0" />
                                  )}
                                  <span>{paymentMethodLabel}</span>
                                </div>
                              </TableCell>
                            )}
                            <TableCell className={`text-sm font-semibold ${
                              isFareView
                                ? isDark ? "text-red-400" : "text-red-600"
                                : isDark ? "text-emerald-400" : "text-emerald-600"
                            }`}>
                              {isFareView ? "−" : "+"}₱{formatAmount(Number(tx.amount))}
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
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className={`flex items-center justify-between pt-4 border-t mt-2 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                <span className={`text-xs font-mono uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Showing{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {currentTypeList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, currentTypeList.length)}
                  </span>{" "}
                  of <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{currentTypeList.length}</span> records
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
      ) : (
      <Card className={`shadow-sm flex flex-col overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-indigo-400" />

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
                placeholder="Search source/target card UID or name..."
                value={transferSearch}
                onChange={(e) => setTransferSearch(e.target.value)}
                className={`pl-10 font-medium text-sm focus-visible:ring-blue-500 ${
                  isDark
                    ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                }`}
              />
            </div>
            <div className="flex gap-3 w-full lg:w-auto">
              <Select value={transferStatusFilter} onValueChange={setTransferStatusFilter}>
                <SelectTrigger className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Status</SelectItem>
                  <SelectItem value="pending" className="cursor-pointer">Pending</SelectItem>
                  <SelectItem value="completed" className="cursor-pointer">Completed</SelectItem>
                  <SelectItem value="failed" className="cursor-pointer">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 flex flex-col overflow-hidden">
          {transfersLoading ? (
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
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Transfer ID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Timestamp</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>From (Card UID)</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>To (Card UID)</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Amount</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Reason</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedTransferList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-32">
                          <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                            <ArrowRightLeft size={48} className="mb-2" />
                            <p className="text-xs font-semibold uppercase tracking-widest">No transfers found</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedTransferList.map((t) => {
                        const status = normalizeTransferStatus(t.status);
                        return (
                          <TableRow
                            key={t.id}
                            className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                              newTransferRowId === t.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              #{t.id}
                            </TableCell>
                            <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {new Date(t.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <div className="font-mono text-xs text-blue-500 font-semibold">{cardUidOf(t.source)}</div>
                              <div className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{fullNameOf(t.source)}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-mono text-xs text-blue-500 font-semibold">{cardUidOf(t.target)}</div>
                              <div className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{fullNameOf(t.target)}</div>
                            </TableCell>
                            <TableCell className={`text-sm font-semibold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                              ₱{formatAmount(Number(t.amount))}
                            </TableCell>
                            <TableCell className={`text-xs max-w-[180px] truncate ${isDark ? "text-slate-400" : "text-slate-500"}`} title={t.reason}>
                              {t.reason || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] font-semibold capitalize ${transferStatusColor(status)}`}>
                                {status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost" size="icon"
                                  className={`h-8 w-8 cursor-pointer ${isDark ? "text-blue-400 hover:text-blue-300 hover:bg-blue-950/40" : "text-blue-500 hover:text-blue-700 hover:bg-blue-50"}`}
                                  onClick={() => setViewTransfer(t)}
                                  title="View transfer details"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className={`flex items-center justify-between pt-4 border-t mt-2 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                <span className={`text-xs font-mono uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Showing{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {filteredTransferList.length === 0 ? 0 : transferStartIndex + 1}–{Math.min(transferStartIndex + PAGE_SIZE, filteredTransferList.length)}
                  </span>{" "}
                  of <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{filteredTransferList.length}</span> records
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={safeTransferPage <= 1}
                    onClick={() => setTransferPage((p) => Math.max(1, p - 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}>
                    <ChevronLeft className="w-3 h-3 mr-1" />Prev
                  </Button>
                  <span className={`text-xs font-semibold px-2 tabular-nums ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                    <span className="text-blue-500">{safeTransferPage}</span>
                    <span className={isDark ? "text-slate-700" : "text-slate-300"}> / {transferTotalPages}</span>
                  </span>
                  <Button variant="ghost" size="sm" disabled={safeTransferPage >= transferTotalPages}
                    onClick={() => setTransferPage((p) => Math.min(transferTotalPages, p + 1))}
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
      )}

      {/* Receipt / Transfer Modals — still available if the admin wants the full receipt view */}
      <ReceiptModal tx={viewTx} routes={routes} onClose={() => setViewTx(null)} isDark={isDark} />
      <TransferModal transfer={viewTransfer} onClose={() => setViewTransfer(null)} isDark={isDark} />
    </div>
  );
}