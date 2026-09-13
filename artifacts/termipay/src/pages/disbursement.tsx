import React, { useEffect, useMemo, useRef, useState } from "react";
import { useListTransactions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import {
  Wallet,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  History,
  RefreshCw,
  Filter,
  RotateCcw,
} from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// how long (ms) to show the success message inside the modal before it auto-closes
const DISBURSE_SUCCESS_AUTOCLOSE_MS = 1800;

// account number is restricted to digits only, max 12 characters (covers PH
// mobile numbers like "09171234567" as well as bank account numbers)
const ACCOUNT_NUMBER_MAX_LEN = 12;

// Disbursement History table is paginated client-side at this many rows per page
const DISBURSEMENTS_PER_PAGE = 10;

// ── SHARED classification config — keep this in sync with whatever the
// backend (create-disbursement function) uses to classify transactions.
// Ideally this list lives in one shared module imported by both sides;
// duplicating it here is a stopgap until that's wired up. ──
const NON_FARE_MARKERS = ["topup", "top_up", "top-up", "cash_in", "cashin", "cash-in", "load", "reload"];

function getLocalDateString(): string {
  return new Date().toLocaleDateString("en-CA");
}

// strips everything except digits and caps the length, used for the
// account/mobile number field
function sanitizeAccountNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, ACCOUNT_NUMBER_MAX_LEN);
}

// shared helper to normalize the API base URL for direct fetch() calls
function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// normalizes the Supabase Functions base URL, e.g.
// "https://xxxx.supabase.co" -> "https://xxxx.functions.supabase.co"
function getSupabaseFunctionsUrl(): string {
  const explicit = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!supabaseUrl) return "";
  return supabaseUrl.replace(".supabase.co", ".functions.supabase.co");
}

