import React from "react";
import { useLocation } from "wouter";
import { useGetReportSummary, useListTransactions } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch"; // ⚠️ adjust path to match where you saved that hook
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Loader2, Wallet } from "lucide-react";

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

export default function ReportPreviewPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const adminName = user?.name || "System Administrator";

  const traceId = React.useRef(Math.random().toString(36).substr(2, 9).toUpperCase()).current;
  const timestamp = React.useRef(
    new Date().toLocaleString("en-PH", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  ).current;
  const datePrinted = timestamp;

  // NOTE: assumes useGetReportSummary/useListTransactions are built on
  // react-query (or similar) and expose `refetch`. If yours doesn't,
  // tell me what the hook returns and I'll adjust.
  const { data: report, isLoading, refetch: refetchReport } = useGetReportSummary();
  const { data: transactions, refetch: refetchTransactions } = useListTransactions();

  // ══ REALTIME: auto-refetch the moment Supabase reports a change ══
  // Adjust the table list if dailyBreakdown/totalRevenue7Days are
  // derived from more than just "transactions" on the backend.
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
    // FIX: use local date, not UTC, so "today" matches the actual
    // calendar date the report's dailyBreakdown rows are keyed on.
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

  const handlePrint = () => window.print();
  const handleBack = () => navigate("/reports");

  if (isLoading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-100">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        <p className="mt-4 text-sm font-medium text-slate-500">Loading report preview...</p>
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
    }
  }
