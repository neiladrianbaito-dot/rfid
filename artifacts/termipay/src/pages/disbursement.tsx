import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
// 🔒 ADMIN ACCESS: nagbibigay ng `canManage` (false kapag view_only ang admin)
// at `loaded` (true kapag tapos na ma-fetch ang access info).
import { useAdminAccess } from "@/hooks/use-admin-access";
import {
  Wallet,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  History,
  RefreshCw,
  Eye,
  XCircle,
  Clock,
} from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// how long (ms) to show the success message inside the modal before it auto-closes
const DISBURSE_SUCCESS_AUTOCLOSE_MS = 1800;

// account number is restricted to digits only, max 12 characters
const ACCOUNT_NUMBER_MAX_LEN = 12;

// Disbursement History table is paginated client-side at this many rows per page
const DISBURSEMENTS_PER_PAGE = 10;

// Backend disburses ANY TIME once ₱50,000 worth of unlinked fare
// transactions has piled up; each disbursement pays up to ₱50,000
// (oldest first), the excess rolls into the next one. Keep in sync with
// the DB function's floor/cap.
const MIN_DISBURSEMENT_AMOUNT = 50000;

// one fixed idempotency key so every disbursement attempt serializes
// against the advisory lock in the DB function.
const DISBURSE_IDEMPOTENCY_KEY = "manual-disbursement";

// ── Status filter options for the Disbursement History table ──
const DISBURSEMENT_STATUS_FILTERS = ["All", "Pending", "Completed", "Failed"] as const;

// Named alias (avoids the build mis-stripping the inline typeof expression,
// which caused "ReferenceError: number is not defined" before).
type DisbursementStatusFilterType = (typeof DISBURSEMENT_STATUS_FILTERS)[number];

// 🎨 Status filter -> dot color mapping
function getDisbursementStatusDotColor(status: string) {
  switch (status) {
    case "Completed":
      return "bg-emerald-500";
    case "Failed":
      return "bg-red-500";
    case "Pending":
      return "bg-amber-500";
    default:
      return "bg-slate-400";
  }
}

// SHARED classification config — keep in sync with the backend
// (create-disbursement function).
const NON_FARE_MARKERS = ["topup", "top_up", "top-up", "cash_in", "cashin", "cash-in", "load", "reload"];

// strips everything except digits and caps the length
function sanitizeAccountNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, ACCOUNT_NUMBER_MAX_LEN);
}

// shared helper to normalize the API base URL for direct fetch() calls
function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// normalizes the Supabase Functions base URL
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

// bank/e-wallet channels Xendit supports for disbursement in PH —
// trim/extend to match what's enabled on your Xendit account
const DISBURSEMENT_CHANNELS = [{ value: "PH_BDO", label: "BDO" }];

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

// ── Receipt helpers ─────────────────────────────────────────────────────────
type DisbursementStatus = "completed" | "failed" | "pending";

function normalizeDisbursementStatus(status?: string | null): DisbursementStatus {
  const key = (status ?? "").toString().toLowerCase().trim();
  if (key === "completed" || key === "complete" || key === "success") return "completed";
  if (key === "failed" || key === "failure" || key === "error") return "failed";
  return "pending";
}

