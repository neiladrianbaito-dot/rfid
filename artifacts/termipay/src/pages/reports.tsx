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

// ── NEW: shared helper to normalize the API base URL for direct fetch()
// calls (same logic used in Layout.tsx) ──
function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// ── NEW: fire-and-forget audit log call for exports. Never throws /
// never blocks the actual export — logging failure should never stop
// a user from getting their file. ──
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

export default function ReportsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const adminName = user?.name || "System Administrator";

  const prevRevenueRef = useRef<number | null>(null);
  const [revenueFlash, setRevenueFlash] = useState(false);

  const { data: report, isLoading, refetch: refetchReport } = useGetReportSummary({
    query: {
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });
  const { data: transactions, refetch: refetchTransactions } = useListTransactions();
  const { data: users, refetch: refetchUsers } = useListUsers();

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

  const totalUniqueTaps = React.useMemo(() => {
    const txList = Array.isArray(transactions) ? transactions : [];
    const uids = new Set(
      txList.map((tx: any) => tx.card_uid || tx.cardUid).filter(Boolean)
    );
    return uids.size;
  }, [transactions]);

  const totalLinkedCards = React.useMemo(() => {
    const userList = Array.isArray(users) ? users : [];
    return userList.filter((u: any) => normalizeEmail(u.email) !== null).length;
  }, [users]);

  const todayRevenue = (() => {
    const breakdown = report?.dailyBreakdown || [];
    if (!breakdown.length) return 0;
    const today = getLocalDateString();
    const todayRow = breakdown.find((d: any) => d.date === today);
    if (!todayRow) return 0;
    return Math.abs(Number(todayRow.revenue) || 0);
  })();

  const totalRevenue7Days = Math.abs(Number(report?.totalRevenue7Days ?? 0));

  const sanitizedBreakdown = (report?.dailyBreakdown || []).map((d: any) => ({
    ...d,
    revenue: Math.abs(Number(d.revenue) || 0),
  }));

  const handleOpenPreview = () => {
    navigate("/reports/preview");
  };

  const handleExportExcelLogs = async () => {
    const XLSXStyle = await import("xlsx-js-style" as any);
    const { utils, writeFile } = XLSXStyle;

    const txList = Array.isArray(transactions) ? transactions : [];
    const userList = Array.isArray(users) ? users : [];
    const stamp = getLocalDateString();
    const generatedAt = new Date().toLocaleString("en-PH", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

    // ── NEW: fire the audit log call. Fire-and-forget — we don't await
    // this before continuing the export, so a slow/failed request never
    // delays or blocks the user's download. ──
    logExportAudit({
      entity: "Transaction Logs",
      format: "Excel",
      details: `${adminName} exported transaction logs as Excel (transaction-logs-${stamp}.xlsx)`,
    });

    // ✅ FIX: Summary rows now match the 4 stat cards on the UI exactly:
    //    Row 5 → Today's Revenue  |  Total Registered Users
    //    Row 6 → 7-Day Revenue    |  Total Linked Cards
    const aoa: any[][] = [
      ["Fare Collection System", "", "", "", "", "", ""],
      ["Transaction Logs Export", "", "", "", "", "", ""],
      [`Generated: ${generatedAt}`, "", "", `Prepared by: ${adminName}`, "", "", ""],
      [],
      ["Today's Revenue", formatPeso(todayRevenue), "", "Total Registered Users", totalUniqueTaps, "", ""],
      ["7-Day Revenue", formatPeso(totalRevenue7Days), "", "Total Linked Cards", totalLinkedCards, "", ""],
      [],
      ["Timestamp", "Card UID", "Full Name", "Type", "Amount (PHP)", "Signed Amount", "Status"],
    ];

    txList.forEach((tx: any) => {
      const ts = tx.timestamp || tx.created_at;
      const amount = Math.abs(Number(tx.amount) || 0);
      aoa.push([
        ts ? new Date(ts).toLocaleString("en-PH") : "",
        tx.card_uid || tx.cardUid || "",
        tx.full_name || tx.fullName || "",
        tx.type || "",
        amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        `+${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        tx.status || "",
      ]);
    });

    const worksheet = utils.aoa_to_sheet(aoa);

    worksheet["!cols"] = [
      { wch: 26 },
      { wch: 18 },
      { wch: 24 },
      { wch: 24 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
    ];

    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
      { s: { r: 2, c: 3 }, e: { r: 2, c: 6 } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: 0 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 0 } },
      { s: { r: 4, c: 3 }, e: { r: 4, c: 3 } },
      { s: { r: 5, c: 3 }, e: { r: 5, c: 3 } },
    ];

    const setStyle = (cellRef: string, style: any) => {
      if (!worksheet[cellRef]) worksheet[cellRef] = { t: "z", v: "" };
      worksheet[cellRef].s = style;
    };

    const thinBorder = {
      top:    { style: "thin",   color: { rgb: "CBD5E1" } },
      bottom: { style: "thin",   color: { rgb: "CBD5E1" } },
      left:   { style: "thin",   color: { rgb: "CBD5E1" } },
      right:  { style: "thin",   color: { rgb: "CBD5E1" } },
    };
    const mediumBorder = {
      top:    { style: "medium", color: { rgb: "0F172A" } },
      bottom: { style: "medium", color: { rgb: "0F172A" } },
      left:   { style: "thin",   color: { rgb: "334155" } },
      right:  { style: "thin",   color: { rgb: "334155" } },
    };
    const hairBorder = {
      top:    { style: "hair",   color: { rgb: "E2E8F0" } },
      bottom: { style: "hair",   color: { rgb: "E2E8F0" } },
      left:   { style: "hair",   color: { rgb: "E2E8F0" } },
      right:  { style: "hair",   color: { rgb: "E2E8F0" } },
    };

    setStyle("A1", {
      font: { bold: true, sz: 16, color: { rgb: "FFFFFF" }, name: "Calibri" },
      fill: { fgColor: { rgb: "0F172A" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    });
    setStyle("A2", {
      font: { bold: true, sz: 11, color: { rgb: "FFFFFF" }, name: "Calibri" },
      fill: { fgColor: { rgb: "1E40AF" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    });

    const metaBase = {
      font: { italic: true, sz: 10, color: { rgb: "475569" }, name: "Calibri" },
      fill: { fgColor: { rgb: "F1F5F9" }, patternType: "solid" },
      alignment: { horizontal: "left", vertical: "center" },
    };
    setStyle("A3", metaBase);
    setStyle("D3", { ...metaBase, font: { ...metaBase.font, italic: false, bold: true } });

    // ✅ Summary row styles — Row 5: Today's Revenue (emerald) | Total Registered Users (indigo)
    const summaryLabel = {
      font: { bold: true, sz: 10, color: { rgb: "1E293B" }, name: "Calibri" },
      fill: { fgColor: { rgb: "E2E8F0" }, patternType: "solid" },
      alignment: { horizontal: "left", vertical: "center" },
      border: thinBorder,
    };
    const summaryEmerald = {
      font: { bold: true, sz: 11, color: { rgb: "15803D" }, name: "Calibri" },
      fill: { fgColor: { rgb: "F0FDF4" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
    const summaryBlue = {
      font: { bold: true, sz: 11, color: { rgb: "1D4ED8" }, name: "Calibri" },
      fill: { fgColor: { rgb: "EFF6FF" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
    const summaryIndigo = {
      font: { bold: true, sz: 11, color: { rgb: "3730A3" }, name: "Calibri" },
      fill: { fgColor: { rgb: "EEF2FF" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
    const summarySky = {
      font: { bold: true, sz: 11, color: { rgb: "0369A1" }, name: "Calibri" },
      fill: { fgColor: { rgb: "F0F9FF" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };

    // Row 5: Today's Revenue | Total Registered Users
    setStyle("A5", summaryLabel);
    setStyle("B5", summaryEmerald);
    setStyle("D5", summaryLabel);
    setStyle("E5", summaryIndigo);

    // Row 6: 7-Day Revenue | Total Linked Cards
    setStyle("A6", summaryLabel);
    setStyle("B6", summaryBlue);
    setStyle("D6", summaryLabel);
    setStyle("E6", summarySky);

    const headerStyle = {
      font: { bold: true, sz: 10, color: { rgb: "FFFFFF" }, name: "Calibri" },
      fill: { fgColor: { rgb: "1E3A5F" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
      border: mediumBorder,
    };
    ["A", "B", "C", "D", "E", "F", "G"].forEach((col) => setStyle(`${col}8`, headerStyle));

    txList.forEach((tx: any, i: number) => {
      const rowNum = 9 + i;
      const isEven = i % 2 === 0;
      const amount = Math.abs(Number(tx.amount) || 0);
      const status = (tx.status || "").toLowerCase();
      const baseFill = isEven ? "FFFFFF" : "F8FAFC";

      const base = {
        font: { sz: 10, color: { rgb: "1E293B" }, name: "Calibri" },
        fill: { fgColor: { rgb: baseFill }, patternType: "solid" },
        alignment: { horizontal: "left", vertical: "center" },
        border: hairBorder,
      };

      setStyle(`A${rowNum}`, { ...base, font: { ...base.font, color: { rgb: "64748B" } } });
      setStyle(`B${rowNum}`, { ...base, font: { ...base.font, name: "Courier New", color: { rgb: "7C3AED" } } });
      setStyle(`C${rowNum}`, { ...base, font: { ...base.font, bold: true } });
      setStyle(`D${rowNum}`, {
        ...base,
        font: { ...base.font, color: { rgb: "4338CA" } },
        fill: { fgColor: { rgb: isEven ? "F5F3FF" : "EDE9FE" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
      });
      setStyle(`E${rowNum}`, {
        ...base,
        font: { ...base.font, bold: true, color: { rgb: "15803D" } },
        alignment: { horizontal: "right", vertical: "center" },
      });
      setStyle(`F${rowNum}`, {
        ...base,
        font: { ...base.font, color: { rgb: "22C55E" } },
        alignment: { horizontal: "right", vertical: "center" },
      });

      type StatusMap = { [key: string]: { font: string; fill: string } };
      const statusMap: StatusMap = {
        success:   { font: "166534", fill: "DCFCE7" },
        completed: { font: "166534", fill: "DCFCE7" },
        failed:    { font: "991B1B", fill: "FEE2E2" },
        error:     { font: "991B1B", fill: "FEE2E2" },
        pending:   { font: "92400E", fill: "FEF3C7" },
      };
      const sc = statusMap[status] || { font: "1E293B", fill: baseFill };
      setStyle(`G${rowNum}`, {
        ...base,
        font: { ...base.font, bold: true, color: { rgb: sc.font } },
        fill: { fgColor: { rgb: sc.fill }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
      });
    });

    worksheet["!rows"] = [
      { hpt: 34 },
      { hpt: 22 },
      { hpt: 16 },
      { hpt: 8 },
      { hpt: 20 },
      { hpt: 20 },
      { hpt: 8 },
      { hpt: 22 },
    ];

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Transaction Logs");
    workbook.Props = {
      Title: "Transaction Logs",
      Subject: "Fare Collection Transaction Export",
      Author: adminName,
      CreatedDate: new Date(),
    };
    writeFile(workbook, `transaction-logs-${stamp}.xlsx`);
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

      {/* ══ BAR CHART ══ */}
      <Card className={`shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />
        <CardHeader className={`border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex items-center justify-between">
            <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <PieChart size={14} className="text-blue-500" />
              Daily Revenue Breakdown
            </CardTitle>
            <div className={`text-[10px] font-medium uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Performance Matrix</div>
          </div>
        </CardHeader>
        <CardContent className="pt-8">
          {isLoading ? (
            <Skeleton className={`h-72 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sanitizedBreakdown}>
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
                    {sanitizedBreakdown.map((_entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === sanitizedBreakdown.length - 1 ? "#3b82f6" : isDark ? "#334155" : "#cbd5e1"}
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
          <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <FileText size={14} className="text-blue-500" />
            Detailed Revenue Log
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-0 px-6 pb-6 mt-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className={`h-12 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />)}
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
                {sanitizedBreakdown.map((day: any, i: number) => {
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