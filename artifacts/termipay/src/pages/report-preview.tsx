import React from "react";
import { useLocation } from "wouter";
import { useGetReportSummary, useListTransactions } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch"; // ⚠️ adjust path to match where you saved that hook
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Loader2, Wallet, Plus, Minus, RotateCcw, CheckCircle2 } from "lucide-react";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// FIX: get the date string in LOCAL time (YYYY-MM-DD), not UTC.
// new Date().toISOString() always converts to UTC, which is 8 hours
// behind Philippine time — so between 12am–8am local time it returns
// "yesterday's" date and todayRevenue silently breaks.
const getLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ── shared helper to normalize the API base URL for direct fetch()
// calls (same logic used in Layout.tsx / ReportsPage.tsx) ──
function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// ── fire-and-forget audit log call for the print/PDF export.
// Never throws / never blocks the actual print dialog from opening. ──
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

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 100;

// How long the "Preparing to print..." toast stays on screen before
// the actual browser print dialog is triggered.
const PRINT_TOAST_DELAY_MS = 900;

// ══ THEME ══
// Single source of truth for the report's color palette, matching the
// sidebar's blue theme in Layout.tsx (blue-950 → blue-600 → blue-300).
const THEME = {
  darkest: "#172554",   // blue-950 — letterhead border / headers
  dark: "#1e3a8a",      // blue-900 — section titles / strong borders
  primary: "#1d4ed8",   // blue-700 — accents, KPI numbers
  mid: "#2563eb",       // blue-600 — call-to-action accents
  border: "#93c5fd",    // blue-300 — light table borders
  headerBg: "#eff6ff",  // blue-50  — table header fill
  altRowBg: "#f8faff",  // near-white blue tint for zebra rows
  totalBg: "#dbeafe",   // blue-100 — grand total row fill
  text: "#0f172a",      // slate-900 — body copy
  muted: "#475569",     // slate-600 — secondary copy
};

