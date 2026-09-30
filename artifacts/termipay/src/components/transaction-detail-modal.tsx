import { useRef, useState } from "react";
import {
  Hash,
  Calendar,
  Clock,
  CreditCard,
  Receipt,
  ShieldCheck,
  Route,
  Wallet,
  X,
  ArrowLeftRight,
  Download,
  FileText,
  Printer,
  Loader2,
} from "lucide-react";
import { toPng } from "html-to-image"; // 🆕 npm i html-to-image jspdf
import { jsPDF } from "jspdf"; // 🆕
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Transaction = {
  id: string | number;
  timestamp: string;
  type: string;
  amount: number | string;
  status: string;
  route_id?: number | null;
  payment_method?: string | null;
  fee_amount?: number | string | null;
  vat_amount?: number | string | null;
  net_amount?: number | string | null;
};

export type FareRoute = {
  id: number;
  origin: string;
  destination: string;
  fareAmount: number;
  isActive: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(amount: number | string): string {
  const num = Math.abs(Number(amount || 0)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `\u20B1${num}`;
}

function getFeeAmount(tx: Transaction): number | null {
  const value = tx?.fee_amount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVatAmount(tx: Transaction): number | null {
  const value = tx?.vat_amount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getNetAmount(tx: Transaction): number | null {
  const value = tx?.net_amount;
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

function formatNullableAmount(value: number | null): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `\u20B1${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

function formatPaymentMethod(method?: string | null): string | null {
  if (!method) return null;
  const map: Record<string, string> = {
    gcash: "GCash",
    paymaya: "Maya",
    card: "Card",
    grab_pay: "GrabPay",
    billease: "BillEase",
    dob: "Online Banking",
    dob_ubp: "UnionBank",
    qrph: "QR Ph",
  };
  const key = method.toLowerCase().trim();
  return map[key] ?? method.charAt(0).toUpperCase() + method.slice(1);
}

function getPaymentMethodLogo(method?: string | null): string | null {
  if (!method) return null;
  const key = method.toLowerCase().trim();
  if (key === "gcash") return "/gcash.svg";
  return null;
}

// 🆕 Load a data URL into an <img> so we can read its natural size (for PDF sizing)
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TransactionDetailModalProps {
  tx: Transaction | null;
  onClose: () => void;
  routes: FareRoute[];
}

export function TransactionDetailModal({
  tx,
  onClose,
  routes,
}: TransactionDetailModalProps) {
  const { isDark } = useTheme();

  // 🆕 Ref to the receipt card + busy state (hooks must stay above the early return)
  const receiptRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "image" | "pdf" | "print">(null);

  if (!tx) return null;

  const isFare = tx.type === "Fare";
  const date = new Date(tx.timestamp);

  const safeRoutes = Array.isArray(routes) ? routes : [];
  const matchedRoute =
    isFare && tx.route_id
      ? safeRoutes.find((r) => r.id === tx.route_id) ?? null
      : null;

  const paymentMethodLabel = formatPaymentMethod(tx.payment_method);
  const paymentMethodLogo = getPaymentMethodLogo(tx.payment_method);

  const originalAmount = Math.abs(Number(tx.amount || 0));
  const netAmount = getNetAmount(tx);
  const feeAmount = getFeeAmount(tx);
  const vatAmount = getVatAmount(tx);
  const heroAmount = !isFare && netAmount != null ? netAmount : originalAmount;

  const amountColor = isFare
    ? isDark ? "text-red-400" : "text-red-600"
    : isDark ? "text-emerald-400" : "text-emerald-600";

  // 🆕 ── Export helpers ───────────────────────────────────────────────────────
  const fileBase = `receipt-TXN-${tx.id}`;

  /** Renders the receipt card to a PNG data URL (buttons are excluded). */
  const captureReceipt = async (): Promise<string> => {
    const node = receiptRef.current;
    if (!node) throw new Error("Receipt not ready");
    return toPng(node, {
      pixelRatio: 3, // sharp on retina / when printed
      cacheBust: true,
      backgroundColor: isDark ? "#0f172a" : "#ffffff",
      // skip anything marked data-no-capture (close X, action buttons, footer)
      filter: (n) =>
        !(n instanceof HTMLElement && n.dataset.noCapture === "true"),
    });
  };

  const handleDownloadImage = async () => {
    try {
      setBusy("image");
      const dataUrl = await captureReceipt();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileBase}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("Failed to save receipt image:", err);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setBusy("pdf");
      const dataUrl = await captureReceipt();
      const img = await loadImage(dataUrl);

      // A4 portrait, receipt centered at 90mm wide (keeps aspect ratio)
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const imgW = 90;
      const imgH = (img.naturalHeight / img.naturalWidth) * imgW;
      const x = (pageW - imgW) / 2;
      const y = 15;
      pdf.addImage(dataUrl, "PNG", x, y, imgW, imgH);
      pdf.save(`${fileBase}.pdf`);
    } catch (err) {
      console.error("Failed to create receipt PDF:", err);
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = async () => {
    try {
      setBusy("print");
      const dataUrl = await captureReceipt();

      // Hidden iframe → print dialog (user can also choose "Save as PDF")
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !iframe.contentWindow) throw new Error("Print frame unavailable");

      doc.open();
      doc.write(`<!DOCTYPE html>
<html>
  <head>
    <title>${fileBase}</title>
    <style>
      @page { size: A4; margin: 15mm; }
      html, body { margin: 0; padding: 0; }
      body { display: flex; justify-content: center; }
      img { width: 90mm; height: auto; }
    </style>
  </head>
  <body><img id="receipt" src="${dataUrl}" /></body>
</html>`);
      doc.close();

      const img = doc.getElementById("receipt") as HTMLImageElement | null;
      const doPrint = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        // clean up after the dialog closes
        setTimeout(() => iframe.remove(), 1000);
      };
      if (img && !img.complete) img.onload = doPrint;
      else doPrint();
    } catch (err) {
      console.error("Failed to print receipt:", err);
    } finally {
      setBusy(null);
    }
  };

  const rows = [
    {
      icon: <Hash className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Transaction ID",
      value: String(tx.id),
      mono: true,
    },
    {
      icon: <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Date",
      value: date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      mono: false,
    },
    {
      icon: <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Time",
      value: date.toLocaleTimeString(),
      mono: false,
    },
    {
      icon: <CreditCard className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />,
      label: "Service type",
      value: tx.type,
      mono: false,
    },
  ];

  const actionBtnClass = `h-8 gap-1.5 text-[10px] sm:text-xs font-semibold cursor-pointer ${
    isDark
      ? "border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-800"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
  }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-3 sm:px-4 cursor-pointer"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl cursor-default border ${
          isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 🆕 Everything inside this wrapper is what gets exported */}
        <div
          ref={receiptRef}
          className={isDark ? "bg-slate-900" : "bg-white"}
        >
          {/* Top accent stripe */}
          <div className={`h-1 w-full ${isFare ? "bg-red-500" : "bg-emerald-500"}`} />

          {/* Header */}
          <div className={`flex items-center justify-between px-4 sm:px-5 py-2 sm:py-2.5 border-b ${
            isDark ? "border-slate-800" : "border-slate-100"
          }`}>
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isFare ? "bg-red-500/10" : "bg-emerald-500/10"
                }`}
              >
                <Receipt
                  className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
                    isFare ? "text-red-400" : "text-emerald-400"
                  }`}
                />
              </div>
              <div>
                <p className={`text-xs sm:text-sm font-semibold leading-none ${
                  isDark ? "text-white" : "text-slate-900"
                }`}>
                  Receipt
                </p>
                <p className={`text-[9px] sm:text-[10px] font-mono mt-0.5 ${
                  isDark ? "text-slate-500" : "text-slate-400"
                }`}>
                  #TXN-{tx.id}
                </p>
              </div>
            </div>
            {/* excluded from the export */}
            <Button
              data-no-capture="true"
              size="icon"
              variant="ghost"
              onClick={onClose}
              className={`h-7 w-7 rounded-lg shrink-0 cursor-pointer ${
                isFare
                  ? "text-red-500 hover:text-red-300 hover:bg-red-500/10"
                  : "text-emerald-500 hover:text-emerald-300 hover:bg-emerald-500/10"
              }`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Amount hero */}
          <div className={`px-4 sm:px-5 pt-2.5 sm:pt-3 pb-2 sm:pb-2.5 border-b border-dashed text-center ${
            isDark ? "border-slate-700" : "border-slate-300"
          }`}>
            <p className={`text-2xl sm:text-3xl font-black tracking-tighter ${amountColor}`}>
              {isFare
                ? formatAmount(tx.amount)
                : formatNullableAmount(heroAmount)}
            </p>
            <p className={`text-[9px] sm:text-[10px] mt-0.5 ${
              isDark ? "text-slate-500" : "text-slate-400"
            }`}>
              {date.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}{" "}
              · {date.toLocaleTimeString()}
            </p>
          </div>

          {/* Detail rows */}
          <div className="px-4 sm:px-5 pt-2 sm:pt-2.5 pb-1.5">
            <p className={`text-[9px] font-black uppercase tracking-widest mb-1.5 ${
              isDark ? "text-slate-600" : "text-slate-400"
            }`}>
              Transaction details
            </p>
            <div className={`rounded-xl overflow-hidden border divide-y ${
              isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-200"
            }`}>
              {rows.map(({ icon, label, value, mono }) => (
                <div
                  key={label}
                  className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                    isDark ? "bg-slate-950/40" : "bg-slate-50"
                  }`}
                >
                  <span className={`flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] shrink-0 ${
                    isDark ? "text-slate-500" : "text-slate-400"
                  }`}>
                    {icon}
                    {label}
                  </span>
                  <span
                    className={`text-[10px] sm:text-xs text-right truncate max-w-[55%] ${
                      isDark ? "text-slate-200" : "text-slate-700"
                    } ${mono ? "font-mono" : "font-medium"}`}
                  >
                    {value}
                  </span>
                </div>
              ))}

              {/* Payment method — only for Top-up (non-Fare) transactions */}
              {!isFare && (
                <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                  isDark ? "bg-slate-950/40" : "bg-slate-50"
                }`}>
                  <span className={`flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] shrink-0 ${
                    isDark ? "text-slate-500" : "text-slate-400"
                  }`}>
                    <Wallet className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                    Payment method
                  </span>
                  <span className={`flex items-center justify-end gap-1.5 text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${
                    isDark ? "text-slate-200" : "text-slate-700"
                  }`}>
                    {paymentMethodLabel ? (
                      <>
                        {paymentMethodLogo && (
                          <img
                            src={paymentMethodLogo}
                            alt={paymentMethodLabel}
                            className="h-6 sm:h-7 w-auto max-w-[40px] object-contain shrink-0"
                          />
                        )}
                        <span className="truncate">{paymentMethodLabel}</span>
                      </>
                    ) : (
                      <span className={isDark ? "text-slate-600" : "text-slate-400"}>—</span>
                    )}
                  </span>
                </div>
              )}

              {/* Amount / Fee / VAT / Net Amount — Top-up only */}
              {!isFare && (
                <>
                  <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                    isDark ? "bg-slate-950/40" : "bg-slate-50"
                  }`}>
                    <span className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest shrink-0 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      Amount
                    </span>
                    <span className={`text-[10px] sm:text-xs font-mono font-bold ${
                      isDark ? "text-slate-200" : "text-slate-700"
                    }`}>
                      {formatAmount(originalAmount)}
                    </span>
                  </div>
                  <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                    isDark ? "bg-slate-950/40" : "bg-slate-50"
                  }`}>
                    <span className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest shrink-0 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      Fee
                    </span>
                    <span className={`text-[10px] sm:text-xs font-mono font-medium ${
                      isDark ? "text-slate-200" : "text-slate-700"
                    }`}>
                      {formatNullableAmount(feeAmount)}
                    </span>
                  </div>
                  <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                    isDark ? "bg-slate-950/40" : "bg-slate-50"
                  }`}>
                    <span className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest shrink-0 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      VAT
                    </span>
                    <span className={`text-[10px] sm:text-xs font-mono font-medium ${
                      isDark ? "text-slate-200" : "text-slate-700"
                    }`}>
                      {formatNullableAmount(vatAmount)}
                    </span>
                  </div>
                  <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                    isDark ? "bg-slate-950/40" : "bg-slate-50"
                  }`}>
                    <span className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest shrink-0 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      Net Amount
                    </span>
                    <span className={`text-[10px] sm:text-xs font-mono font-bold ${
                      isDark ? "text-emerald-400" : "text-emerald-600"
                    }`}>
                      {formatNullableAmount(netAmount)}
                    </span>
                  </div>
                </>
              )}

              {/* Status row */}
              <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                isDark ? "bg-slate-950/40" : "bg-slate-50"
              }`}>
                <span className={`flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] shrink-0 ${
                  isDark ? "text-slate-500" : "text-slate-400"
                }`}>
                  <ShieldCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                  Status
                </span>
                <span className={`text-[10px] sm:text-xs font-medium ${
                  isDark ? "text-white" : "text-slate-900"
                }`}>
                  {tx.status}
                </span>
              </div>

              {/* Route — only for Fare type */}
              {isFare && (
                <div className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
                  isDark ? "bg-slate-950/40" : "bg-slate-50"
                }`}>
                  <span className={`flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] shrink-0 ${
                    isDark ? "text-slate-500" : "text-slate-400"
                  }`}>
                    <Route className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                    Route
                  </span>
                  <span className={`flex items-center gap-1 sm:gap-1.5 justify-end text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${
                    isDark ? "text-slate-200" : "text-slate-700"
                  }`}>
                    {matchedRoute ? (
                      <>
                        <span className="truncate">{matchedRoute.origin}</span>
                        <ArrowLeftRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                        <span className="truncate">{matchedRoute.destination}</span>
                      </>
                    ) : (
                      <span className={isDark ? "text-slate-600" : "text-slate-400"}>—</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Total line */}
          <div className={`mx-4 sm:mx-5 mt-1.5 sm:mt-2 mb-3 border-t border-dashed pt-1.5 sm:pt-2 flex items-center justify-between gap-2 ${
            isDark ? "border-slate-700" : "border-slate-300"
          }`}>
            <span className={`text-[10px] sm:text-xs font-semibold ${
              isDark ? "text-slate-400" : "text-slate-500"
            }`}>
              {isFare ? "Amount deducted" : "Net Amount"}
            </span>
            <span className={`text-xs sm:text-sm font-black ${amountColor}`}>
              {isFare
                ? formatAmount(tx.amount)
                : formatNullableAmount(netAmount)}
            </span>
          </div>
        </div>
        {/* 🆕 ── end of exported area ─────────────────────────────────────── */}

        {/* Footer (not exported) */}
        <div className="px-4 sm:px-5 pb-3 sm:pb-4 space-y-2">
          {/* 🆕 Download image / PDF / Print — Fare type only */}
          {isFare && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={handleDownloadImage}
                className={actionBtnClass}
              >
                {busy === "image" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Image
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={handleDownloadPdf}
                className={actionBtnClass}
              >
                {busy === "pdf" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={handlePrint}
                className={actionBtnClass}
              >
                {busy === "print" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}
                Print
              </Button>
            </div>
          )}

          <Button
            onClick={onClose}
            className="w-full text-white border-0 font-semibold transition-colors text-sm sm:text-base cursor-pointer"
            style={{ backgroundColor: isFare ? "#dc2626" : "#059669" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                isFare ? "#ef4444" : "#10b981";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                isFare ? "#dc2626" : "#059669";
            }}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}