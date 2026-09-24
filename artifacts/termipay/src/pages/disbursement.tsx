import React, { useEffect, useMemo, useRef, useState } from "react";
import { useListTransactions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { useAdminAccess } from "@/hooks/use-admin-access";
import {
  Wallet,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  History,
  RefreshCw,
  Landmark,
  Smartphone,
  Lock,
} from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DISBURSE_SUCCESS_AUTOCLOSE_MS = 1800;
const DISBURSEMENTS_PER_PAGE = 10;

// keep in sync with the backend classification
const NON_FARE_MARKERS = ["topup", "top_up", "top-up", "cash_in", "cashin", "cash-in", "load", "reload"];
const GCASH_MARKERS = ["gcash", "g-cash", "g_cash"];

function getLocalDateString(): string {
  return new Date().toLocaleDateString("en-CA");
}

function getSupabaseFunctionsUrl(): string {
  const explicit = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!supabaseUrl) return "";
  return supabaseUrl.replace(".supabase.co", ".functions.supabase.co");
}

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("termipay_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

// used only to show a nice label in the history table
const DISBURSEMENT_CHANNELS = [{ value: "PH_BDO", label: "BDO" }];

// Shape returned by the get-disbursement-destination function (already masked by the backend)
type DisbursementDestination = {
  bank_code: string;
  account_holder_name: string;
  masked_account_number: string; // e.g. "••••1234"
};

function getDaysInMonth(year: string, month: string): number {
  if (year === "all" || month === "all") return 31;
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (isNaN(y) || isNaN(m)) return 31;
  return new Date(y, m, 0).getDate();
}

function getTxTypeRaw(tx: any): string {
  return (tx.type ?? tx.transaction_type ?? tx.category ?? "").toString().toLowerCase().trim();
}

function isFareTransaction(tx: any): boolean {
  const raw = getTxTypeRaw(tx);
  if (!raw) return true;
  return !NON_FARE_MARKERS.some((marker) => raw.includes(marker));
}

function isTopupTransaction(tx: any): boolean {
  const raw = getTxTypeRaw(tx);
  if (!raw) return false;
  return NON_FARE_MARKERS.some((marker) => raw.includes(marker));
}

function isGcashChannel(tx: any): boolean {
  const raw = (tx.channel ?? tx.payment_channel ?? tx.payment_method ?? tx.channel_code ?? "")
    .toString()
    .toLowerCase()
    .trim();
  if (!raw) return true; // TODO: flip to false once a real channel field exists
  return GCASH_MARKERS.some((marker) => raw.includes(marker));
}

let warnedMissingNetAmount = false;

function getTopupNetAmount(tx: any): number {
  const netRaw =
    tx.net_amount ?? tx.netAmount ?? tx.xendit_net_amount ?? tx.xenditNetAmount ?? tx.amount_net ?? null;

  if (netRaw !== null && netRaw !== "" && !isNaN(Number(netRaw))) {
    return Math.abs(Number(netRaw));
  }

  const gross = Math.abs(Number(tx.amount) || 0);
  const feeRaw = tx.fee ?? tx.fee_amount ?? tx.xendit_fee_amount ?? tx.xenditFeeAmount ?? null;
  const vatRaw = tx.vat ?? tx.vat_amount ?? tx.xendit_vat_amount ?? tx.xenditVatAmount ?? null;

  if (feeRaw !== null || vatRaw !== null) {
    const fee = Math.abs(Number(feeRaw) || 0);
    const vat = Math.abs(Number(vatRaw) || 0);
    return Math.max(0, gross - fee - vat);
  }

  if (!warnedMissingNetAmount) {
    warnedMissingNetAmount = true;
    console.warn("[Disbursement] Top-up has no net amount / fee fields — falling back to gross.", tx);
  }
  return gross;
}

function getTxDateKey(tx: any): string | null {
  const ts = tx.timestamp || tx.created_at;
  if (!ts) return null;
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-CA");
}

function getTxDateParts(tx: any): { year: string; month: string; day: string } | null {
  const key = getTxDateKey(tx);
  if (!key) return null;
  const [y, m, d] = key.split("-");
  return { year: y, month: m, day: d };
}

function getChannelLabel(row: any): string {
  const code = (row.bank_code ?? row.channel_code ?? row.channel ?? "").toString().trim();
  if (!code) return "—";
  const match = DISBURSEMENT_CHANNELS.find((c) => c.value === code);
  return match ? match.label : code;
}

function isBdoChannel(row: any): boolean {
  const code = (row.bank_code ?? row.channel_code ?? row.channel ?? "").toString().trim();
  return code === "PH_BDO";
}

export default function DisbursementPage() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  void user; // admin identity is now taken from the auth token on the backend

  const { canManage, loaded } = useAdminAccess();
  const canDisburse = loaded && canManage;
  const isViewOnly = loaded && !canManage;

  // ── filter state ──
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterDay, setFilterDay] = useState<string>("all");

  const daysInSelectedMonth = useMemo(
    () => getDaysInMonth(filterYear, filterMonth),
    [filterYear, filterMonth]
  );

  const dayOptions = useMemo(
    () =>
      Array.from({ length: daysInSelectedMonth }, (_, i) => ({
        value: String(i + 1).padStart(2, "0"),
        label: String(i + 1),
      })),
    [daysInSelectedMonth]
  );

  useEffect(() => {
    if (filterDay === "all") return;
    if (parseInt(filterDay, 10) > daysInSelectedMonth) setFilterDay("all");
  }, [daysInSelectedMonth, filterDay]);

  // ── modal state (no more bank/account inputs — only an optional note) ──
  const [disburseModalOpen, setDisburseModalOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [disburseError, setDisburseError] = useState<string | null>(null);
  const [disburseSuccess, setDisburseSuccess] = useState<string | null>(null);

  // ── FIXED destination (BDO) — comes from the backend, already masked ──
  const [destination, setDestination] = useState<DisbursementDestination | null>(null);
  const [isLoadingDestination, setIsLoadingDestination] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);

  const [disbursementHistory, setDisbursementHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [xenditBalance, setXenditBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  const [disbursementPage, setDisbursementPage] = useState(1);

  const isSubmittingRef = useRef(false);
  const autoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
    };
  }, []);

  const fetchDestination = React.useCallback(async () => {
    setIsLoadingDestination(true);
    setDestinationError(null);
    try {
      const res = await fetch(`${getSupabaseFunctionsUrl()}/get-disbursement-destination`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setDestination(null);
        setDestinationError("Hindi ma-load ang destination account. Subukan ulit.");
        return;
      }
      const data = await res.json();
      const d = data?.destination;
      if (d && d.bank_code && d.masked_account_number) {
        setDestination({
          bank_code: String(d.bank_code),
          account_holder_name: String(d.account_holder_name || ""),
          masked_account_number: String(d.masked_account_number),
        });
      } else {
        setDestination(null);
        setDestinationError("Wala pang naka-set na destination account. Kontakin ang super admin.");
      }
    } catch (err) {
      console.warn("Failed to fetch destination:", err);
      setDestination(null);
      setDestinationError("Hindi ma-load ang destination account. Subukan ulit.");
    } finally {
      setIsLoadingDestination(false);
    }
  }, []);

  useEffect(() => {
    fetchDestination();
  }, [fetchDestination]);

  const fetchDisbursementHistory = React.useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`${getSupabaseFunctionsUrl()}/list-disbursements?limit=100`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        console.warn("Failed to fetch disbursement history:", await res.text());
        return;
      }
      const data = await res.json();
      setDisbursementHistory(Array.isArray(data?.disbursements) ? data.disbursements : []);
      setDisbursementPage(1);
    } catch (err) {
      console.warn("Failed to fetch disbursement history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchDisbursementHistory();
  }, [fetchDisbursementHistory]);

  const fetchXenditBalance = React.useCallback(async () => {
    setIsLoadingBalance(true);
    try {
      const res = await fetch(`${getSupabaseFunctionsUrl()}/get-xendit-balance`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        console.warn("Failed to fetch Xendit balance:", await res.text());
        setXenditBalance(null);
        return;
      }
      const data = await res.json();
      setXenditBalance(typeof data?.balance === "number" ? data.balance : null);
    } catch (err) {
      console.warn("Failed to fetch Xendit balance:", err);
      setXenditBalance(null);
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    fetchXenditBalance();
  }, [fetchXenditBalance]);

  const { data: transactions, refetch: refetchTransactions } = useListTransactions();

  useRealtimeRefetch(["transactions"], () => {
    refetchTransactions();
    fetchXenditBalance();
  });

  const txList = useMemo(() => (Array.isArray(transactions) ? transactions : []), [transactions]);

  const totalGcashTopups = useMemo(
    () =>
      txList
        .filter((tx: any) => isTopupTransaction(tx) && isGcashChannel(tx))
        .reduce((sum: number, tx: any) => sum + getTopupNetAmount(tx), 0),
    [txList]
  );

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    txList.forEach((tx: any) => {
      const parts = getTxDateParts(tx);
      if (parts) years.add(parts.year);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [txList]);

  const isFilterActive = filterYear !== "all" || filterMonth !== "all" || filterDay !== "all";

  const resetFilters = () => {
    setFilterYear("all");
    setFilterMonth("all");
    setFilterDay("all");
  };

  const filterLabel = useMemo(() => {
    if (!isFilterActive) return "";
    const parts: string[] = [];
    if (filterDay !== "all") parts.push(filterDay);
    if (filterMonth !== "all") {
      const m = MONTH_OPTIONS.find((mo) => mo.value === filterMonth);
      parts.push(m ? m.label : filterMonth);
    }
    if (filterYear !== "all") parts.push(filterYear);
    return parts.join(" ");
  }, [isFilterActive, filterYear, filterMonth, filterDay]);

  const disburseDateRange = useMemo((): { start: string; end: string } | null => {
    if (!isFilterActive) {
      const today = getLocalDateString();
      return { start: today, end: today };
    }
    if (filterYear === "all") return null;

    if (filterMonth === "all") {
      return { start: `${filterYear}-01-01`, end: `${filterYear}-12-31` };
    }
    if (filterDay === "all") {
      const daysInMonth = getDaysInMonth(filterYear, filterMonth);
      return {
        start: `${filterYear}-${filterMonth}-01`,
        end: `${filterYear}-${filterMonth}-${String(daysInMonth).padStart(2, "0")}`,
      };
    }
    return { start: `${filterYear}-${filterMonth}-${filterDay}`, end: `${filterYear}-${filterMonth}-${filterDay}` };
  }, [isFilterActive, filterYear, filterMonth, filterDay]);

  const txInRange = useMemo(() => {
    if (!disburseDateRange) return [];
    return txList.filter((tx: any) => {
      if (!isFareTransaction(tx)) return false;
      const key = getTxDateKey(tx);
      if (!key) return false;
      return key >= disburseDateRange.start && key <= disburseDateRange.end;
    });
  }, [txList, disburseDateRange]);

  const fareTransactionIds = useMemo(
    () => txInRange.map((tx: any) => tx.id).filter((id: any) => id != null),
    [txInRange]
  );

  const disburseAmount = useMemo(
    () => txInRange.reduce((sum: number, tx: any) => sum + Math.abs(Number(tx.amount) || 0), 0),
    [txInRange]
  );

  const disburseAmountLabel = isFilterActive ? `${filterLabel} Revenue` : "Today's Revenue";

  const disburseIdempotencyKey = isFilterActive
    ? `filtered-${filterYear}-${filterMonth}-${filterDay}`
    : `today-${getLocalDateString()}`;

  const disburseButtonTitle = isViewOnly
    ? "View only — you don't have permission to disburse."
    : !disburseDateRange
      ? "Pumili ng Year sa filter para makapag-disburse"
      : undefined;

  const clearAutoClose = () => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
  };

  const openDisburseModal = () => {
    if (!canDisburse) return;
    clearAutoClose();
    setDisburseError(null);
    setDisburseSuccess(null);
    setDisburseModalOpen(true);
    // make sure the destination shown is fresh
    fetchDestination();
  };

  const closeDisburseModal = () => {
    if (isDisbursing) return;
    clearAutoClose();
    setDisburseModalOpen(false);
  };

  const handleSubmitDisbursement = async () => {
    if (!canDisburse) {
      setDisburseError("View only access — wala kang permission na mag-disburse.");
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setDisburseError(null);

    if (!disburseDateRange) {
      setDisburseError("Pumili muna ng Year sa filter para makapag-disburse.");
      isSubmittingRef.current = false;
      return;
    }
    if (!destination) {
      setDisburseError("Walang destination account na naka-set. Hindi pwedeng mag-disburse.");
      isSubmittingRef.current = false;
      return;
    }
    if (fareTransactionIds.length === 0) {
      setDisburseError("Walang fare transaction (hindi top-up) na available na i-disburse para sa period na ito.");
      isSubmittingRef.current = false;
      return;
    }

    setIsDisbursing(true);
    try {
      // NOTE: walang bank_code / account_number / account_holder_name / requested_by dito.
      // Ang backend na ang kukuha ng destination sa config nito at ng admin identity sa auth token.
      const res = await fetch(`${getSupabaseFunctionsUrl()}/create-disbursement`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          date_start: disburseDateRange.start,
          date_end: disburseDateRange.end,
          fare_transaction_ids: fareTransactionIds,
          description: note.trim() || `${disburseAmountLabel} disbursement`,
          idempotency_key: disburseIdempotencyKey,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(
            data?.error || "Wala nang bagong fare transaction na pwedeng i-disburse para sa period na ito."
          );
        }
        throw new Error(data?.error || "Nabigo ang disbursement request.");
      }

      const sentAmount = data?.disbursement?.amount ?? disburseAmount;
      setDisburseSuccess(
        `Naipadala na ang ${formatPeso(sentAmount)} sa BDO ${destination.masked_account_number} — pending pa ang confirmation mula sa Xendit.`
      );
      setNote("");

      fetchDisbursementHistory();
      fetchXenditBalance();

      clearAutoClose();
      autoCloseTimeoutRef.current = setTimeout(() => {
        setDisburseModalOpen(false);
        setDisburseSuccess(null);
        autoCloseTimeoutRef.current = null;
      }, DISBURSE_SUCCESS_AUTOCLOSE_MS);
    } catch (err: any) {
      setDisburseError(err?.message || "May error na nangyari, subukan ulit.");
    } finally {
      setIsDisbursing(false);
      isSubmittingRef.current = false;
    }
  };

  const disbursementTotalPages = Math.max(1, Math.ceil(disbursementHistory.length / DISBURSEMENTS_PER_PAGE));
  const disbursementPageClamped = Math.min(disbursementPage, disbursementTotalPages);

  const paginatedDisbursements = useMemo(() => {
    const start = (disbursementPageClamped - 1) * DISBURSEMENTS_PER_PAGE;
    return disbursementHistory.slice(start, start + DISBURSEMENTS_PER_PAGE);
  }, [disbursementHistory, disbursementPageClamped]);

  const goToPrevDisbursementPage = () => setDisbursementPage((p) => Math.max(1, p - 1));
  const goToNextDisbursementPage = () => setDisbursementPage((p) => Math.min(disbursementTotalPages, p + 1));

  const statusBadgeClasses = (status: string, isDarkMode: boolean) => {
    const s = (status || "").toUpperCase();
    if (s === "COMPLETED") return isDarkMode ? "bg-emerald-950/40 text-emerald-400 border-emerald-900" : "bg-emerald-50 text-emerald-700 border-emerald-100";
    if (s === "FAILED") return isDarkMode ? "bg-red-950/40 text-red-400 border-red-900" : "bg-red-50 text-red-700 border-red-100";
    return isDarkMode ? "bg-amber-950/40 text-amber-400 border-amber-900" : "bg-amber-50 text-amber-700 border-amber-100";
  };

  const selectClass = `h-8 rounded border px-2 text-xs ${isDark ? "bg-slate-950 border-slate-700 text-slate-200" : "bg-white border-slate-300 text-slate-700"}`;
  const thClass = `text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`;
  const pageBtnClass = `h-8 flex items-center gap-1 px-3 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
    isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
  }`;

  const confirmDisabled = isDisbursing || !canDisburse || !destination || isLoadingDestination;

  return (
    <div
      className={`space-y-8 h-full flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`}
      style={{ overflowX: "hidden", maxWidth: "100%", boxSizing: "border-box" }}
      data-testid="disbursement-page"
    >
      {/* ══ HEADER ══ */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <Wallet className="text-indigo-500" size={26} />
            Disbursement
          </h2>
          <p className={`text-sm mt-1 flex items-center flex-wrap gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <span>Send collected revenue to the registered BDO account via</span>
            <img src="/xendit.png" alt="Xendit" className="h-4 w-auto max-w-[70px] object-contain inline-block align-middle" />
            <span>, and review past payouts.</span>
          </p>
        </div>
      </div>

      {/* ══ XENDIT BALANCE + GCASH TOP-UPS SUMMARY ══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className={`shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-transparent" />
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                <Landmark size={12} className="text-indigo-500" />
                Xendit Balance
              </p>
              <p className={`text-xl font-bold font-mono mt-1 ${isDark ? "text-white" : "text-slate-900"}`}>
                {isLoadingBalance ? (
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                ) : xenditBalance !== null ? (
                  formatPeso(xenditBalance)
                ) : (
                  "—"
                )}
              </p>
              <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Available to disburse right now
              </p>
            </div>
            <button
              type="button"
              onClick={fetchXenditBalance}
              disabled={isLoadingBalance}
              data-testid="button-refresh-xendit-balance"
              title="Refresh"
              className={`h-8 w-8 flex-none flex items-center justify-center rounded-md transition-colors disabled:opacity-50 ${
                isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <RefreshCw size={14} className={isLoadingBalance ? "animate-spin" : ""} />
            </button>
          </CardContent>
        </Card>

        <Card className={`shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 via-blue-400 to-transparent" />
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                <Smartphone size={12} className="text-sky-500" />
                Total GCash Top-ups (Net)
              </p>
              <p className={`text-xl font-bold font-mono mt-1 ${isDark ? "text-white" : "text-slate-900"}`}>
                {formatPeso(totalGcashTopups)}
              </p>
              <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Net amount after fees, all-time — not fare revenue
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ══ SELECT PERIOD TO DISBURSE ══ */}
      <div className={`flex flex-wrap items-center gap-2 py-3 border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <span className={`text-sm font-semibold whitespace-nowrap ${isDark ? "text-slate-300" : "text-slate-700"}`}>
          Select Period to Disburse:
        </span>

        <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} data-testid="select-filter-year" className={selectClass}>
          <option value="all">Year</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} data-testid="select-filter-month" className={selectClass}>
          <option value="all">Month</option>
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        <select value={filterDay} onChange={(e) => setFilterDay(e.target.value)} data-testid="select-filter-day" className={selectClass}>
          <option value="all">Day</option>
          {dayOptions.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>

        {isFilterActive && (
          <button
            type="button"
            onClick={resetFilters}
            data-testid="button-reset-filters"
            className={`h-8 px-2 text-xs underline ${isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"}`}
          >
            Reset
          </button>
        )}

        <span className={`text-sm font-semibold ml-2 ${isDark ? "text-slate-200" : "text-slate-800"}`}>
          {disburseAmountLabel}: {formatPeso(disburseAmount)}
        </span>

        <Button
          onClick={openDisburseModal}
          disabled={!disburseDateRange || !canDisburse}
          className={`ml-auto text-xs font-semibold h-8 px-4 text-white disabled:cursor-not-allowed disabled:opacity-100 ${
            canDisburse && disburseDateRange
              ? "bg-indigo-600 hover:bg-indigo-700"
              : isDark
                ? "bg-slate-700 text-slate-400 hover:bg-slate-700"
                : "bg-slate-300 text-slate-500 hover:bg-slate-300"
          }`}
          data-testid="button-disburse-revenue"
          title={disburseButtonTitle}
        >
          Disburse
        </Button>
      </div>

      {isViewOnly && (
        <p className={`-mt-6 text-[11px] ${isDark ? "text-amber-400" : "text-amber-600"}`}>
          View only — disbursing is disabled for your account.
        </p>
      )}

      {/* ══ DISBURSEMENT HISTORY ══ */}
      <Card className={`shadow-sm overflow-hidden ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <History size={14} className="text-indigo-500" />
              Disbursement History
              <span className={`normal-case font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                — actual Xendit payouts
              </span>
            </CardTitle>
            <button
              type="button"
              onClick={fetchDisbursementHistory}
              disabled={isLoadingHistory}
              data-testid="button-refresh-disbursement-history"
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <RefreshCw size={12} className={isLoadingHistory ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0 px-6 pb-6 pt-6">
          {isLoadingHistory && disbursementHistory.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className={`h-10 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />)}
            </div>
          ) : disbursementHistory.length === 0 ? (
            <div className={`py-10 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Wala pang disbursement na naitala.
            </div>
          ) : (
            <Table>
              <TableHeader className={isDark ? "bg-slate-900" : "bg-white"}>
                <TableRow className={`hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  <TableHead className={thClass}>Date</TableHead>
                  <TableHead className={thClass}>Account</TableHead>
                  <TableHead className={thClass}>Channel</TableHead>
                  <TableHead className={thClass}>Xendit ID</TableHead>
                  <TableHead className={thClass}>Status</TableHead>
                  <TableHead className={`text-right ${thClass}`}>Fee</TableHead>
                  <TableHead className={`text-right ${thClass}`}>VAT</TableHead>
                  <TableHead className={`text-right ${thClass}`}>Net Amount</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedDisbursements.map((row: any) => (
                  <TableRow
                    key={row.id}
                    className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}`}
                  >
                    <TableCell className={`text-sm ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                      {row.created_at ? new Date(row.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </TableCell>
                    <TableCell className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      <div className="font-medium">{row.account_holder_name}</div>
                      <div className="font-mono text-[11px] opacity-70">
                        {row.account_number
                          ? `••••${String(row.account_number).slice(-4)}`
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {isBdoChannel(row) && (
                          <img src="/bdo.png" alt="BDO" className="h-3.5 w-auto max-w-[24px] object-contain flex-none" />
                        )}
                        <span className="font-medium">{getChannelLabel(row)}</span>
                      </span>
                    </TableCell>
                    <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      {row.xendit_disbursement_id || "—"}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold uppercase ${statusBadgeClasses(row.status, isDark)}`}>
                        {row.status}
                      </span>
                      {row.status === "FAILED" && row.failure_reason && (
                        <div className={`text-[10px] mt-0.5 ${isDark ? "text-red-400/70" : "text-red-500/80"}`}>{row.failure_reason}</div>
                      )}
                    </TableCell>
                    <TableCell className={`text-right text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {row.xendit_fee_amount != null ? formatPeso(Number(row.xendit_fee_amount)) : "—"}
                    </TableCell>
                    <TableCell className={`text-right text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {row.xendit_vat_amount != null ? formatPeso(Number(row.xendit_vat_amount)) : "—"}
                    </TableCell>
                    <TableCell className={`text-right text-xs font-mono ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                      {row.xendit_net_amount != null ? formatPeso(Number(row.xendit_net_amount)) : "—"}
                    </TableCell>
                    <TableCell className={`text-right font-semibold font-mono text-sm ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      {formatPeso(Number(row.amount) || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {disbursementHistory.length > DISBURSEMENTS_PER_PAGE && (
            <div className={`flex items-center justify-between pt-4 mt-2 border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Page {disbursementPageClamped} of {disbursementTotalPages} · {disbursementHistory.length} total
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={goToPrevDisbursementPage} disabled={disbursementPageClamped <= 1} data-testid="button-disbursement-prev-page" className={pageBtnClass}>
                  Previous
                </button>
                <button type="button" onClick={goToNextDisbursementPage} disabled={disbursementPageClamped >= disbursementTotalPages} data-testid="button-disbursement-next-page" className={pageBtnClass}>
                  Next
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ DISBURSE REVENUE MODAL (summary + confirm only) ══ */}
      {disburseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeDisburseModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-lg border shadow-xl ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}
          >
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
                <Wallet size={16} className="text-indigo-500" />
                Disburse Revenue
              </h3>
              <button onClick={closeDisburseModal} className={isDark ? "text-slate-500 hover:text-white" : "text-slate-400 hover:text-slate-900"}>
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Amount */}
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-md border text-sm ${isDark ? "bg-indigo-950/40 border-indigo-900" : "bg-indigo-50 border-indigo-100"}`}>
                <span className={isDark ? "text-indigo-300" : "text-indigo-700"}>{disburseAmountLabel}</span>
                <span className={`font-bold ${isDark ? "text-indigo-300" : "text-indigo-700"}`}>{formatPeso(disburseAmount)}</span>
              </div>
              <p className={`text-[11px] -mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Fare transactions lang ang isasama — hindi kasama ang top-ups, cash-ins, at loads. Kung may na-disburse na dati, mga bagong fare transaction lang ang bibilangin.
              </p>

              {/* Fixed destination (read-only) */}
              <div>
                <label className={`text-xs font-semibold mb-1 block ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Ipapadala sa
                </label>
                <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 ${isDark ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                  {isLoadingDestination ? (
                    <span className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      <Loader2 size={14} className="animate-spin" /> Loading...
                    </span>
                  ) : destination ? (
                    <>
                      <div className="min-w-0">
                        <div className={`flex items-center gap-2 text-sm font-semibold ${isDark ? "text-slate-100" : "text-slate-800"}`}>
                          <img src="/bdo.png" alt="BDO" className="h-3.5 w-auto max-w-[24px] object-contain flex-none" />
                          <span>BDO</span>
                          <span className="font-mono">{destination.masked_account_number}</span>
                        </div>
                        {destination.account_holder_name && (
                          <div className={`text-xs mt-0.5 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            {destination.account_holder_name}
                          </div>
                        )}
                      </div>
                      <Lock size={14} className={`flex-none ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                    </>
                  ) : (
                    <span className={`text-sm ${isDark ? "text-red-400" : "text-red-600"}`}>
                      {destinationError || "Walang destination account."}
                    </span>
                  )}
                </div>
                <p className={`text-[10px] mt-1 ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                  Naka-lock ang destination account. Super admin lang ang makakapagpalit nito.
                </p>
              </div>

              {/* Optional note */}
              <div>
                <label className={`text-xs font-semibold mb-1 block ${isDark ? "text-slate-400" : "text-slate-500"}`}>Note (optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  data-testid="input-disburse-description"
                  placeholder={`${disburseAmountLabel} disbursement`}
                  className={`w-full h-9 rounded-md border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                />
              </div>

              {disburseError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-100 text-red-700 text-xs">
                  <AlertCircle size={14} className="mt-0.5 flex-none" />
                  {disburseError}
                </div>
              )}
              {disburseSuccess && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs">
                  <CheckCircle2 size={14} className="mt-0.5 flex-none" />
                  {disburseSuccess}
                </div>
              )}
            </div>

            <div className={`flex justify-end gap-2 px-5 py-4 border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <button
                type="button"
                onClick={closeDisburseModal}
                disabled={isDisbursing}
                className={`text-xs font-semibold px-4 h-9 bg-transparent border-0 shadow-none disabled:opacity-60 disabled:cursor-not-allowed ${
                  isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Cancel
              </button>

              <Button
                onClick={handleSubmitDisbursement}
                disabled={confirmDisabled}
                data-testid="button-confirm-disburse"
                title={isViewOnly ? "View only — you don't have permission to disburse." : undefined}
                className={`text-white text-xs font-semibold px-4 h-9 disabled:cursor-not-allowed ${
                  canDisburse && destination
                    ? "bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
                    : isDark
                      ? "bg-slate-700 text-slate-400 hover:bg-slate-700 disabled:opacity-100"
                      : "bg-slate-300 text-slate-500 hover:bg-slate-300 disabled:opacity-100"
                }`}
              >
                {isDisbursing ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Confirm Disbursement"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}