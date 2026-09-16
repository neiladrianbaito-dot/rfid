import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGetReportSummary, useListTransactions, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { supabase } from "@/lib/supabase";
import {
  Eye,
  TrendingUp,
  User,
  BarChart3,
  Activity,
  PieChart,
  FileText,
  FileSpreadsheet,
  LinkIcon,
  PhilippinePeso,
  Filter,
  RotateCcw,
} from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

function getLocalDateString(): string {
  return new Date().toLocaleDateString("en-CA");
}

// shared helper to normalize the API base URL for direct fetch() calls
function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// fire-and-forget audit log call for exports
async function logExportAudit(params: { entity: string; format: string; details: string }) {
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
    console.warn("Failed to write export audit log (ignoring):", err);
  }
}

// ── transaction type / transfer status normalizers (same rules used on the
// Transactions page, kept in sync so the Excel export splits records into
// Fare / Top-up exactly the same way the UI tabs do) ──
type TxType = "Fare" | "Top-up";

function normalizeTxType(type?: string | null): TxType {
  const key = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "fare") return "Fare";
  return "Top-up";
}

type TransferStatus = "pending" | "completed" | "failed";

function normalizeTransferStatus(status?: string | null): TransferStatus {
  const key = (status ?? "").toLowerCase().trim();
  if (key === "completed" || key === "complete" || key === "success") return "completed";
  if (key === "failed" || key === "failure" || key === "error") return "failed";
  return "pending";
}

function cardUidOf(card?: { card_uid?: string | null; cardUid?: string | null } | null): string {
  return card?.card_uid || card?.cardUid || "—";
}

function fullNameOf(card?: { full_name?: string | null; fullName?: string | null } | null): string {
  return card?.full_name || card?.fullName || "Unknown";
}

// ── date-filter helpers ──
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

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => {
  const val = String(i + 1).padStart(2, "0");
  return { value: val, label: String(i + 1) };
});

// Splits a "YYYY-MM-DD" (or ISO) date string into { year, month, day } parts.
function splitDateString(dateStr: string): { year: string; month: string; day: string } | null {
  if (!dateStr) return null;
  const datePart = dateStr.split("T")[0];
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

// Extracts { year, month, day } from a record's timestamp field. Works for
// both transactions (timestamp/created_at) and transfers (created_at).
function getTxDateParts(tx: any): { year: string; month: string; day: string } | null {
  const ts = tx.timestamp || tx.created_at;
  if (!ts) return null;
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return null;
  return {
    year: String(dt.getFullYear()),
    month: String(dt.getMonth() + 1).padStart(2, "0"),
    day: String(dt.getDate()).padStart(2, "0"),
  };
}

// Returns the transaction's local "YYYY-MM-DD" date key (used to aggregate
// per-day totals directly from the full transaction list, instead of relying
// on report.dailyBreakdown, which only ever contains a short recent window).
function getTxDateKey(tx: any): string | null {
  const ts = tx.timestamp || tx.created_at;
  if (!ts) return null;
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
}

// ── builds the FULL list of "YYYY-MM-DD" date keys implied by the active
// filter combo, so the chart/table always render a complete calendar
// range (e.g. Year=2026 -> Jan 1 through Dec 31, 2026) instead of only the
// days that happen to have a transaction. Missing days get filled with
// ₱0 revenue by the caller. Returns null when there isn't a year selected,
// since a complete range can't be anchored without one. ──
function generateDateRange(filterYear: string, filterMonth: string, filterDay: string): string[] | null {
  if (filterYear === "all") return null;
  const year = parseInt(filterYear, 10);
  if (isNaN(year)) return null;

  // Year only -> Jan 1 to Dec 31 of that year
  if (filterMonth === "all") {
    const dates: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const daysInMonth = new Date(year, m, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        dates.push(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }
    }
    return dates;
  }

  const month = parseInt(filterMonth, 10);

  // Year + Month -> every day in that month
  if (filterDay === "all") {
    const dates: string[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`${year}-${filterMonth}-${String(d).padStart(2, "0")}`);
    }
    return dates;
  }

  // Year + Month + Day -> the single day
  return [`${year}-${filterMonth}-${filterDay}`];
}

