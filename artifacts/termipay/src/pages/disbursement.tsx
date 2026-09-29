import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { Wallet, History, RefreshCw } from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Disbursement History table is paginated client-side at this many rows per page
const DISBURSEMENTS_PER_PAGE = 10;

// ── Status filter options for the Disbursement History table ──
const DISBURSEMENT_STATUS_FILTERS = ["All", "Pending", "Completed", "Failed"] as const;

// Named alias (avoids the build mis-stripping the inline typeof expression)
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

// normalizes the Supabase Functions base URL
function getSupabaseFunctionsUrl(): string {
  const explicit = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!supabaseUrl) return "";
  return supabaseUrl.replace(".supabase.co", ".functions.supabase.co");
}

// bank/e-wallet channels — keep in sync with the Reports page's Disbursement tab
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

function DisbursementPage() {
  const { isDark } = useTheme();

  // ── REAL disbursement history — fetched straight from the DB via the
  // list-disbursements function. ──
  const [disbursementHistory, setDisbursementHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [disbursementPage, setDisbursementPage] = useState(1);
  const [disbursementStatusFilter, setDisbursementStatusFilter] =
    useState<DisbursementStatusFilterType>("All");

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

  // keep the history fresh when transactions / disbursements change
  useRealtimeRefetch(["transactions", "disbursements"], () => {
    fetchDisbursementHistory();
  });

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
      {/* ══ HEADER ══ */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <Wallet className="text-indigo-500" size={26} />
            Disbursement
          </h2>
          <p className={`text-sm mt-1 flex items-center flex-wrap gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <span>Past payouts sent via</span>
            <img src="/xendit.png" alt="Xendit" className="h-4 w-auto max-w-[70px] object-contain inline-block align-middle" />
            <span>. To disburse, go to Reports → Disbursement tab.</span>
          </p>
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
    </div>
  );
}

export default DisbursementPage;
export { DisbursementPage };
export { DisbursementPage as Disbursement };