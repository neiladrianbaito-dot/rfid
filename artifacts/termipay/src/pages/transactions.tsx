import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { ReactNode, KeyboardEvent } from "react";
import { useListTransactions } from "@workspace/api-client-react";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Search,
  Zap,
  History,
  ChevronLeft,
  ChevronRight,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Route,
  CreditCard,
  ArrowLeftRight,
  ArrowRightLeft,
} from "lucide-react";

const PAGE_SIZE = 10;

// Stable empty array — para hindi magbago ang reference habang wala pang data.
const EMPTY_LIST: any[] = [];

type FareRoute = {
  id: number;
  origin: string;
  destination: string;
  fare_amount: number;
};

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
  // optional snapshot columns (filled automatically when a user is deleted)
  source_card_uid?: string | null;
  source_full_name?: string | null;
  target_card_uid?: string | null;
  target_full_name?: string | null;
  source: TransferCard | null;
  target: TransferCard | null;
};

type FinancialFields = {
  fee_amount: number | null;
  vat_amount: number | null;
  net_amount: number | null;
};

type TxView = "topup" | "fare" | "transfers";
type TxType = "Fare" | "Top-up";

// ══════════════════════════════════════════════════════════════════════════
// PAGE STYLES — single-file build. The same one-folder look as the Reports
// page: only the active tab + the content panel are visible (white); the
// tab strip itself is transparent and starts flush at the left edge.
// ══════════════════════════════════════════════════════════════════════════
const TX_CSS = `
.tp {
  --tp-bg: #ffffff;
  --tp-border: #e4e4e7;
  --tp-divider: #ececee;
  --tp-muted: #71717a;
  --tp-text: #27272a;
  --tp-accent: #2563eb;
  --tp-radius: 18px;
  --tp-shadow:
    0 1px 2px rgba(24, 24, 27, 0.06),
    0 10px 24px -8px rgba(24, 24, 27, 0.14),
    0 24px 48px -20px rgba(24, 24, 27, 0.14);
}
.tp[data-theme="dark"] {
  --tp-bg: #0f172a;
  --tp-border: #1e293b;
  --tp-divider: #1e293b;
  --tp-muted: #94a3b8;
  --tp-text: #e2e8f0;
  --tp-accent: #60a5fa;
  --tp-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 12px 28px -10px rgba(0, 0, 0, 0.55);
}

/* One master container: transparent shell, flush to the page edges, fills
   the remaining height. */
.tp {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  min-width: 0;
  background: transparent;
}

/* Tab strip: transparent, no padding — first tab starts at the left edge. */
.tp-tabs {
  position: relative;
  z-index: 2;
  display: flex;
  flex: none;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 6px;
  padding: 0;
  background: transparent;
  overflow-x: auto;
  scrollbar-width: none;
}
.tp-tabs::-webkit-scrollbar { display: none; }

.tp-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  margin-bottom: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--tp-muted);
  background: transparent;
  border: 1px solid transparent;   /* reserved so hover/active don't shift layout */
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.tp-tab:hover {
  color: var(--tp-text);
  background: color-mix(in srgb, var(--tp-bg) 55%, transparent);
  border-color: var(--tp-border);
}
.tp-tab[aria-selected="true"] {
  color: var(--tp-accent);
  background: var(--tp-bg);     /* same fill as the panel below it — merges into one shape */
  border-color: var(--tp-border);
  box-shadow:
    0 -2px 6px rgba(24, 24, 27, 0.08),
    0 -1px 0 rgba(24, 24, 27, 0.04);
  z-index: 3;
}
/* Hairline under the whole strip so inactive tabs still read as tabs sitting
   on a visible edge, not floating text. The active tab's own bottom border
   is erased below so it merges flush into the panel. */
.tp-tabs {
  border-bottom: 1px solid var(--tp-border);
}
.tp-tab[aria-selected="true"] {
  margin-bottom: -1px;
  border-bottom: 1px solid var(--tp-bg);
}
.tp-tab svg { width: 14px; height: 14px; flex: none; }
.tp-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--tp-muted);
  border: 1px solid var(--tp-divider);
}
.tp-tab[aria-selected="true"] .tp-count {
  color: var(--tp-accent);
  border-color: var(--tp-border);
}

/* Body: the one white panel. Square top-left so the first tab sits flush. */
.tp-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--tp-bg);
  color: var(--tp-text);
  border: 1px solid var(--tp-border);  /* subtle gray border around the panel */
  border-top: 0;                       /* merges flush with the active tab above */
  border-radius: 0 var(--tp-radius) var(--tp-radius) var(--tp-radius);
  box-shadow: var(--tp-shadow);
}

/* Toolbar (LIVE badge / search / status filter) — a plain row with a
   divider, not a nested card header. */
.tp-toolbar {
  flex: none;
  padding: 16px 24px;
  border-bottom: 1px solid var(--tp-divider);
  background: transparent;
}

/* Sticky table head takes the panel color instead of a hard-coded white. */
.tp .tp-thead { background: var(--tp-bg); }

.tp-tab:focus-visible {
  outline: 2px solid var(--tp-accent);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .tp-toolbar { padding: 12px 16px; }
  .tp-tab { padding: 8px 12px; }
}
`;