// ── shared Excel styling helpers (used by every sheet the export builds) ──
const THIN_BORDER = {
  top: { style: "thin", color: { rgb: "CBD5E1" } },
  bottom: { style: "thin", color: { rgb: "CBD5E1" } },
  left: { style: "thin", color: { rgb: "CBD5E1" } },
  right: { style: "thin", color: { rgb: "CBD5E1" } },
};
const MEDIUM_BORDER = {
  top: { style: "medium", color: { rgb: "0F172A" } },
  bottom: { style: "medium", color: { rgb: "0F172A" } },
  left: { style: "thin", color: { rgb: "334155" } },
  right: { style: "thin", color: { rgb: "334155" } },
};
const HAIR_BORDER = {
  top: { style: "hair", color: { rgb: "E2E8F0" } },
  bottom: { style: "hair", color: { rgb: "E2E8F0" } },
  left: { style: "hair", color: { rgb: "E2E8F0" } },
  right: { style: "hair", color: { rgb: "E2E8F0" } },
};

type SheetColumn = {
  header: string;
  width: number;
  get: (row: any, idx: number) => string;
};

function colLetter(c: number): string {
  return String.fromCharCode("A".charCodeAt(0) + c);
}

type SheetBlock = {
  title: string;
  bandColor: string;
  columns: SheetColumn[];
  rows: any[];
  statusColIndex?: number;
  statusColorFor?: (status: string) => { font: string; fill: string };
};

