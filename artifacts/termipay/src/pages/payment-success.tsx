import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  PhilippinePeso,
  Copy,
  ArrowLeft,
  Clock,
  Smartphone,
  SearchX,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { motion } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DASHBOARD_URL = "https://rfid-termipay-sigma.vercel.app/user-dashboard";

// Reuse your existing Supabase client instance instead of creating a new one
// if you already have one exported elsewhere (e.g. "@/lib/supabase") — swap
// this import out for that if so.
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

interface TransactionBreakdown {
  amount: number;
  fee_amount: number | null;
  vat_amount: number | null;
  net_amount: number | null;
  timestamp: string;
}

const MAX_POLL_ATTEMPTS = 6; // ~12 seconds of polling
const POLL_INTERVAL_MS = 2000;

export default function GCashPaymentSuccessPage() {
  const { isDark } = useTheme();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const [txn, setTxn] = useState<TransactionBreakdown | null>(null);
  const [isLoadingTxn, setIsLoadingTxn] = useState(true);

  // Xendit success redirect naglalagay ng details bilang query params,
  // see create-topup edge function's successRedirectUrl.
  const params = new URLSearchParams(searchString);
  const referenceNo = params.get("reference");
  const amountParam = params.get("amount");
  const fallbackAmount = Math.abs(Number(amountParam) || 0);
  const paidAtParam = params.get("paidAt");
  const fallbackPaidAt = paidAtParam ? new Date(paidAtParam) : new Date();

  // ✅ Walang laman o invalid ang params (di galing sa Xendit / direct visit
  // sa URL na walang token) → hindi valid na payment confirmation ito.
  const isValidPaymentData =
    !!referenceNo &&
    referenceNo.trim().length > 0 &&
    !!amountParam &&
    !Number.isNaN(Number(amountParam)) &&
    fallbackAmount > 0;

  useEffect(() => {
    document.title = isValidPaymentData
      ? "Payment Successful — TermiPay"
      : "Page Not Found — TermiPay";
  }, [isValidPaymentData]);

  // Fetch the authoritative fee/vat/net breakdown from Supabase, since the
  // webhook (which inserts the row and computes these) may still be in
  // flight when the browser lands here from Xendit's redirect. Poll a few
  // times before giving up and just showing the gross amount.
  useEffect(() => {
    if (!isValidPaymentData || !referenceNo) {
      setIsLoadingTxn(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const fetchTxn = async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("amount, fee_amount, vat_amount, net_amount, timestamp")
        .eq("external_id", referenceNo)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch transaction breakdown:", error);
      }

      if (data) {
        setTxn(data as TransactionBreakdown);
        setIsLoadingTxn(false);
        return;
      }

      attempts += 1;
      if (attempts < MAX_POLL_ATTEMPTS) {
        setTimeout(fetchTxn, POLL_INTERVAL_MS);
      } else {
        // Webhook hasn't landed yet — fall back to showing gross amount only.
        setIsLoadingTxn(false);
      }
    };

    fetchTxn();

    return () => {
      cancelled = true;
    };
  }, [isValidPaymentData, referenceNo]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referenceNo || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available — ignore silently
    }
  };

  // ✅ 404 fallback — kapag walang valid token/payment data mula sa Xendit
  if (!isValidPaymentData) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center p-3 sm:p-4 transition-colors ${
          isDark ? "bg-slate-950 text-slate-200" : "bg-slate-50 text-slate-800"
        }`}
        data-testid="gcash-success-page-404"
      >
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
            <div className="absolute top-0 left-0 h-[3px] w-full bg-slate-400" />

            <CardHeader className="flex flex-col items-center text-center pt-10 sm:pt-12 pb-4 px-4 sm:px-6">
              <div
                className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full border flex items-center justify-center mb-3 sm:mb-4 ${
                  isDark
                    ? "bg-slate-800/60 border-slate-700 text-slate-400"
                    : "bg-slate-100 border-slate-200 text-slate-500"
                }`}
              >
                <SearchX size={28} className="sm:hidden" strokeWidth={2} />
                <SearchX size={32} className="hidden sm:block" strokeWidth={2} />
              </div>
              <CardTitle
                className={`text-lg sm:text-xl font-bold tracking-tight ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                404 — Page Not Found
              </CardTitle>
              <p className={`text-xs sm:text-sm mt-1.5 max-w-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Walang nahanap na valid na payment confirmation. Maaaring nag-expire, na-refresh, o na-access nang direkta ang page na ito nang walang payment token mula sa Xendit.
              </p>
            </CardHeader>

            <CardContent className="pb-8 sm:pb-10 px-4 sm:px-6">
              <div className="flex flex-col gap-2 mt-4">
                <Button
                  onClick={() => setLocation("/user-dashboard")}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                  data-testid="button-back-dashboard-404"
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

  // Prefer values fetched from Supabase (authoritative); fall back to the
  // gross amount from the URL if the webhook hasn't landed yet.
  const displayAmount = txn?.amount ?? fallbackAmount;
  const feeAmount = txn?.fee_amount ?? null;
  const vatAmount = txn?.vat_amount ?? null;
  const netAmount = txn?.net_amount ?? null;
  const displayPaidAt = txn?.timestamp ? new Date(txn.timestamp) : fallbackPaidAt;
  const hasBreakdown = feeAmount !== null && vatAmount !== null && netAmount !== null;

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-3 sm:p-4 transition-colors ${
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

          <CardHeader className="flex flex-col items-center text-center pt-8 sm:pt-10 pb-4 px-4 sm:px-6">
            <div
              className={`check-pop w-14 h-14 sm:w-16 sm:h-16 rounded-full border flex items-center justify-center mb-3 sm:mb-4 ${
                isDark
                  ? "bg-emerald-950/40 border-emerald-900 text-emerald-400"
                  : "bg-emerald-50 border-emerald-100 text-emerald-600"
              }`}
            >
              <CheckCircle2 size={28} className="sm:hidden" strokeWidth={2.2} />
              <CheckCircle2 size={32} className="hidden sm:block" strokeWidth={2.2} />
            </div>
            <CardTitle
              className={`text-lg sm:text-xl font-bold tracking-tight ${
                isDark ? "text-white" : "text-slate-900"
              }`}
            >
              Payment Successful
            </CardTitle>
            <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Your fare has been paid via GCash
            </p>
          </CardHeader>

          <CardContent className="pb-6 sm:pb-8 px-4 sm:px-6">
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
                className={`text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-1 ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                <PhilippinePeso size={20} className="text-emerald-500 sm:hidden" strokeWidth={2.4} />
                <PhilippinePeso size={22} className="text-emerald-500 hidden sm:block" strokeWidth={2.4} />
                {formatPeso(displayAmount).replace("₱", "")}
              </span>
            </div>

            {/* Divider */}
            <div className={`h-px w-full mb-4 ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />

            {/* Fee / VAT / Net breakdown */}
            {isLoadingTxn ? (
              <div className="flex items-center justify-center gap-2 py-3 mb-1">
                <Loader2 size={14} className={`animate-spin ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Kinukuha ang transaction breakdown...
                </span>
              </div>
            ) : hasBreakdown ? (
              <div
                className={`rounded-lg p-3 mb-4 space-y-2 ${
                  isDark ? "bg-slate-800/50" : "bg-slate-50"
                }`}
              >
                <p
                  className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${
                    isDark ? "text-slate-500" : "text-slate-400"
                  }`}
                >
                  Transaction Breakdown
                </p>
                <div className="flex items-center justify-between">
                  <span className={`text-xs sm:text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    Transaction Amount
                  </span>
                  <span className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                    {formatPeso(displayAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs sm:text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    Transaction Fee
                  </span>
                  <span className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                    {formatPeso(feeAmount as number)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs sm:text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    Transaction VAT
                  </span>
                  <span className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                    {formatPeso(vatAmount as number)}
                  </span>
                </div>
                <div className={`h-px w-full my-1 ${isDark ? "bg-slate-700" : "bg-slate-200"}`} />
                <div className="flex items-center justify-between">
                  <span className={`text-xs sm:text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                    Net Amount Credited
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-emerald-500">
                    {formatPeso(netAmount as number)}
                  </span>
                </div>
              </div>
            ) : (
              <p className={`text-[11px] text-center mb-4 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Available na ang fee at VAT breakdown sa iyong transaction history sa loob ng ilang minuto.
              </p>
            )}

            {/* Details list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <Smartphone size={15} /> Payment Method
                </span>
                <span className={`text-sm font-semibold flex items-center gap-1.5 ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                  <img
                    src="/gcash.svg"
                    alt="GCash"
                    className="h-10 w-10 sm:h-12 sm:w-12 object-contain"
                  />
                  GCash
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <Clock size={15} /> Date &amp; Time
                </span>
                <span className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                  {displayPaidAt.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={`shrink-0 text-xs sm:text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Reference No.
                </span>
                <button
                  onClick={handleCopy}
                  title={referenceNo || ""}
                  className={`flex items-center gap-1.5 min-w-0 max-w-[65%] text-xs sm:text-sm font-mono font-semibold rounded px-1.5 py-0.5 transition-colors ${
                    isDark
                      ? "text-blue-400 hover:bg-slate-800"
                      : "text-blue-600 hover:bg-slate-100"
                  }`}
                  data-testid="button-copy-reference"
                >
                  <span className="truncate">{referenceNo}</span>
                  <Copy size={13} className="shrink-0" />
                </button>
              </div>
            </div>

            {copied && (
              <p className="text-right text-[11px] text-emerald-500 mt-1 -mb-2">Copied!</p>
            )}

            {/* Powered by note */}
            <div
              className={`flex items-center justify-center gap-1.5 mt-6 text-[10px] font-semibold uppercase tracking-widest ${
                isDark ? "text-slate-600" : "text-slate-400"
              }`}
            >
              <span>Powered by</span>
              <img
                src="/xendit.png"
                alt="Xendit"
                className="h-3.5 w-auto max-w-[60px] object-contain"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-6">
              <Button
                onClick={() => { window.location.href = DASHBOARD_URL; }}
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