function formatAmountPlain(amount: number): string {
  return Math.abs(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNullablePeso(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `₱${formatAmountPlain(n)}` : "—";
}

// ── Reusable row para sa receipt modal (same design as Transaction Logs) ────
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

// ── Disbursement Receipt Modal ──────────────────────────────────────────────
function DisbursementReceiptModal({
  row,
  onClose,
  isDark,
}: {
  row: any | null;
  onClose: () => void;
  isDark: boolean;
}) {
  if (!row) return null;

  const status = normalizeDisbursementStatus(row.status);
  const amount = formatAmountPlain(Number(row.amount) || 0);

  const StatusIcon = status === "failed" ? XCircle : status === "pending" ? Clock : CheckCircle2;

  const statusRingClass =
    status === "completed"
      ? isDark
        ? "ring-emerald-900 bg-emerald-950/40 text-emerald-400"
        : "ring-emerald-100 bg-emerald-50 text-emerald-600"
      : status === "failed"
        ? isDark
          ? "ring-red-900 bg-red-950/40 text-red-400"
          : "ring-red-100 bg-red-50 text-red-600"
        : isDark
          ? "ring-amber-900 bg-amber-950/40 text-amber-400"
          : "ring-amber-100 bg-amber-50 text-amber-600";

  const statusTextColor =
    status === "completed"
      ? isDark ? "text-emerald-400" : "text-emerald-600"
      : status === "failed"
        ? isDark ? "text-red-400" : "text-red-600"
        : isDark ? "text-amber-400" : "text-amber-600";

  const accentColor =
    status === "completed"
      ? "from-emerald-500 to-cyan-400"
      : status === "failed"
        ? "from-red-500 to-rose-400"
        : "from-amber-500 to-orange-400";

  const closeBg =
    status === "completed"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : status === "failed"
        ? "bg-red-600 hover:bg-red-700"
        : "bg-indigo-600 hover:bg-indigo-700";

  const valueText = isDark ? "text-slate-300" : "text-slate-700";
  const amountColor = isDark ? "text-indigo-400" : "text-indigo-600";

  const netValue = row.xendit_net_amount;

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Disbursement Receipt</DialogTitle>
          <DialogDescription>Disbursement #{row.id}</DialogDescription>
        </VisuallyHidden>

        <div className={`h-1 w-full bg-gradient-to-r ${accentColor}`} />

        <div className="px-5 pt-5 pb-6 space-y-5">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${statusRingClass}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Revenue Disbursement
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${amountColor}`}>
              ₱{amount}
            </p>
          </div>

          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          {/* Details */}
          <div
            className={`rounded-xl overflow-hidden border divide-y ${
              isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"
            }`}
          >
            <DetailRow label="Disbursement ID" isDark={isDark}>
              <span className={`text-xs font-mono font-medium ${valueText}`}>#{row.id}</span>
            </DetailRow>

            <DetailRow label="Timestamp" isDark={isDark}>
              <span className={`text-xs text-right font-medium ${valueText}`}>
                {row.created_at
                  ? new Date(row.created_at).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "—"}
              </span>
            </DetailRow>

            <DetailRow label="Status" isDark={isDark}>
              <span className={`text-xs font-bold capitalize ${statusTextColor}`}>{status}</span>
            </DetailRow>

            <DetailRow label="Account Name" isDark={isDark}>
              <span className={`text-xs font-bold text-right truncate max-w-[60%] ${valueText}`}>
                {row.account_holder_name || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Account No." isDark={isDark}>
              <span className={`text-xs font-mono font-semibold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                {row.account_number || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Channel" isDark={isDark}>
              <span className={`flex items-center justify-end gap-1.5 text-xs font-medium text-right max-w-[60%] ${valueText}`}>
                {isBdoChannel(row) && (
                  <img
                    src="/bdo.png"
                    alt="BDO"
                    className="h-4 w-auto max-w-[28px] object-contain shrink-0"
                  />
                )}
                <span className="truncate">{getChannelLabel(row)}</span>
              </span>
            </DetailRow>

            <DetailRow label="Xendit ID" isDark={isDark}>
              <span className={`text-[11px] font-mono font-medium text-right truncate max-w-[60%] ${valueText}`}>
                {row.xendit_disbursement_id || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Note" isDark={isDark}>
              <span className={`text-xs text-right max-w-[60%] truncate ${valueText}`}>
                {row.description || "—"}
              </span>
            </DetailRow>

            {status === "failed" && row.failure_reason && (
              <DetailRow label="Failure Reason" isDark={isDark}>
                <span className={`text-xs text-right max-w-[60%] ${isDark ? "text-red-400" : "text-red-600"}`}>
                  {row.failure_reason}
                </span>
              </DetailRow>
            )}

            <DetailRow label="Amount" isDark={isDark}>
              <span className={`text-xs font-mono font-bold ${isDark ? "text-slate-200" : "text-slate-900"}`}>
                ₱{amount}
              </span>
            </DetailRow>

            <DetailRow label="Fee" isDark={isDark}>
              <span className={`text-xs font-mono font-medium ${valueText}`}>
                {formatNullablePeso(row.xendit_fee_amount)}
              </span>
            </DetailRow>

            <DetailRow label="VAT" isDark={isDark}>
              <span className={`text-xs font-mono font-medium ${valueText}`}>
                {formatNullablePeso(row.xendit_vat_amount)}
              </span>
            </DetailRow>

            <DetailRow label="Net Amount" isDark={isDark}>
              <span className={`text-xs font-mono font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                {formatNullablePeso(netValue)}
              </span>
            </DetailRow>
          </div>

          {/* Footer total */}
          <div
            className={`border-t border-dashed pt-3 flex items-center justify-between ${
              isDark ? "border-slate-800" : "border-slate-200"
            }`}
          >
            <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Amount disbursed
            </span>
            <span className={`text-sm font-bold ${amountColor}`}>₱{amount}</span>
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

function DisbursementPage() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const adminName = user?.name || "System Administrator";

  // 🔒 ADMIN ACCESS:
  //  - canDisburse: true lang kapag tapos nang mag-load ang access info
  //    AT may permission (hindi view_only).
  //  - isViewOnly: true kapag loaded na at walang permission.
  const { canManage, loaded } = useAdminAccess();
  const canDisburse = loaded && canManage;
  const isViewOnly = loaded && !canManage;

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

  // ── receipt modal state (eye icon sa Actions column) ──
  const [viewDisbursement, setViewDisbursement] = useState<any | null>(null);

  // ── REAL disbursement history (list-disbursements) ──
  const [disbursementHistory, setDisbursementHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // ── AUTHORITATIVE disbursement preview (preview-disbursement): what the
  // NEXT disbursement will actually pay out (oldest-first, capped at
  // ₱50,000) and exactly which fare transactions it covers. ──
  const [disbursementPreview, setDisbursementPreview] = useState<{
    totalAvailable: number;
    batchAmount: number;
    batchIds: any[];
  }>({ totalAvailable: 0, batchAmount: 0, batchIds: [] });
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [disbursementPage, setDisbursementPage] = useState(1);
  const [disbursementStatusFilter, setDisbursementStatusFilter] =
    useState<DisbursementStatusFilterType>("All");

  // synchronous guard against double-submit
  const isSubmittingRef = useRef(false);
  // holds the setTimeout id for the post-success auto-close
  const autoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
    };
  }, []);

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

  const fetchDisbursementPreview = React.useCallback(async () => {
    setIsLoadingPreview(true);
    try {
      const functionsUrl = getSupabaseFunctionsUrl();
      const token = window.localStorage.getItem("termipay_auth_token");
      const res = await fetch(`${functionsUrl}/preview-disbursement`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        console.warn("Failed to fetch disbursement preview:", await res.text());
        return;
      }
      const data = await res.json();
      setDisbursementPreview({
        totalAvailable: typeof data?.total_available === "number" ? data.total_available : 0,
        batchAmount: typeof data?.batch_amount === "number" ? data.batch_amount : 0,
        batchIds: Array.isArray(data?.batch_ids) ? data.batch_ids : [],
      });
    } catch (err) {
      console.warn("Failed to fetch disbursement preview:", err);
    } finally {
      setIsLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    fetchDisbursementHistory();
    fetchDisbursementPreview();
  }, [fetchDisbursementHistory, fetchDisbursementPreview]);

  // keep history + preview fresh when transactions / disbursements change
  useRealtimeRefetch(["transactions", "disbursements"], () => {
    fetchDisbursementHistory();
    fetchDisbursementPreview();
  });

  // explicit fare-only transaction IDs, sent to the backend as an allowlist
  const fareTransactionIds = disbursementPreview.batchIds;
  // amount that will ACTUALLY go out on the NEXT disbursement run
  const disburseAmount = disbursementPreview.batchAmount;
  // what's left in the fare queue AFTER this batch
  const remainingFareBalance = Math.max(0, disbursementPreview.totalAvailable - disbursementPreview.batchAmount);

  const disburseButtonTitle = isViewOnly
    ? "View only — you don't have permission to disburse."
    : undefined;

  const openDisburseModal = () => {
    // 🔒 Guard: bawal buksan ang disburse modal kapag view_only
    if (!canDisburse) return;

    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    setDisburseChannelOpen(false);
    setDisburseError(null);
    setDisburseSuccess(null);
    setDisburseModalOpen(true);
    // pull the freshest "available to disburse" numbers as the modal opens
    fetchDisbursementPreview();
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

  const handleAccountNumberChange = (rawValue: string) => {
    setDisburseForm((prev) => ({ ...prev, account_number: sanitizeAccountNumber(rawValue) }));
  };

  const handleSubmitDisbursement = async () => {
    // 🔒 Guard: bawal mag-disburse kapag view_only (kahit ma-bypass ang UI).
    if (!canDisburse) {
      setDisburseError("View only access — wala kang permission na mag-disburse.");
      return;
    }

    // synchronous double-submit guard — checked and set BEFORE any await
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setDisburseError(null);

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
    if (!/^\d{1,12}$/.test(disburseForm.account_number.trim())) {
      setDisburseError("Ang account/mobile number ay dapat mga numero lang, hanggang 12 digits.");
      isSubmittingRef.current = false;
      return;
    }
    if (fareTransactionIds.length === 0) {
      setDisburseError("Walang fare transaction (hindi top-up) na available na i-disburse sa ngayon.");
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
          // no date_start/date_end — the backend scans ALL unlinked fare
          // transactions regardless of when they happened.
          // explicit fare-only enforcement; the backend MUST use these.
          transaction_type: "fare",
          exclude_transaction_types: NON_FARE_MARKERS,
          fare_transaction_ids: fareTransactionIds,
          channel_code: disburseForm.bank_code,
          bank_code: disburseForm.bank_code,
          account_holder_name: disburseForm.account_holder_name.trim(),
          account_number: disburseForm.account_number.trim(),
          description: disburseForm.description.trim() || "Fare revenue disbursement",
          requested_by: adminName,
          idempotency_key: DISBURSE_IDEMPOTENCY_KEY,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 409 = no un-disbursed FARE transactions, or the available total
        // hasn't reached the ₱50,000 minimum yet — the message explains which.
        if (res.status === 409) {
          throw new Error(data?.error || "Hindi pa maisasagawa ang disbursement sa ngayon.");
        }
        throw new Error(data?.error || "Nabigo ang disbursement request.");
      }

      const sentAmount = data?.disbursement?.amount ?? disburseAmount;
      const recipientName = disburseForm.account_holder_name.trim();
      setDisburseSuccess(
        `Naipadala na ang ${formatPeso(sentAmount)} (mula sa bagong/hindi pa na-disburse na FARE transactions lamang) — pending pa ang confirmation mula sa Xendit.`
      );
      setDisburseForm({ bank_code: "", account_holder_name: "", account_number: "", description: "" });

      logAudit({
        entity: "Disbursement",
        format: "Xendit",
        details: `${adminName} triggered a disbursement of ${formatPeso(sentAmount)} (fare-only) to ${recipientName}`,
      });

      // refresh everything that just changed
      fetchDisbursementHistory();
      fetchDisbursementPreview();

      // auto-close the modal after a short delay so the admin can read the
      // success message (isDisbursing is already false by then).
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

  // ── counts per status, off the FULL history ──
  const disbursementStatusCounts = useMemo(() => {
    const counts = { All: disbursementHistory.length, Pending: 0, Completed: 0, Failed: 0 };
    for (const row of disbursementHistory) {
      const s = (row.status || "").toString().toUpperCase();
      if (s === "PENDING") counts.Pending += 1;
      else if (s === "COMPLETED") counts.Completed += 1;
      else if (s === "FAILED") counts.Failed += 1;
    }
    return counts;
  }, [disbursementHistory]);

  const filteredDisbursementHistory = useMemo(() => {
    if (disbursementStatusFilter === "All") return disbursementHistory;
    return disbursementHistory.filter(
      (row: any) => (row.status || "").toString().toUpperCase() === disbursementStatusFilter.toUpperCase()
    );
  }, [disbursementHistory, disbursementStatusFilter]);

  useEffect(() => {
    setDisbursementPage(1);
  }, [disbursementStatusFilter]);

  const disbursementTotalPages = Math.max(1, Math.ceil(filteredDisbursementHistory.length / DISBURSEMENTS_PER_PAGE));
  const disbursementPageClamped = Math.min(disbursementPage, disbursementTotalPages);

  const paginatedDisbursements = useMemo(() => {
    const start = (disbursementPageClamped - 1) * DISBURSEMENTS_PER_PAGE;
    return filteredDisbursementHistory.slice(start, start + DISBURSEMENTS_PER_PAGE);
  }, [filteredDisbursementHistory, disbursementPageClamped]);

  const goToPrevDisbursementPage = () => setDisbursementPage((p) => Math.max(1, p - 1));
  const goToNextDisbursementPage = () => setDisbursementPage((p) => Math.min(disbursementTotalPages, p + 1));

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
      {/* ══ HEADER + DISBURSE BUTTON ══ */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <Wallet className="text-indigo-500" size={26} />
            Disbursement
          </h2>
          <p className={`text-sm mt-1 flex items-center flex-wrap gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <span>Send collected revenue to a bank or e-wallet via</span>
            <img src="/xendit.png" alt="Xendit" className="h-4 w-auto max-w-[70px] object-contain inline-block align-middle" />
            <span>, and review past payouts.</span>
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* 🔒 View-only notice */}
          {isViewOnly && (
            <span className={`text-[11px] font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>
              View only — disbursing is disabled for your account.
            </span>
          )}

          {/* 🔒 Disburse button — NAKA-GREY OUT (disabled) kapag view_only,
              hindi tinatanggal sa screen. */}
          <Button
            onClick={openDisburseModal}
            disabled={!canDisburse}
            className={`text-xs font-semibold h-9 px-6 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-100 ${
              canDisburse
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
      </div>

      {/* ══ DISBURSEMENT HISTORY — REAL data straight from the disbursements table ══ */}
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
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={disbursementStatusFilter}
                onValueChange={(v) => setDisbursementStatusFilter(v as DisbursementStatusFilterType)}
              >
                <SelectTrigger
                  data-testid="select-disbursement-status-filter"
                  className={`h-8 w-[150px] text-[11px] font-semibold cursor-pointer ${
                    isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {disbursementStatusFilter !== "All" && (
                      <span className={`w-2 h-2 rounded-full inline-block ${getDisbursementStatusDotColor(disbursementStatusFilter)}`} />
                    )}
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
                  {DISBURSEMENT_STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s} className="cursor-pointer">
                      <span className="flex items-center gap-2">
                        {s !== "All" && (
                          <span className={`w-2 h-2 rounded-full inline-block ${getDisbursementStatusDotColor(s)}`} />
                        )}
                        {s}
                        <span className={isDark ? "text-slate-500" : "text-slate-400"}>
                          ({disbursementStatusCounts[s]})
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

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
          ) : filteredDisbursementHistory.length === 0 ? (
            <div className={`py-10 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Walang disbursement na may status na "{disbursementStatusFilter}".
            </div>
          ) : (
            <Table>
              <TableHeader className={isDark ? "bg-slate-900" : "bg-white"}>
                <TableRow className={`hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Date</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Account</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Channel</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Xendit ID</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                  <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Fee</TableHead>
                  <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>VAT</TableHead>
                  <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Net Amount</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Amount</TableHead>
                  <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
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
                    {/* 👁 Actions — buksan ang receipt */}
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 cursor-pointer text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => setViewDisbursement(row)}
                        title="View receipt"
                        data-testid={`button-view-disbursement-${row.id}`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* ── Previous / Next pagination controls ── */}
          {filteredDisbursementHistory.length > DISBURSEMENTS_PER_PAGE && (
            <div className={`flex items-center justify-between pt-4 mt-2 border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Page {disbursementPageClamped} of {disbursementTotalPages} · {filteredDisbursementHistory.length} total
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

      {/* ══ DISBURSEMENT RECEIPT MODAL (same design as Transaction Logs receipt) ══ */}
      <DisbursementReceiptModal
        row={viewDisbursement}
        onClose={() => setViewDisbursement(null)}
        isDark={isDark}
      />

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
                <span className={isDark ? "text-indigo-300" : "text-indigo-700"}>Available to Disburse</span>
                <span className={`font-bold ${isDark ? "text-indigo-300" : "text-indigo-700"}`}>
                  {isLoadingPreview ? <Loader2 size={14} className="animate-spin inline-block" /> : formatPeso(disburseAmount)}
                </span>
              </div>
              {/* what's left in the fare queue AFTER this batch — only shown
                  when there actually is a remainder */}
              {remainingFareBalance > 0 && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-md border text-xs ${isDark ? "bg-slate-800/60 border-slate-700" : "bg-slate-50 border-slate-200"}`}>
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>Remaining fare balance (next disbursement)</span>
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{formatPeso(remainingFareBalance)}</span>
                </div>
              )}
              <p className={`text-[11px] -mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Only fare transactions are included here — top-ups, cash-ins, and loads are automatically excluded, and
                anything already disbursed is not counted again. Disbursements aren't tied to any date — any unlinked fare
                transaction is eligible, whenever it happened.
              </p>
              <p className={`text-[11px] -mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                A disbursement only goes through once at least ₱{MIN_DISBURSEMENT_AMOUNT.toLocaleString("en-US")} is
                available, and each one pays out up to ₱{MIN_DISBURSEMENT_AMOUNT.toLocaleString("en-US")} at a time
                (oldest transactions first) — any excess rolls into the next disbursement.
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
                  placeholder="Fare revenue disbursement"
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

              {/* 🔒 Confirm button — naka-grey out din kapag view_only (extra
                  proteksyon, kahit paano pa nabuksan ang modal) */}
              <Button
                onClick={handleSubmitDisbursement}
                disabled={isDisbursing || !canDisburse}
                data-testid="button-confirm-disburse"
                title={isViewOnly ? "View only — you don't have permission to disburse." : undefined}
                className={`text-white text-xs font-semibold px-4 h-9 disabled:cursor-not-allowed ${
                  canDisburse
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

export default DisbursementPage;
export { DisbursementPage };
export { DisbursementPage as Disbursement };