// fire-and-forget audit log call for disbursement actions
async function logAudit(params: { entity: string; format: string; details: string }) {
  try {
    const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);
    const token = window.localStorage.getItem("termipay_auth_token");
    await fetch(`${apiBaseUrl}/api/audit/log-export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch (err) {
    console.warn("Failed to write audit log (ignoring):", err);
  }
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

// bank/e-wallet channels Xendit commonly supports for disbursement in PH —
// trim/extend this list to match what's actually enabled on your Xendit account
const DISBURSEMENT_CHANNELS = [
  { value: "PH_BDO", label: "BDO" },
];

// ── Returns how many days are in a given year/month. Falls back to 31
// (safe upper bound) when year and/or month aren't picked yet, so the
// Day dropdown still shows a full list before a Year/Month is chosen. ──
function getDaysInMonth(year: string, month: string): number {
  if (year === "all" || month === "all") return 31;
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (isNaN(y) || isNaN(m)) return 31;
  return new Date(y, m, 0).getDate();
}

// ── Identifies whether a transaction is an actual FARE (tap) transaction,
// as opposed to a top-up / cash-in / load transaction. Only fare
// transactions count as "revenue" that can be disbursed — top-ups are
// money the passenger added to their own balance, not money collected
// by the operator.
//
// IMPORTANT: adjust `NON_FARE_MARKERS` (and/or the field lookup below) to
// match whatever field/value your backend actually uses to distinguish
// transaction types. If no type-like field is present at all, this
// treats the transaction as fare by default (backward-compatible with
// data that has no type field yet). ──
function isFareTransaction(tx: any): boolean {
  const raw = (tx.type ?? tx.transaction_type ?? tx.category ?? "")
    .toString()
    .toLowerCase()
    .trim();
  if (!raw) return true; // no type field present — assume fare
  return !NON_FARE_MARKERS.some((marker) => raw.includes(marker));
}

// Returns the transaction's local "YYYY-MM-DD" date key
function getTxDateKey(tx: any): string | null {
  const ts = tx.timestamp || tx.created_at;
  if (!ts) return null;
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
}

// Extracts { year, month, day } from a transaction's timestamp field
function getTxDateParts(tx: any): { year: string; month: string; day: string } | null {
  const key = getTxDateKey(tx);
  if (!key) return null;
  const [y, m, d] = key.split("-");
  return { year: y, month: m, day: d };
}

export default function DisbursementPage() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const adminName = user?.name || "System Administrator";

  // ── filter state (drives which period gets disbursed) ──
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterDay, setFilterDay] = useState<string>("all");

  // ── Day options are derived from the currently selected Year/Month so
  // it's impossible to pick an invalid date like Feb 31. Whenever the
  // available days shrink (e.g. switching from a 31-day month to Feb)
  // and the currently selected Day no longer exists, it's reset to "all"
  // automatically. ──
  const daysInSelectedMonth = useMemo(
    () => getDaysInMonth(filterYear, filterMonth),
    [filterYear, filterMonth]
  );

  const dayOptions = useMemo(
    () =>
      Array.from({ length: daysInSelectedMonth }, (_, i) => {
        const val = String(i + 1).padStart(2, "0");
        return { value: val, label: String(i + 1) };
      }),
    [daysInSelectedMonth]
  );

  useEffect(() => {
    if (filterDay === "all") return;
    if (parseInt(filterDay, 10) > daysInSelectedMonth) {
      setFilterDay("all");
    }
  }, [daysInSelectedMonth, filterDay]);

  // ── disbursement modal state ──
  const [disburseModalOpen, setDisburseModalOpen] = useState(false);
  const [disburseChannelOpen, setDisburseChannelOpen] = useState(false);
  const [disburseForm, setDisburseForm] = useState({
    bank_code: "",
    account_holder_name: "",
    account_number: "",
    description: "",
  });
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [disburseError, setDisburseError] = useState<string | null>(null);
  const [disburseSuccess, setDisburseSuccess] = useState<string | null>(null);

  // ── REAL disbursement history — fetched straight from the DB via the
  // list-disbursements function, not computed/estimated on the frontend.
  // This reflects exactly what was (or wasn't) actually transferred to
  // Xendit, including its current status. ──
  const [disbursementHistory, setDisbursementHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // ── current page (1-indexed) for the Disbursement History table ──
  const [disbursementPage, setDisbursementPage] = useState(1);

  // ── synchronous guard against double-submit (double-click, double-tap,
  // Enter-key + click race, etc). The real, authoritative protection
  // against duplicates still lives in the backend/DB; this ref just
  // avoids firing an obviously-redundant second request from the same
  // click session. ──
  const isSubmittingRef = useRef(false);

  // ── holds the setTimeout id for the post-success auto-close ──
  const autoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
    };
  }, []);

  // ── fetches the REAL disbursement rows from the DB (via the
  // list-disbursements function) — what actually went to Xendit, with
  // its current status. Called on mount and after every disbursement
  // attempt so the list always reflects reality. ──
  const fetchDisbursementHistory = React.useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const functionsUrl = getSupabaseFunctionsUrl();
      const token = window.localStorage.getItem("termipay_auth_token");
      const res = await fetch(`${functionsUrl}/list-disbursements?limit=100`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

  const { data: transactions, refetch: refetchTransactions } = useListTransactions();

  useRealtimeRefetch(["transactions"], () => {
    refetchTransactions();
  });

  const txList = useMemo(() => (Array.isArray(transactions) ? transactions : []), [transactions]);

  // ── derive available years straight from transactions so the Year
  // dropdown reflects everything that actually has records ──
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

  // Human-readable label for the currently active filter, e.g. "September 2026"
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

  // ── the actual [date_start, date_end] range the backend will scan for
  // un-disbursed transactions. Requires a Year to be selected (or no
  // filter at all, which means "today"). Month-only/Day-only filters
  // (no Year) don't resolve to a concrete range — disburseDateRange is
  // null in that case and the button gets disabled. ──
  const disburseDateRange = useMemo((): { start: string; end: string } | null => {
    if (!isFilterActive) {
      const today = getLocalDateString();
      return { start: today, end: today };
    }
    if (filterYear === "all") return null; // no concrete range to anchor to

    if (filterMonth === "all") {
      return { start: `${filterYear}-01-01`, end: `${filterYear}-12-31` };
    }
    if (filterDay === "all") {
      const daysInMonth = getDaysInMonth(filterYear, filterMonth);
      return { start: `${filterYear}-${filterMonth}-01`, end: `${filterYear}-${filterMonth}-${String(daysInMonth).padStart(2, "0")}` };
    }
    return { start: `${filterYear}-${filterMonth}-${filterDay}`, end: `${filterYear}-${filterMonth}-${filterDay}` };
  }, [isFilterActive, filterYear, filterMonth, filterDay]);

  // ── transactions that fall inside the active disburse date range AND
  // pass the fare-only filter. This list is now used for TWO things:
  // 1) the estimated preview amount shown in the UI, and
  // 2) the explicit allowlist of transaction IDs sent to the backend,
  // so the server has a concrete, fare-only set to intersect against
  // instead of re-deriving "fare" from the date range alone. ──
  const txInRange = useMemo(() => {
    if (!disburseDateRange) return [];
    return txList.filter((tx: any) => {
      if (!isFareTransaction(tx)) return false;
      const key = getTxDateKey(tx);
      if (!key) return false;
      return key >= disburseDateRange.start && key <= disburseDateRange.end;
    });
  }, [txList, disburseDateRange]);

  // ── explicit fare-only transaction IDs in the active range, sent to the
  // backend as an allowlist. Falsy/missing ids are filtered out defensively. ──
  const fareTransactionIds = useMemo(
    () => txInRange.map((tx: any) => tx.id).filter((id: any) => id != null),
    [txInRange]
  );

  const disburseAmount = useMemo(
    () => txInRange.reduce((sum: number, tx: any) => sum + Math.abs(Number(tx.amount) || 0), 0),
    [txInRange]
  );

  const disburseAmountLabel = isFilterActive ? `${filterLabel} Revenue` : "Today's Revenue";

  // ── identifies WHICH PERIOD is being disbursed, so the backend can
  // serialize concurrent requests for the same period (advisory lock). ──
  const disburseIdempotencyKey = isFilterActive
    ? `filtered-${filterYear}-${filterMonth}-${filterDay}`
    : `today-${getLocalDateString()}`;

  const openDisburseModal = () => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    setDisburseChannelOpen(false);
    setDisburseError(null);
    setDisburseSuccess(null);
    setDisburseModalOpen(true);
  };

  const closeDisburseModal = () => {
    if (isDisbursing) return; // don't let them close mid-request
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    setDisburseChannelOpen(false);
    setDisburseModalOpen(false);
  };

  const handleDisburseFieldChange = (field: keyof typeof disburseForm, value: string) => {
    setDisburseForm((prev) => ({ ...prev, [field]: value }));
  };

  // ── dedicated handler for the account/mobile number field: strips any
  // non-digit characters as the admin types/pastes, and hard-caps the
  // length at ACCOUNT_NUMBER_MAX_LEN (12). ──
  const handleAccountNumberChange = (rawValue: string) => {
    setDisburseForm((prev) => ({ ...prev, account_number: sanitizeAccountNumber(rawValue) }));
  };

  const handleSubmitDisbursement = async () => {
    // ── synchronous double-submit guard — checked and set BEFORE any
    // await, so a second click that fires before the first re-render
    // still gets blocked here. ──
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setDisburseError(null);

    if (!disburseDateRange) {
      setDisburseError("Pumili muna ng Year sa filter para makapag-disburse (kailangan ng malinaw na date range).");
      isSubmittingRef.current = false;
      return;
    }
    if (!disburseForm.bank_code) {
      setDisburseError("Pumili ng bank o e-wallet.");
      isSubmittingRef.current = false;
      return;
    }
    if (!disburseForm.account_holder_name.trim() || !disburseForm.account_number.trim()) {
      setDisburseError("Kailangan ang account holder name at account number.");
      isSubmittingRef.current = false;
      return;
    }
    // ── belt-and-suspenders: account number should already be digits-only
    // (max 12) thanks to handleAccountNumberChange, but re-validate here in
    // case the value ever gets set another way. ──
    if (!/^\d{1,12}$/.test(disburseForm.account_number.trim())) {
      setDisburseError("Ang account/mobile number ay dapat mga numero lang, hanggang 12 digits.");
      isSubmittingRef.current = false;
      return;
    }
    // ── nothing fare-eligible to disburse for this period — stop before
    // even hitting the backend, and tell the admin clearly why. ──
    if (fareTransactionIds.length === 0) {
      setDisburseError("Walang fare transaction (hindi top-up) na available na i-disburse para sa period na ito.");
      isSubmittingRef.current = false;
      return;
    }

    setIsDisbursing(true);
    try {
      const functionsUrl = getSupabaseFunctionsUrl();
      const token = window.localStorage.getItem("termipay_auth_token");

      const res = await fetch(`${functionsUrl}/create-disbursement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          date_start: disburseDateRange.start,
          date_end: disburseDateRange.end,
          // ── NEW: explicit fare-only enforcement sent to the backend.
          // The backend MUST use these to restrict what actually gets
          // disbursed — it should not just trust the date range, since
          // that range can also contain topup/cash-in/load transactions. ──
          transaction_type: "fare",
          exclude_transaction_types: NON_FARE_MARKERS,
          fare_transaction_ids: fareTransactionIds,
          channel_code: disburseForm.bank_code,
          bank_code: disburseForm.bank_code,
          account_holder_name: disburseForm.account_holder_name.trim(),
          account_number: disburseForm.account_number.trim(),
          description: disburseForm.description.trim() || `${disburseAmountLabel} disbursement`,
          requested_by: adminName,
          idempotency_key: disburseIdempotencyKey,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 409 = the backend found no un-disbursed FARE transactions left for
        // this period — show a clear message instead of the generic one
        if (res.status === 409) {
          throw new Error(
            data?.error || "Wala nang bagong fare transaction na pwedeng i-disburse para sa period na ito."
          );
        }
        throw new Error(data?.error || "Nabigo ang disbursement request.");
      }

      const sentAmount = data?.disbursement?.amount ?? disburseAmount;
      setDisburseSuccess(
        `Naipadala na ang ${formatPeso(sentAmount)} (mula sa bagong/hindi pa na-disburse na FARE transactions lamang) — pending pa ang confirmation mula sa Xendit.`
      );
      setDisburseForm({ bank_code: "", account_holder_name: "", account_number: "", description: "" });

      logAudit({
        entity: "Disbursement",
        format: "Xendit",
        details: `${adminName} triggered a disbursement of ${formatPeso(sentAmount)} (${disburseAmountLabel}, fare-only) to ${disburseForm.account_holder_name.trim()}`,
      });

      // refresh the REAL history list right away so the new row (with its
      // actual DB-generated amount/status) shows up without waiting for
      // the modal auto-close
      fetchDisbursementHistory();

      // ── auto-close the modal once the disbursement request succeeds.
      // A short delay lets the admin actually read the success message
      // before the modal disappears; isDisbursing is already false by
      // then (set in `finally` below) so closeDisburseModal won't be
      // blocked by the "don't close mid-request" guard. ──
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = setTimeout(() => {
        setDisburseChannelOpen(false);
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

  // ── pagination derived values for the Disbursement History table ──
  const disbursementTotalPages = Math.max(1, Math.ceil(disbursementHistory.length / DISBURSEMENTS_PER_PAGE));

  // Clamp the current page in case the underlying list shrank (e.g. after
  // a refetch returned fewer rows than before).
  const disbursementPageClamped = Math.min(disbursementPage, disbursementTotalPages);

  const paginatedDisbursements = useMemo(() => {
    const start = (disbursementPageClamped - 1) * DISBURSEMENTS_PER_PAGE;
    return disbursementHistory.slice(start, start + DISBURSEMENTS_PER_PAGE);
  }, [disbursementHistory, disbursementPageClamped]);

  const goToPrevDisbursementPage = () => {
    setDisbursementPage((p) => Math.max(1, p - 1));
  };

  const goToNextDisbursementPage = () => {
    setDisbursementPage((p) => Math.min(disbursementTotalPages, p + 1));
  };

  const statusBadgeClasses = (status: string, isDarkMode: boolean) => {
    const s = (status || "").toUpperCase();
    if (s === "COMPLETED") return isDarkMode ? "bg-emerald-950/40 text-emerald-400 border-emerald-900" : "bg-emerald-50 text-emerald-700 border-emerald-100";
    if (s === "FAILED") return isDarkMode ? "bg-red-950/40 text-red-400 border-red-900" : "bg-red-50 text-red-700 border-red-100";
    return isDarkMode ? "bg-amber-950/40 text-amber-400 border-amber-900" : "bg-amber-50 text-amber-700 border-amber-100";
  };

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
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Send collected revenue to a bank or e-wallet via Xendit, and review past payouts.
          </p>
        </div>
      </div>

      {/* ══ FILTER + DISBURSE TRIGGER ══ */}
      <Card className={`shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-transparent" />
        <CardHeader className={`border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <Wallet size={14} className="text-indigo-500" />
                Select Period to Disburse
              </CardTitle>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Filter size={13} className={isDark ? "text-indigo-400" : "text-indigo-500"} />

              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                data-testid="select-filter-year"
                className={`h-8 rounded-md border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <option value="all">Year</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>

              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                data-testid="select-filter-month"
                className={`h-8 rounded-md border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <option value="all">Month</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <select
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                data-testid="select-filter-day"
                className={`h-8 rounded-md border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
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
                  className={`h-8 flex items-center gap-1 px-2.5 rounded-md text-xs font-semibold transition-colors ${
                    isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              )}

              <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold ${
                isDark ? "bg-indigo-950/40 border-indigo-900 text-indigo-300" : "bg-indigo-50 border-indigo-100 text-indigo-700"
              }`}>
                {disburseAmountLabel}: {formatPeso(disburseAmount)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <Button
            onClick={openDisburseModal}
            disabled={!disburseDateRange}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs px-6 h-9 cursor-pointer transition-colors duration-150 shadow-sm"
            data-testid="button-disburse-revenue"
            title={!disburseDateRange ? "Pumili ng Year sa filter para makapag-disburse" : undefined}
          >
            <Wallet className="w-3.5 h-3.5 mr-2" />
            Disburse {disburseAmountLabel}
          </Button>
        </CardContent>
      </Card>

      {/* ══ DISBURSEMENT HISTORY — REAL data straight from the disbursements
          table (via list-disbursements), i.e. what actually went to Xendit ══ */}
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
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Date</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Account</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Xendit ID</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
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
                      <div className="font-mono text-[11px] opacity-70">{row.account_number}</div>
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
                    <TableCell className={`text-right font-semibold font-mono text-sm ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      {formatPeso(Number(row.amount) || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* ── Previous / Next pagination controls — only shown once there's
              more than one page's worth of disbursement rows. ── */}
          {disbursementHistory.length > DISBURSEMENTS_PER_PAGE && (
            <div className={`flex items-center justify-between pt-4 mt-2 border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Page {disbursementPageClamped} of {disbursementTotalPages} · {disbursementHistory.length} total
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToPrevDisbursementPage}
                  disabled={disbursementPageClamped <= 1}
                  data-testid="button-disbursement-prev-page"
                  className={`h-8 flex items-center gap-1 px-3 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={goToNextDisbursementPage}
                  disabled={disbursementPageClamped >= disbursementTotalPages}
                  data-testid="button-disbursement-next-page"
                  className={`h-8 flex items-center gap-1 px-3 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ DISBURSE REVENUE MODAL ══ */}
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
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-md border text-sm ${isDark ? "bg-indigo-950/40 border-indigo-900" : "bg-indigo-50 border-indigo-100"}`}>
                <span className={isDark ? "text-indigo-300" : "text-indigo-700"}>{disburseAmountLabel}</span>
                <span className={`font-bold ${isDark ? "text-indigo-300" : "text-indigo-700"}`}>{formatPeso(disburseAmount)}</span>
              </div>
              <p className={`text-[11px] -mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Fare transactions lang ang isasama dito — awtomatikong hindi kasama ang top-up/cash-in/load. Kung may bahagi nito na na-disburse na dati, awtomatikong bibilangin lang ang mga bagong fare transaction na hindi pa naipapadala sa Xendit.
              </p>

              <div>
                <label className={`text-xs font-semibold mb-1 block ${isDark ? "text-slate-400" : "text-slate-500"}`}>Bank / E-Wallet</label>
                <div className="relative">
                  <button
                    type="button"
                    data-testid="select-disburse-bank"
                    onClick={() => setDisburseChannelOpen((prev) => !prev)}
                    className={`w-full h-9 rounded-md border px-2.5 text-sm flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {disburseForm.bank_code === "PH_BDO" ? (
                        <>
                          <span>BDO</span>
                          <img src="/bdo.png" alt="BDO" className="h-3.5 w-auto max-w-[24px] object-contain flex-none" />
                        </>
                      ) : (
                        <span>
                          {DISBURSEMENT_CHANNELS.find((c) => c.value === disburseForm.bank_code)?.label || "Select channel"}
                        </span>
                      )}
                    </span>
                    <ChevronDown size={15} className={`flex-none transition-transform ${disburseChannelOpen ? "rotate-180" : ""}`} />
                  </button>

                  {disburseChannelOpen && (
                    <div
                      className={`absolute z-50 mt-1 w-full rounded-md border shadow-lg overflow-hidden ${
                        isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          handleDisburseFieldChange("bank_code", "");
                          setDisburseChannelOpen(false);
                        }}
                        className={`w-full h-9 px-2.5 text-left text-sm ${
                          isDark ? "text-slate-400 hover:bg-slate-900" : "text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        Select channel
                      </button>

                      {DISBURSEMENT_CHANNELS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => {
                            handleDisburseFieldChange("bank_code", c.value);
                            setDisburseChannelOpen(false);
                          }}
                          className={`w-full h-10 px-2.5 text-left text-sm flex items-center gap-2 ${
                            isDark ? "text-slate-200 hover:bg-slate-900" : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {c.value === "PH_BDO" ? (
                            <>
                              <span>{c.label}</span>
                              <img src="/bdo.png" alt="BDO" className="h-3.5 w-auto max-w-[24px] object-contain flex-none ml-auto" />
                            </>
                          ) : (
                            <span>{c.label}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className={`text-xs font-semibold mb-1 block ${isDark ? "text-slate-400" : "text-slate-500"}`}>Account Holder Name</label>
                <input
                  type="text"
                  value={disburseForm.account_holder_name}
                  onChange={(e) => handleDisburseFieldChange("account_holder_name", e.target.value)}
                  data-testid="input-disburse-holder-name"
                  placeholder="Juan Dela Cruz"
                  className={`w-full h-9 rounded-md border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                />
              </div>

              <div>
                <label className={`text-xs font-semibold mb-1 block ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Account / Mobile Number
                  <span className={`ml-1 font-normal normal-case ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                    (numbers only, max 12 digits)
                  </span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={ACCOUNT_NUMBER_MAX_LEN}
                  value={disburseForm.account_number}
                  onChange={(e) => handleAccountNumberChange(e.target.value)}
                  onKeyDown={(e) => {
                    // Block obviously non-numeric keystrokes outright (nice-to-have;
                    // the real enforcement is the onChange sanitizer above, which also
                    // covers paste/autofill/IME input).
                    const allowedKeys = [
                      "Backspace", "Delete", "Tab", "Escape", "Enter",
                      "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End",
                    ];
                    if (allowedKeys.includes(e.key) || e.ctrlKey || e.metaKey) return;
                    if (!/^[0-9]$/.test(e.key)) e.preventDefault();
                  }}
                  data-testid="input-disburse-account-number"
                  placeholder="09171234567"
                  className={`w-full h-9 rounded-md border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                />
              </div>

              <div>
                <label className={`text-xs font-semibold mb-1 block ${isDark ? "text-slate-400" : "text-slate-500"}`}>Note (optional)</label>
                <input
                  type="text"
                  value={disburseForm.description}
                  onChange={(e) => handleDisburseFieldChange("description", e.target.value)}
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
                disabled={isDisbursing}
                data-testid="button-confirm-disburse"
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 h-9"
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