// ── 🧊 NO-FLICKER HELPER ────────────────────────────────────────────────────
// Kapag pareho ang laman ng lumang data at bagong data, ibinabalik ang LUMANG
// reference — walang re-render, walang effect na tumatakbo ulit, walang blink.
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Kunin ang listahan kahit array ang response o may wrapper ({ data: [...] }).
function extractList(value: unknown): any[] | null {
  if (Array.isArray(value)) return value;
  const v = value as any;
  if (v && Array.isArray(v.data)) return v.data;
  if (v && Array.isArray(v.transactions)) return v.transactions;
  if (v && Array.isArray(v.items)) return v.items;
  return null;
}

// Hanapin ang route ng fare transaction: route_id / routeId, o kung ang
// transaction mismo ay may origin/destination.
function findRouteFor(tx: any, routes: FareRoute[]): FareRoute | null {
  const routeId = tx?.route_id ?? tx?.routeId;
  if (routeId != null && routeId !== "") {
    const found = routes.find((route) => route.id === Number(routeId));
    if (found) return found;
  }
  if (tx?.origin || tx?.destination) {
    return {
      id: -1,
      origin: tx.origin ?? "—",
      destination: tx.destination ?? "—",
      fare_amount: Number(tx.amount),
    };
  }
  return null;
}

function normalizeTxType(type?: string | null): TxType {
  const key = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "fare") return "Fare";
  return "Top-up";
}

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
  if (!card) return "Deleted user";
  return card.full_name || card.fullName || "Unknown";
}

