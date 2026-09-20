import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGetReportSummary, useListTransactions, useListUsers, useListRoutes } from "@workspace/api-client-react";
// NOTE: if your generated client names this hook differently (e.g.
// useListFareRoutes / useListActiveRoutes), rename the import + the call
// below to match — it should hit the same GET /routes endpoint that
// returns { id, origin, destination, fareAmount, isActive, deviceId }.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
} from "recharts";
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
  GraduationCap,
  HeartPulse,
  Accessibility,
  Percent,
  Wallet,
  Receipt,
  Route as RouteIcon,
  Award,
  Users,
  Sparkles,
  TrendingDown,
} from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

// ➕ Normalizes a card's raw `type` field into one of the 4 known card
// types. Used everywhere below to attribute a Fare transaction to
// Regular vs. a discounted category (Student/Senior/PWD).
function normalizeCardType(type?: string | null): "Regular" | "Student" | "Senior" | "PWD" {
  const t = (type || "Regular").toLowerCase().trim();
  if (t === "student") return "Student";
  if (t === "senior") return "Senior";
  if (t === "pwd") return "PWD";
  return "Regular";
}

// 🎨 Badge styling for the discount-type breakdown (Student/Senior/PWD),
// matching the same palette used on the User Management page so the
// colors mean the same thing across the app.
function getDiscountBadgeStyle(kind: "Student" | "Senior" | "PWD", isDark: boolean) {
  switch (kind) {
    case "Student":
      return isDark ? "border-blue-900 text-blue-400 bg-blue-950/40" : "border-blue-200 text-blue-600 bg-blue-50";
    case "Senior":
      return isDark ? "border-yellow-900 text-yellow-400 bg-yellow-950/40" : "border-yellow-300 text-yellow-700 bg-yellow-50";
    case "PWD":
      return isDark ? "border-emerald-900 text-emerald-400 bg-emerald-950/40" : "border-emerald-200 text-emerald-600 bg-emerald-50";
  }
}

function getDiscountDotColor(kind: "Student" | "Senior" | "PWD") {
  switch (kind) {
    case "Student":
      return "bg-blue-500";
    case "Senior":
      return "bg-yellow-500";
    case "PWD":
      return "bg-emerald-500";
  }
}

// 🎨 Line colors for the Discount Collection Analytics line graph — kept
// in sync with the badge/dot colors above and the table's column colors
// so "Student" always means blue, "Senior" always means yellow, etc.
const DISCOUNT_LINE_COLORS = {
  total: "#7c3aed", // purple — matches the export tab's band color
  regular: "#ef4444", // slate
  student: "#3b82f6", // blue
  senior: "#eab308", // yellow
  pwd: "#10b981", // emerald
};

// 🎨 Line colors for the Route Performance chart — one per plotted route
// (up to 5 shown at once to keep the chart legible). Cycles if more.
const ROUTE_LINE_COLORS = ["#3b82f6", "#f97316", "#10b981", "#a855f7", "#ef4444"];

// How many days ahead the Route Performance forecast projects.
const ROUTE_FORECAST_DAYS = 7;
// How many of the busiest routes get their own line on the chart.
const ROUTE_CHART_TOP_N = 5;

// ➕ Standard PH statutory discount rate for Student/Senior/PWD fares
// (20% off). Used to back-calculate how much revenue was foregone by
// honoring the discount: if a rider paid `discounted = full * 0.8`,
// then the amount NOT collected is `discounted * (0.20 / 0.80)` =
// `discounted * 0.25`.
const DISCOUNT_RATE = 0.20;
const LOST_REVENUE_MULTIPLIER = DISCOUNT_RATE / (1 - DISCOUNT_RATE); // 0.25

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

