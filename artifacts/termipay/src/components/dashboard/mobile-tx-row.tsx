import { memo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Transaction } from "@/components/transaction-detail-modal";
import { formatAmount } from "@/lib/dashboard-formatters";

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
            {formatAmount(tx.type, tx.amount)}
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
    prev.isDark === next.isDark,
);