function formatAmount(amount: number): string {
  return Math.abs(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getFeeAmount(tx: any): number | null {
  return toNullableNumber(tx?.fee_amount ?? tx?.feeAmount);
}

function getVatAmount(tx: any): number | null {
  return toNullableNumber(tx?.vat_amount ?? tx?.vatAmount);
}

function getNetAmount(tx: any): number | null {
  const value = tx?.net_amount ?? tx?.netAmount;
  if (value != null && value !== "") {
    return toNullableNumber(value);
  }
  const amount = Number(tx?.amount);
  const fee = getFeeAmount(tx);
  const vat = getVatAmount(tx);
  if (Number.isFinite(amount) && fee != null && vat != null) {
    return amount - fee - vat;
  }
  return null;
}

function formatNullableAmount(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `₱${formatAmount(value)}`;
}

function formatNetAmountWithSign(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `+₱${formatAmount(value)}`;
}

function formatPaymentMethod(method?: string | null): string {
  if (!method) return "—";
  const map: Record<string, string> = {
    gcash: "GCash",
    paymaya: "Maya",
    maya: "Maya",
    card: "Card",
    grab_pay: "GrabPay",
    billease: "BillEase",
    qrph: "QR Ph",
  };
  const key = method.toLowerCase().trim();
  return map[key] ?? method.charAt(0).toUpperCase() + method.slice(1);
}

function getPaymentMethodLogo(method?: string | null): string | null {
  if (!method) return null;
  const key = method.toLowerCase().trim();
  if (key === "gcash") return "/gcash.svg";
  return null;
}

// ── 🗂️ One-folder container: transparent tab strip + single white body ─────
type TxTabDef = { key: TxView; label: string; icon: typeof CreditCard; count: number };

function TxPanel({
  tabs,
  active,
  onChange,
  isDark,
  children,
}: {
  tabs: TxTabDef[];
  active: TxView;
  onChange: (key: TxView) => void;
  isDark: boolean;
  children: ReactNode;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Arrow keys / Home / End (WAI-ARIA tabs pattern)
  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  };

  return (
    <div className="tp" data-theme={isDark ? "dark" : "light"} data-testid="transactions-panel">
      <div className="tp-tabs" role="tablist" aria-label="Transaction types">
        {tabs.map(({ key, label, icon: Icon, count }, i) => (
          <button
            key={key}
            ref={(el) => { tabRefs.current[key] = el; }}
            role="tab"
            id={`tp-tab-${key}`}
            aria-selected={active === key}
            aria-controls={`tp-panel-${key}`}
            tabIndex={active === key ? 0 : -1}
            className="tp-tab"
            onClick={() => onChange(key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            <Icon aria-hidden="true" />
            {label}
            <span className="tp-count">{count}</span>
          </button>
        ))}
      </div>

      <div
        className="tp-body"
        role="tabpanel"
        id={`tp-panel-${active}`}
        aria-labelledby={`tp-tab-${active}`}
      >
        {children}
      </div>
    </div>
  );
}

// ── Reusable row para sa mga modal ──────────────────────────────────────────
function DetailRow({
  label,
  isDark,
  icon,
  children,
}: {
  label: string;
  isDark: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
        isDark ? "bg-slate-950/60" : "bg-slate-50"
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest ${
          isDark ? "text-slate-500" : "text-slate-400"
        }`}
      >
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

// ── Receipt Modal ───────────────────────────────────────────────────────────
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

  const originalAmountNumber = Math.abs(Number(tx.amount));
  const originalAmount = originalAmountNumber.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const netAmount = getNetAmount(tx);
  const heroAmount = !isFare && netAmount != null ? formatAmount(netAmount) : originalAmount;

  const matchedRoute = isFare ? findRouteFor(tx, routes) : null;

  const paymentMethodLabel = !isFare ? formatPaymentMethod(tx.payment_method) : null;
  const paymentMethodLogo = !isFare ? getPaymentMethodLogo(tx.payment_method) : null;

  const StatusIcon =
    tx.status === "Failed" ? XCircle : tx.status === "Pending" ? Clock : CheckCircle2;

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

  const valueText = isDark ? "text-slate-300" : "text-slate-700";

  const statusTextColor =
    tx.status === "Failed"
      ? isDark ? "text-red-400" : "text-red-600"
      : tx.status === "Pending"
        ? isDark ? "text-amber-400" : "text-amber-600"
        : isDark ? "text-emerald-400" : "text-emerald-600";

  return (
    <Dialog open={!!tx} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Transaction Receipt</DialogTitle>
          <DialogDescription>Transaction #{tx.id}</DialogDescription>
        </VisuallyHidden>

        <div className={`h-1 w-full bg-gradient-to-r ${accentColor}`} />

        <div className="px-5 pt-5 pb-6 space-y-5">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${statusRingClass}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {isFare ? "Fare Deduction" : "Balance Top-up"}
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${amountColor}`}>
              {isFare ? `−₱${originalAmount}` : `+₱${heroAmount}`}
            </p>
          </div>

          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          {/* Details */}
          <div
            className={`rounded-xl overflow-hidden border divide-y ${
              isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"
            }`}
          >
            <DetailRow label="Transaction ID" isDark={isDark}>
              <span className={`text-xs font-mono font-medium ${valueText}`}>#{tx.id}</span>
            </DetailRow>

            <DetailRow label="Timestamp" isDark={isDark}>
              <span className={`text-xs text-right font-medium ${valueText}`}>
                {new Date(tx.timestamp || tx.created_at).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </DetailRow>

            <DetailRow label="Card UID" isDark={isDark}>
              <span className={`text-xs font-mono font-semibold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                {tx.card_uid || tx.cardUid || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Full Name" isDark={isDark}>
              <span className={`text-xs font-bold text-right truncate max-w-[60%] ${valueText}`}>
                {tx.full_name || tx.fullName || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Status" isDark={isDark}>
              <span className={`text-xs font-bold ${statusTextColor}`}>{tx.status}</span>
            </DetailRow>

            {/* Top-up only: Amount / Fee / VAT / Net */}
            {!isFare && (
              <>
                <DetailRow label="Amount" isDark={isDark}>
                  <span className={`text-xs font-mono font-bold ${isDark ? "text-slate-200" : "text-slate-900"}`}>
                    ₱{originalAmount}
                  </span>
                </DetailRow>

                <DetailRow label="Fee" isDark={isDark}>
                  <span className={`text-xs font-mono font-medium ${valueText}`}>
                    {formatNullableAmount(getFeeAmount(tx))}
                  </span>
                </DetailRow>

                <DetailRow label="VAT" isDark={isDark}>
                  <span className={`text-xs font-mono font-medium ${valueText}`}>
                    {formatNullableAmount(getVatAmount(tx))}
                  </span>
                </DetailRow>

                <DetailRow label="Net Amount" isDark={isDark}>
                  <span className={`text-xs font-mono font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    {formatNetAmountWithSign(netAmount)}
                  </span>
                </DetailRow>
              </>
            )}

            {/* Fare only: Route */}
            {isFare && (
              <DetailRow label="Route" isDark={isDark} icon={<Route className="w-3.5 h-3.5" />}>
                <span className={`text-xs text-right flex items-center justify-end gap-1 max-w-[60%] ${valueText}`}>
                  {matchedRoute ? (
                    <>
                      <span className="truncate">{matchedRoute.origin}</span>
                      <ArrowLeftRight className="w-3 h-3 shrink-0 opacity-60" />
                      <span className="truncate">{matchedRoute.destination}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </DetailRow>
            )}

            {/* Top-up only: Payment method */}
            {!isFare && (
              <DetailRow label="Payment method" isDark={isDark} icon={<CreditCard className="w-3.5 h-3.5" />}>
                <span className={`flex items-center justify-end gap-1.5 text-xs font-medium text-right max-w-[60%] ${valueText}`}>
                  {paymentMethodLogo && (
                    <img
                      src={paymentMethodLogo}
                      alt={paymentMethodLabel ?? ""}
                      className="h-9 sm:h-10 w-auto max-w-[64px] object-contain shrink-0"
                    />
                  )}
                  <span className="truncate">{paymentMethodLabel}</span>
                </span>
              </DetailRow>
            )}
          </div>

          {/* Footer total */}
          <div
            className={`border-t border-dashed pt-3 flex items-center justify-between ${
              isDark ? "border-slate-800" : "border-slate-200"
            }`}
          >
            <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {isFare ? "Amount deducted" : "Net Amount"}
            </span>
            <span className={`text-sm font-bold ${amountColor}`}>
              {isFare ? `−₱${originalAmount}` : formatNetAmountWithSign(netAmount)}
            </span>
          </div>

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

// ── Transfer Modal ──────────────────────────────────────────────────────────
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

  const StatusIcon = status === "failed" ? XCircle : status === "pending" ? Clock : CheckCircle2;
  const valueText = isDark ? "text-slate-300" : "text-slate-700";
  const dateOpts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

  const statusTextColor =
    status === "completed"
      ? isDark ? "text-emerald-400" : "text-emerald-600"
      : status === "failed"
        ? isDark ? "text-red-400" : "text-red-600"
        : isDark ? "text-amber-400" : "text-amber-600";

  return (
    <Dialog open={!!transfer} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Card Balance Transfer</DialogTitle>
          <DialogDescription>Transfer #{transfer.id}</DialogDescription>
        </VisuallyHidden>

        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-400" />

        <div className="px-5 pt-5 pb-6 space-y-5">
          <div className="flex flex-col items-center gap-2 pt-1">
            <div
              className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${
                isDark
                  ? "ring-blue-900 bg-blue-950/40 text-blue-400"
                  : "ring-blue-100 bg-blue-50 text-blue-600"
              }`}
            >
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Card Balance Transfer
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${isDark ? "text-blue-400" : "text-blue-600"}`}>
              ₱{amount}
            </p>
          </div>

          <div
            className={`flex items-center gap-2 rounded-xl border p-3 ${
              isDark ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-slate-50"
            }`}
          >
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

          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          <div
            className={`rounded-xl overflow-hidden border divide-y ${
              isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"
            }`}
          >
            <DetailRow label="Transfer ID" isDark={isDark}>
              <span className={`text-xs font-mono font-medium ${valueText}`}>#{transfer.id}</span>
            </DetailRow>

            <DetailRow label="Requested" isDark={isDark}>
              <span className={`text-xs text-right ${valueText}`}>
                {new Date(transfer.created_at).toLocaleString("en-PH", dateOpts)}
              </span>
            </DetailRow>

            {transfer.completed_at && (
              <DetailRow label="Completed" isDark={isDark}>
                <span className={`text-xs text-right ${valueText}`}>
                  {new Date(transfer.completed_at).toLocaleString("en-PH", dateOpts)}
                </span>
              </DetailRow>
            )}

            <DetailRow label="Reason" isDark={isDark}>
              <span className={`text-xs text-right max-w-[60%] truncate ${valueText}`}>
                {transfer.reason || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Status" isDark={isDark}>
              <span className={`text-xs font-bold capitalize ${statusTextColor}`}>{status}</span>
            </DetailRow>
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

// ── Page ────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { isDark } = useTheme();

  const [activeView, setActiveView] = useState<TxView>("topup");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewTx, setViewTx] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [routes, setRoutes] = useState<FareRoute[]>([]);
  const [financialById, setFinancialById] = useState<Record<string, FinancialFields>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [transfers, setTransfers] = useState<CardTransfer[]>([]);
  // Skeleton ay lalabas LANG sa unang load — hindi na sa bawat realtime event.
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transferSearch, setTransferSearch] = useState("");
  const [transferStatusFilter, setTransferStatusFilter] = useState("all");
  const [transferPage, setTransferPage] = useState(1);
  const [viewTransfer, setViewTransfer] = useState<CardTransfer | null>(null);
  const [transfersLastUpdated, setTransfersLastUpdated] = useState<Date | null>(null);

  // ── Fare routes (realtime, silent refresh) ────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadRoutes = async () => {
      const { data, error } = await supabase
        .from("fare_routes")
        .select("id, origin, destination, fare_amount")
        .order("id");
      if (cancelled || error || !data) return;
      // 🧊 walang pagbabago → walang re-render
      setRoutes((prev) => (sameData(prev, data) ? prev : (data as FareRoute[])));
    };

    loadRoutes();

    const channel = supabase
      .channel("admin_fare_routes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fare_routes" }, loadRoutes)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Card transfers (realtime, silent refresh) ─────────────────────────────
  // Plain select + hiwalay na users query (walang FK embed), snapshot columns
  // ang fallback kapag burado na ang user.
  //
  // 🧊 Mga ginawa laban sa "reload":
  //   • Hindi na nagse-set ng loading=true sa bawat event (skeleton flash).
  //   • Pinagsasama ang sunod-sunod na events sa isang load (300ms).
  //   • Kapag may mas bagong request, binabalewala ang lumang sagot.
  //   • Kapag pareho ang laman, walang state update.
  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadTransfers = async () => {
      const myRequest = ++requestId;

      // 1) plain select — kasama ang optional snapshot columns
      const { data, error } = await supabase
        .from("card_balance_transfers")
        .select("*")
        .order("created_at", { ascending: false });

      if (cancelled || myRequest !== requestId) return;

      if (error || !data) {
        console.warn("Unable to load card transfers:", error?.message);
        setTransfersLoading(false);
        return;
      }

      // 2) kunin ang lahat ng users na kasama sa ISANG query
      const userIds = Array.from(
        new Set(
          data
            .flatMap((row: any) => [row.source_card_id, row.target_card_id])
            .filter((id: any) => id != null)
            .map((id: any) => Number(id)),
        ),
      );

      const usersById = new Map<number, TransferCard>();

      if (userIds.length > 0) {
        const { data: usersData, error: usersError } = await supabase
          .from("users")
          .select("id, card_uid, full_name")
          .in("id", userIds);

        if (cancelled || myRequest !== requestId) return;

        if (usersError) {
          console.warn("Unable to load users for transfers:", usersError.message);
        } else {
          for (const u of usersData ?? []) {
            usersById.set(Number(u.id), u as TransferCard);
          }
        }
      }

      // 3) live user muna → snapshot (burado na ang user) → null
      const resolveCard = (
        id: number | null,
        snapshotUid?: string | null,
        snapshotName?: string | null,
      ): TransferCard | null => {
        const live = id != null ? usersById.get(Number(id)) : undefined;
        if (live) return live;
        if (snapshotUid || snapshotName) {
          return { id: Number(id), card_uid: snapshotUid ?? null, full_name: snapshotName ?? null };
        }
        return null;
      };

      const merged: CardTransfer[] = data.map((row: any) => ({
        ...row,
        source: resolveCard(row.source_card_id, row.source_card_uid, row.source_full_name),
        target: resolveCard(row.target_card_id, row.target_card_uid, row.target_full_name),
      }));

      setTransfers((prev) => (sameData(prev, merged) ? prev : merged));
      setTransfersLoading(false);
    };

    const scheduleLoad = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadTransfers();
      }, 300);
    };

    void loadTransfers();

    const channel = supabase
      .channel("admin_card_balance_transfers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card_balance_transfers" },
        scheduleLoad,
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Transactions query ────────────────────────────────────────────────────
  const params: any = {};
  if (search) params.search = search;
  if (statusFilter !== "all") params.status = statusFilter;

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, activeView]);

  useEffect(() => {
    setTransferPage(1);
  }, [transferSearch, transferStatusFilter]);

  const {
    data: transactions,
    isLoading,
    refetch: refetchTransactions,
  } = useListTransactions(params, {
    query: {
      refetchOnWindowFocus: true,
    },
  });

  // 🧊 Panatilihin ang huling data habang naglo-load ang bago (hal. nagpalit ng
  // search/status filter). Kaya hindi na nagfla-flash ang skeleton / "No records".
  const lastTransactionsRef = useRef<any[] | null>(null);
  const currentList = extractList(transactions);
  if (currentList) {
    lastTransactionsRef.current = currentList;
  }
  const rawTransactionList: any[] = currentList ?? lastTransactionsRef.current ?? EMPTY_LIST;

  // Skeleton: unang load lang, kapag wala pang naipakitang data kahit isang beses.
  const showListSkeleton = isLoading && lastTransactionsRef.current === null;

  // 🧊 Realtime: pinagsasama ang sunod-sunod na events sa isang refetch, at
  // stable ang callback para hindi nagre-resubscribe ang realtime hook.
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTransactionsRealtime = useCallback(() => {
    if (realtimeTimerRef.current) return;
    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      refetchTransactions();
    }, 400);
  }, [refetchTransactions]);

  useEffect(() => {
    return () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    };
  }, []);

  useRealtimeRefetch(["transactions"], handleTransactionsRealtime);

  // ── Fee / VAT / Net ───────────────────────────────────────────────────────
  // 🧊 Hindi na binubura ang lumang values habang naglo-load ang bago (dati:
  // nagiging {} muna → "—" ang lahat → babalik = blink). Minemerge na lang.
  useEffect(() => {
    if (rawTransactionList.length === 0) return; // panatilihin ang huling values

    let cancelled = false;

    const loadFinancialFields = async () => {
      const ids = rawTransactionList
        .map((tx: any) => tx?.id)
        .filter((id: any) => id != null)
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id));

      if (ids.length === 0) return;

      const { data, error } = await supabase
        .from("transactions")
        .select("id, fee_amount, vat_amount, net_amount")
        .in("id", ids);

      if (cancelled) return;

      if (error) {
        console.warn("Unable to load transaction fee/VAT/net fields:", error.message);
        return;
      }

      setFinancialById((prev) => {
        let changed = false;
        const next: Record<string, FinancialFields> = { ...prev };
        for (const row of data ?? []) {
          const key = String(row.id);
          const value: FinancialFields = {
            fee_amount: row.fee_amount == null ? null : Number(row.fee_amount),
            vat_amount: row.vat_amount == null ? null : Number(row.vat_amount),
            net_amount: row.net_amount == null ? null : Number(row.net_amount),
          };
          const old = prev[key];
          if (
            !old ||
            old.fee_amount !== value.fee_amount ||
            old.vat_amount !== value.vat_amount ||
            old.net_amount !== value.net_amount
          ) {
            next[key] = value;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    loadFinancialFields();

    return () => {
      cancelled = true;
    };
  }, [rawTransactionList]);

  // ── Lists + pagination ────────────────────────────────────────────────────
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

  // "Last sync" label lang ang nagbabago — walang highlight/blink sa rows.
  useEffect(() => {
    if (activeView === "transfers") return;
    if (currentTypeList.length === 0) return;
    setLastUpdated(new Date());
  }, [currentTypeList, activeView]);

  const filteredTransferList = useMemo(() => {
    let list = transfers;

    if (transferStatusFilter !== "all") {
      list = list.filter(
        (transfer) => normalizeTransferStatus(transfer.status) === transferStatusFilter,
      );
    }

    const q = transferSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((transfer) => {
        const haystack = [
          cardUidOf(transfer.source),
          fullNameOf(transfer.source),
          cardUidOf(transfer.target),
          fullNameOf(transfer.target),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return list;
  }, [transfers, transferStatusFilter, transferSearch]);

  const transferTotalPages = Math.max(1, Math.ceil(filteredTransferList.length / PAGE_SIZE));
  const safeTransferPage = Math.min(transferPage, transferTotalPages);
  const transferStartIndex = (safeTransferPage - 1) * PAGE_SIZE;
  const paginatedTransferList = filteredTransferList.slice(
    transferStartIndex,
    transferStartIndex + PAGE_SIZE,
  );

  useEffect(() => {
    if (filteredTransferList.length === 0) return;
    setTransfersLastUpdated(new Date());
  }, [filteredTransferList]);

  // ── Style helpers ─────────────────────────────────────────────────────────
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

  const isFareView = activeView === "fare";
  const isTransferView = activeView === "transfers";

  const TX_TABS: TxTabDef[] = [
    { key: "topup", label: "Top-up", icon: CreditCard, count: topupList.length },
    { key: "fare", label: "Fare", icon: Route, count: fareList.length },
    { key: "transfers", label: "Transfer", icon: ArrowRightLeft, count: transfers.length },
  ];

  const headClass = "text-[11px] font-semibold uppercase tracking-wide";
  const theadClass = `tp-thead sticky top-0 z-10 border-b ${
    isDark ? "border-slate-800" : "border-zinc-200"
  }`;

  // LIVE pill — shared by both toolbars
  const livePill = (
    <div className="flex items-center gap-2 mr-2 shrink-0">
      <span
        className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${
          isDark
            ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
            : "text-emerald-600 bg-emerald-50 border-emerald-100"
        }`}
      >
        <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
        LIVE
      </span>
    </div>
  );

  return (
    <div
      className={`space-y-4 md:space-y-6 h-full min-h-0 flex flex-col overflow-hidden pb-4 px-1 ${
        isDark ? "text-slate-200" : "text-slate-800"
      }`}
    >
      <style>{`
        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot {
          animation: realtime-dot 1s ease-in-out infinite;
        }
      `}</style>
      <style>{TX_CSS}</style>

      {/* Header */}
      <div
        className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${
          isDark ? "border-slate-800" : "border-slate-200"
        }`}
      >
        <div>
          <h2
            className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            <History className="text-blue-500" size={26} />
            Transaction Logs
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Monitor all Top-ups, Fare deductions, and Card Transfers in real-time
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${
              isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"
            }`}
          >
            <Zap className="text-blue-500" size={16} />
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide ${
                isDark ? "text-blue-400" : "text-blue-700"
              }`}
            >
              Live Telemetry Active
            </span>
          </div>
          {(isTransferView ? transfersLastUpdated : lastUpdated) && (
            <span className={`text-[10px] font-mono pr-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Last sync:{" "}
              {(isTransferView ? transfersLastUpdated : lastUpdated)!.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ══ ONE FOLDER: transparent tab strip + single white panel ══ */}
      <TxPanel tabs={TX_TABS} active={activeView} onChange={setActiveView} isDark={isDark}>
        {!isTransferView ? (
          <>
            {/* Top-up / Fare toolbar */}
            <div className="tp-toolbar">
              <div className="flex flex-col lg:flex-row gap-4 items-center">
                {livePill}
                <div className="relative flex-1 w-full">
                  <Search
                    className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}
                  />
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
                    <SelectTrigger
                      className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${
                        isDark
                          ? "bg-slate-950 border-slate-800 text-slate-300"
                          : "bg-white border-slate-200 text-slate-600"
                      }`}
                    >
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent
                      className={
                        isDark
                          ? "bg-slate-900 border-slate-800 text-slate-300"
                          : "bg-white border-slate-200 text-slate-600"
                      }
                    >
                      <SelectItem value="all" className="cursor-pointer">All Status</SelectItem>
                      <SelectItem value="Success" className="cursor-pointer">Success</SelectItem>
                      <SelectItem value="Failed" className="cursor-pointer">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 px-4 sm:px-6 pb-0 flex flex-col overflow-hidden">
              {showListSkeleton ? (
                <div className="space-y-4 pt-6">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative mt-0 flex-1 min-h-0 overflow-auto">
                    <Table>
                      <TableHeader className={theadClass}>
                        <TableRow className="border-none hover:bg-transparent">
                          <TableHead className={headClass}>Txn ID</TableHead>
                          <TableHead className={headClass}>Timestamp</TableHead>
                          <TableHead className={headClass}>Card UID</TableHead>
                          <TableHead className={headClass}>Full Name</TableHead>
                          {isFareView ? (
                            <>
                              <TableHead className={headClass}>Origin</TableHead>
                              {/* ↔ column sa pagitan ng Origin at Destination */}
                              <TableHead className="w-10 px-0 text-center">
                                <ArrowLeftRight
                                  className={`mx-auto h-3.5 w-3.5 ${isDark ? "text-slate-600" : "text-slate-300"}`}
                                  aria-hidden="true"
                                />
                                <span className="sr-only">Both directions</span>
                              </TableHead>
                              <TableHead className={headClass}>Destination</TableHead>
                            </>
                          ) : (
                            <TableHead className={headClass}>Payment Method</TableHead>
                          )}
                          <TableHead className={headClass}>Amount</TableHead>
                          {!isFareView && (
                            <>
                              <TableHead className={headClass}>Fee</TableHead>
                              <TableHead className={headClass}>VAT</TableHead>
                              <TableHead className={headClass}>Net Amount</TableHead>
                            </>
                          )}
                          <TableHead className={headClass}>Status</TableHead>
                          <TableHead className={`${headClass} text-right`}>Actions</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {paginatedList.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={isFareView ? 10 : 11}
                              className="text-center py-32"
                            >
                              <div
                                className={`flex flex-col items-center ${
                                  isDark ? "text-slate-700" : "text-slate-300"
                                }`}
                              >
                                <History size={48} className="mb-2" />
                                <p className="text-xs font-semibold uppercase tracking-widest">
                                  No records found
                                </p>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedList.map((rawTx: any) => {
                            const tx = {
                              ...rawTx,
                              ...(financialById[String(rawTx?.id)] ?? {}),
                            };

                            const matchedRoute = isFareView ? findRouteFor(tx, routes) : null;

                            const paymentMethodLabel = !isFareView
                              ? formatPaymentMethod(tx.payment_method)
                              : null;
                            const paymentMethodLogo = !isFareView
                              ? getPaymentMethodLogo(tx.payment_method)
                              : null;

                            return (
                              <TableRow
                                key={tx.id}
                                className={`transition-colors ${
                                  isDark
                                    ? "border-slate-800 hover:bg-slate-800/50"
                                    : "border-zinc-100 hover:bg-zinc-50"
                                }`}
                              >
                                <TableCell className="text-xs font-mono">#{tx.id}</TableCell>
                                <TableCell className="text-xs font-mono">
                                  {new Date(tx.timestamp || tx.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                                  {tx.card_uid || tx.cardUid || "—"}
                                </TableCell>
                                <TableCell className="text-sm font-medium">
                                  {tx.full_name || tx.fullName || "—"}
                                </TableCell>

                                {isFareView ? (
                                  <>
                                    <TableCell className="text-xs">
                                      {matchedRoute ? matchedRoute.origin : "—"}
                                    </TableCell>
                                    <TableCell className="w-10 px-0 text-center">
                                      <ArrowLeftRight
                                        className={`mx-auto h-4 w-4 ${
                                          isDark ? "text-slate-400" : "text-slate-500"
                                        }`}
                                        aria-label="Both directions"
                                      />
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {matchedRoute ? matchedRoute.destination : "—"}
                                    </TableCell>
                                  </>
                                ) : (
                                  <TableCell className="text-xs">
                                    <div className="flex items-center gap-1.5">
                                      {paymentMethodLogo && (
                                        <img
                                          src={paymentMethodLogo}
                                          alt=""
                                          className="h-6 w-auto max-w-[52px] object-contain shrink-0"
                                        />
                                      )}
                                      <span>{paymentMethodLabel}</span>
                                    </div>
                                  </TableCell>
                                )}

                                <TableCell
                                  className={`text-sm font-semibold ${
                                    isFareView
                                      ? isDark ? "text-red-400" : "text-red-600"
                                      : isDark ? "text-slate-200" : "text-slate-800"
                                  }`}
                                >
                                  {isFareView && "−"}₱{formatAmount(Number(tx.amount))}
                                </TableCell>

                                {!isFareView && (
                                  <>
                                    <TableCell className="text-xs font-medium tabular-nums">
                                      {formatNullableAmount(getFeeAmount(tx))}
                                    </TableCell>
                                    <TableCell className="text-xs font-medium tabular-nums">
                                      {formatNullableAmount(getVatAmount(tx))}
                                    </TableCell>
                                    <TableCell
                                      className={`text-sm font-bold tabular-nums ${
                                        isDark ? "text-emerald-400" : "text-emerald-600"
                                      }`}
                                    >
                                      {formatNetAmountWithSign(getNetAmount(tx))}
                                    </TableCell>
                                  </>
                                )}

                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] font-semibold ${statusColor(tx.status)}`}
                                  >
                                    {tx.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 cursor-pointer text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => setViewTx(tx)}
                                    title="View receipt"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div
                    className={`flex items-center justify-between py-3 border-t mt-0 ${
                      isDark ? "border-slate-800" : "border-zinc-200"
                    }`}
                  >
                    <span className="text-xs font-mono">
                      Showing {currentTypeList.length === 0 ? 0 : startIndex + 1}–
                      {Math.min(startIndex + PAGE_SIZE, currentTypeList.length)} of{" "}
                      {currentTypeList.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        <ChevronLeft className="w-3 h-3 mr-1" />
                        Prev
                      </Button>
                      <span className="text-xs font-semibold px-2 tabular-nums">
                        <span className="text-blue-500">{safePage}</span>
                        {" / "}
                        {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        Next
                        <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Transfers toolbar */}
            <div className="tp-toolbar">
              <div className="flex flex-col lg:flex-row gap-4 items-center">
                {livePill}
                <div className="relative flex-1 w-full">
                  <Search
                    className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}
                  />
                  <Input
                    placeholder="Search source/target card UID or name..."
                    value={transferSearch}
                    onChange={(e) => setTransferSearch(e.target.value)}
                    className="pl-10 text-sm"
                  />
                </div>
                <Select value={transferStatusFilter} onValueChange={setTransferStatusFilter}>
                  <SelectTrigger className="w-full lg:w-[150px] text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex-1 min-h-0 px-4 sm:px-6 pb-0 flex flex-col overflow-hidden">
              {transfersLoading ? (
                <div className="space-y-4 pt-6">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative mt-0 flex-1 min-h-0 overflow-auto">
                    <Table>
                      <TableHeader className={theadClass}>
                        <TableRow>
                          <TableHead>Transfer ID</TableHead>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedTransferList.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-32">
                              <ArrowRightLeft size={48} className="mx-auto mb-2 opacity-30" />
                              <p className="text-xs font-semibold uppercase tracking-widest">
                                No transfers found
                              </p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedTransferList.map((transfer) => {
                            const status = normalizeTransferStatus(transfer.status);
                            return (
                              <TableRow key={transfer.id}>
                                <TableCell className="font-mono text-xs">#{transfer.id}</TableCell>
                                <TableCell className="text-xs font-mono">
                                  {new Date(transfer.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <div className="font-mono text-xs text-blue-500 font-semibold">
                                    {cardUidOf(transfer.source)}
                                  </div>
                                  <div className="text-[11px] opacity-60">
                                    {fullNameOf(transfer.source)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="font-mono text-xs text-blue-500 font-semibold">
                                    {cardUidOf(transfer.target)}
                                  </div>
                                  <div className="text-[11px] opacity-60">
                                    {fullNameOf(transfer.target)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm font-semibold text-blue-500">
                                  ₱{formatAmount(Number(transfer.amount))}
                                </TableCell>
                                <TableCell className="text-xs max-w-[180px] truncate">
                                  {transfer.reason || "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] font-semibold capitalize ${transferStatusColor(status)}`}
                                  >
                                    {status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 cursor-pointer text-blue-500"
                                    onClick={() => setViewTransfer(transfer)}
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div
                    className={`flex items-center justify-between py-3 border-t mt-0 ${
                      isDark ? "border-slate-800" : "border-zinc-200"
                    }`}
                  >
                    <span className="text-xs font-mono">
                      Showing {filteredTransferList.length === 0 ? 0 : transferStartIndex + 1}–
                      {Math.min(transferStartIndex + PAGE_SIZE, filteredTransferList.length)} of{" "}
                      {filteredTransferList.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safeTransferPage <= 1}
                        onClick={() => setTransferPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        <ChevronLeft className="w-3 h-3 mr-1" />
                        Prev
                      </Button>
                      <span className="text-xs font-semibold px-2">
                        {safeTransferPage} / {transferTotalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safeTransferPage >= transferTotalPages}
                        onClick={() => setTransferPage((p) => Math.min(transferTotalPages, p + 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        Next
                        <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </TxPanel>

      <ReceiptModal
        tx={viewTx}
        routes={routes}
        onClose={() => setViewTx(null)}
        isDark={isDark}
      />
      <TransferModal
        transfer={viewTransfer}
        onClose={() => setViewTransfer(null)}
        isDark={isDark}
      />
    </div>
  );
}