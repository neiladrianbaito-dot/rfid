import { memo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Transaction } from "@/components/transaction-detail-modal";
import { formatAmount } from "@/lib/dashboard-formatters";

// 🆕 Net amount helpers — mirrors the desktop table's getNetAmount /
// formatNetAmountWithSign so the mobile Top-up row shows the same figure
// (amount minus fee minus VAT, with a "+" sign) instead of the raw amount.
function getFeeAmount(tx: any): number | null {
  const value = tx?.fee_amount ?? tx?.feeAmount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVatAmount(tx: any): number | null {
  const value = tx?.vat_amount ?? tx?.vatAmount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getNetAmount(tx: any): number | null {
  const value = tx?.net_amount ?? tx?.netAmount;
  if (value != null && value !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const amount = Number(tx?.amount);
  const fee = getFeeAmount(tx);
  const vat = getVatAmount(tx);
  if (Number.isFinite(amount) && fee != null && vat != null) {
    return amount - fee - vat;
  }
  return null;
}

function formatNetAmountWithSign(value: number | null): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `+₱${value.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

export const MobileTxRow = memo(
  function MobileTxRow({
    tx,
    onClick,
    isDark,
  }: {
    tx: Transaction;
    onClick: () => void;
    isDark: boolean;
  }) {
    const isFare = tx.type === "Fare";

    const date = new Date(tx.timestamp);

    const dateStr = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const timeStr = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

    // 🆕 Top-up rows now show the Net Amount (with "+" sign) instead of the
    // raw Amount. Fare rows are unchanged (they have no fee/VAT/net fields).
    const displayAmount = isFare
      ? formatAmount(tx.type, tx.amount)
      : formatNetAmountWithSign(getNetAmount(tx));

    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left cursor-pointer ${
          isDark
            ? "active:bg-slate-800/40"
            : "active:bg-slate-100"
        }`}
      >
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
            isFare
              ? "bg-red-500/10 border border-red-500/20"
              : "bg-emerald-500/10 border border-emerald-500/20"
          }`}
        >
          {isFare ? (
            <ArrowRight
              className={`h-3.5 w-3.5 ${
                isDark ? "text-red-400" : "text-red-600"
              }`}
            />
          ) : (
            <ArrowLeft
              className={`h-3.5 w-3.5 ${
                isDark ? "text-emerald-400" : "text-emerald-600"
              }`}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={`text-xs font-semibold leading-tight ${
              isDark ? "text-slate-100" : "text-slate-800"
            }`}
          >
            {tx.type}
          </p>

          <p
            className={`text-[10px] mt-0.5 leading-tight ${
              isDark ? "text-slate-500" : "text-slate-500"
            }`}
          >
            {dateStr} · {timeStr}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p
            className={`text-xs font-bold tabular-nums ${
              isFare
                ? isDark
                  ? "text-red-400"
                  : "text-red-600"
                : isDark
                  ? "text-emerald-400"
                  : "text-emerald-600"
            }`}
          >
            {displayAmount}
          </p>

          <p
            className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${
              tx.status === "Success"
                ? isDark
                  ? "text-emerald-500/70"
                  : "text-emerald-600/80"
                : isDark
                  ? "text-red-500/70"
                  : "text-red-600/80"
            }`}
          >
            {tx.status}
          </p>
        </div>
      </button>
    );
  },
  (prev, next) =>
    prev.tx.id === next.tx.id &&
    prev.tx.amount === next.tx.amount &&
    (prev.tx as any).net_amount === (next.tx as any).net_amount &&
    (prev.tx as any).fee_amount === (next.tx as any).fee_amount &&
    (prev.tx as any).vat_amount === (next.tx as any).vat_amount &&
    prev.isDark === next.isDark,
);