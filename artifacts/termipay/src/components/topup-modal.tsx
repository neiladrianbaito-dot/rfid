import { CreditCard, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { MAX_BALANCE } from "@/lib/api";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
import { useTheme } from "@/hooks/use-theme";
import type { useTopup } from "@/hooks/use-topup";

type Props = ReturnType<typeof useTopup> & { cardUid: string; currentBalance: number };

export function TopupModal({ isOpen, close, amount, setAmount, loading, alertOpen, setAlertOpen, alertContent, remainingTopup, isAtMaxBalance, handleTopup, cardUid, currentBalance }: Props) {
  const { isDark } = useTheme();

  return (
    <>
      <style>{DASHBOARD_STYLES}</style>

      {/* Alert Dialog */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent
          className={`w-[calc(100vw-2rem)] max-w-[380px] mx-auto [&>button]:opacity-100 [&>button:hover]:opacity-70 [&>button]:cursor-pointer ${
            isDark
              ? "bg-slate-900 text-white border-slate-800 [&>button]:text-white"
              : "bg-white text-slate-900 border-slate-200 [&>button]:text-slate-700"
          }`}
        >
          <DialogHeader>
            <DialogTitle>{alertContent.title}</DialogTitle>
            <DialogDescription className={isDark ? "text-slate-400" : "text-slate-500"}>{alertContent.msg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAlertOpen(false)} className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto cursor-pointer text-white">Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Topup Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent
          className={`p-0 border-none bg-transparent w-[calc(100vw-2rem)] max-w-[400px] mx-auto [&>button]:opacity-100 [&>button:hover]:opacity-70 [&>button]:cursor-pointer ${
            isDark ? "[&>button]:text-white" : "[&>button]:text-slate-700"
          }`}
        >
          <DialogTitle className="sr-only">Top-up Wallet</DialogTitle>
          <DialogDescription className="sr-only">Add funds to your wallet via GCash or Maya through PayMongo.</DialogDescription>
          <div className={isDark ? "rgb-container" : "rgb-container-light"}>
            <div className={`p-5 sm:p-6 ${isDark ? "text-white" : "text-slate-900"}`}>

              {/* Header */}
              <h2 className="text-lg sm:text-xl font-bold mb-1 flex items-center gap-2">
                <CreditCard className={`h-5 w-5 shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} /> Top-up Wallet
              </h2>
              <p className={`text-[11px] mb-5 uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>Secure Payment via PayMongo</p>

              {/* Balance Bar */}
              <div className={`mb-5 border rounded-xl p-3 space-y-2 ${
                isDark ? "bg-slate-800/60 border-slate-700/60" : "bg-slate-100/80 border-slate-200"
              }`}>
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider gap-2">
                  <span className={`shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Wallet Limit</span>
                  <span className={`text-right tabular-nums ${
                    isAtMaxBalance
                      ? isDark ? "text-red-400" : "text-red-600"
                      : isDark ? "text-emerald-400" : "text-emerald-600"
                  }`}>
                    ₱{currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} / ₱{MAX_BALANCE.toLocaleString()}
                  </span>
                </div>
                <div className={`w-full rounded-full h-1.5 overflow-hidden ${isDark ? "bg-slate-700" : "bg-slate-200"}`}>
                  <div
                    className={`h-1.5 rounded-full transition-all ${isAtMaxBalance ? "bg-red-500" : currentBalance / MAX_BALANCE >= 0.8 ? "bg-amber-400" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min((currentBalance / MAX_BALANCE) * 100, 100)}%` }}
                  />
                </div>
                <p className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                  {isAtMaxBalance
                    ? <span className={`font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>Wallet is full. You cannot top up further.</span>
                    : <>You can still top up <span className={`font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>₱{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></>}
                </p>
              </div>

              {/* Form */}
              <div className="space-y-4">
                
                <div>
                  <label className={`text-[10px] font-bold uppercase block mb-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Amount (PHP)</label>
                  <Input
                    type="number"
                    placeholder={isAtMaxBalance ? "Wallet is full" : `Max ₱${remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isAtMaxBalance}
                    className={`focus:border-emerald-500/50 ${
                      isDark
                        ? "bg-white/5 border-white/10 text-white placeholder:text-slate-500"
                        : "bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                    } ${amount && parseFloat(amount) > remainingTopup ? (isDark ? "border-red-500/50" : "border-red-400") : ""}`}
                  />
                  {amount && parseFloat(amount) > remainingTopup && !isAtMaxBalance && (
                    <p className={`text-[10px] mt-1 flex items-start gap-1 ${isDark ? "text-red-400" : "text-red-600"}`}>
                      <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>Amount exceeds your remaining limit of ₱{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </p>
                  )}
                </div>
                <Button
                  onClick={handleTopup}
                  disabled={loading || isAtMaxBalance || !amount || parseFloat(amount) <= 0}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? "Verifying..." : isAtMaxBalance ? "Wallet Full" : "Pay via PayMongo"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}