`}</style>
      <div className="min-h-screen bg-slate-200">
        {/* ══ TOOLBAR ══ */}
        <div className="preview-toolbar sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-300 bg-white px-6 py-4 shadow-sm">
          <Button
            variant="outline"
            onClick={handleBack}
            className="font-bold uppercase text-xs tracking-widest"
            data-testid="button-back-reports"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">
            Revenue Audit Report Preview
          </div>
          <Button
            onClick={handlePrint}
            className="bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs tracking-widest"
            data-testid="button-print"
          >
            <Printer className="w-4 h-4 mr-2" />
            Print / Save as PDF
          </Button>
        </div>

        {/* ══ PAGE WRAP ══ */}
        <div className="flex justify-center py-10 px-4">
          <div
            className="audit-doc bg-white shadow-2xl"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "14mm 16mm",
              fontFamily: "'Times New Roman', Times, serif",
              color: "#000",
              lineHeight: 1.4,
              boxSizing: "border-box",
            }}
          >
            {/* Letterhead */}
            <div style={{ borderBottom: "3px double #000", paddingBottom: "10px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "16px" }}>
              <img src="/bagong.png" alt="Bagong Pilipinas" style={{ width: "72px", height: "72px", flexShrink: 0, objectFit: "contain" }} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: "9pt", fontWeight: "bold", letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #000", paddingBottom: "2px", marginBottom: "6px" }}>
                  Republic of the Philippines
                </div>
                <div style={{ fontSize: "16pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Fare Collection System
                </div>
                <div style={{ fontSize: "8pt", letterSpacing: "0.12em", textTransform: "uppercase", color: "#333", marginTop: "4px" }}>
                  City Accounting Office &nbsp;•&nbsp; Calbayog City, Western Samar
                </div>
              </div>
              <img src="/calbayog.svg" alt="Calbayog City Seal" style={{ width: "72px", height: "72px", flexShrink: 0, objectFit: "contain" }} />
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
                  borderBottom: "1.5px solid #000",
                  display: "inline-block",
                }}>
                  Official Revenue Audit Report
                </div>
              </div>
              <div style={{ fontSize: "9pt", marginTop: "10px", color: "#222" }}>
                7-Day Financial Performance Summary
              </div>
            </div>

            {/* Metadata table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt", marginBottom: "12px", border: "1px solid #000" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontWeight: "bold", width: "25%", background: "#f0f0f0" }}>Document Reference No.</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", width: "25%", fontFamily: "monospace" }}>TP-REV-{traceId}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontWeight: "bold", width: "20%", background: "#f0f0f0" }}>Date Generated</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", width: "30%" }}>{timestamp}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontWeight: "bold", background: "#f0f0f0" }}>Prepared By</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000" }}>{adminName}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontWeight: "bold", background: "#f0f0f0" }}>Classification</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000" }}>CONFIDENTIAL — FOR OFFICIAL USE</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontWeight: "bold", background: "#f0f0f0" }}>Report Coverage</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000" }}>Last 7 Calendar Days</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontWeight: "bold", background: "#f0f0f0" }}>System Version</td>
                  <td style={{ padding: "4px 8px", border: "1px solid #000", fontFamily: "monospace" }}>Fare Collection System v1.0.0</td>
                </tr>
              </tbody>
            </table>

            {/* Section I */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", borderBottom: "2px solid #000", paddingBottom: "2px", marginBottom: "10px", letterSpacing: "0.06em" }}>
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
                      <td key={i} style={{ width: "33.3%", border: "1px solid #000", padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: "8pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #999", paddingBottom: "4px", marginBottom: "6px" }}>
                          {kpi.label}
                        </div>
                        <div style={{ fontSize: "16pt", fontWeight: "bold", fontFamily: "monospace" }}>
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
              <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", borderBottom: "2px solid #000", paddingBottom: "2px", marginBottom: "10px", letterSpacing: "0.06em" }}>
                II. &nbsp; Daily Revenue Breakdown
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
                <thead>
                  <tr style={{ background: "#e8e8e8" }}>
                    <th style={{ border: "1px solid #000", padding: "5px 8px", textAlign: "left", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>No.</th>
                    <th style={{ border: "1px solid #000", padding: "5px 8px", textAlign: "left", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date</th>
                    <th style={{ border: "1px solid #000", padding: "5px 8px", textAlign: "left", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Day of Week</th>
                    <th style={{ border: "1px solid #000", padding: "5px 8px", textAlign: "right", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Revenue Collected (PHP)</th>
                  </tr>
                </thead>
                <tbody>
                  {sanitizedBreakdown.map((day: any, i: number) => {
                    const date = new Date(day.date + "T00:00:00");
                    const isLast = i === sanitizedBreakdown.length - 1;
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f8f8" }}>
                        <td style={{ border: "1px solid #000", padding: "4px 8px", textAlign: "center", fontFamily: "monospace" }}>{String(i + 1).padStart(2, "0")}</td>
                        <td style={{ border: "1px solid #000", padding: "4px 8px", fontWeight: isLast ? "bold" : "normal" }}>
                          {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                        </td>
                        <td style={{ border: "1px solid #000", padding: "4px 8px" }}>
                          {date.toLocaleDateString("en-US", { weekday: "long" })}
                        </td>
                        <td style={{ border: "1px solid #000", padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: isLast ? "bold" : "normal" }}>
                          {day.revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "#e8e8e8", fontWeight: "bold" }}>
                    <td colSpan={3} style={{ border: "1px solid #000", padding: "5px 8px", textAlign: "right", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Grand Total
                    </td>
                    <td style={{ border: "1px solid #000", padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontSize: "10pt" }}>
                      {grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Section III */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase", borderBottom: "2px solid #000", paddingBottom: "2px", marginBottom: "10px", letterSpacing: "0.06em" }}>
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
                    <div style={{ borderBottom: "1.5px solid #000", marginBottom: "4px", paddingBottom: "20px" }} />
                    <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase" }}>{adminName}</div>
                    <div style={{ fontSize: "8.5pt", color: "#333" }}>System Administrator / Report Author</div>
                    <div style={{ fontSize: "8pt", color: "#555", marginTop: "2px" }}>Fare Collection System</div>
                    <div style={{ fontSize: "8pt", color: "#555", marginTop: "8px", fontStyle: "italic" }}>
                      Date: ___________________________
                    </div>
                  </td>
                  <td style={{ width: "50%", border: "none", paddingLeft: "20px", verticalAlign: "top" }}>
                    <div style={{ borderBottom: "1.5px solid #000", marginBottom: "4px", paddingBottom: "20px" }} />
                    <div style={{ fontSize: "10pt", fontWeight: "bold", textTransform: "uppercase" }}>Financial Auditor</div>
                    <div style={{ fontSize: "8.5pt", color: "#333" }}>Verified By / Authorized Signatory</div>
                    <div style={{ fontSize: "8pt", color: "#555", marginTop: "2px" }}>Financial Audit Division</div>
                    <div style={{ fontSize: "8pt", color: "#555", marginTop: "8px", fontStyle: "italic" }}>
                      Date: ___________________________
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div style={{
              marginTop: "16px",
              borderTop: "2px solid #000",
              paddingTop: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "7.5pt",
              color: "#444",
            }}>
              <span><strong>Date Printed:</strong> {datePrinted}</span>
              <span style={{ textAlign: "center" }}>Fare Collection System — CONFIDENTIAL</span>
              <span><strong>Printed By:</strong> {adminName}</span>
            </div>
          </div>
        </div>

        {/* ══ DASHBOARD FOOTER ══ */}
        <footer className="border-t border-slate-800/60 pt-4 pb-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-700">
            <div className="flex items-center gap-2">
              <Wallet size={10} className="text-emerald-500/30" />
              <span>Fare Collection System</span>
            </div>
            <div className="flex items-center gap-3">
              <span>© {new Date().getFullYear()} All rights reserved.</span>
              <span className="text-slate-800">|</span>
              <span className="text-emerald-500/30">v1.0.0</span>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}