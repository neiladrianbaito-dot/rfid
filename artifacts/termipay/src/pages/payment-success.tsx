import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  PhilippinePeso,
  Copy,
  ArrowLeft,
  Clock,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { motion } from "framer-motion";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function GCashPaymentSuccessPage() {
  const { isDark } = useTheme();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const [copied, setCopied] = useState(false);

  // Xendit success redirect naglalagay ng details bilang query params,
  // see create-topup edge function's successRedirectUrl.
  const params = new URLSearchParams(searchString);
  const amount = Math.abs(Number(params.get("amount")) || 0);
  const referenceNo = params.get("reference") || "N/A";
  const paidAtParam = params.get("paidAt");
  const paidAt = paidAtParam ? new Date(paidAtParam) : new Date();

  useEffect(() => {
    document.title = "Payment Successful — TermiPay";
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referenceNo);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available — ignore silently
    }
  };

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 transition-colors ${
        isDark ? "bg-slate-950 text-slate-200" : "bg-slate-50 text-slate-800"
      }`}
      data-testid="gcash-success-page"
    >
      <style>{`
        @keyframes check-pop {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .check-pop { animation: check-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md"
      >
        <Card
          className={`relative overflow-hidden shadow-sm transition-colors ${
            isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
          }`}
        >
          {/* Top accent bar */}
          <div className="absolute top-0 left-0 h-[3px] w-full bg-emerald-500" />

          <CardHeader className="flex flex-col items-center text-center pt-10 pb-4">
            <div
              className={`check-pop w-16 h-16 rounded-full border flex items-center justify-center mb-4 ${
                isDark
                  ? "bg-emerald-950/40 border-emerald-900 text-emerald-400"
                  : "bg-emerald-50 border-emerald-100 text-emerald-600"
              }`}
            >
              <CheckCircle2 size={32} strokeWidth={2.2} />
            </div>
            <CardTitle
              className={`text-xl font-bold tracking-tight ${
                isDark ? "text-white" : "text-slate-900"
              }`}
            >
              Payment Successful
            </CardTitle>
            <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Your fare has been paid via GCash
            </p>
          </CardHeader>

          <CardContent className="pb-8">
            {/* Amount */}
            <div className="flex flex-col items-center py-6">
              <span
                className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${
                  isDark ? "text-slate-500" : "text-slate-400"
                }`}
              >
                Amount Paid
              </span>
              <span
                className={`text-3xl font-bold tracking-tight flex items-center gap-1 ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                <PhilippinePeso size={22} className="text-emerald-500" strokeWidth={2.4} />
                {formatPeso(amount).replace("₱", "")}
              </span>
            </div>

            {/* Divider */}
            <div className={`h-px w-full mb-4 ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />

            {/* Details list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <Smartphone size={15} /> Payment Method
                </span>
                <span className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                  GCash
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <Clock size={15} /> Date &amp; Time
                </span>
                <span className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                  {paidAt.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Reference No.
                </span>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 text-sm font-mono font-semibold rounded px-1.5 py-0.5 transition-colors ${
                    isDark
                      ? "text-blue-400 hover:bg-slate-800"
                      : "text-blue-600 hover:bg-slate-100"
                  }`}
                  data-testid="button-copy-reference"
                >
                  {referenceNo}
                  <Copy size={13} />
                </button>
              </div>
            </div>

            {copied && (
              <p className="text-right text-[11px] text-emerald-500 mt-1 -mb-2">Copied!</p>
            )}

            {/* Secure note */}
            <div
              className={`flex items-center justify-center gap-1.5 mt-6 text-[10px] font-semibold uppercase tracking-widest ${
                isDark ? "text-slate-600" : "text-slate-400"
              }`}
            >
              <ShieldCheck size={12} /> Verified by Xendit
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-6">
              <Button
                onClick={() => navigate("/")}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                data-testid="button-back-dashboard"
              >
                <ArrowLeft size={16} className="mr-1.5" />
                Back to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}