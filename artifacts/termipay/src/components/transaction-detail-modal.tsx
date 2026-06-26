import {
  Hash,
  Calendar,
  Clock,
  CreditCard,
  Receipt,
  ShieldCheck,
  Route,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Transaction = {
  id: string | number;
  timestamp: string;
  type: string;
  amount: number | string;
  status: string;
  route_id?: number | null; // ✅ added
};

export type FareRoute = {
  id: number;
  origin: string;
  destination: string;
  fareAmount: number;
  isActive: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(amount: number | string): string {
  const num = Math.abs(Number(amount || 0)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `\u20B1${num}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TransactionDetailModalProps {
  tx: Transaction | null;
  onClose: () => void;
  routes: FareRoute[];
}

export function TransactionDetailModal({
  tx,
  onClose,
  routes,
}: TransactionDetailModalProps) {
  if (!tx) return null;

  const isFare = tx.type === "Fare";
  const isSuccess = tx.status === "Success";
  const date = new Date(tx.timestamp);

  // ✅ FIXED: match by route_id directly instead of fareAmount
  const safeRoutes = Array.isArray(routes) ? routes : [];
  const matchedRoute = isFare && tx.route_id
    ? safeRoutes.find((r) => r.id === tx.route_id) ?? null
    : null;

  const rows = [
    {
      icon: <Hash className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Transaction ID",
      value: String(tx.id),
      mono: true,
    },
    {
      icon: <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Date",
      value: date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      mono: false,
    },
    {
      icon: <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Time",
      value: date.toLocaleTimeString(),
      mono: false,
    },
    {
      icon: <CreditCard className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Service type",
      value: tx.type,
      mono: false,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-3 sm:px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent stripe */}
        <div className={`h-1 w-full ${isFare ? "bg-red-500" : "bg-emerald-500"}`} />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isFare ? "bg-red-500/10" : "bg-emerald-500/10"
              }`}
            >
              <Receipt
                className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
                  isFare ? "text-red-400" : "text-emerald-400"
                }`}
              />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-semibold text-white leading-none">
                Receipt
              </p>
              <p className="text-[9px] sm:text-[10px] font-mono text-slate-500 mt-0.5">
                #TXN-{tx.id}
              </p>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className={`h-7 w-7 rounded-lg shrink-0 ${
              isFare
                ? "text-red-500 hover:text-red-300 hover:bg-red-500/10"
                : "text-emerald-500 hover:text-emerald-300 hover:bg-emerald-500/10"
            }`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Amount hero */}
        <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-dashed border-slate-700 text-center">
          <p
            className={`text-3xl sm:text-4xl font-black tracking-tighter ${
              isFare ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {formatAmount(tx.amount)}
          </p>
          <p className="text-[10px] sm:text-[11px] text-slate-500 mt-1">
            {date.toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}{" "}
            · {date.toLocaleTimeString()}
          </p>
        </div>

        {/* Detail rows */}
        <div className="px-4 sm:px-5 pt-3 sm:pt-4 pb-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2">
            Transaction details
          </p>
          <div className="rounded-xl overflow-hidden border border-slate-800 divide-y divide-slate-800">
            {rows.map(({ icon, label, value, mono }) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 px-3 py-2 sm:py-2.5 bg-slate-950/40"
              >
                <span className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] text-slate-500 shrink-0">
                  {icon}
                  {label}
                </span>
                <span
                  className={`text-[10px] sm:text-xs text-slate-200 text-right truncate max-w-[55%] ${
                    mono ? "font-mono" : "font-medium"
                  }`}
                >
                  {value}
                </span>
              </div>
            ))}

            {/* Status row */}
            <div className="flex items-center justify-between gap-3 px-3 py-2 sm:py-2.5 bg-slate-950/40">
              <span className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] text-slate-500 shrink-0">
                <ShieldCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                Status
              </span>
              <span style={{ color: "#ffffff" }} className="text-[10px] sm:text-xs font-medium">
                {tx.status}
              </span>
            </div>

            {/* Route — only for Fare type (single combined line) */}
            {isFare && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 sm:py-2.5 bg-slate-950/40">
                <span className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] text-slate-500 shrink-0">
                  <Route className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                  Route
                </span>
                <span className="text-[10px] sm:text-xs font-medium text-slate-200 text-right truncate max-w-[55%]">
                  {matchedRoute ? (
                    `${matchedRoute.origin} → ${matchedRoute.destination}`
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Total line */}
        <div className="mx-4 sm:mx-5 mt-2.5 sm:mt-3 mb-1 border-t border-dashed border-slate-700 pt-2.5 sm:pt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] sm:text-xs font-semibold text-slate-400">
            {isFare ? "Amount deducted" : "Amount credited"}
          </span>
          <span className={`text-xs sm:text-sm font-black ${isFare ? "text-red-400" : "text-emerald-400"}`}>
            {formatAmount(tx.amount)}
          </span>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 pt-2.5 sm:pt-3 pb-4 sm:pb-5">
          <Button
            onClick={onClose}
            className="w-full text-white border-0 font-semibold transition-colors text-sm sm:text-base"
            style={{ backgroundColor: isFare ? "#dc2626" : "#059669" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                isFare ? "#ef4444" : "#10b981";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                isFare ? "#dc2626" : "#059669";
            }}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}