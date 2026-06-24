import { useState } from "react";
import { CreditCard, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { MAX_BALANCE } from "@/lib/api";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
import type { useTopup } from "@/hooks/use-topup";

type Props = ReturnType<typeof useTopup> & { currentBalance: number };

/** Format a plain number string with thousand separators + 2 decimal places. */
function formatDisplay(raw: string): string {
  if (!raw) return "";
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  return num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TopupModal({
  isOpen, close, amount, setAmount, loading,
  alertOpen, setAlertOpen, alertContent,
  remainingTopup, isAtMaxBalance, handleTopup,
  currentBalance,
}: Props) {
  const [displayValue, setDisplayValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const parsedAmount = parseFloat(amount);
  const exceedsLimit = !!amount && parsedAmount > remainingTopup;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const controlKeys = ["Backspace", "Delete", "Tab", "Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (controlKeys.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (/^\d$/.test(e.key)) return;
    if (e.key === "." && !displayValue.includes(".")) return;
    e.preventDefault();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const decimalIndex = raw.indexOf(".");
    const final = decimalIndex !== -1 ? raw.slice(0, decimalIndex + 3) : raw;
    setDisplayValue(final);
    setAmount(final);
  }

  function handleFocus() {
    setIsFocused(true);
    setDisplayValue(amount);
  }

  function handleBlur() {
    setIsFocused(false);
    if (amount) setDisplayValue(formatDisplay(amount));
  }

  return (
    <>
      <style>{DASHBOARD_STYLES}</style>

      {/* Alert Dialog */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent className="bg-slate-900 text-white border-slate-800 w-[calc(100vw-2rem)] max-w-[380px] mx-auto [&>button]:text-white [&>button]:opacity-100 [&>button:hover]:opacity-70">
          <DialogHeader>
            <DialogTitle>{alertContent.title}</DialogTitle>
            <DialogDescription className="text-slate-400">{alertContent.msg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAlertOpen(false)} className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto">Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Topup Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="p-0 border-none bg-transparent w-[calc(100vw-2rem)] max-w-[400px] mx-auto [&>button]:text-white [&>button]:opacity-100 [&>button:hover]:opacity-70">
          <DialogTitle className="sr-only">Top-up Wallet</DialogTitle>
          <DialogDescription className="sr-only">Add funds to your wallet via GCash or Maya through PayMongo.</DialogDescription>
          <div className="rgb-container">
            <div className="p-5 sm:p-6 text-white">

              {/* Header */}
              <h2 className="text-lg sm:text-xl font-bold mb-1 flex items-center gap-2">
                <CreditCard className="text-emerald-400 h-5 w-5 shrink-0" /> Top-up Wallet
              </h2>
              <p className="text-[11px] text-slate-400 mb-5 uppercase tracking-wider">Secure Payment via PayMongo</p>

              {/* Balance Bar */}
              <div className="mb-5 bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 space-y-2">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider gap-2">
                  <span className="text-slate-500 shrink-0">Wallet Limit</span>
                  <span className={`text-right tabular-nums ${isAtMaxBalance ? "text-red-400" : "text-emerald-400"}`}>
                    ₱{currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} / ₱{MAX_BALANCE.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all ${isAtMaxBalance ? "bg-red-500" : currentBalance / MAX_BALANCE >= 0.8 ? "bg-amber-400" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min((currentBalance / MAX_BALANCE) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  {isAtMaxBalance
                    ? <span className="text-red-400 font-semibold">Wallet is full. You cannot top up further.</span>
                    : <>You can still top up <span className="text-emerald-400 font-bold">₱{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></>}
                </p>
              </div>

              {/* Form — Card UID hidden, only Amount shown */}
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Amount (PHP)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none select-none">₱</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder={
                        isAtMaxBalance
                          ? "Wallet is full"
                          : `Max ${remainingTopup.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
                      }
                      value={displayValue}
                      onChange={handleChange}
                      onKeyDown={handleKeyDown}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      disabled={isAtMaxBalance}
                      className={`pl-7 bg-white/5 border-white/10 text-white focus:border-emerald-500/50 ${
                        exceedsLimit ? "border-red-500/50" : ""
                      }`}
                    />
                  </div>
                  {exceedsLimit && !isAtMaxBalance && (
                    <p className="text-[10px] text-red-400 mt-1 flex items-start gap-1">
                      <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>Amount exceeds your remaining limit of ₱{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </p>
                  )}
                </div>
                <Button
                  onClick={handleTopup}
                  disabled={loading || isAtMaxBalance || !amount || parsedAmount <= 0}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 disabled:opacity-50"
                >
                  {loading ? "Verifying..." : isAtMaxBalance ? "Wallet Full" : "Pay via GCash / Maya"}
                </Button>
              </div>

            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}