// ➕ Fee / VAT / Net amount extraction for Top-up transactions — mirrors
// the exact same logic used on the Transactions page's receipt modal, so
// the Excel export's Fee / VAT / Net Amount columns always match what's
// shown on-screen there.
function getFeeAmount(tx: any): number | null {
  const value = tx?.fee_amount ?? tx?.feeAmount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVatAmount(tx: any): number | null {
  const value = tx?.vat_amount ?? tx?.vatAmount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getNetAmount(tx: any): number | null {
  const value = tx?.net_amount ?? tx?.netAmount;
  if (value != null && value !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const amount = Number(tx?.amount);
  const fee = getFeeAmount(tx);
  const vat = getVatAmount(tx);
  if (Number.isFinite(amount) && fee != null && vat != null) {
    return amount - fee - vat;
  }
  return null;
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

// Returns the "YYYY-MM-DD" date that is `days` after `dateStr` (local time).
// Used to extend the x-axis past the last real day of data so the forecast
// lines on the Route Performance chart have somewhere to go.
function addDaysToDateString(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00");
  dt.setDate(dt.getDate() + days);
  return dt.toLocaleDateString("en-CA");
}

// ── Simple least-squares linear regression forecast ──
// Not a full predictive-analytics model — just a lightweight trend
// projection (best-fit straight line through the recent daily counts,
// extended `forecastCount` days forward). Good enough to flag "this route
// is trending up/down" without pretending to be more precise than the data
// supports. Negative predictions are clamped to 0 since ridership/revenue
// can't go below zero.
function linearRegressionForecast(values: number[], forecastCount: number): number[] {
  const n = values.length;
  if (n === 0) return Array(forecastCount).fill(0);
  if (n === 1) return Array(forecastCount).fill(Math.max(0, values[0]));

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  values.forEach((y, x) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;

  return Array.from({ length: forecastCount }, (_, i) => {
    const x = n + i;
    return Math.max(0, Math.round(intercept + slope * x));
  });
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
  // ➕ Optional grand-total for this column, computed across every row on
  // the sheet. When present, buildSingleSheet renders one extra "TOTAL"
  // row at the bottom so the admin can see sums at a glance instead of
  // having to add them up in Excel. Columns without a `total` show a
  // blank cell on that row (except column 0, which shows the "TOTAL"
  // label itself when no other column claims it).
  total?: (rows: any[]) => string;
};

// Excel column letters, supports > 26 columns (AA, AB, ...) even though no
// single tab currently needs more than a handful of columns.
function colLetter(c: number): string {
  let n = c;
  let s = "";
  do {
    s = String.fromCharCode("A".charCodeAt(0) + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

type SheetBlock = {
  title: string;
  bandColor: string;
  columns: SheetColumn[];
  rows: any[];
  statusColIndex?: number;
  statusColorFor?: (status: string) => { font: string; fill: string };
};

// ── Single-sheet (ONE TAB) builder ───────────────────────────────────────
// Renders exactly ONE block (Fare, Top-up, Transfers, or Discount
// Analytics) as its own full-width worksheet — banner + subtitle + meta
// row, then the block's own colored title band and column headers, then
// its data rows. Each call produces one sheet/tab, mirroring the
// Fare / Top-up / Transfer tabs on the Transactions page instead of
// cramming every category side-by-side into a single sheet.
function buildSingleSheet(
  utils: any,
  opts: {
    generatedAt: string;
    adminName: string;
    subtitle: string;
    block: SheetBlock;
  }
) {
  const b = opts.block;
  const totalCols = Math.max(1, b.columns.length);

  const HEADER_ROWS = 6; // 0:title 1:subtitle 2:meta 3:blank 4:band 5:column headers
  const dataRowsCount = Math.max(1, b.rows.length);
  // ➕ Only add the extra TOTALS row when there's real data AND at least
  // one column actually defines a total() — an empty "No records" sheet
  // has nothing to sum.
  const hasTotals = b.rows.length > 0 && b.columns.some((c) => !!c.total);
  const totalRows = HEADER_ROWS + dataRowsCount + (hasTotals ? 1 : 0);

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

  // ── banner (full width of this tab) ──
  grid[0][0] = "Fare Collection System";
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
  setStyle(0, 0, {
    font: { bold: true, sz: 16, color: { rgb: "FFFFFF" }, name: "Calibri" },
    fill: { fgColor: { rgb: "0F172A" }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  });

  grid[1][0] = opts.subtitle;
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

  // ── this tab's own colored band title (row 4) ──
  grid[4][0] = b.title;
  merges.push({ s: { r: 4, c: 0 }, e: { r: 4, c: totalCols - 1 } });
  setStyle(4, 0, {
    font: { bold: true, sz: 11, color: { rgb: "FFFFFF" }, name: "Calibri" },
    fill: { fgColor: { rgb: b.bandColor }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center" },
  });

  // ── column headers (row 5) ──
  b.columns.forEach((c, ci) => {
    grid[5][ci] = c.header;
    setStyle(5, ci, {
      font: { bold: true, sz: 10, color: { rgb: "FFFFFF" }, name: "Calibri" },
      fill: { fgColor: { rgb: "1E3A5F" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: MEDIUM_BORDER,
    });
  });

  if (b.rows.length === 0) {
    grid[HEADER_ROWS][0] = "No records for this filter.";
    merges.push({ s: { r: HEADER_ROWS, c: 0 }, e: { r: HEADER_ROWS, c: totalCols - 1 } });
    setStyle(HEADER_ROWS, 0, {
      font: { italic: true, sz: 10, color: { rgb: "94A3B8" }, name: "Calibri" },
      fill: { fgColor: { rgb: "F8FAFC" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    });
  } else {
    b.rows.forEach((row, i) => {
      const r = HEADER_ROWS + i;
      const isEven = i % 2 === 0;
      const baseFill = isEven ? "FFFFFF" : "F8FAFC";
      b.columns.forEach((c, ci) => {
        const val = c.get(row, i);
        grid[r][ci] = val;
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
        setStyle(r, ci, style);
      });
    });
  }

  // ── 🆕 TOTALS row — one bold, dark banner row right after the last
  // data row, summing every column that defines a total(). The first
  // column falls back to the "TOTAL" label itself if it doesn't have its
  // own total() (e.g. a Date/Timestamp/Card UID column). ──
  if (hasTotals) {
    const r = HEADER_ROWS + b.rows.length;
    b.columns.forEach((c, ci) => {
      const val = c.total ? c.total(b.rows) : ci === 0 ? "TOTAL" : "";
      grid[r][ci] = val;
      setStyle(r, ci, {
        font: { bold: true, sz: 10, color: { rgb: "FFFFFF" }, name: "Calibri" },
        fill: { fgColor: { rgb: "0F172A" }, patternType: "solid" },
        alignment: { horizontal: ci === 0 ? "left" : "right", vertical: "center" },
        border: MEDIUM_BORDER,
      });
    });
    rowHeights[r] = 22;
  }

  const worksheet = utils.aoa_to_sheet(grid);
  worksheet["!cols"] = b.columns.map((c) => ({ wch: c.width }));
  worksheet["!merges"] = merges;
  worksheet["!rows"] = rowHeights.map((hpt) => ({ hpt }));
  styles.forEach(({ ref, style }) => {
    if (!worksheet[ref]) worksheet[ref] = { t: "z", v: "" };
    worksheet[ref].s = style;
  });

  return worksheet;
}

// Excel worksheet (tab) names can't contain : \ / ? * [ ] and max out at 31
// chars — this keeps every tab name we generate safe.
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*\[\]]/g, "-").slice(0, 31);
}

// 🆕 Report-tab definitions for the GCash-style underline tab bar, moved
// to the very top of the page (right under the page header, above the
// summary cards) instead of sitting between the cards and the tab
// content below.
type ReportTab = "chart" | "discount" | "log" | "routes";
const REPORT_TABS: { key: ReportTab; label: string; icon: typeof PieChart }[] = [
  { key: "chart", label: "Daily Revenue Breakdown", icon: PieChart },
  { key: "discount", label: "Discount Collection Analytics", icon: Percent },
  { key: "log", label: "Detailed Revenue Log", icon: FileText },
  { key: "routes", label: "Route Performance", icon: RouteIcon },
];

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

  // ── which report section tab is showing: Daily Revenue Breakdown,
  // Discount Collection Analytics, or Detailed Revenue Log — same
  // one-tab-visible-at-a-time pattern as the Top-up / Fare / Transfer
  // switch on the Transactions page. The Year/Month/Day filter below
  // is now rendered inline in each tab's header row, next to the title,
  // and applies to whichever tab is active. ──
  const [activeTab, setActiveTab] = useState<ReportTab>("chart");

  const { data: report, isLoading, refetch: refetchReport } = useGetReportSummary({
    query: {
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });
  const { data: transactions, refetch: refetchTransactions } = useListTransactions();
  const { data: users, refetch: refetchUsers } = useListUsers();
  const { data: routes, refetch: refetchRoutes } = useListRoutes();

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

  // ── 🆕 per-transaction fee_amount / vat_amount / net_amount, fetched
  // the same way the Transactions page does (these columns aren't part
  // of the main useListTransactions() response). Merged onto the
  // transaction list below (enrichedTxList) so the Top-up Excel export
  // tab can show Fee / VAT / Net Amount columns, exactly like the
  // Transactions page's receipt modal already does on-screen. ──
  const [financialById, setFinancialById] = useState<
    Record<string, { fee_amount: number | null; vat_amount: number | null; net_amount: number | null }>
  >({});

  useRealtimeRefetch(["transactions", "fare_routes", "users"], () => {
    refetchReport();
    refetchTransactions();
    refetchUsers();
    refetchRoutes();
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
  const routeList = React.useMemo(() => (Array.isArray(routes) ? routes : []), [routes]);

  // ── 🆕 fetch fee_amount / vat_amount / net_amount for every currently
  // loaded transaction, keyed by id. ──
  useEffect(() => {
    let cancelled = false;
    const loadFinancialFields = async () => {
      const ids = txList
        .map((tx: any) => tx?.id)
        .filter((id: any) => id != null)
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id));
      if (ids.length === 0) {
        setFinancialById({});
        return;
      }
      const { data, error } = await supabase
        .from("transactions")
        .select("id, fee_amount, vat_amount, net_amount")
        .in("id", ids);
      if (cancelled) return;
      if (error) {
        console.warn("Unable to load transaction fee/VAT/net fields:", error.message);
        return;
      }
      const next: Record<string, { fee_amount: number | null; vat_amount: number | null; net_amount: number | null }> = {};
      for (const row of data ?? []) {
        next[String(row.id)] = {
          fee_amount: row.fee_amount == null ? null : Number(row.fee_amount),
          vat_amount: row.vat_amount == null ? null : Number(row.vat_amount),
          net_amount: row.net_amount == null ? null : Number(row.net_amount),
        };
      }
      setFinancialById(next);
    };
    loadFinancialFields();
    return () => {
      cancelled = true;
    };
  }, [txList]);

  // ── 🆕 txList with fee_amount / vat_amount / net_amount merged in.
  // filteredTxList (below) is built from THIS instead of the raw
  // txList, so filteredFareList / filteredTopupList — and therefore the
  // Excel export — automatically carry the financial fields too. ──
  const enrichedTxList = React.useMemo(
    () => txList.map((tx: any) => ({ ...tx, ...(financialById[String(tx.id)] ?? {}) })),
    [txList, financialById]
  );

  // ── route_id -> "Origin → Destination" lookup, used to turn the raw
  // routeId on each Fare transaction into a readable route name for the
  // Route Performance tab. Falls back to "Route #<id>" for a route that
  // was deleted after transactions referencing it were recorded. ──
  const routeNameById = React.useMemo(() => {
    const map = new Map<number, string>();
    routeList.forEach((r: any) => {
      const id = Number(r.id);
      if (!Number.isFinite(id)) return;
      map.set(id, `${r.origin} → ${r.destination}`);
    });
    return map;
  }, [routeList]);

  const getRouteName = React.useCallback(
    (routeId: number) => routeNameById.get(routeId) || `Route #${routeId}`,
    [routeNameById]
  );

  // ── card_uid -> card type lookup, used to attribute each Fare
  // transaction to Regular / Student / Senior / PWD for the discount
  // analytics section below. Falls back to "Regular" for any card that
  // can't be matched (e.g. a deleted card). ──
  const cardTypeByUid = React.useMemo(() => {
    const map = new Map<string, string>();
    userList.forEach((u: any) => {
      const uid = u.cardUid || u.card_uid;
      if (uid) map.set(uid, u.type || "Regular");
    });
    return map;
  }, [userList]);

  const getTxCardType = React.useCallback(
    (tx: any): "Regular" | "Student" | "Senior" | "PWD" => {
      const uid = tx.card_uid || tx.cardUid;
      if (!uid) return "Regular";
      return normalizeCardType(cardTypeByUid.get(uid));
    },
    [cardTypeByUid]
  );

  // ── Daily passenger volume by Card Type ─────────────────────────────────
  // Built from Fare transactions only because each Fare transaction represents
  // one passenger ride. The date key comes from the transaction timestamp, so
  // the hover tooltip can dynamically show only the passenger counts for the
  // exact day represented by the hovered revenue bar.
  const passengerBreakdownByDate = React.useMemo(() => {
    const map = new Map<
      string,
      { total: number; regular: number; student: number; senior: number; pwd: number }
    >();

    txList.forEach((tx: any) => {
      if (normalizeTxType(tx.type) !== "Fare") return;

      const dateKey = getTxDateKey(tx);
      if (!dateKey) return;

      const cardType = getTxCardType(tx);
      const entry =
        map.get(dateKey) || { total: 0, regular: 0, student: 0, senior: 0, pwd: 0 };

      entry.total += 1;

      if (cardType === "Student") entry.student += 1;
      else if (cardType === "Senior") entry.senior += 1;
      else if (cardType === "PWD") entry.pwd += 1;
      else entry.regular += 1;

      map.set(dateKey, entry);
    });

    return map;
  }, [txList, getTxCardType]);

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

  // ── discount analytics: per-day totals split into Regular vs.
  // Student/Senior/PWD, built from Fare transactions only (top-ups aren't
  // discounted). Powers the "Discount Collection Analytics" card below
  // and its own Excel export tab. ──
  const fareDiscountDailyBreakdown = React.useMemo(() => {
    const map = new Map<
      string,
      { total: number; regular: number; student: number; senior: number; pwd: number }
    >();
    txList.forEach((tx: any) => {
      if (normalizeTxType(tx.type) !== "Fare") return;
      const dateKey = getTxDateKey(tx);
      if (!dateKey) return;
      const amount = Math.abs(Number(tx.amount) || 0);
      const cardType = getTxCardType(tx);
      const entry = map.get(dateKey) || { total: 0, regular: 0, student: 0, senior: 0, pwd: 0 };
      entry.total += amount;
      if (cardType === "Student") entry.student += amount;
      else if (cardType === "Senior") entry.senior += amount;
      else if (cardType === "PWD") entry.pwd += amount;
      else entry.regular += amount;
      map.set(dateKey, entry);
    });
    return Array.from(map.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [txList, getTxCardType]);

  const fareDiscountByDate = React.useMemo(
    () => new Map(fareDiscountDailyBreakdown.map((d) => [d.date, d])),
    [fareDiscountDailyBreakdown]
  );

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

  // ── whenever a Year is selected, always render the COMPLETE calendar
  // range implied by the filter (Year alone -> Jan 1–Dec 31; Year+Month ->
  // every day of that month), filling in ₱0 for days that have no
  // transactions, instead of only showing days that happen to have data.
  // Falls back to the old "filter existing rows" behavior when no Year is
  // picked (e.g. Month-only or Day-only filters), since there's no year to
  // anchor a full range to. ──
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

  // Same "always render the complete calendar range when a Year is
  // selected" behavior as filteredBreakdown above, applied to the
  // Regular/Student/Senior/PWD discount breakdown.
  const filteredFareDiscountBreakdown = React.useMemo(() => {
    if (!isFilterActive) return fareDiscountDailyBreakdown;

    const fullRange = generateDateRange(filterYear, filterMonth, filterDay);
    if (fullRange) {
      return fullRange.map((date) => {
        const existing = fareDiscountByDate.get(date);
        return existing || { date, total: 0, regular: 0, student: 0, senior: 0, pwd: 0 };
      });
    }

    return fareDiscountDailyBreakdown.filter((d) => {
      const parts = splitDateString(d.date);
      if (!parts) return false;
      if (filterMonth !== "all" && parts.month !== filterMonth) return false;
      if (filterDay !== "all" && parts.day !== filterDay) return false;
      return true;
    });
  }, [fareDiscountDailyBreakdown, fareDiscountByDate, filterYear, filterMonth, filterDay, isFilterActive]);

  // ── filtered transactions (drives the Fare / Top-up export tabs) —
  // unaffected by the calendar fill-in above, since exports should only
  // ever list actual transaction records, not empty calendar days.
  // 🆕 Now built from enrichedTxList (txList + fee/vat/net merged in)
  // so filteredFareList / filteredTopupList carry those fields too. ──
  const filteredTxList = React.useMemo(() => {
    if (!isFilterActive) return enrichedTxList;
    return enrichedTxList.filter((tx: any) => {
      const parts = getTxDateParts(tx);
      if (!parts) return false;
      if (filterYear !== "all" && parts.year !== filterYear) return false;
      if (filterMonth !== "all" && parts.month !== filterMonth) return false;
      if (filterDay !== "all" && parts.day !== filterDay) return false;
      return true;
    });
  }, [enrichedTxList, filterYear, filterMonth, filterDay, isFilterActive]);

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

  // ── discount summary totals for the currently active filter (or
  // all-time when no filter is set), computed straight from the filtered
  // Fare transaction list so partial/empty calendar days don't dilute
  // it. Feeds the summary chips and the per-type badges on the Discount
  // Collection Analytics card. ──
  //
  // ➕ Also computes `revenueLost`: the estimated peso amount NOT
  // collected because Student/Senior/PWD riders were charged the
  // statutory 20%-off fare instead of the full (Regular) fare. Since the
  // amount actually recorded on a discounted transaction is already the
  // POST-discount amount (i.e. 80% of the full fare), the un-collected
  // 20% is derived as `discountedRevenue * (0.20 / 0.80)`.
  const discountSummary = React.useMemo(() => {
    let totalCollected = 0;
    let regularRevenue = 0;
    let regularCount = 0;
    const byType: Record<"Student" | "Senior" | "PWD", { revenue: number; count: number }> = {
      Student: { revenue: 0, count: 0 },
      Senior: { revenue: 0, count: 0 },
      PWD: { revenue: 0, count: 0 },
    };

    filteredFareList.forEach((tx: any) => {
      const amount = Math.abs(Number(tx.amount) || 0);
      const cardType = getTxCardType(tx);
      totalCollected += amount;
      if (cardType === "Regular") {
        regularRevenue += amount;
        regularCount += 1;
      } else {
        byType[cardType].revenue += amount;
        byType[cardType].count += 1;
      }
    });

    const discountedRevenue = byType.Student.revenue + byType.Senior.revenue + byType.PWD.revenue;
    const discountedCount = byType.Student.count + byType.Senior.count + byType.PWD.count;
    const discountedSharePct = totalCollected > 0 ? (discountedRevenue / totalCollected) * 100 : 0;

    // ➕ Revenue lost to the 20% discount, overall and per discount type.
    const revenueLost = discountedRevenue * LOST_REVENUE_MULTIPLIER;
    const revenueLostByType: Record<"Student" | "Senior" | "PWD", number> = {
      Student: byType.Student.revenue * LOST_REVENUE_MULTIPLIER,
      Senior: byType.Senior.revenue * LOST_REVENUE_MULTIPLIER,
      PWD: byType.PWD.revenue * LOST_REVENUE_MULTIPLIER,
    };
    // What would have been collected if every discounted rider paid full
    // (Regular) fare instead — i.e. discountedRevenue + revenueLost.
    const wouldBeRevenueAtFullFare = totalCollected + revenueLost;

    return {
      totalCollected,
      regularRevenue,
      regularCount,
      discountedRevenue,
      discountedCount,
      discountedSharePct,
      byType,
      revenueLost,
      revenueLostByType,
      wouldBeRevenueAtFullFare,
    };
  }, [filteredFareList, getTxCardType]);

  // ── Daily Average (Fare collections) for the currently active filter
  // period — total collected divided by the number of calendar days
  // covered by filteredFareDiscountBreakdown (which is already the full,
  // zero-filled range whenever a Year is selected, or just the days that
  // exist when it isn't). Powers the "Daily Average" chip on the
  // Discount Collection Analytics tab. ──
  const discountDailyAverage = React.useMemo(() => {
    const dayCount = filteredFareDiscountBreakdown.length;
    if (dayCount === 0) return 0;
    return discountSummary.totalCollected / dayCount;
  }, [filteredFareDiscountBreakdown, discountSummary.totalCollected]);

  // Registered-user distribution by Card Type for the Discount Collection
  // Analytics donut. This is intentionally based on the registered `users`
  // dataset — NOT Fare transactions — so the chart answers "how many users
  // are registered under each card type" rather than "how many rides occurred".
  const cardTypeDistribution = React.useMemo(() => {
    const counts: Record<"Regular" | "Student" | "Senior" | "PWD", number> = {
      Regular: 0,
      Student: 0,
      Senior: 0,
      PWD: 0,
    };

    userList.forEach((u: any) => {
      counts[normalizeCardType(u?.type)] += 1;
    });

    return (Object.entries(counts) as Array<[keyof typeof counts, number]>)
      .map(([name, value]) => ({ name, value }))
      .filter((item) => item.value > 0);
  }, [userList]);

  const CARD_TYPE_CHART_COLORS: Record<string, string> = {
    Regular: "#64748b",
    Student: "#3b82f6",
    Senior: "#eab308",
    PWD: "#10b981",
  };

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE PERFORMANCE — which route gets the most riders/day, a line-graph
  // trend per route with a short forecast, and each route's daily average.
  // Built from Fare transactions only (routeId is null on Top-up rows).
  // ══════════════════════════════════════════════════════════════════════

  // ── per-day, per-route ride count + revenue, from the filtered Fare
  // list. Keyed by date -> routeId -> { count, revenue }. ──
  const routeDailyMap = React.useMemo(() => {
    const map = new Map<string, Map<number, { count: number; revenue: number }>>();
    filteredFareList.forEach((tx: any) => {
      const routeId = tx.routeId ?? tx.route_id;
      if (routeId === null || routeId === undefined) return;
      const rid = Number(routeId);
      if (!Number.isFinite(rid)) return;
      const dateKey = getTxDateKey(tx);
      if (!dateKey) return;
      const amount = Math.abs(Number(tx.amount) || 0);
      const dayMap = map.get(dateKey) || new Map<number, { count: number; revenue: number }>();
      const entry = dayMap.get(rid) || { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += amount;
      dayMap.set(rid, entry);
      map.set(dateKey, dayMap);
    });
    return map;
  }, [filteredFareList]);

  // ── totals per route across the whole filtered period, used for the
  // "most sinasakyang ruta" ranking and the daily-average table. ──
  const routeTotals = React.useMemo(() => {
    const totals = new Map<number, { count: number; revenue: number }>();
    filteredFareList.forEach((tx: any) => {
      const routeId = tx.routeId ?? tx.route_id;
      if (routeId === null || routeId === undefined) return;
      const rid = Number(routeId);
      if (!Number.isFinite(rid)) return;
      const amount = Math.abs(Number(tx.amount) || 0);
      const t = totals.get(rid) || { count: 0, revenue: 0 };
      t.count += 1;
      t.revenue += amount;
      totals.set(rid, t);
    });
    return totals;
  }, [filteredFareList]);

  // The full calendar-day range for the active filter (already computed
  // above for the discount table) — reused here as the shared x-axis for
  // the route ridership chart, and as the denominator for daily averages.
  const routePeriodDates = React.useMemo(
    () => filteredFareDiscountBreakdown.map((d) => d.date),
    [filteredFareDiscountBreakdown]
  );
  const routePeriodDayCount = routePeriodDates.length || 1;

  // Total routed Fare rides in the period — denominator for each route's
  // "share of rides" figure below.
  const totalRoutedRides = React.useMemo(() => {
    let total = 0;
    routeTotals.forEach((t) => (total += t.count));
    return total;
  }, [routeTotals]);

  // Every route that had at least one ride in the period, ranked by total
  // rides descending — #1 is the "pinaka-sinasakyang ruta".
  const rankedRoutes = React.useMemo(() => {
    return Array.from(routeTotals.entries())
      .map(([routeId, t]) => ({
        routeId,
        name: getRouteName(routeId),
        totalRides: t.count,
        totalRevenue: t.revenue,
        avgRidesPerDay: t.count / routePeriodDayCount,
        avgRevenuePerDay: t.revenue / routePeriodDayCount,
        sharePct: totalRoutedRides > 0 ? (t.count / totalRoutedRides) * 100 : 0,
      }))
      .sort((a, b) => b.totalRides - a.totalRides);
  }, [routeTotals, getRouteName, routePeriodDayCount, totalRoutedRides]);

  const topRoute = rankedRoutes[0] || null;
  const topRoutesForChart = rankedRoutes.slice(0, ROUTE_CHART_TOP_N);

  // ── chart data: actual daily ride counts for the top routes, plus a
  // short linear-trend forecast appended after the last real day. Two
  // dataKeys per route ("..._actual" solid, "..._forecast" dashed) so
  // recharts can style the projected segment differently. The forecast
  // series starts on the last actual day (duplicating that value) so the
  // dashed line visually connects to the solid one instead of jumping. ──
  const { routeChartData, routeChartSeries } = React.useMemo(() => {
    if (topRoutesForChart.length === 0 || routePeriodDates.length === 0) {
      return { routeChartData: [] as any[], routeChartSeries: [] as any[] };
    }

    const series = topRoutesForChart.map((r, idx) => {
      const actualValues = routePeriodDates.map((date) => {
        const dayMap = routeDailyMap.get(date);
        return dayMap?.get(r.routeId)?.count ?? 0;
      });
      const forecastValues = linearRegressionForecast(actualValues, ROUTE_FORECAST_DAYS);
      return {
        routeId: r.routeId,
        name: r.name,
        color: ROUTE_LINE_COLORS[idx % ROUTE_LINE_COLORS.length],
        actualKey: `r${r.routeId}_actual`,
        forecastKey: `r${r.routeId}_forecast`,
        actualValues,
        forecastValues,
      };
    });

    const lastDate = routePeriodDates[routePeriodDates.length - 1];
    const forecastDates = Array.from({ length: ROUTE_FORECAST_DAYS }, (_, i) =>
      addDaysToDateString(lastDate, i + 1)
    );
    const allDates = [...routePeriodDates, ...forecastDates];

    const data = allDates.map((date, idx) => {
      const row: any = { date, isForecast: idx >= routePeriodDates.length };
      series.forEach((s) => {
        if (idx < routePeriodDates.length) {
          row[s.actualKey] = s.actualValues[idx];
          row[s.forecastKey] = idx === routePeriodDates.length - 1 ? s.actualValues[idx] : null;
        } else {
          row[s.actualKey] = null;
          row[s.forecastKey] = s.forecastValues[idx - routePeriodDates.length];
        }
      });
      return row;
    });

    return { routeChartData: data, routeChartSeries: series };
  }, [topRoutesForChart, routePeriodDates, routeDailyMap]);

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

  // ── EXPORT: one workbook, SIX separate tabs/sheets — "Fare",
  // "Top-up", "Transfers", "Discount Analytics", "Route Summary",
  // "Route Daily" — mirroring the Fare / Top-up / Transfer tabs on the
  // Transactions page plus the Discount Collection Analytics and Route
  // Performance tabs on this page. Discount Analytics and Route Daily now
  // both pull from the FULL zero-filled calendar range (same data the
  // on-screen charts use) instead of only the days that happen to have a
  // transaction, so no date gets silently dropped from the export.
  // 🆕 Top-up now also gets Fee / VAT / Net Amount columns, sourced from
  // filteredTopupList (which now carries fee_amount/vat_amount/net_amount
  // thanks to enrichedTxList above), matching the Transactions page. ──
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
      details: `${adminName} exported transaction logs as Excel (transaction-logs${filenameSuffix}-${stamp}.xlsx) — 6 separate tabs: Fare, Top-up, Transfers, Discount Analytics, Route Summary, Route Daily${
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

    // 🆕 `includeFinancials` adds Fee (PHP) / VAT (PHP) / Net Amount (PHP)
    // columns between "Signed Amount" and "Status" — used for the Top-up
    // tab only (Fare rows don't carry fee/VAT data, same as the
    // Transactions page which only shows these for non-Fare rows).
    // ➕ shared "sum a numeric getter across every row" helper, used by
    // the total() functions below (Fee/VAT/Net can be null on some rows,
    // so nulls are treated as 0 for the sum).
    const sumFormatted = (rows: any[], getter: (tx: any) => number | null) => {
      const sum = rows.reduce((s, tx) => {
        const v = getter(tx);
        return s + (v == null ? 0 : v);
      }, 0);
      return sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const txColumns = (signPrefix: string, includeFinancials: boolean = false): SheetColumn[] => {
      const columns: SheetColumn[] = [
        { header: "Timestamp", width: 26, get: (tx) => {
          const ts = tx.timestamp || tx.created_at;
          return ts ? new Date(ts).toLocaleString("en-PH") : "";
        }},
        { header: "Card UID", width: 18, get: (tx) => tx.card_uid || tx.cardUid || "" },
        { header: "Full Name", width: 24, get: (tx) => tx.full_name || tx.fullName || "" },
        { header: "Amount (PHP)", width: 18, get: (tx) =>
          Math.abs(Number(tx.amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          total: (rows) => sumFormatted(rows, (tx) => Math.abs(Number(tx.amount) || 0)),
        },
        { header: "Signed Amount", width: 16, get: (tx) =>
          `${signPrefix}${Math.abs(Number(tx.amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          total: (rows) => `${signPrefix}${sumFormatted(rows, (tx) => Math.abs(Number(tx.amount) || 0))}`,
        },
      ];

      if (includeFinancials) {
        columns.push(
          { header: "Fee (PHP)", width: 16, get: (tx) => {
            const v = getFeeAmount(tx);
            return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }, total: (rows) => sumFormatted(rows, getFeeAmount) },
          { header: "VAT (PHP)", width: 16, get: (tx) => {
            const v = getVatAmount(tx);
            return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }, total: (rows) => sumFormatted(rows, getVatAmount) },
          { header: "Net Amount (PHP)", width: 18, get: (tx) => {
            const v = getNetAmount(tx);
            return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }, total: (rows) => sumFormatted(rows, getNetAmount) },
        );
      }

      columns.push({
        header: "Status",
        width: 14,
        get: (tx) => tx.status || "",
        // ➕ Status has no numeric sum, so its "total" doubles as a
        // record count — e.g. "128 records" — instead of sitting blank.
        total: (rows) => `${rows.length} record${rows.length === 1 ? "" : "s"}`,
      });
      return columns;
    };

    const transferColumns: SheetColumn[] = [
      { header: "Timestamp", width: 26, get: (t) => new Date(t.created_at).toLocaleString("en-PH") },
      { header: "From (Card UID)", width: 18, get: (t) => cardUidOf(t.source) },
      { header: "From Name", width: 22, get: (t) => fullNameOf(t.source) },
      { header: "To (Card UID)", width: 18, get: (t) => cardUidOf(t.target) },
      { header: "To Name", width: 22, get: (t) => fullNameOf(t.target) },
      { header: "Amount (PHP)", width: 16, get: (t) =>
        Math.abs(Number(t.amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        total: (rows) => {
          const sum = rows.reduce((s: number, t: any) => s + Math.abs(Number(t.amount) || 0), 0);
          return sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
      },
      { header: "Reason", width: 24, get: (t) => t.reason || "" },
      { header: "Status", width: 14, get: (t) => {
        const s = normalizeTransferStatus(t.status);
        return s.charAt(0).toUpperCase() + s.slice(1);
      }, total: (rows) => `${rows.length} record${rows.length === 1 ? "" : "s"}` },
    ];

    const peso2 = (n: number) =>
      n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ── 🔧 FIX: Discount Analytics rows now come straight from
    // `filteredFareDiscountBreakdown` — the SAME zero-filled, full
    // calendar-range dataset that drives the on-screen chart/table on the
    // "Discount Collection Analytics" tab. This guarantees every date in
    // the selected range appears, even if a day has ₱0.00 across the
    // board, instead of silently skipping days with no Fare transaction. ──
    const discountColumns: SheetColumn[] = [
      { header: "Date", width: 16, get: (d) =>
        new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      },
      { header: "Total Collected (PHP)", width: 20, get: (d) => peso2(d.total),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + d.total, 0)) },
      { header: "Regular (PHP)", width: 16, get: (d) => peso2(d.regular),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + d.regular, 0)) },
      { header: "Student (PHP)", width: 16, get: (d) => peso2(d.student),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + d.student, 0)) },
      { header: "Senior (PHP)", width: 16, get: (d) => peso2(d.senior),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + d.senior, 0)) },
      { header: "PWD (PHP)", width: 16, get: (d) => peso2(d.pwd),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + d.pwd, 0)) },
      { header: "Discounted Total (PHP)", width: 20, get: (d) => peso2(d.student + d.senior + d.pwd),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + d.student + d.senior + d.pwd, 0)) },
      { header: "Discounted Share", width: 16, get: (d) =>
        d.total > 0 ? `${(((d.student + d.senior + d.pwd) / d.total) * 100).toFixed(1)}%` : "0.0%",
        // ➕ overall share = total discounted / total collected across
        // the whole period, not an average of the daily percentages.
        total: (rows) => {
          const totalAll = rows.reduce((s: number, d: any) => s + d.total, 0);
          const totalDisc = rows.reduce((s: number, d: any) => s + d.student + d.senior + d.pwd, 0);
          return totalAll > 0 ? `${((totalDisc / totalAll) * 100).toFixed(1)}%` : "0.0%";
        },
      },
      { header: "Revenue Lost to 20% Discount (PHP)", width: 24, get: (d) =>
        peso2((d.student + d.senior + d.pwd) * LOST_REVENUE_MULTIPLIER),
        total: (rows) => peso2(rows.reduce((s: number, d: any) => s + (d.student + d.senior + d.pwd) * LOST_REVENUE_MULTIPLIER, 0)),
      },
    ];

    // ── 🆕 Route Performance — Summary. One row per route that had at
    // least one ride in the filtered period (`rankedRoutes` already
    // covers every route, not just the top 5 shown on the chart). ──
    const routeSummaryColumns: SheetColumn[] = [
      { header: "Rank", width: 8, get: (_r: any, idx: number) => String(idx + 1) },
      { header: "Route", width: 30, get: (r: any) => r.name },
      { header: "Total Rides", width: 14, get: (r: any) => r.totalRides.toLocaleString("en-US"),
        total: (rows) => rows.reduce((s: number, r: any) => s + r.totalRides, 0).toLocaleString("en-US") },
      { header: "Daily Avg Rides", width: 16, get: (r: any) => r.avgRidesPerDay.toFixed(1),
        total: (rows) => rows.reduce((s: number, r: any) => s + r.avgRidesPerDay, 0).toFixed(1) },
      { header: "Total Revenue (PHP)", width: 20, get: (r: any) => peso2(r.totalRevenue),
        total: (rows) => peso2(rows.reduce((s: number, r: any) => s + r.totalRevenue, 0)) },
      { header: "Daily Avg Revenue (PHP)", width: 22, get: (r: any) => peso2(r.avgRevenuePerDay),
        total: (rows) => peso2(rows.reduce((s: number, r: any) => s + r.avgRevenuePerDay, 0)) },
      { header: "Share of Rides", width: 16, get: (r: any) => `${r.sharePct.toFixed(1)}%`,
        // ➕ every route's share adds up to ~100% of routed rides.
        total: (rows) => `${rows.reduce((s: number, r: any) => s + r.sharePct, 0).toFixed(1)}%` },
    ];

    // ── 🆕 Route Performance — Daily Ridership. One row per date across
    // the SAME full, zero-filled `routePeriodDates` range used by the
    // on-screen chart (`routeDailyMap`), one column per route (every
    // route in `rankedRoutes`, not just the top 5 charted on-screen), so
    // no date and no route gets left out of the export. ──
    const routeDailyColumns: SheetColumn[] = [
      { header: "Date", width: 16, get: (row: any) =>
        new Date(row.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      },
      ...rankedRoutes.map((r): SheetColumn => ({
        header: r.name,
        width: 20,
        get: (row: any) => String(row.counts.get(r.routeId)?.count ?? 0),
        total: (rows) =>
          String(rows.reduce((s: number, row: any) => s + (row.counts.get(r.routeId)?.count ?? 0), 0)),
      })),
    ];
    const routeDailyRows = routePeriodDates.map((date) => ({
      date,
      counts: routeDailyMap.get(date) || new Map<number, { count: number; revenue: number }>(),
    }));

    const filterSuffix = isFilterActive ? ` — Filtered: ${filterLabel}` : "";

    // ── build the 6 tabs, one worksheet each ──
    const fareSheet = buildSingleSheet(utils, {
      generatedAt,
      adminName,
      subtitle: `Fare Deduction Logs${filterSuffix}`,
      block: {
        title: `FARE — DEDUCTION LOGS (${filteredFareList.length})`,
        bandColor: "B91C1C",
        columns: txColumns("−"),
        rows: filteredFareList,
        statusColIndex: 5,
        statusColorFor,
      },
    });

    // 🆕 Top-up sheet now passes `true` to txColumns to include the
    // Fee (PHP) / VAT (PHP) / Net Amount (PHP) columns, and the Status
    // column moves from index 5 to index 8 to match the new layout:
    // Timestamp(0) Card UID(1) Full Name(2) Amount(3) Signed Amount(4)
    // Fee(5) VAT(6) Net Amount(7) Status(8).
    const topupSheet = buildSingleSheet(utils, {
      generatedAt,
      adminName,
      subtitle: `Top-up Balance Logs${filterSuffix}`,
      block: {
        title: `TOP-UP — BALANCE LOGS (${filteredTopupList.length})`,
        bandColor: "047857",
        columns: txColumns("+", true),
        rows: filteredTopupList,
        statusColIndex: 8,
        statusColorFor,
      },
    });

    const transfersSheet = buildSingleSheet(utils, {
      generatedAt,
      adminName,
      subtitle: `Card Balance Transfers${filterSuffix}`,
      block: {
        title: `TRANSFERS — CARD BALANCE (${filteredTransfersList.length})`,
        bandColor: "1D4ED8",
        columns: transferColumns,
        rows: filteredTransfersList,
        statusColIndex: 7,
        statusColorFor,
      },
    });

    const discountSheet = buildSingleSheet(utils, {
      generatedAt,
      adminName,
      subtitle: `Discount Collection Analytics — Daily${filterSuffix}`,
      block: {
        title: `DISCOUNT ANALYTICS — DAILY (${filteredFareDiscountBreakdown.length})`,
        bandColor: "7C3AED",
        columns: discountColumns,
        rows: filteredFareDiscountBreakdown,
      },
    });

    const routeSummarySheet = buildSingleSheet(utils, {
      generatedAt,
      adminName,
      subtitle: `Route Performance — Summary${filterSuffix}`,
      block: {
        title: `ROUTE PERFORMANCE — SUMMARY (${rankedRoutes.length})`,
        bandColor: "EA580C",
        columns: routeSummaryColumns,
        rows: rankedRoutes,
      },
    });

    const routeDailySheet = buildSingleSheet(utils, {
      generatedAt,
      adminName,
      subtitle: `Route Performance — Daily Ridership${filterSuffix}`,
      block: {
        title: `ROUTE PERFORMANCE — DAILY RIDERSHIP (${routeDailyRows.length})`,
        bandColor: "D97706",
        columns: routeDailyColumns,
        rows: routeDailyRows,
      },
    });

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, fareSheet, safeSheetName("Fare"));
    utils.book_append_sheet(workbook, topupSheet, safeSheetName("Top-up"));
    utils.book_append_sheet(workbook, transfersSheet, safeSheetName("Transfers"));
    utils.book_append_sheet(workbook, discountSheet, safeSheetName("Discount Analytics"));
    utils.book_append_sheet(workbook, routeSummarySheet, safeSheetName("Route Summary"));
    utils.book_append_sheet(workbook, routeDailySheet, safeSheetName("Route Daily"));

    workbook.Props = {
      Title: "Transaction Logs",
      Subject: "Fare Collection Transaction Export",
      Author: adminName,
      CreatedDate: new Date(),
    };

    writeFile(workbook, `transaction-logs${filenameSuffix}-${stamp}.xlsx`);
  };

  // ══════════════════════════════════════════════════════════════════════
  // SHARED FILTER BAR — simple inline dropdowns only (no card/border
  // wrapper). Rendered directly inside each tab's own CardHeader row, next
  // to the title, so it doesn't add its own vertical block/spacing above
  // the chart/table content. Same Year/Month/Day selects + Reset button.
  // ══════════════════════════════════════════════════════════════════════
  const renderFilterBar = () => (
    <div className="flex items-center gap-1.5">
      <Filter size={12} className={isDark ? "text-slate-500" : "text-slate-400"} />

      <select
        value={filterYear}
        onChange={(e) => handleYearChange(e.target.value)}
        data-testid="select-filter-year"
        className={`h-7 rounded-md border px-2 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-700"
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
        className={`h-7 rounded-md border px-2 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-700"
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
        className={`h-7 rounded-md border px-2 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-700"
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
          className={`h-7 flex items-center gap-1 px-2 rounded-md text-[11px] font-semibold transition-colors ${
            isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <RotateCcw size={11} />
          Reset
        </button>
      )}
    </div>
  );

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

      {/* ══ TAB SWITCH — moved to the very top, right under the page header
          and above the summary cards. GCash-style flat underline tabs
          (line indicator on the active tab, no pill/card background)
          instead of the old segmented pill control. Daily Revenue
          Breakdown / Discount Collection Analytics / Detailed Revenue Log /
          Route Performance — same one-tab-visible pattern as the
          Top-up / Fare / Transfer switch on the Transactions page. ══ */}
      <div className={`flex items-center gap-6 overflow-x-auto border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        {REPORT_TABS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              data-testid={`button-tab-${key}`}
              className={`relative flex items-center gap-1.5 pb-2.5 -mb-px whitespace-nowrap text-xs font-semibold transition-colors cursor-pointer border-b-2 ${
                active
                  ? isDark ? "text-blue-400 border-blue-400" : "text-blue-600 border-blue-600"
                  : isDark ? "text-slate-500 border-transparent hover:text-slate-300" : "text-slate-400 border-transparent hover:text-slate-600"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* ══ SUMMARY CARDS — only rendered on the "Daily Revenue Breakdown"
          (first / "chart") tab. Hidden on Discount Collection Analytics,
          Detailed Revenue Log, and Route Performance. ══ */}
      {activeTab === "chart" && (
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
      )}

      {/* ══ TAB CONTENT — only the active tab's card renders. Each card's
          header row now carries the title AND the inline filter dropdowns
          together, so the filter doesn't add its own spacing block. ══ */}
      {activeTab === "chart" && (
      <Card className={`shadow-sm overflow-hidden relative flex-1 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />
        <CardHeader className={`border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <PieChart size={14} className="text-blue-500" />
                Daily Revenue Breakdown
                {isFilterActive && (
                  <span className={`normal-case font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    — {filterLabel}
                  </span>
                )}
              </CardTitle>
              {renderFilterBar()}
            </div>
            <div className={`text-[10px] font-medium uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Performance Matrix</div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
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
                    content={({ active, label }) => {
                      if (!active || !label) return null;

                      const dateKey = String(label).split("T")[0];
                      const breakdown = passengerBreakdownByDate.get(dateKey) || {
                        total: 0,
                        regular: 0,
                        student: 0,
                        senior: 0,
                        pwd: 0,
                      };

                      const date = new Date(`${dateKey}T00:00:00`);
                      const formattedDate = date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      });

                      const rows = [
                        { label: "Regular", value: breakdown.regular },
                        { label: "Student", value: breakdown.student },
                        { label: "Senior", value: breakdown.senior },
                        { label: "PWD", value: breakdown.pwd },
                      ];

                      return (
                        <div
                          style={{
                            backgroundColor: isDark ? "#0f172a" : "#ffffff",
                            border: isDark ? "1px solid #1e293b" : "1px solid #e2e8f0",
                            borderRadius: "8px",
                            padding: "10px 12px",
                            fontSize: "11px",
                            fontWeight: 600,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                            minWidth: "170px",
                          }}
                        >
                          <div
                            style={{
                              color: isDark ? "#e2e8f0" : "#1e293b",
                              marginBottom: "7px",
                              fontWeight: 700,
                            }}
                          >
                            {formattedDate}
                          </div>

                          <div
                            style={{
                              color: isDark ? "#60a5fa" : "#2563eb",
                              marginBottom: "7px",
                              paddingBottom: "7px",
                              borderBottom: isDark
                                ? "1px solid #1e293b"
                                : "1px solid #e2e8f0",
                            }}
                          >
                            Total Passengers: {breakdown.total.toLocaleString("en-US")}
                          </div>

                          {rows.map((row) => (
                            <div
                              key={row.label}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "18px",
                                color: isDark ? "#cbd5e1" : "#475569",
                                marginTop: "4px",
                              }}
                            >
                              <span>{row.label}</span>
                              <span
                                style={{
                                  color: isDark ? "#f8fafc" : "#0f172a",
                                  fontWeight: 700,
                                }}
                              >
                                {row.value.toLocaleString("en-US")}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
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
      )}

      {/* ══ DISCOUNT COLLECTION ANALYTICS ══
          Fare revenue only, split into Regular vs. Student/Senior/PWD.
          Follows the same Year/Month/Day filter, rendered inline in this
          card's header row next to the title. Trend is shown as a LINE
          GRAPH (Total/Regular/Student/Senior/PWD over time), matching the
          bar chart style used on the "Daily Revenue Breakdown" tab. The
          daily table is kept below the chart for exact per-day figures. */}
      {activeTab === "discount" && (
      <Card className={`shadow-sm overflow-hidden relative flex-1 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-600 via-indigo-500 to-transparent" />
        <CardHeader className={`border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <Percent size={14} className="text-purple-500" />
                Discount Collection Analytics
                {isFilterActive && (
                  <span className={`normal-case font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    — {filterLabel}
                  </span>
                )}
              </CardTitle>
              {renderFilterBar()}
            </div>
            <div className={`text-[10px] font-medium uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Fare collections only · Regular vs. Student / Senior / PWD
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {isLoading ? (
            <Skeleton className={`h-40 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
          ) : (
            <>
              {/* Summary chips */}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {[
                  { label: "Total Fare Collected", value: formatPeso(discountSummary.totalCollected), icon: Wallet, color: isDark ? "text-blue-400" : "text-blue-600", bg: isDark ? "bg-blue-950/40" : "bg-blue-50", border: isDark ? "border-blue-900" : "border-blue-100" },
                  { label: "Daily Average", value: formatPeso(discountDailyAverage), icon: Activity, color: isDark ? "text-cyan-400" : "text-cyan-600", bg: isDark ? "bg-cyan-950/40" : "bg-cyan-50", border: isDark ? "border-cyan-900" : "border-cyan-100" },
                  { label: "Regular (Full Fare)", value: formatPeso(discountSummary.regularRevenue), icon: Receipt, color: isDark ? "text-slate-300" : "text-slate-600", bg: isDark ? "bg-slate-800/60" : "bg-slate-100", border: isDark ? "border-slate-700" : "border-slate-200" },
                  { label: "Total Discounted", value: formatPeso(discountSummary.discountedRevenue), icon: Percent, color: isDark ? "text-purple-400" : "text-purple-600", bg: isDark ? "bg-purple-950/40" : "bg-purple-50", border: isDark ? "border-purple-900" : "border-purple-100" },
                  { label: "Discounted Share", value: `${discountSummary.discountedSharePct.toFixed(1)}%`, icon: Percent, color: isDark ? "text-orange-400" : "text-orange-600", bg: isDark ? "bg-orange-950/40" : "bg-orange-50", border: isDark ? "border-orange-900" : "border-orange-100" },
                  // ➕ Revenue lost to the 20% statutory discount.
                  { label: "Revenue Lost (20% Discount)", value: formatPeso(discountSummary.revenueLost), icon: TrendingDown, color: isDark ? "text-rose-400" : "text-rose-600", bg: isDark ? "bg-rose-950/40" : "bg-rose-50", border: isDark ? "border-rose-900" : "border-rose-100" },
                ].map((stat, idx) => (
                  <div key={idx} className={`rounded-lg border px-4 py-3 ${stat.bg} ${stat.border}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>{stat.label}</p>
                        <p className={`text-lg font-bold mt-0.5 tracking-tight ${stat.color}`}>{stat.value}</p>
                      </div>
                      <stat.icon className={stat.color} size={18} />
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Card type analytics: donut + horizontal line graph ─────── */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
                <div className={`rounded-lg border p-4 ${isDark ? "border-slate-800 bg-slate-950/40" : "border-slate-200 bg-slate-50/60"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-slate-300" : "text-slate-600"}`}>Card Type</h3>
                      <p className={`text-[11px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Registered users by card type</p>
                    </div>
                  </div>
                  {cardTypeDistribution.length === 0 ? (
                    <div className={`h-[300px] flex items-center justify-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>No registered users found.</div>
                  ) : (
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPieChart>
                          <Pie data={cardTypeDistribution} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={66} outerRadius={96} paddingAngle={2} stroke={isDark ? "#0f172a" : "#ffffff"} strokeWidth={2}>
                            {cardTypeDistribution.map((entry) => (<Cell key={entry.name} fill={CARD_TYPE_CHART_COLORS[entry.name]} />))}
                          </Pie>
                          <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fill={isDark ? "#e2e8f0" : "#1e293b"} fontSize="22" fontWeight="700">{cardTypeDistribution.reduce((sum, item) => sum + item.value, 0)}</text>
                          <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle" fill={isDark ? "#64748b" : "#94a3b8"} fontSize="10" fontWeight="600">REGISTERED USERS</text>
                          <Tooltip contentStyle={{ backgroundColor: isDark ? "#0f172a" : "#ffffff", border: isDark ? "1px solid #1e293b" : "1px solid #e2e8f0", borderRadius: "8px", fontSize: "11px", fontWeight: "600" }} formatter={(value: number, name: string) => { const total = cardTypeDistribution.reduce((sum, item) => sum + item.value, 0); const pct = total > 0 ? (value / total) * 100 : 0; return [`${value} ${value === 1 ? "user" : "users"} (${pct.toFixed(1)}%)`, name]; }} />
                          <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: "11px", fontWeight: 600 }} formatter={(value: string) => (<span style={{ color: isDark ? "#cbd5e1" : "#334155" }}>{value}</span>)} />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className={`rounded-lg border p-4 ${isDark ? "border-slate-800 bg-slate-950/40" : "border-slate-200 bg-slate-50/60"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-slate-300" : "text-slate-600"}`}>Discount Collection by Card Type</h3>
                      <p className={`text-[11px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Regular, Student, Senior, and PWD</p>
                    </div>
                  </div>
                  {filteredFareDiscountBreakdown.length === 0 ? (
                    <div className={`h-[300px] flex items-center justify-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>No fare records match the selected filter.</div>
                  ) : (
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={filteredFareDiscountBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                          <XAxis dataKey="date" tickFormatter={(d: string) => { const date = new Date(d + "T00:00:00"); return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }} stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={10} fontWeight="600" axisLine={false} tickLine={false} />
                          <YAxis stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={10} fontWeight="600" tickFormatter={(v: number) => `₱${v.toLocaleString("en-US")}`} axisLine={false} tickLine={false} width={58} />
                          <Tooltip contentStyle={{ backgroundColor: isDark ? "#0f172a" : "#ffffff", border: isDark ? "1px solid #1e293b" : "1px solid #e2e8f0", borderRadius: "8px", fontSize: "11px", fontWeight: "600", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} labelFormatter={(d: string) => { const date = new Date(d + "T00:00:00"); return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }} labelStyle={{ color: isDark ? "#e2e8f0" : "#1e293b" }} formatter={(value: number, name: string) => [formatPeso(Math.abs(value)), name]} />
                          <Legend wrapperStyle={{ fontSize: "10px", fontWeight: 600 }} formatter={(value: string) => (<span style={{ color: isDark ? "#cbd5e1" : "#334155" }}>{value}</span>)} />
                          <Line type="monotone" dataKey="regular" name="Regular" stroke={DISCOUNT_LINE_COLORS.regular} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                          <Line type="monotone" dataKey="student" name="Student" stroke={DISCOUNT_LINE_COLORS.student} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                          <Line type="monotone" dataKey="senior" name="Senior" stroke={DISCOUNT_LINE_COLORS.senior} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                          <Line type="monotone" dataKey="pwd" name="PWD" stroke={DISCOUNT_LINE_COLORS.pwd} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* Daily breakdown table — exact per-day figures backing the
                  line graph above */}
              {filteredFareDiscountBreakdown.length === 0 ? (
                <div className={`py-8 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  No fare records match the selected filter.
                </div>
              ) : (
                <div className="overflow-x-auto -mx-2 px-2">
                  <Table>
                    <TableHeader className={isDark ? "bg-slate-900" : "bg-white"}>
                      <TableRow className={`hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                        <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Date</TableHead>
                        <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Total Collected</TableHead>
                        <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Regular</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-blue-500">Student</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-yellow-600">Senior</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-emerald-600">PWD</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-purple-500">Discounted %</TableHead>
                        {/* ➕ per-day revenue lost column */}
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-rose-500">Revenue Lost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredFareDiscountBreakdown.map((day, i) => {
                        const date = new Date(day.date + "T00:00:00");
                        const discountedTotal = day.student + day.senior + day.pwd;
                        const sharePct = day.total > 0 ? (discountedTotal / day.total) * 100 : 0;
                        const dayLost = discountedTotal * LOST_REVENUE_MULTIPLIER;
                        return (
                          <TableRow
                            key={i}
                            className={`transition-colors cursor-default ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}`}
                          >
                            <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              {date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </TableCell>
                            <TableCell className={`text-right font-semibold font-mono text-sm ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              {formatPeso(day.total)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                              {formatPeso(day.regular)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                              {formatPeso(day.student)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs ${isDark ? "text-yellow-400" : "text-yellow-700"}`}>
                              {formatPeso(day.senior)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                              {formatPeso(day.pwd)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs font-semibold ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                              {sharePct.toFixed(1)}%
                            </TableCell>
                            {/* ➕ per-day revenue lost value */}
                            <TableCell className={`text-right font-mono text-xs font-semibold ${isDark ? "text-rose-400" : "text-rose-600"}`}>
                              −{formatPeso(dayLost)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      )}

      {/* ══ ROUTE PERFORMANCE ══
          Which route gets the most riders/day (Fare transactions only,
          grouped by routeId), a line-graph trend per route with a short
          linear-trend forecast, and each route's daily average. Same
          Year/Month/Day filter, rendered inline in this card's header row
          next to the title. */}
      {activeTab === "routes" && (
      <Card className={`shadow-sm overflow-hidden relative flex-1 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 via-amber-500 to-transparent" />
        <CardHeader className={`border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <RouteIcon size={14} className="text-orange-500" />
                Route Performance
                {isFilterActive && (
                  <span className={`normal-case font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    — {filterLabel}
                  </span>
                )}
              </CardTitle>
              {renderFilterBar()}
            </div>
            <div className={`text-[10px] font-medium uppercase tracking-wide flex items-center gap-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <Sparkles size={11} className="text-amber-500" />
              Fare rides only · {ROUTE_FORECAST_DAYS}-day trend forecast
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {isLoading ? (
            <Skeleton className={`h-40 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
          ) : rankedRoutes.length === 0 ? (
            <div className={`py-12 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              No routed Fare rides match the selected filter.
            </div>
          ) : (
            <>
              {/* ── Top route highlight ── */}
              {topRoute && (
                <div className={`flex items-center gap-4 rounded-lg border px-5 py-4 ${
                  isDark ? "bg-amber-950/30 border-amber-900" : "bg-amber-50 border-amber-200"
                }`}>
                  <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-none ${
                    isDark ? "bg-amber-900/50 text-amber-400" : "bg-amber-100 text-amber-600"
                  }`}>
                    <Award size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-amber-500/80" : "text-amber-700/80"}`}>
                     Most Traveled Route {isFilterActive ? `(${filterLabel})` : "(All-time)"}
                    </p>
                    <p className={`text-lg font-bold tracking-tight truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                      {topRoute.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 flex-none">
                    <div className="text-right">
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Total Rides</p>
                      <p className={`text-lg font-bold font-mono ${isDark ? "text-white" : "text-slate-900"}`}>{topRoute.totalRides.toLocaleString("en-US")}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Daily Avg</p>
                      <p className={`text-lg font-bold font-mono ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                        {topRoute.avgRidesPerDay.toFixed(1)} <span className="text-xs font-normal opacity-70">rides/day</span>
                      </p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Revenue</p>
                      <p className={`text-lg font-bold font-mono ${isDark ? "text-white" : "text-slate-900"}`}>{formatPeso(topRoute.totalRevenue)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Ranking badges for the rest of the top routes ── */}
              {rankedRoutes.length > 1 && (
                <div className="flex flex-wrap gap-3">
                  {rankedRoutes.slice(1, ROUTE_CHART_TOP_N).map((r, idx) => (
                    <div
                      key={r.routeId}
                      className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${
                        isDark ? "bg-slate-800/60 border-slate-700" : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-none ${
                        isDark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"
                      }`}>
                        {idx + 2}
                      </div>
                      <div>
                        <div className={`text-xs font-bold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{r.name}</div>
                        <div className={`text-[11px] font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {r.totalRides.toLocaleString("en-US")} rides · {r.avgRidesPerDay.toFixed(1)}/day · {r.sharePct.toFixed(0)}% share
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Line graph: ridership trend per route + short forecast ── */}
              {routeChartData.length === 0 ? (
                <div className={`h-[300px] flex items-center justify-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Not enough data to chart a trend for this filter.
                </div>
              ) : (
                <div className="h-[340px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={routeChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
                        allowDecimals={false}
                        stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={11} fontWeight="600"
                        tickFormatter={(v: number) => `${v}`} axisLine={false} tickLine={false}
                        label={{
                          value: "Rides / day",
                          angle: -90,
                          position: "insideLeft",
                          style: { fontSize: 10, fontWeight: 600, fill: isDark ? "#64748b" : "#94a3b8" },
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? "#0f172a" : "#ffffff",
                          border: isDark ? "1px solid #1e293b" : "1px solid #e2e8f0",
                          borderRadius: "8px",
                          fontSize: "11px",
                          fontWeight: "600",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        }}
                        labelFormatter={(d: string) => {
                          const date = new Date(d + "T00:00:00");
                          return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                        }}
                        labelStyle={{ color: isDark ? "#e2e8f0" : "#1e293b" }}
                        formatter={(value: number, name: string) =>
                          value === null || value === undefined ? ["—", name] : [`${value} rides`, name]
                        }
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "11px", fontWeight: 600 }}
                        formatter={(value: string) => (
                          <span style={{ color: isDark ? "#cbd5e1" : "#334155" }}>{value}</span>
                        )}
                      />
                      {routeChartSeries.map((s) => (
                        <Line
                          key={s.actualKey}
                          type="monotone"
                          dataKey={s.actualKey}
                          name={s.name}
                          stroke={s.color}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls={false}
                        />
                      ))}
                      {routeChartSeries.map((s) => (
                        <Line
                          key={s.forecastKey}
                          type="monotone"
                          dataKey={s.forecastKey}
                          name={`${s.name} (Forecast)`}
                          stroke={s.color}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          dot={false}
                          activeDot={{ r: 3 }}
                          legendType="none"
                          connectNulls={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ── Daily average table, every routed ride in the period ── */}
              <div className="overflow-x-auto -mx-2 px-2">
                <Table>
                  <TableHeader className={isDark ? "bg-slate-900" : "bg-white"}>
                    <TableRow className={`hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>#</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Route</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-orange-500">Total Rides</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Daily Avg (Rides)</TableHead>
                      <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Total Revenue</TableHead>
                      <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Daily Avg (Revenue)</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-purple-500">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedRoutes.map((r, i) => (
                      <TableRow
                        key={r.routeId}
                        className={`transition-colors cursor-default ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}`}
                      >
                        <TableCell className={`text-xs font-bold ${isDark ? "text-slate-500" : "text-slate-400"}`}>{i + 1}</TableCell>
                        <TableCell className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{r.name}</TableCell>
                        <TableCell className={`text-right font-semibold font-mono text-sm ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                          {r.totalRides.toLocaleString("en-US")}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                          {r.avgRidesPerDay.toFixed(1)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {formatPeso(r.totalRevenue)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {formatPeso(r.avgRevenuePerDay)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-semibold ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                          {r.sharePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      )}

      {/* ══ DATA TABLE ══ */}
      {activeTab === "log" && (
      <Card className={`shadow-sm flex-1 flex flex-col overflow-hidden ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <FileText size={14} className="text-blue-500" />
                Detailed Revenue Log
                {isFilterActive && (
                  <span className={`normal-case font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    — {filterLabel}
                  </span>
                )}
              </CardTitle>
              {renderFilterBar()}
            </div>
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
      )}
    </div>
  );
}