export default function ReportPreviewPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const adminName = user?.name || "System Administrator";

  const [zoom, setZoom] = React.useState(ZOOM_DEFAULT);
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  const zoomReset = () => setZoom(ZOOM_DEFAULT);

  // ══ PRINT TOAST ══
  const [isPreparingPrint, setIsPreparingPrint] = React.useState(false);
  const printTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (printTimeoutRef.current) clearTimeout(printTimeoutRef.current);
    };
  }, []);

  const handlePrint = () => {
    if (isPreparingPrint) return; // guard against double-clicks
    setIsPreparingPrint(true);

    logExportAudit({
      entity: "Revenue Audit Report",
      format: "PDF/Print",
      details: `${adminName} opened print/PDF dialog for revenue audit report (Ref: TP-REV-${traceId})`,
    });

    printTimeoutRef.current = setTimeout(() => {
      window.print();
      setIsPreparingPrint(false);
    }, PRINT_TOAST_DELAY_MS);
  };

  // ══ MOUSE-WHEEL ZOOM ══
  const pageWrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = pageWrapRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      setZoom((z) => {
        const delta = e.deltaY > 0 ? -5 : 5;
        const next = z + delta;
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const traceId = React.useRef(Math.random().toString(36).substr(2, 9).toUpperCase()).current;
  const timestamp = React.useRef(
    new Date().toLocaleString("en-PH", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  ).current;
  const datePrinted = timestamp;

  const { data: report, isLoading, refetch: refetchReport } = useGetReportSummary();
  const { data: transactions, refetch: refetchTransactions } = useListTransactions();

  useRealtimeRefetch(["transactions"], () => {
    refetchReport();
    refetchTransactions();
  });

  const totalUniqueTaps = React.useMemo(() => {
    const txList = Array.isArray(transactions) ? transactions : [];
    const uids = new Set(
      txList.map((tx: any) => tx.card_uid || tx.cardUid).filter(Boolean)
    );
    return uids.size;
  }, [transactions]);

  const todayRevenue = (() => {
    const breakdown = report?.dailyBreakdown || [];
    if (!breakdown.length) return 0;
    const today = getLocalDateString(new Date());
    const todayRow = breakdown.find((d: any) => d.date === today);
    if (!todayRow) return 0;
    return Math.abs(Number(todayRow.revenue) || 0);
  })();

  const totalRevenue7Days = Math.abs(Number(report?.totalRevenue7Days ?? 0));

  const sanitizedBreakdown = (report?.dailyBreakdown || []).map((d: any) => ({
    ...d,
    revenue: Math.abs(Number(d.revenue) || 0),
  }));

  const grandTotal = sanitizedBreakdown.reduce((sum: number, d: any) => sum + d.revenue, 0);

  const handleBack = () => navigate("/reports");

  if (isLoading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-blue-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="mt-4 text-sm font-medium text-blue-900">Loading report preview...</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
  @media print {
    @page {
      size: A4 portrait;
      margin: 0;
    }
    body * {
      visibility: hidden;
    }
    .audit-doc, .audit-doc * {
      visibility: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .audit-doc {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      box-shadow: none !important;
      padding: 12mm 14mm !important;
      /* zoom must never affect the printed output */
      transform: none !important;
    }
    .print-toast {
      display: none !important;
    }
  }

  @keyframes print-toast-in {
    from { opacity: 0; transform: translate(-50%, 8px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
`}</style>

      {/* ══ "PREPARING TO PRINT" TOAST ══ */}
      {isPreparingPrint && (
        <div
          className="print-toast fixed bottom-6 left-1/2 z-50 flex items-center gap-3 rounded-lg border border-blue-200 bg-white px-4 py-3 shadow-xl"
          style={{ animation: "print-toast-in 180ms ease-out" }}
          role="status"
          aria-live="polite"
          data-testid="toast-preparing-print"
        >
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-blue-600" />
          <span className="text-xs font-semibold text-blue-900">
            Preparing to print the report<span className="animate-pulse">…</span>
          </span>
        </div>
      )}

      <div className="flex min-h-screen flex-col bg-blue-100/60">
        {/* ══ TOOLBAR ══ */}
        <div className="preview-toolbar sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-blue-200 bg-white px-6 py-4 shadow-sm">
          <Button
            variant="outline"
            onClick={handleBack}
            className="font-bold uppercase text-xs tracking-widest cursor-pointer border-blue-200 text-blue-700 transition-colors duration-150 hover:bg-blue-50 active:bg-blue-100"
            data-testid="button-back-reports"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <div className="text-xs font-black uppercase tracking-widest text-blue-900">
            Revenue Audit Report Preview
          </div>

          <div className="flex items-center gap-3">
            {/* ══ ZOOM CONTROLS ══ */}
            <div className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1 py-1">
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom <= ZOOM_MIN}
                title="Zoom out"
                data-testid="button-zoom-out"
                className="flex h-7 w-7 items-center justify-center rounded cursor-pointer text-blue-700 transition-colors duration-150 hover:bg-blue-200 active:bg-blue-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={zoomReset}
                title="Reset zoom"
                data-testid="button-zoom-reset"
                className="min-w-[3.25rem] cursor-pointer rounded px-1.5 py-1 text-center text-[11px] font-bold tabular-nums text-blue-700 transition-colors duration-150 hover:bg-blue-200 active:bg-blue-300"
              >
                {zoom}%
              </button>

              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom >= ZOOM_MAX}
                title="Zoom in"
                data-testid="button-zoom-in"
                className="flex h-7 w-7 items-center justify-center rounded cursor-pointer text-blue-700 transition-colors duration-150 hover:bg-blue-200 active:bg-blue-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button
              onClick={handlePrint}
              disabled={isPreparingPrint}
              className="bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white font-black uppercase text-xs tracking-widest cursor-pointer transition-colors duration-150 hover:shadow-lg hover:shadow-blue-500/30 disabled:cursor-not-allowed disabled:opacity-70"
              data-testid="button-print"
            >
              {isPreparingPrint ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4 mr-2" />
                  Print / Save as PDF
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ══ PAGE WRAP ══ */}
        <div ref={pageWrapRef} className="flex flex-1 justify-center overflow-auto py-10 px-4">
          <div
            className="audit-doc bg-white shadow-2xl"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "14mm 16mm",
              fontFamily: "'Times New Roman', Times, serif",
              color: THEME.text,
              lineHeight: 1.4,
              boxSizing: "border-box",
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
              transition: "transform 150ms ease-out",
              marginBottom: zoom > 100 ? `${(zoom - 100) * 3}mm` : 0,
            }}
          >
            {/* Letterhead */}
            <div style={{ borderBottom: `3px double ${THEME.darkest}`, paddingBottom: "10px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "16px" }}>
              <img src="/bagong.png" alt="Bagong Pilipinas" style={{ width: "72px", height: "72px", flexShrink: 0, objectFit: "contain" }} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: "9pt", fontWeight: "bold", letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: `1px solid ${THEME.dark}`, paddingBottom: "2px", marginBottom: "6px", color: THEME.dark }}>
                  Republic of the Philippines
                </div>
                <div style={{ fontSize: "16pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em", color: THEME.darkest }}>
                  Fare Collection System
                </div>
                <div style={{ fontSize: "8pt", letterSpacing: "0.12em", textTransform: "uppercase", color: THEME.muted, marginTop: "4px" }}>
                  City Accounting Office &nbsp;•&nbsp; Calbayog City, Western Samar
                </div>
              </div>
              <img src="/calbayog.png" alt="Calbayog City Seal" style={{ width: "72px", height: "72px", flexShrink: 0, objectFit: "contain" }} />
            </div>

            {/* Document title */}
            <div style={{ textAlign: "center", marginBottom: "12px" }}>
              <div style={{ display: "inline-block" }}>
                <div style={{
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  paddingBottom: "6px",
                  borderBottom: `1.5px solid ${THEME.primary}`,
                  display: "inline-block",
                  color: THEME.darkest,
                }}>
                  Official Revenue Audit Report
                </div>
              </div>
              <div style={{ fontSize: "9pt", marginTop: "10px", color: THEME.muted }}>
                7-Day Financial Performance Summary
              </div>
            </div>

            {/* Metadata table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt", marginBottom: "12px", border: `1px solid ${THEME.border}` }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontWeight: "bold", width: "25%", background: THEME.headerBg, color: THEME.dark }}>Document Reference No.</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, width: "25%", fontFamily: "monospace" }}>TP-REV-{traceId}</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontWeight: "bold", width: "20%", background: THEME.headerBg, color: THEME.dark }}>Date Generated</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, width: "30%" }}>{timestamp}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontWeight: "bold", background: THEME.headerBg, color: THEME.dark }}>Prepared By</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}` }}>{adminName}</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontWeight: "bold", background: THEME.headerBg, color: THEME.dark }}>Classification</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}` }}>CONFIDENTIAL — FOR OFFICIAL USE</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontWeight: "bold", background: THEME.headerBg, color: THEME.dark }}>Report Coverage</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}` }}>Last 7 Calendar Days</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontWeight: "bold", background: THEME.headerBg, color: THEME.dark }}>System Version</td>
                  <td style={{ padding: "4px 8px", border: `1px solid ${THEME.border}`, fontFamily: "monospace" }}>Fare Collection System v1.0.0</td>
                </tr>
              </tbody>
            </table>

            {/* Section I */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", borderBottom: `2px solid ${THEME.dark}`, paddingBottom: "2px", marginBottom: "10px", letterSpacing: "0.06em", color: THEME.darkest }}>
                I. &nbsp; Executive Summary
              </div>
              <p style={{ fontSize: "9pt", textAlign: "justify", marginBottom: "8px" }}>
                This document constitutes an official financial audit report generated by the Fare Collection System. The data presented herein reflects all recorded fare deduction transactions processed through RFID-enabled terminals within the covered reporting period.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
                <tbody>
                  <tr>
                    {[
                      { label: "Total Revenue (7 Days)", value: formatPeso(totalRevenue7Days) },
                      { label: "Today's Revenue", value: formatPeso(todayRevenue) },
                      { label: "Total Registered Users", value: String(totalUniqueTaps) },
                    ].map((kpi, i) => (
                      <td key={i} style={{ width: "33.3%", border: `1px solid ${THEME.border}`, padding: "10px 12px", textAlign: "center", background: THEME.altRowBg }}>
                        <div style={{ fontSize: "8pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `1px solid ${THEME.border}`, paddingBottom: "4px", marginBottom: "6px", color: THEME.dark }}>
                          {kpi.label}
                        </div>
                        <div style={{ fontSize: "16pt", fontWeight: "bold", fontFamily: "monospace", color: THEME.primary }}>
                          {kpi.value}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Section II */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", borderBottom: `2px solid ${THEME.dark}`, paddingBottom: "2px", marginBottom: "10px", letterSpacing: "0.06em", color: THEME.darkest }}>
                II. &nbsp; Daily Revenue Breakdown
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
                <thead>
                  <tr style={{ background: THEME.dark }}>
                    <th style={{ border: `1px solid ${THEME.border}`, padding: "5px 8px", textAlign: "left", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff" }}>No.</th>
                    <th style={{ border: `1px solid ${THEME.border}`, padding: "5px 8px", textAlign: "left", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff" }}>Date</th>
                    <th style={{ border: `1px solid ${THEME.border}`, padding: "5px 8px", textAlign: "left", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff" }}>Day of Week</th>
                    <th style={{ border: `1px solid ${THEME.border}`, padding: "5px 8px", textAlign: "right", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff" }}>Revenue Collected (PHP)</th>
                  </tr>
                </thead>
                <tbody>
                  {sanitizedBreakdown.map((day: any, i: number) => {
                    const date = new Date(day.date + "T00:00:00");
                    const isLast = i === sanitizedBreakdown.length - 1;
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : THEME.altRowBg }}>
                        <td style={{ border: `1px solid ${THEME.border}`, padding: "4px 8px", textAlign: "center", fontFamily: "monospace" }}>{String(i + 1).padStart(2, "0")}</td>
                        <td style={{ border: `1px solid ${THEME.border}`, padding: "4px 8px", fontWeight: isLast ? "bold" : "normal" }}>
                          {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                        </td>
                        <td style={{ border: `1px solid ${THEME.border}`, padding: "4px 8px" }}>
                          {date.toLocaleDateString("en-US", { weekday: "long" })}
                        </td>
                        <td style={{ border: `1px solid ${THEME.border}`, padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: isLast ? "bold" : "normal", color: isLast ? THEME.primary : THEME.text }}>
                          {day.revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: THEME.totalBg, fontWeight: "bold" }}>
                    <td colSpan={3} style={{ border: `1px solid ${THEME.border}`, padding: "5px 8px", textAlign: "right", textTransform: "uppercase", letterSpacing: "0.05em", color: THEME.darkest }}>
                      Grand Total
                    </td>
                    <td style={{ border: `1px solid ${THEME.border}`, padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontSize: "10pt", color: THEME.darkest }}>
                      {grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Section III */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", borderBottom: `2px solid ${THEME.dark}`, paddingBottom: "2px", marginBottom: "10px", letterSpacing: "0.06em", color: THEME.darkest }}>
                III. &nbsp; Certification
              </div>
              <p style={{ fontSize: "9pt", textAlign: "justify" }}>
                I hereby certify that the information contained in this report is true, accurate, and complete to the best of my knowledge, and that this document was generated directly from the Fare Collection System database at the date and time indicated above.
              </p>
            </div>

            {/* Signature block */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "22px" }}>
              <tbody>
                <tr>
                  <td style={{ width: "50%", border: "none", paddingRight: "20px", verticalAlign: "top" }}>
                    <div style={{ borderBottom: `1.5px solid ${THEME.dark}`, marginBottom: "4px", paddingBottom: "20px" }} />
                    <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", color: THEME.darkest }}>{adminName}</div>
                    <div style={{ fontSize: "8.5pt", color: THEME.muted }}>System Administrator / Report Author</div>
                    <div style={{ fontSize: "8pt", color: THEME.muted, marginTop: "2px" }}>Fare Collection System</div>
                    <div style={{ fontSize: "8pt", color: THEME.muted, marginTop: "8px", fontStyle: "italic" }}>
                      Date: ___________________________
                    </div>
                  </td>
                  <td style={{ width: "50%", border: "none", paddingLeft: "20px", verticalAlign: "top" }}>
                    <div style={{ borderBottom: `1.5px solid ${THEME.dark}`, marginBottom: "4px", paddingBottom: "20px" }} />
                    <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", color: THEME.darkest }}>Financial Auditor</div>
                    <div style={{ fontSize: "8.5pt", color: THEME.muted }}>Verified By / Authorized Signatory</div>
                    <div style={{ fontSize: "8pt", color: THEME.muted, marginTop: "2px" }}>Financial Audit Division</div>
                    <div style={{ fontSize: "8pt", color: THEME.muted, marginTop: "8px", fontStyle: "italic" }}>
                      Date: ___________________________
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div style={{
              marginTop: "16px",
              borderTop: `2px solid ${THEME.dark}`,
              paddingTop: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "7.5pt",
              color: THEME.muted,
            }}>
              <span><strong>Date Printed:</strong> {datePrinted}</span>
              <span style={{ textAlign: "center", color: THEME.dark, fontWeight: "bold" }}>Fare Collection System — CONFIDENTIAL</span>
              <span><strong>Printed By:</strong> {adminName}</span>
            </div>
          </div>
        </div>

        {/* ══ DASHBOARD FOOTER ══ */}
        <footer className="sticky bottom-0 z-20 border-t border-blue-200 bg-white px-6 py-3 shadow-[0_-1px_4px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-blue-800/70">
            <div className="flex items-center gap-2">
              <Wallet size={10} className="text-blue-400" />
              <span>Fare Collection System</span>
            </div>
            <div className="flex items-center gap-3">
              <span>© {new Date().getFullYear()} All rights reserved.</span>
              <span className="text-blue-200">|</span>
              <span className="text-blue-700">v1.0.0</span>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}