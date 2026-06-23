import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGetReportSummary, useListTransactions, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import {
  Eye,
  TrendingUp,
  Calendar,
  Fingerprint,
  BarChart3,
  Activity,
  PieChart,
  FileText,
  FileSpreadsheet,
  LinkIcon,
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

export default function ReportsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
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
      className="space-y-8 h-full flex flex-col"
      style={{ overflowX: "hidden", maxWidth: "100%", boxSizing: "border-box" }}
      data-testid="reports-page"
    >
      <style>{`
        html, body { overflow-x: hidden !important; }
        @keyframes card-pulse {
          0%   { box-shadow: 0 0 20px rgba(16,185,129,0.3); }
          50%  { box-shadow: 0 0 40px rgba(16,185,129,0.7); }
          100% { box-shadow: 0 0 20px rgba(16,185,129,0.3); }
        }
        .card-pulse { animation: card-pulse 0.8s ease-in-out; }
      `}</style>

      {/* ══ HEADER ══ */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic flex items-center gap-3">
            <BarChart3 className="text-blue-500" />
            Revenue <span className="text-blue-500">Report</span>
          </h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
            Strategic financial intelligence and 7-day performance metrics
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <Activity className="text-blue-400 animate-pulse" size={16} />
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">
              Real-time Stream Active
            </span>
          </div>
          <Button
            onClick={handleExportExcelLogs}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase text-[10px] tracking-widest px-6"
            data-testid="button-export-excel-logs"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export Excel Logs
          </Button>
          <Button
            onClick={handleOpenPreview}
            className="bg-slate-100 hover:bg-white text-slate-950 font-black uppercase text-[10px] tracking-widest px-6"
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
          { label: "7-Day Revenue",          value: formatPeso(totalRevenue7Days), icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", testId: "text-total-revenue",      flash: false },
          { label: "Today's Revenue",         value: formatPeso(todayRevenue),      icon: Calendar,   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", testId: "text-today-revenue",      flash: revenueFlash },
          { label: "Total Registered Users",  value: totalUniqueTaps,               icon: Fingerprint,color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20",  testId: "text-total-taps",         flash: false },
          { label: "Total Linked Cards",      value: totalLinkedCards,              icon: LinkIcon,   color: "text-sky-400",     bg: "bg-sky-500/10",     border: "border-sky-500/20",     testId: "text-total-linked-cards", flash: false },
        ].map((stat, idx) => (
          <Card key={idx} className={`bg-slate-900/40 border-slate-800 backdrop-blur-md ${stat.flash ? "card-pulse" : ""}`}>
            <CardContent className="p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 opacity-5">
                <stat.icon className="w-full h-full" />
              </div>
              {isLoading ? (
                <Skeleton className="h-12 w-full bg-slate-800/50" />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</p>
                    <p className={`text-2xl font-black mt-1 tracking-tighter ${stat.color}`} data-testid={stat.testId}>
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
      <Card className="bg-slate-900/40 border-slate-800 backdrop-blur-md shadow-2xl overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />
        <CardHeader className="border-b border-slate-800/50 bg-slate-900/20">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <PieChart size={14} className="text-blue-500" />
              Daily Revenue Breakdown
            </CardTitle>
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter">Performance Matrix</div>
          </div>
        </CardHeader>
        <CardContent className="pt-8">
          {isLoading ? (
            <Skeleton className="h-72 w-full bg-slate-800/30" />
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sanitizedBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => {
                      const date = new Date(d + "T00:00:00");
                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    }}
                    stroke="#475569" fontSize={10} fontWeight="bold" axisLine={false} tickLine={false}
                  />
                  <YAxis
                    stroke="#475569" fontSize={10} fontWeight="bold"
                    tickFormatter={(v: number) => `₱${v.toLocaleString("en-US")}`} axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                    contentStyle={{ backgroundColor: "#020617", border: "1px solid #1e293b", borderRadius: "8px", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase" }}
                    itemStyle={{ color: "#3b82f6" }}
                    formatter={(value: number) => [formatPeso(Math.abs(value)), "Revenue"]}
                  />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {sanitizedBreakdown.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={index === sanitizedBreakdown.length - 1 ? "#3b82f6" : "#1e293b"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ DATA TABLE ══ */}
      <Card className="bg-slate-900/40 border-slate-800 backdrop-blur-md shadow-2xl flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex-none pb-4 bg-slate-900/20 border-b border-slate-800/50">
          <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <FileText size={14} className="text-blue-500" />
            Detailed Revenue Log
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-0 px-6 pb-6 mt-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-800/30" />)}
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/50">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Log Date</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Standard Day</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-blue-500">Revenue Credited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sanitizedBreakdown.map((day: any, i: number) => {
                  const date = new Date(day.date + "T00:00:00");
                  return (
                    <TableRow key={i} className="border-slate-800/50 hover:bg-white/5 transition-colors">
                      <TableCell className="text-xs font-bold text-white">
                        {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-[10px] font-black text-slate-500 uppercase">
                        {date.toLocaleDateString("en-US", { weekday: "long" })}
                      </TableCell>
                      <TableCell className="text-right font-black text-emerald-400 font-mono text-xs">
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