// ── Single-sheet, SIDE-BY-SIDE (row format) builder ─────────────────────
// Fare, Top-up, and Transfers sit next to each other in the SAME row band —
// each block gets its own column range (e.g. Fare = A:F, Top-up = H:M,
// Transfers = O:V) — instead of being stacked on top of one another. A
// shared banner spans the full width above all three blocks.
function buildRowFormatSheet(
  utils: any,
  opts: {
    generatedAt: string;
    adminName: string;
    blocks: SheetBlock[];
  }
) {
  const GAP = 1; // blank column between blocks
  const offsets: number[] = [];
  let cursor = 0;
  opts.blocks.forEach((b, i) => {
    offsets.push(cursor);
    cursor += b.columns.length;
    if (i < opts.blocks.length - 1) cursor += GAP;
  });
  const totalCols = cursor;

  const HEADER_ROWS = 6; // 0:title 1:subtitle 2:meta 3:blank 4:band 5:column headers
  const dataRowsCount = Math.max(1, ...opts.blocks.map((b) => b.rows.length));
  const totalRows = HEADER_ROWS + dataRowsCount;

  const grid: any[][] = Array.from({ length: totalRows }, () => Array(totalCols).fill(""));
  const styles: { ref: string; style: any }[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const rowHeights: number[] = Array(totalRows).fill(18);
  rowHeights[0] = 34;
  rowHeights[1] = 22;
  rowHeights[2] = 16;
  rowHeights[3] = 8;
  rowHeights[4] = 24;
  rowHeights[5] = 22;

  const setStyle = (r: number, c: number, style: any) => {
    styles.push({ ref: `${colLetter(c)}${r + 1}`, style });
  };

  // ── shared banner across the full width ──
  grid[0][0] = "Fare Collection System";
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
  setStyle(0, 0, {
    font: { bold: true, sz: 16, color: { rgb: "FFFFFF" }, name: "Calibri" },
    fill: { fgColor: { rgb: "0F172A" }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  });

  grid[1][0] = "Transaction Logs Export — Fare, Top-up & Transfers (row format)";
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });
  setStyle(1, 0, {
    font: { bold: true, sz: 11, color: { rgb: "FFFFFF" }, name: "Calibri" },
    fill: { fgColor: { rgb: "1E40AF" }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  });

  grid[2][0] = `Generated: ${opts.generatedAt}    |    Prepared by: ${opts.adminName}`;
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } });
  setStyle(2, 0, {
    font: { italic: true, sz: 10, color: { rgb: "475569" }, name: "Calibri" },
    fill: { fgColor: { rgb: "F1F5F9" }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  });

  // ── each block, placed side by side starting at its own column offset ──
  opts.blocks.forEach((b, bi) => {
    const offset = offsets[bi];
    const colCount = b.columns.length;

    // band title (row 4)
    grid[4][offset] = b.title;
    merges.push({ s: { r: 4, c: offset }, e: { r: 4, c: offset + colCount - 1 } });
    setStyle(4, offset, {
      font: { bold: true, sz: 11, color: { rgb: "FFFFFF" }, name: "Calibri" },
      fill: { fgColor: { rgb: b.bandColor }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    });

    // column headers (row 5)
    b.columns.forEach((c, ci) => {
      grid[5][offset + ci] = c.header;
      setStyle(5, offset + ci, {
        font: { bold: true, sz: 10, color: { rgb: "FFFFFF" }, name: "Calibri" },
        fill: { fgColor: { rgb: "1E3A5F" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
        border: MEDIUM_BORDER,
      });
    });

    if (b.rows.length === 0) {
      grid[HEADER_ROWS][offset] = "No records for this filter.";
      merges.push({ s: { r: HEADER_ROWS, c: offset }, e: { r: HEADER_ROWS, c: offset + colCount - 1 } });
      setStyle(HEADER_ROWS, offset, {
        font: { italic: true, sz: 10, color: { rgb: "94A3B8" }, name: "Calibri" },
        fill: { fgColor: { rgb: "F8FAFC" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
      });
      return;
    }

    b.rows.forEach((row, i) => {
      const r = HEADER_ROWS + i;
      const isEven = i % 2 === 0;
      const baseFill = isEven ? "FFFFFF" : "F8FAFC";
      b.columns.forEach((c, ci) => {
        const val = c.get(row, i);
        grid[r][offset + ci] = val;
        let style: any = {
          font: { sz: 10, color: { rgb: "1E293B" }, name: "Calibri" },
          fill: { fgColor: { rgb: baseFill }, patternType: "solid" },
          alignment: { horizontal: "left", vertical: "center" },
          border: HAIR_BORDER,
        };
        if (b.statusColIndex !== undefined && ci === b.statusColIndex && b.statusColorFor) {
          const sc = b.statusColorFor(String(val || ""));
          style = {
            ...style,
            font: { ...style.font, bold: true, color: { rgb: sc.font } },
            fill: { fgColor: { rgb: sc.fill }, patternType: "solid" },
            alignment: { horizontal: "center", vertical: "center" },
          };
        }
        setStyle(r, offset + ci, style);
      });
    });
  });

  const worksheet = utils.aoa_to_sheet(grid);

  const widths = Array(totalCols).fill(3); // gap columns default narrow
  opts.blocks.forEach((b, bi) => {
    const offset = offsets[bi];
    b.columns.forEach((c, ci) => (widths[offset + ci] = c.width));
  });
  worksheet["!cols"] = widths.map((w) => ({ wch: w }));
  worksheet["!merges"] = merges;
  worksheet["!rows"] = rowHeights.map((hpt) => ({ hpt }));
  styles.forEach(({ ref, style }) => {
    if (!worksheet[ref]) worksheet[ref] = { t: "z", v: "" };
    worksheet[ref].s = style;
  });

  return worksheet;
}

export default function ReportsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const adminName = user?.name || "System Administrator";

  const prevRevenueRef = useRef<number | null>(null);
  const [revenueFlash, setRevenueFlash] = useState(false);

  // ── filter state ──
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterDay, setFilterDay] = useState<string>("all");

  const { data: report, isLoading, refetch: refetchReport } = useGetReportSummary({
    query: {
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });
  const { data: transactions, refetch: refetchTransactions } = useListTransactions();
  const { data: users, refetch: refetchUsers } = useListUsers();

  // ── card balance transfers (needed for the "Transfers" export tab). Not
  // exposed anywhere else on this page — fetched the same way the
  // Transactions page does, joined with the source/target `users` rows. ──
  const [transfers, setTransfers] = useState<any[]>([]);

  useEffect(() => {
    const loadTransfers = async () => {
      const { data, error } = await supabase
        .from("card_balance_transfers")
        .select(`
          id, source_card_id, target_card_id, amount, reason,
          source_balance_before, target_balance_before, status,
          created_at, completed_at,
          source:users!card_balance_transfers_source_card_id_fkey(id, card_uid, full_name),
          target:users!card_balance_transfers_target_card_id_fkey(id, card_uid, full_name)
        `)
        .order("created_at", { ascending: false });
      if (!error && data) setTransfers(data as any[]);
    };
    loadTransfers();

    const channel = supabase
      .channel("reports_card_balance_transfers")
      .on("postgres_changes", { event: "*", schema: "public", table: "card_balance_transfers" }, loadTransfers)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useRealtimeRefetch(["transactions", "fare_routes", "users"], () => {
    refetchReport();
    refetchTransactions();
    refetchUsers();
  });

  useEffect(() => {
    if (!report) return;
    const breakdown = report?.dailyBreakdown || [];
    const today = getLocalDateString();
    const todayRow = breakdown.find((d: any) => d.date === today);
    const current = Math.abs(Number(todayRow?.revenue) || 0);
    if (prevRevenueRef.current !== null && current !== prevRevenueRef.current) {
      setRevenueFlash(true);
      setTimeout(() => setRevenueFlash(false), 800);
    }
    prevRevenueRef.current = current;
  }, [report]);

  const txList = React.useMemo(() => (Array.isArray(transactions) ? transactions : []), [transactions]);
  const userList = React.useMemo(() => (Array.isArray(users) ? users : []), [users]);

  const totalUniqueTaps = React.useMemo(() => {
    const uids = new Set(
      txList.map((tx: any) => tx.card_uid || tx.cardUid).filter(Boolean)
    );
    return uids.size;
  }, [txList]);

  const totalLinkedCards = React.useMemo(() => {
    return userList.filter((u: any) => normalizeEmail(u.email) !== null).length;
  }, [userList]);

  const todayRevenue = (() => {
    const breakdown = report?.dailyBreakdown || [];
    if (!breakdown.length) return 0;
    const today = getLocalDateString();
    const todayRow = breakdown.find((d: any) => d.date === today);
    if (!todayRow) return 0;
    return Math.abs(Number(todayRow.revenue) || 0);
  })();

  const totalRevenue7Days = Math.abs(Number(report?.totalRevenue7Days ?? 0));

  // Report's own short-window breakdown — used ONLY as the default (no
  // filter active) view, matching the original behavior.
  const sanitizedBreakdown = React.useMemo(
    () =>
      (report?.dailyBreakdown || []).map((d: any) => ({
        ...d,
        revenue: Math.abs(Number(d.revenue) || 0),
      })),
    [report]
  );

  // ── aggregate per-day revenue directly from the FULL transaction
  // list. report.dailyBreakdown only ever covers a short recent window,
  // so this gives the filter a complete dataset to search across. ──
  const aggregatedBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    txList.forEach((tx: any) => {
      const dateKey = getTxDateKey(tx);
      if (!dateKey) return;
      const amount = Math.abs(Number(tx.amount) || 0);
      map.set(dateKey, (map.get(dateKey) || 0) + amount);
    });
    return Array.from(map.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [txList]);

  // Quick lookup used when filling in the complete calendar range below.
  const revenueByDate = React.useMemo(() => {
    return new Map(aggregatedBreakdown.map((d: any) => [d.date, d.revenue]));
  }, [aggregatedBreakdown]);

  // ── derive available years straight from transactions (the full
  // dataset), so the Year dropdown reflects everything that actually
  // has records, not just the last 7 days ──
  const availableYears = React.useMemo(() => {
    const years = new Set<string>();
    txList.forEach((tx: any) => {
      const parts = getTxDateParts(tx);
      if (parts) years.add(parts.year);
    });
    sanitizedBreakdown.forEach((d: any) => {
      const parts = splitDateString(d.date);
      if (parts) years.add(parts.year);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [txList, sanitizedBreakdown]);

  const isFilterActive = filterYear !== "all" || filterMonth !== "all" || filterDay !== "all";

  const resetFilters = () => {
    setFilterYear("all");
    setFilterMonth("all");
    setFilterDay("all");
  };

  const handleYearChange = (value: string) => setFilterYear(value);
  const handleMonthChange = (value: string) => setFilterMonth(value);
  const handleDayChange = (value: string) => setFilterDay(value);

  // ── the actual source used for chart + table: full aggregated data
  // when a filter is active, otherwise report's short window ──
  const baseBreakdown = isFilterActive ? aggregatedBreakdown : sanitizedBreakdown;

  // ── FIXED: whenever a Year is selected, always render the COMPLETE
  // calendar range implied by the filter (Year alone -> Jan 1–Dec 31;
  // Year+Month -> every day of that month), filling in ₱0 for days that
  // have no transactions, instead of only showing days that happen to
  // have data. Falls back to the old "filter existing rows" behavior
  // when no Year is picked (e.g. Month-only or Day-only filters), since
  // there's no year to anchor a full range to. ──
  const filteredBreakdown = React.useMemo(() => {
    if (!isFilterActive) return baseBreakdown;

    const fullRange = generateDateRange(filterYear, filterMonth, filterDay);
    if (fullRange) {
      return fullRange.map((date) => ({
        date,
        revenue: revenueByDate.get(date) || 0,
      }));
    }

    // No year selected (Month and/or Day only, across all years) — keep
    // the previous "only show days that exist" behavior.
    return baseBreakdown.filter((d: any) => {
      const parts = splitDateString(d.date);
      if (!parts) return false;
      if (filterMonth !== "all" && parts.month !== filterMonth) return false;
      if (filterDay !== "all" && parts.day !== filterDay) return false;
      return true;
    });
  }, [baseBreakdown, filterYear, filterMonth, filterDay, isFilterActive, revenueByDate]);

  // ── filtered transactions (drives the Fare / Top-up export tabs) —
  // unaffected by the calendar fill-in above, since exports should only
  // ever list actual transaction records, not empty calendar days. ──
  const filteredTxList = React.useMemo(() => {
    if (!isFilterActive) return txList;
    return txList.filter((tx: any) => {
      const parts = getTxDateParts(tx);
      if (!parts) return false;
      if (filterYear !== "all" && parts.year !== filterYear) return false;
      if (filterMonth !== "all" && parts.month !== filterMonth) return false;
      if (filterDay !== "all" && parts.day !== filterDay) return false;
      return true;
    });
  }, [txList, filterYear, filterMonth, filterDay, isFilterActive]);

  // Split the filtered transaction list into Fare / Top-up, same rule the
  // Transactions page tabs use.
  const filteredFareList = React.useMemo(
    () => filteredTxList.filter((tx: any) => normalizeTxType(tx.type) === "Fare"),
    [filteredTxList]
  );
  const filteredTopupList = React.useMemo(
    () => filteredTxList.filter((tx: any) => normalizeTxType(tx.type) === "Top-up"),
    [filteredTxList]
  );

  // ── filtered transfers, same date-filter rule as transactions above,
  // driving the "Transfers" export tab. ──
  const filteredTransfersList = React.useMemo(() => {
    if (!isFilterActive) return transfers;
    return transfers.filter((t: any) => {
      const parts = getTxDateParts(t);
      if (!parts) return false;
      if (filterYear !== "all" && parts.year !== filterYear) return false;
      if (filterMonth !== "all" && parts.month !== filterMonth) return false;
      if (filterDay !== "all" && parts.day !== filterDay) return false;
      return true;
    });
  }, [transfers, filterYear, filterMonth, filterDay, isFilterActive]);

  const filteredRevenueTotal = React.useMemo(
    () => filteredBreakdown.reduce((sum: number, d: any) => sum + (Number(d.revenue) || 0), 0),
    [filteredBreakdown]
  );

  // Human-readable label for the currently active filter, e.g. "September 2026"
  const filterLabel = React.useMemo(() => {
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

  const handleOpenPreview = () => {
    navigate("/reports/preview");
  };

  // ── EXPORT: single sheet, no tabs. Fare, Top-up, and Transfers are
  // stacked one after another in the SAME worksheet, each as its own
  // colored section with its own column headers. ──
  const handleExportExcelLogs = async () => {
    const XLSXStyle = await import("xlsx-js-style" as any);
    const { utils, writeFile } = XLSXStyle;

    const stamp = getLocalDateString();
    const generatedAt = new Date().toLocaleString("en-PH", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

    const filenameSuffix = isFilterActive
      ? `-${[filterYear !== "all" ? filterYear : null, filterMonth !== "all" ? filterMonth : null, filterDay !== "all" ? filterDay : null]
          .filter(Boolean)
          .join("-")}`
      : "";

    logExportAudit({
      entity: "Transaction Logs",
      format: "Excel",
      details: `${adminName} exported transaction logs as Excel (transaction-logs${filenameSuffix}-${stamp}.xlsx) — combined Fare/Top-up/Transfers sheet${
        isFilterActive ? ` [Filtered: ${filterLabel}]` : ""
      }`,
    });

    // ── shared status colors ──
    const statusColorFor = (status: string) => {
      const key = (status || "").toLowerCase();
      const map: Record<string, { font: string; fill: string }> = {
        success: { font: "166534", fill: "DCFCE7" },
        completed: { font: "166534", fill: "DCFCE7" },
        failed: { font: "991B1B", fill: "FEE2E2" },
        error: { font: "991B1B", fill: "FEE2E2" },
        pending: { font: "92400E", fill: "FEF3C7" },
      };
      return map[key] || { font: "1E293B", fill: "F8FAFC" };
    };

    const txColumns = (signPrefix: string): SheetColumn[] => [
      { header: "Timestamp", width: 26, get: (tx) => {
        const ts = tx.timestamp || tx.created_at;
        return ts ? new Date(ts).toLocaleString("en-PH") : "";
      }},
      { header: "Card UID", width: 18, get: (tx) => tx.card_uid || tx.cardUid || "" },
      { header: "Full Name", width: 24, get: (tx) => tx.full_name || tx.fullName || "" },
      { header: "Amount (PHP)", width: 18, get: (tx) =>
        Math.abs(Number(tx.amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      { header: "Signed Amount", width: 16, get: (tx) =>
        `${signPrefix}${Math.abs(Number(tx.amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      },
      { header: "Status", width: 14, get: (tx) => tx.status || "" },
    ];

    const transferColumns: SheetColumn[] = [
      { header: "Timestamp", width: 26, get: (t) => new Date(t.created_at).toLocaleString("en-PH") },
      { header: "From (Card UID)", width: 18, get: (t) => cardUidOf(t.source) },
      { header: "From Name", width: 22, get: (t) => fullNameOf(t.source) },
      { header: "To (Card UID)", width: 18, get: (t) => cardUidOf(t.target) },
      { header: "To Name", width: 22, get: (t) => fullNameOf(t.target) },
      { header: "Amount (PHP)", width: 16, get: (t) =>
        Math.abs(Number(t.amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      { header: "Reason", width: 24, get: (t) => t.reason || "" },
      { header: "Status", width: 14, get: (t) => {
        const s = normalizeTransferStatus(t.status);
        return s.charAt(0).toUpperCase() + s.slice(1);
      }},
    ];

    const sumAmounts = (list: any[]) =>
      list.reduce((s, tx) => s + Math.abs(Number(tx.amount) || 0), 0);

    const worksheet = buildRowFormatSheet(utils, {
      generatedAt,
      adminName,
      blocks: [
        {
          title: `FARE — DEDUCTION LOGS (${filteredFareList.length})`,
          bandColor: "B91C1C",
          columns: txColumns("−"),
          rows: filteredFareList,
          statusColIndex: 5,
          statusColorFor,
        },
        {
          title: `TOP-UP — BALANCE LOGS (${filteredTopupList.length})`,
          bandColor: "047857",
          columns: txColumns("+"),
          rows: filteredTopupList,
          statusColIndex: 5,
          statusColorFor,
        },
        {
          title: `TRANSFERS — CARD BALANCE (${filteredTransfersList.length})`,
          bandColor: "1D4ED8",
          columns: transferColumns,
          rows: filteredTransfersList,
          statusColIndex: 7,
          statusColorFor,
        },
      ],
    });

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Transaction Logs");
    workbook.Props = {
      Title: "Transaction Logs",
      Subject: "Fare Collection Transaction Export",
      Author: adminName,
      CreatedDate: new Date(),
    };

    writeFile(workbook, `transaction-logs${filenameSuffix}-${stamp}.xlsx`);
  };

  return (
    <div
      className={`space-y-8 h-full flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`}
      style={{ overflowX: "hidden", maxWidth: "100%", boxSizing: "border-box" }}
      data-testid="reports-page"
    >
      <style>{`
        html, body { overflow-x: hidden !important; }
        @keyframes card-pulse {
          0%   { box-shadow: 0 0 0 rgba(16,185,129,0); }
          50%  { box-shadow: 0 0 0 4px rgba(16,185,129,0.15); }
          100% { box-shadow: 0 0 0 rgba(16,185,129,0); }
        }
        .card-pulse { animation: card-pulse 0.8s ease-in-out; }
      `}</style>

      {/* ══ HEADER ══ */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <BarChart3 className="text-blue-500" size={26} />
            Revenue Report
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Strategic financial intelligence and 7-day performance metrics
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`hidden lg:flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
            <Activity className="text-blue-500" size={16} />
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>
              Real-time Stream Active
            </span>
          </div>
          <Button
            onClick={handleExportExcelLogs}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-6 cursor-pointer transition-colors duration-150 shadow-sm"
            data-testid="button-export-excel-logs"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export Excel Logs
          </Button>
          <Button
            onClick={handleOpenPreview}
            className={`font-semibold text-xs px-6 cursor-pointer transition-colors duration-150 shadow-sm border ${
              isDark
                ? "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white border-blue-600"
                : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white border-blue-600"
            }`}
            data-testid="button-preview-report"
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview Report
          </Button>
        </div>
      </div>

      {/* ══ SUMMARY CARDS ══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "7-Day Revenue",          value: formatPeso(totalRevenue7Days), icon: TrendingUp, color: isDark ? "text-emerald-400" : "text-emerald-600", bg: isDark ? "bg-emerald-950/40" : "bg-emerald-50", border: isDark ? "border-emerald-900" : "border-emerald-100", testId: "text-total-revenue",      flash: false },
          { label: "Today's Revenue",         value: formatPeso(todayRevenue),      icon: PhilippinePeso, color: isDark ? "text-emerald-400" : "text-emerald-600", bg: isDark ? "bg-emerald-950/40" : "bg-emerald-50", border: isDark ? "border-emerald-900" : "border-emerald-100", testId: "text-today-revenue",      flash: revenueFlash },
          { label: "Total Registered Users",  value: totalUniqueTaps,               icon: User, color: isDark ? "text-indigo-400" : "text-indigo-600",  bg: isDark ? "bg-indigo-950/40" : "bg-indigo-50",  border: isDark ? "border-indigo-900" : "border-indigo-100",  testId: "text-total-taps",         flash: false },
          { label: "Total Linked Cards",      value: totalLinkedCards,              icon: LinkIcon,   color: isDark ? "text-sky-400" : "text-sky-600",     bg: isDark ? "bg-sky-950/40" : "bg-sky-50",     border: isDark ? "border-sky-900" : "border-sky-100",     testId: "text-total-linked-cards", flash: false },
        ].map((stat, idx) => (
          <Card
            key={idx}
            className={`shadow-sm transition-all duration-200 hover:shadow-md ${
              isDark ? "bg-slate-900 border-slate-800 hover:border-slate-700" : "bg-white border-slate-200 hover:border-slate-300"
            } ${stat.flash ? "card-pulse" : ""}`}
          >
            <CardContent className="p-6 relative overflow-hidden">
              <div className={`absolute top-0 right-0 w-16 h-16 ${isDark ? "opacity-10" : "opacity-5"}`}>
                <stat.icon className="w-full h-full" />
              </div>
              {isLoading ? (
                <Skeleton className={`h-12 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>{stat.label}</p>
                    <p className={`text-2xl font-bold mt-1 tracking-tight ${stat.color}`} data-testid={stat.testId}>
                      {stat.value}
                    </p>
                  </div>
                  <div className={`w-10 h-10 rounded border ${stat.bg} ${stat.border} flex items-center justify-center ${stat.color}`}>
                    <stat.icon size={20} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ══ BAR CHART — filter now lives right inside this card's header ══ */}
      <Card className={`shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />
        <CardHeader className={`border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <PieChart size={14} className="text-blue-500" />
                Daily Revenue Breakdown
              </CardTitle>
              <div className={`text-[10px] font-medium uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Performance Matrix</div>
            </div>

            {/* ── inline filter row ── */}
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={13} className={isDark ? "text-blue-400" : "text-blue-500"} />

              <select
                value={filterYear}
                onChange={(e) => handleYearChange(e.target.value)}
                data-testid="select-filter-year"
                className={`h-8 rounded-md border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                onChange={(e) => handleMonthChange(e.target.value)}
                data-testid="select-filter-month"
                className={`h-8 rounded-md border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                onChange={(e) => handleDayChange(e.target.value)}
                data-testid="select-filter-day"
                className={`h-8 rounded-md border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <option value="all">Day</option>
                {DAY_OPTIONS.map((d) => (
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

              {isFilterActive && (
                <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold ${
                  isDark ? "bg-blue-950/40 border-blue-900 text-blue-300" : "bg-blue-50 border-blue-100 text-blue-700"
                }`}>
                  {filterLabel}: {formatPeso(filteredRevenueTotal)} ({filteredBreakdown.length}d)
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-8">
          {isLoading ? (
            <Skeleton className={`h-72 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
          ) : filteredBreakdown.length === 0 ? (
            <div className={`h-[300px] flex items-center justify-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              No records match the selected filter.
            </div>
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => {
                      const date = new Date(d + "T00:00:00");
                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    }}
                    stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={11} fontWeight="600" axisLine={false} tickLine={false}
                  />
                  <YAxis
                    stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={11} fontWeight="600"
                    tickFormatter={(v: number) => `₱${v.toLocaleString("en-US")}`} axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: isDark ? "rgba(96,165,250,0.08)" : "rgba(37,99,235,0.05)" }}
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      border: isDark ? "1px solid #1e293b" : "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "11px",
                      fontWeight: "600",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    labelStyle={{ color: isDark ? "#e2e8f0" : "#1e293b" }}
                    itemStyle={{ color: isDark ? "#60a5fa" : "#2563eb" }}
                    formatter={(value: number) => [formatPeso(Math.abs(value)), "Revenue"]}
                  />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]} className="cursor-pointer">
                    {filteredBreakdown.map((_entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === filteredBreakdown.length - 1 ? "#3b82f6" : isDark ? "#334155" : "#cbd5e1"}
                        className="cursor-pointer"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ DATA TABLE ══ */}
      <Card className={`shadow-sm flex-1 flex flex-col overflow-hidden ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <FileText size={14} className="text-blue-500" />
              Detailed Revenue Log
              {isFilterActive && (
                <span className={`normal-case font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  — {filterLabel}
                </span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-0 px-6 pb-6 mt-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className={`h-12 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />)}
            </div>
          ) : filteredBreakdown.length === 0 ? (
            <div className={`py-12 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              No records match the selected filter.
            </div>
          ) : (
            <Table>
              <TableHeader className={isDark ? "bg-slate-900" : "bg-white"}>
                <TableRow className={`hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Log Date</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Standard Day</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-blue-500">Revenue Credited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBreakdown.map((day: any, i: number) => {
                  const date = new Date(day.date + "T00:00:00");
                  return (
                    <TableRow
                      key={i}
                      className={`transition-colors cursor-default ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}`}
                    >
                      <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                        {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </TableCell>
                      <TableCell className={`text-[11px] font-semibold uppercase ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        {date.toLocaleDateString("en-US", { weekday: "long" })}
                      </TableCell>
                      <TableCell className={`text-right font-semibold font-mono text-sm ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                        {formatPeso(day.revenue)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}