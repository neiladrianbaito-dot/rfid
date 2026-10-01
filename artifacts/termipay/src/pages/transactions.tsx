import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { ReactNode, KeyboardEvent } from "react";
import { useListTransactions } from "@workspace/api-client-react";
import { useTheme } from "@/hooks/use-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { supabase } from "@/lib/supabase";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Search,
  Zap,
  History,
  ChevronLeft,
  ChevronRight,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Route,
  CreditCard,
  ArrowLeftRight,
  ArrowRightLeft,
  Hash,
  Calendar,
  Receipt,
  ShieldCheck,
  Wallet,
  X,
  Download,
  FileText,
  Printer,
  Loader2,
  User,
  BadgeCheck,
} from "lucide-react";

const PAGE_SIZE = 10;

// Stable empty array — para hindi magbago ang reference habang wala pang data.
const EMPTY_LIST: any[] = [];

type FareRoute = {
  id: number;
  origin: string;
  destination: string;
  fare_amount: number;
};

type TransferCard = {
  id: number;
  card_uid?: string | null;
  cardUid?: string | null;
  full_name?: string | null;
  fullName?: string | null;
};

type TransferStatus = "pending" | "completed" | "failed";

type CardTransfer = {
  id: number;
  source_card_id: number;
  target_card_id: number;
  amount: number;
  reason: string;
  source_balance_before: number | null;
  target_balance_before: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  // optional snapshot columns (filled automatically when a user is deleted)
  source_card_uid?: string | null;
  source_full_name?: string | null;
  target_card_uid?: string | null;
  target_full_name?: string | null;
  source: TransferCard | null;
  target: TransferCard | null;
};

type FinancialFields = {
  fee_amount: number | null;
  vat_amount: number | null;
  net_amount: number | null;
};

// 🆕 Passenger info looked up from the `users` table by card_uid
type PassengerInfo = {
  full_name: string | null;
  card_type: string | null;
};

type TxView = "topup" | "fare" | "transfers";
type TxType = "Fare" | "Top-up";

// ══════════════════════════════════════════════════════════════════════════
// PAGE STYLES — ONE-FOLDER look. The active tab and the body are ONE shape.
// • No overflow on the tab strip (nothing gets clipped = no "cut").
// • Active tab has an ::after "cover" that hides the body's top border
//   under it (no reliance on a fragile -1px overlap alone).
// • Hover = TEXT color only.
// • Responsive: on small screens the tabs share the full width equally.
// ══════════════════════════════════════════════════════════════════════════
const TX_CSS = `
.tp {
  --tp-bg: #ffffff;
  --tp-border: #e4e4e7;
  --tp-divider: #ececee;
  --tp-muted: #71717a;
  --tp-text: #27272a;
  --tp-accent: #2563eb;
  --tp-radius: 18px;
  --tp-shadow:
    0 1px 2px rgba(24, 24, 27, 0.06),
    0 10px 24px -8px rgba(24, 24, 27, 0.14),
    0 24px 48px -20px rgba(24, 24, 27, 0.14);
}
.tp[data-theme="dark"] {
  --tp-bg: #0f172a;
  --tp-border: #1e293b;
  --tp-divider: #1e293b;
  --tp-muted: #94a3b8;
  --tp-text: #e2e8f0;
  --tp-accent: #60a5fa;
  --tp-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 12px 28px -10px rgba(0, 0, 0, 0.55);
}

.tp {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  min-width: 0;
  background: transparent;
}

/* No overflow here on purpose — overflow would clip the active tab's cover. */
.tp-tabs {
  position: relative;
  z-index: 2;
  display: flex;
  flex: none;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 0;
  background: transparent;
}

.tp-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  padding: 10px 18px;
  margin: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--tp-muted);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  box-shadow: none;
  outline: none;
  cursor: pointer;
  transition: color 0.15s ease;
}

/* Hover = TEXT ONLY */
.tp-tab:hover {
  color: var(--tp-text);
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

/* Active tab = same color as the body → looks like ONE piece */
.tp-tab[aria-selected="true"],
.tp-tab[aria-selected="true"]:hover {
  color: var(--tp-accent);
  background: var(--tp-bg);
  border-color: var(--tp-border);
  box-shadow: none;
  margin-bottom: -1px;
  padding-bottom: 11px;
  z-index: 3;
}

/* Cover: hides the body's top border directly under the active tab */
.tp-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 3px;
  background: var(--tp-bg);
  pointer-events: none;
}

.tp-tab svg { width: 14px; height: 14px; flex: none; }
.tp-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tp-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--tp-muted);
  border: 1px solid var(--tp-divider);
}
.tp-tab:hover .tp-count { color: var(--tp-text); }
.tp-tab[aria-selected="true"] .tp-count {
  color: var(--tp-accent);
  border-color: var(--tp-border);
}

.tp-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--tp-bg);
  color: var(--tp-text);
  border: 1px solid var(--tp-border);
  border-radius: 0 var(--tp-radius) var(--tp-radius) var(--tp-radius);
  box-shadow: var(--tp-shadow);
}

/* If the FIRST tab is not active, round the body's top-left corner */
.tp[data-first="false"] .tp-body {
  border-top-left-radius: var(--tp-radius);
}

.tp-toolbar {
  flex: none;
  padding: 16px 24px;
  border-bottom: 1px solid var(--tp-divider);
  background: transparent;
}

.tp .tp-thead { background: var(--tp-bg); }

.tp-tab:focus-visible {
  outline: 2px solid var(--tp-accent);
  outline-offset: 2px;
}

/* ── Responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .tp-tabs { gap: 2px; }
  .tp-tab {
    flex: 1 1 0;
    gap: 5px;
    padding: 9px 6px;
    font-size: 11px;
    border-radius: 10px 10px 0 0;
  }
  .tp-tab[aria-selected="true"],
  .tp-tab[aria-selected="true"]:hover { padding-bottom: 10px; }
  .tp-count { padding: 0 5px; font-size: 9px; }
  .tp-toolbar { padding: 12px 16px; }
  .tp { --tp-radius: 14px; }
}

@media (max-width: 420px) {
  .tp-tab { gap: 4px; padding: 8px 4px; font-size: 10.5px; }
  .tp-tab svg { width: 12px; height: 12px; }
  .tp-count { display: none; }
  .tp-tab[aria-selected="true"],
  .tp-tab[aria-selected="true"]:hover { padding-bottom: 9px; }
}
`;

// ── 🧊 NO-FLICKER HELPER ────────────────────────────────────────────────────
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function extractList(value: unknown): any[] | null {
  if (Array.isArray(value)) return value;
  const v = value as any;
  if (v && Array.isArray(v.data)) return v.data;
  if (v && Array.isArray(v.transactions)) return v.transactions;
  if (v && Array.isArray(v.items)) return v.items;
  return null;
}

function findRouteFor(tx: any, routes: FareRoute[]): FareRoute | null {
  const routeId = tx?.route_id ?? tx?.routeId;
  if (routeId != null && routeId !== "") {
    const found = routes.find((route) => route.id === Number(routeId));
    if (found) return found;
  }
  if (tx?.origin || tx?.destination) {
    return {
      id: -1,
      origin: tx.origin ?? "—",
      destination: tx.destination ?? "—",
      fare_amount: Number(tx.amount),
    };
  }
  return null;
}

function normalizeTxType(type?: string | null): TxType {
  const key = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "fare") return "Fare";
  return "Top-up";
}

function normalizeTransferStatus(status?: string | null): TransferStatus {
  const key = (status ?? "").toLowerCase().trim();
  if (key === "completed" || key === "complete" || key === "success") return "completed";
  if (key === "failed" || key === "failure" || key === "error") return "failed";
  return "pending";
}

function cardUidOf(card?: TransferCard | null): string {
  return card?.card_uid || card?.cardUid || "—";
}

function fullNameOf(card?: TransferCard | null): string {
  if (!card) return "Deleted user";
  return card.full_name || card.fullName || "Unknown";
}

function formatAmount(amount: number): string {
  return Math.abs(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getFeeAmount(tx: any): number | null {
  return toNullableNumber(tx?.fee_amount ?? tx?.feeAmount);
}

function getVatAmount(tx: any): number | null {
  return toNullableNumber(tx?.vat_amount ?? tx?.vatAmount);
}

function getNetAmount(tx: any): number | null {
  const value = tx?.net_amount ?? tx?.netAmount;
  if (value != null && value !== "") {
    return toNullableNumber(value);
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
  return value == null || !Number.isFinite(value) ? "—" : `₱${formatAmount(value)}`;
}

function formatNetAmountWithSign(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `+₱${formatAmount(value)}`;
}

function formatPaymentMethod(method?: string | null): string {
  if (!method) return "—";
  const map: Record<string, string> = {
    gcash: "GCash",
    paymaya: "Maya",
    maya: "Maya",
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

// 🆕 Card type → display label ("Senior Citizen", "senior-citizen", "PWD"...)
function formatCardType(type?: string | null): string {
  if (!type) return "—";
  const key = type.toLowerCase().trim().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    senior: "Senior Citizen",
    senior_citizen: "Senior Citizen",
    pwd: "PWD",
    student: "Student",
    regular: "Regular",
  };
  return map[key] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

// 🆕 Passenger name / card type readers (accept snake_case + camelCase)
function getPassengerName(tx: any): string {
  const value =
    tx?.passenger_name ?? tx?.passengerName ?? tx?.full_name ?? tx?.fullName ?? "";
  const name = String(value).trim();
  return name || "—";
}

function getCardType(tx: any): string | null {
  return tx?.card_type ?? tx?.cardType ?? null;
}

// 🆕 Load a data URL into an <img> so we can read its natural size (for PDF)
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── 🗂️ One-folder container: transparent tab strip + single white body ─────
type TxTabDef = { key: TxView; label: string; icon: typeof CreditCard; count: number };

function TxPanel({
  tabs,
  active,
  onChange,
  isDark,
  children,
}: {
  tabs: TxTabDef[];
  active: TxView;
  onChange: (key: TxView) => void;
  isDark: boolean;
  children: ReactNode;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  };

  return (
    <div
      className="tp"
      data-theme={isDark ? "dark" : "light"}
      data-first={active === tabs[0]?.key ? "true" : "false"}
      data-testid="transactions-panel"
    >
      <div className="tp-tabs" role="tablist" aria-label="Transaction types">
        {tabs.map(({ key, label, icon: Icon, count }, i) => (
          <button
            key={key}
            type="button"
            ref={(el) => { tabRefs.current[key] = el; }}
            role="tab"
            id={`tp-tab-${key}`}
            aria-selected={active === key}
            aria-controls={`tp-panel-${key}`}
            tabIndex={active === key ? 0 : -1}
            className="tp-tab"
            onClick={() => onChange(key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            <Icon aria-hidden="true" />
            <span className="tp-label">{label}</span>
            <span className="tp-count">{count}</span>
          </button>
        ))}
      </div>

      <div
        className="tp-body"
        role="tabpanel"
        id={`tp-panel-${active}`}
        aria-labelledby={`tp-tab-${active}`}
      >
        {children}
      </div>
    </div>
  );
}

// ── Reusable row para sa Transfer modal ─────────────────────────────────────
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

// ── 🆕 Small row used inside the receipt (same look as the user dashboard) ──
function ReceiptRow({
  isDark,
  icon,
  label,
  upper,
  children,
}: {
  isDark: boolean;
  icon?: ReactNode;
  label: string;
  upper?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2 ${
        isDark ? "bg-slate-950/40" : "bg-slate-50"
      }`}
    >
      <span
        className={`flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] shrink-0 ${
          upper ? "font-semibold uppercase tracking-widest" : ""
        } ${isDark ? "text-slate-500" : "text-slate-400"}`}
      >
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

// ── 🆕 Receipt Modal — SAME design for Top-up and Fare ──────────────────────
function ReceiptModal({
  tx,
  routes,
  onClose,
  isDark,
}: {
  tx: any | null;
  routes: FareRoute[];
  onClose: () => void;
  isDark: boolean;
}) {
  // hooks must stay above the early return
  const receiptRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "image" | "pdf" | "print">(null);

  if (!tx) return null;

  const isFare = normalizeTxType(tx.type) === "Fare";
  const date = new Date(tx.timestamp || tx.created_at);

  const matchedRoute = isFare ? findRouteFor(tx, routes) : null;

  const paymentMethodLabel = !isFare ? formatPaymentMethod(tx.payment_method) : null;
  const paymentMethodLogo = !isFare ? getPaymentMethodLogo(tx.payment_method) : null;

  const originalAmount = Math.abs(Number(tx.amount || 0));
  const netAmount = getNetAmount(tx);
  const feeAmount = getFeeAmount(tx);
  const vatAmount = getVatAmount(tx);
  const heroAmount = !isFare && netAmount != null ? netAmount : originalAmount;

  const amountColor = isFare
    ? isDark ? "text-red-400" : "text-red-600"
    : isDark ? "text-emerald-400" : "text-emerald-600";

  const valueText = isDark ? "text-slate-200" : "text-slate-700";
  const mutedDash = isDark ? "text-slate-600" : "text-slate-400";
  const iconCls = "h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0";

  const statusTextColor =
    tx.status === "Failed"
      ? isDark ? "text-red-400" : "text-red-600"
      : tx.status === "Pending"
        ? isDark ? "text-amber-400" : "text-amber-600"
        : isDark ? "text-white" : "text-slate-900";

  // ── Export helpers ────────────────────────────────────────────────────────
  const fileBase = `receipt-TXN-${tx.id}`;

  const captureReceipt = async (): Promise<string> => {
    const node = receiptRef.current;
    if (!node) throw new Error("Receipt not ready");
    return toPng(node, {
      pixelRatio: 3,
      cacheBust: true,
      backgroundColor: isDark ? "#0f172a" : "#ffffff",
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

  const actionBtnClass = `h-8 gap-1.5 text-[10px] sm:text-xs font-semibold cursor-pointer ${
    isDark
      ? "border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-800"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
  }`;

  return (
    <Dialog open={!!tx} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:hidden ${
          isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Transaction Receipt</DialogTitle>
          <DialogDescription>Transaction #{tx.id}</DialogDescription>
        </VisuallyHidden>

        {/* Everything inside this wrapper is what gets exported */}
        <div ref={receiptRef} className={isDark ? "bg-slate-900" : "bg-white"}>
          {/* Top accent stripe */}
          <div className={`h-1 w-full ${isFare ? "bg-red-500" : "bg-emerald-500"}`} />

          {/* Company header */}
          <div
            className={`px-4 sm:px-5 pt-3 pb-2.5 text-center border-b border-dashed ${
              isDark ? "border-slate-700" : "border-slate-300"
            }`}
          >
            <p className={`text-xs sm:text-sm font-black tracking-wide ${isDark ? "text-white" : "text-slate-900"}`}>
              D&apos; TURBANADA TRANSPORT, INC.
            </p>
            <p className={`text-[9px] sm:text-[10px] leading-snug mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              JD Avelino St., Brgy. West Awang, Calbayog City, Samar, Philippines
            </p>
            <p className={`text-[9px] sm:text-[10px] leading-snug ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Non Vat Reg. TIN 496-013-435-00005
            </p>
            <p className={`text-[9px] sm:text-[10px] leading-snug ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              CP #09171281530
            </p>
          </div>

          {/* Header */}
          <div
            className={`flex items-center justify-between px-4 sm:px-5 py-2 sm:py-2.5 border-b ${
              isDark ? "border-slate-800" : "border-slate-100"
            }`}
          >
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isFare ? "bg-red-500/10" : "bg-emerald-500/10"
                }`}
              >
                <Receipt
                  className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isFare ? "text-red-400" : "text-emerald-400"}`}
                />
              </div>
              <div>
                <p className={`text-xs sm:text-sm font-semibold leading-none ${isDark ? "text-white" : "text-slate-900"}`}>
                  Receipt
                </p>
                <p className={`text-[9px] sm:text-[10px] font-mono mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
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
          <div
            className={`px-4 sm:px-5 pt-2.5 sm:pt-3 pb-2 sm:pb-2.5 border-b border-dashed text-center ${
              isDark ? "border-slate-700" : "border-slate-300"
            }`}
          >
            <p className={`text-2xl sm:text-3xl font-black tracking-tighter ${amountColor}`}>
              {isFare ? `₱${formatAmount(originalAmount)}` : formatNullableAmount(heroAmount)}
            </p>
            <p className={`text-[9px] sm:text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ·{" "}
              {date.toLocaleTimeString()}
            </p>
          </div>

          {/* Detail rows */}
          <div className="px-4 sm:px-5 pt-2 sm:pt-2.5 pb-1.5">
            <p className={`text-[9px] font-black uppercase tracking-widest mb-1.5 ${isDark ? "text-slate-600" : "text-slate-400"}`}>
              Transaction details
            </p>
            <div
              className={`rounded-xl overflow-hidden border divide-y ${
                isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-200"
              }`}
            >
              <ReceiptRow isDark={isDark} icon={<Hash className={iconCls} />} label="Transaction ID">
                <span className={`text-[10px] sm:text-xs font-mono text-right truncate max-w-[55%] ${valueText}`}>
                  {String(tx.id)}
                </span>
              </ReceiptRow>

              <ReceiptRow isDark={isDark} icon={<Calendar className={iconCls} />} label="Date">
                <span className={`text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                  {date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                </span>
              </ReceiptRow>

              <ReceiptRow isDark={isDark} icon={<Clock className={iconCls} />} label="Time">
                <span className={`text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                  {date.toLocaleTimeString()}
                </span>
              </ReceiptRow>

              <ReceiptRow isDark={isDark} icon={<CreditCard className={iconCls} />} label="Card UID">
                <span className={`text-[10px] sm:text-xs font-mono font-semibold text-right truncate max-w-[55%] ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                  {tx.card_uid || tx.cardUid || "—"}
                </span>
              </ReceiptRow>

              <ReceiptRow isDark={isDark} icon={<CreditCard className={iconCls} />} label="Service type">
                <span className={`text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                  {isFare ? "Fare" : "Top-up"}
                </span>
              </ReceiptRow>

              <ReceiptRow isDark={isDark} icon={<User className={iconCls} />} label="Passenger">
                <span className={`text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                  {getPassengerName(tx)}
                </span>
              </ReceiptRow>

              <ReceiptRow isDark={isDark} icon={<BadgeCheck className={iconCls} />} label="Card type">
                <span className={`text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                  {formatCardType(getCardType(tx))}
                </span>
              </ReceiptRow>

              {/* Payment method — Top-up only */}
              {!isFare && (
                <ReceiptRow isDark={isDark} icon={<Wallet className={iconCls} />} label="Payment method">
                  <span className={`flex items-center justify-end gap-1.5 text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                    {paymentMethodLabel && paymentMethodLabel !== "—" ? (
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
                      <span className={mutedDash}>—</span>
                    )}
                  </span>
                </ReceiptRow>
              )}

              {/* Amount / Fee / VAT / Net — Top-up only */}
              {!isFare && (
                <>
                  <ReceiptRow isDark={isDark} label="Amount" upper>
                    <span className={`text-[10px] sm:text-xs font-mono font-bold ${valueText}`}>
                      ₱{formatAmount(originalAmount)}
                    </span>
                  </ReceiptRow>
                  <ReceiptRow isDark={isDark} label="Fee" upper>
                    <span className={`text-[10px] sm:text-xs font-mono font-medium ${valueText}`}>
                      {formatNullableAmount(feeAmount)}
                    </span>
                  </ReceiptRow>
                  <ReceiptRow isDark={isDark} label="VAT" upper>
                    <span className={`text-[10px] sm:text-xs font-mono font-medium ${valueText}`}>
                      {formatNullableAmount(vatAmount)}
                    </span>
                  </ReceiptRow>
                  <ReceiptRow isDark={isDark} label="Net Amount" upper>
                    <span className={`text-[10px] sm:text-xs font-mono font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      {formatNullableAmount(netAmount)}
                    </span>
                  </ReceiptRow>
                </>
              )}

              {/* Status */}
              <ReceiptRow isDark={isDark} icon={<ShieldCheck className={iconCls} />} label="Status">
                <span className={`text-[10px] sm:text-xs font-medium ${statusTextColor}`}>
                  {tx.status}
                </span>
              </ReceiptRow>

              {/* Route — Fare only */}
              {isFare && (
                <ReceiptRow isDark={isDark} icon={<Route className={iconCls} />} label="Route">
                  <span className={`flex items-center gap-1 sm:gap-1.5 justify-end text-[10px] sm:text-xs font-medium text-right truncate max-w-[55%] ${valueText}`}>
                    {matchedRoute ? (
                      <>
                        <span className="truncate">{matchedRoute.origin}</span>
                        <ArrowLeftRight className={iconCls} />
                        <span className="truncate">{matchedRoute.destination}</span>
                      </>
                    ) : (
                      <span className={mutedDash}>—</span>
                    )}
                  </span>
                </ReceiptRow>
              )}
            </div>
          </div>

          {/* Total line */}
          <div
            className={`mx-4 sm:mx-5 mt-1.5 sm:mt-2 mb-3 border-t border-dashed pt-1.5 sm:pt-2 flex items-center justify-between gap-2 ${
              isDark ? "border-slate-700" : "border-slate-300"
            }`}
          >
            <span className={`text-[10px] sm:text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {isFare ? "Amount deducted" : "Net Amount"}
            </span>
            <span className={`text-xs sm:text-sm font-black ${amountColor}`}>
              {isFare ? `₱${formatAmount(originalAmount)}` : formatNullableAmount(netAmount)}
            </span>
          </div>
        </div>
        {/* ── end of exported area ── */}

        {/* Footer (not exported) — Image / PDF / Print for BOTH types */}
        <div className="px-4 sm:px-5 pb-3 sm:pb-4 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={handleDownloadImage}
              className={actionBtnClass}
            >
              {busy === "image" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Image
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={handleDownloadPdf}
              className={actionBtnClass}
            >
              {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={handlePrint}
              className={actionBtnClass}
            >
              {busy === "print" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              Print
            </Button>
          </div>

          <Button
            onClick={onClose}
            className="w-full text-white border-0 font-semibold transition-colors text-sm sm:text-base cursor-pointer"
            style={{ backgroundColor: isFare ? "#dc2626" : "#059669" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = isFare ? "#ef4444" : "#10b981";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = isFare ? "#dc2626" : "#059669";
            }}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Transfer Modal ──────────────────────────────────────────────────────────
function TransferModal({
  transfer,
  onClose,
  isDark,
}: {
  transfer: CardTransfer | null;
  onClose: () => void;
  isDark: boolean;
}) {
  if (!transfer) return null;

  const status = normalizeTransferStatus(transfer.status);
  const amount = Math.abs(Number(transfer.amount)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const StatusIcon = status === "failed" ? XCircle : status === "pending" ? Clock : CheckCircle2;
  const valueText = isDark ? "text-slate-300" : "text-slate-700";
  const dateOpts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

  const statusTextColor =
    status === "completed"
      ? isDark ? "text-emerald-400" : "text-emerald-600"
      : status === "failed"
        ? isDark ? "text-red-400" : "text-red-600"
        : isDark ? "text-amber-400" : "text-amber-600";

  return (
    <Dialog open={!!transfer} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Card Balance Transfer</DialogTitle>
          <DialogDescription>Transfer #{transfer.id}</DialogDescription>
        </VisuallyHidden>

        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-400" />

        <div className="px-5 pt-5 pb-6 space-y-5">
          <div className="flex flex-col items-center gap-2 pt-1">
            <div
              className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${
                isDark
                  ? "ring-blue-900 bg-blue-950/40 text-blue-400"
                  : "ring-blue-100 bg-blue-50 text-blue-600"
              }`}
            >
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Card Balance Transfer
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${isDark ? "text-blue-400" : "text-blue-600"}`}>
              ₱{amount}
            </p>
          </div>

          <div
            className={`flex items-center gap-2 rounded-xl border p-3 ${
              isDark ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>From</p>
              <p className={`text-xs font-mono font-semibold truncate ${isDark ? "text-blue-400" : "text-blue-600"}`}>{cardUidOf(transfer.source)}</p>
              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{fullNameOf(transfer.source)}</p>
            </div>
            <ArrowRightLeft className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
            <div className="flex-1 min-w-0 text-right">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>To</p>
              <p className={`text-xs font-mono font-semibold truncate ${isDark ? "text-blue-400" : "text-blue-600"}`}>{cardUidOf(transfer.target)}</p>
              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{fullNameOf(transfer.target)}</p>
            </div>
          </div>

          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          <div
            className={`rounded-xl overflow-hidden border divide-y ${
              isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"
            }`}
          >
            <DetailRow label="Transfer ID" isDark={isDark}>
              <span className={`text-xs font-mono font-medium ${valueText}`}>#{transfer.id}</span>
            </DetailRow>

            <DetailRow label="Requested" isDark={isDark}>
              <span className={`text-xs text-right ${valueText}`}>
                {new Date(transfer.created_at).toLocaleString("en-PH", dateOpts)}
              </span>
            </DetailRow>

            {transfer.completed_at && (
              <DetailRow label="Completed" isDark={isDark}>
                <span className={`text-xs text-right ${valueText}`}>
                  {new Date(transfer.completed_at).toLocaleString("en-PH", dateOpts)}
                </span>
              </DetailRow>
            )}

            <DetailRow label="Reason" isDark={isDark}>
              <span className={`text-xs text-right max-w-[60%] truncate ${valueText}`}>
                {transfer.reason || "—"}
              </span>
            </DetailRow>

            <DetailRow label="Status" isDark={isDark}>
              <span className={`text-xs font-bold capitalize ${statusTextColor}`}>{status}</span>
            </DetailRow>
          </div>

          <Button
            onClick={onClose}
            className="w-full text-white font-semibold uppercase text-[11px] tracking-widest bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { isDark } = useTheme();

  const [activeView, setActiveView] = useState<TxView>("topup");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewTx, setViewTx] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [routes, setRoutes] = useState<FareRoute[]>([]);
  const [financialById, setFinancialById] = useState<Record<string, FinancialFields>>({});
  // 🆕 passenger name + card type, keyed by card_uid
  const [passengerByCardUid, setPassengerByCardUid] = useState<Record<string, PassengerInfo>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [transfers, setTransfers] = useState<CardTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transferSearch, setTransferSearch] = useState("");
  const [transferStatusFilter, setTransferStatusFilter] = useState("all");
  const [transferPage, setTransferPage] = useState(1);
  const [viewTransfer, setViewTransfer] = useState<CardTransfer | null>(null);
  const [transfersLastUpdated, setTransfersLastUpdated] = useState<Date | null>(null);

  // ── Fare routes (realtime, silent refresh) ────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadRoutes = async () => {
      const { data, error } = await supabase
        .from("fare_routes")
        .select("id, origin, destination, fare_amount")
        .order("id");
      if (cancelled || error || !data) return;
      setRoutes((prev) => (sameData(prev, data) ? prev : (data as FareRoute[])));
    };

    loadRoutes();

    const channel = supabase
      .channel("admin_fare_routes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fare_routes" }, loadRoutes)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Card transfers (realtime, silent refresh) ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadTransfers = async () => {
      const myRequest = ++requestId;

      const { data, error } = await supabase
        .from("card_balance_transfers")
        .select("*")
        .order("created_at", { ascending: false });

      if (cancelled || myRequest !== requestId) return;

      if (error || !data) {
        console.warn("Unable to load card transfers:", error?.message);
        setTransfersLoading(false);
        return;
      }

      const userIds = Array.from(
        new Set(
          data
            .flatMap((row: any) => [row.source_card_id, row.target_card_id])
            .filter((id: any) => id != null)
            .map((id: any) => Number(id)),
        ),
      );

      const usersById = new Map<number, TransferCard>();

      if (userIds.length > 0) {
        const { data: usersData, error: usersError } = await supabase
          .from("users")
          .select("id, card_uid, full_name")
          .in("id", userIds);

        if (cancelled || myRequest !== requestId) return;

        if (usersError) {
          console.warn("Unable to load users for transfers:", usersError.message);
        } else {
          for (const u of usersData ?? []) {
            usersById.set(Number(u.id), u as TransferCard);
          }
        }
      }

      const resolveCard = (
        id: number | null,
        snapshotUid?: string | null,
        snapshotName?: string | null,
      ): TransferCard | null => {
        const live = id != null ? usersById.get(Number(id)) : undefined;
        if (live) return live;
        if (snapshotUid || snapshotName) {
          return { id: Number(id), card_uid: snapshotUid ?? null, full_name: snapshotName ?? null };
        }
        return null;
      };

      const merged: CardTransfer[] = data.map((row: any) => ({
        ...row,
        source: resolveCard(row.source_card_id, row.source_card_uid, row.source_full_name),
        target: resolveCard(row.target_card_id, row.target_card_uid, row.target_full_name),
      }));

      setTransfers((prev) => (sameData(prev, merged) ? prev : merged));
      setTransfersLoading(false);
    };

    const scheduleLoad = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadTransfers();
      }, 300);
    };

    void loadTransfers();

    const channel = supabase
      .channel("admin_card_balance_transfers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card_balance_transfers" },
        scheduleLoad,
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Transactions query ────────────────────────────────────────────────────
  const params: any = {};
  if (search) params.search = search;
  if (statusFilter !== "all") params.status = statusFilter;

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, activeView]);

  useEffect(() => {
    setTransferPage(1);
  }, [transferSearch, transferStatusFilter]);

  const {
    data: transactions,
    isLoading,
    refetch: refetchTransactions,
  } = useListTransactions(params, {
    query: {
      refetchOnWindowFocus: true,
    },
  });

  const lastTransactionsRef = useRef<any[] | null>(null);
  const currentList = extractList(transactions);
  if (currentList) {
    lastTransactionsRef.current = currentList;
  }
  const rawTransactionList: any[] = currentList ?? lastTransactionsRef.current ?? EMPTY_LIST;

  const showListSkeleton = isLoading && lastTransactionsRef.current === null;

  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTransactionsRealtime = useCallback(() => {
    if (realtimeTimerRef.current) return;
    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      refetchTransactions();
    }, 400);
  }, [refetchTransactions]);

  useEffect(() => {
    return () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    };
  }, []);

  useRealtimeRefetch(["transactions"], handleTransactionsRealtime);

  // ── Fee / VAT / Net ───────────────────────────────────────────────────────
  useEffect(() => {
    if (rawTransactionList.length === 0) return;

    let cancelled = false;

    const loadFinancialFields = async () => {
      const ids = rawTransactionList
        .map((tx: any) => tx?.id)
        .filter((id: any) => id != null)
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id));

      if (ids.length === 0) return;

      const { data, error } = await supabase
        .from("transactions")
        .select("id, fee_amount, vat_amount, net_amount")
        .in("id", ids);

      if (cancelled) return;

      if (error) {
        console.warn("Unable to load transaction fee/VAT/net fields:", error.message);
        return;
      }

      setFinancialById((prev) => {
        let changed = false;
        const next: Record<string, FinancialFields> = { ...prev };
        for (const row of data ?? []) {
          const key = String(row.id);
          const value: FinancialFields = {
            fee_amount: row.fee_amount == null ? null : Number(row.fee_amount),
            vat_amount: row.vat_amount == null ? null : Number(row.vat_amount),
            net_amount: row.net_amount == null ? null : Number(row.net_amount),
          };
          const old = prev[key];
          if (
            !old ||
            old.fee_amount !== value.fee_amount ||
            old.vat_amount !== value.vat_amount ||
            old.net_amount !== value.net_amount
          ) {
            next[key] = value;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    loadFinancialFields();

    return () => {
      cancelled = true;
    };
  }, [rawTransactionList]);

  // ── 🆕 Passenger name + card type (from `users`, by card_uid) ─────────────
  useEffect(() => {
    if (rawTransactionList.length === 0) return;

    let cancelled = false;

    const loadPassengers = async () => {
      const uids = Array.from(
        new Set(
          rawTransactionList
            .map((tx: any) => tx?.card_uid ?? tx?.cardUid)
            .filter((uid: any) => typeof uid === "string" && uid.trim() !== ""),
        ),
      ) as string[];

      if (uids.length === 0) return;

      const { data, error } = await supabase
        .from("users")
        .select("card_uid, full_name, type")
        .in("card_uid", uids);

      if (cancelled) return;

      if (error) {
        console.warn("Unable to load passenger info:", error.message);
        return;
      }

      setPassengerByCardUid((prev) => {
        let changed = false;
        const next: Record<string, PassengerInfo> = { ...prev };
        for (const row of data ?? []) {
          const key = String(row.card_uid);
          const value: PassengerInfo = {
            full_name: row.full_name ?? null,
            card_type: row.type ?? null,
          };
          const old = prev[key];
          if (!old || old.full_name !== value.full_name || old.card_type !== value.card_type) {
            next[key] = value;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    loadPassengers();

    return () => {
      cancelled = true;
    };
  }, [rawTransactionList]);

  // ── Lists + pagination ────────────────────────────────────────────────────
  const topupList = useMemo(
    () => rawTransactionList.filter((tx: any) => normalizeTxType(tx.type) === "Top-up"),
    [rawTransactionList],
  );
  const fareList = useMemo(
    () => rawTransactionList.filter((tx: any) => normalizeTxType(tx.type) === "Fare"),
    [rawTransactionList],
  );

  const currentTypeList = activeView === "fare" ? fareList : topupList;
  const totalPages = Math.max(1, Math.ceil(currentTypeList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = currentTypeList.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    if (activeView === "transfers") return;
    if (currentTypeList.length === 0) return;
    setLastUpdated(new Date());
  }, [currentTypeList, activeView]);

  const filteredTransferList = useMemo(() => {
    let list = transfers;

    if (transferStatusFilter !== "all") {
      list = list.filter(
        (transfer) => normalizeTransferStatus(transfer.status) === transferStatusFilter,
      );
    }

    const q = transferSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((transfer) => {
        const haystack = [
          cardUidOf(transfer.source),
          fullNameOf(transfer.source),
          cardUidOf(transfer.target),
          fullNameOf(transfer.target),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return list;
  }, [transfers, transferStatusFilter, transferSearch]);

  const transferTotalPages = Math.max(1, Math.ceil(filteredTransferList.length / PAGE_SIZE));
  const safeTransferPage = Math.min(transferPage, transferTotalPages);
  const transferStartIndex = (safeTransferPage - 1) * PAGE_SIZE;
  const paginatedTransferList = filteredTransferList.slice(
    transferStartIndex,
    transferStartIndex + PAGE_SIZE,
  );

  useEffect(() => {
    if (filteredTransferList.length === 0) return;
    setTransfersLastUpdated(new Date());
  }, [filteredTransferList]);

  // ── Style helpers ─────────────────────────────────────────────────────────
  const statusColor = (status: string) => {
    if (isDark) {
      switch (status) {
        case "Success": return "bg-emerald-950/40 text-emerald-400 border-emerald-900";
        case "Failed":  return "bg-red-950/40 text-red-400 border-red-900";
        case "Pending": return "bg-amber-950/40 text-amber-400 border-amber-900";
        default:        return "bg-slate-800 text-slate-400 border-slate-700";
      }
    }
    switch (status) {
      case "Success": return "bg-emerald-50 text-emerald-600 border-emerald-200";
      case "Failed":  return "bg-red-50 text-red-600 border-red-200";
      case "Pending": return "bg-amber-50 text-amber-600 border-amber-200";
      default:        return "bg-slate-100 text-slate-500 border-slate-200";
    }
  };

  const transferStatusColor = (status: TransferStatus) => {
    if (isDark) {
      switch (status) {
        case "completed": return "bg-emerald-950/40 text-emerald-400 border-emerald-900";
        case "failed":    return "bg-red-950/40 text-red-400 border-red-900";
        default:          return "bg-amber-950/40 text-amber-400 border-amber-900";
      }
    }
    switch (status) {
      case "completed": return "bg-emerald-50 text-emerald-600 border-emerald-200";
      case "failed":    return "bg-red-50 text-red-600 border-red-200";
      default:          return "bg-amber-50 text-amber-600 border-amber-200";
    }
  };

  const isFareView = activeView === "fare";
  const isTransferView = activeView === "transfers";

  const TX_TABS: TxTabDef[] = [
    { key: "topup", label: "Top-up", icon: CreditCard, count: topupList.length },
    { key: "fare", label: "Fare", icon: Route, count: fareList.length },
    { key: "transfers", label: "Transfer", icon: ArrowRightLeft, count: transfers.length },
  ];

  const headClass = "text-[11px] font-semibold uppercase tracking-wide";
  const theadClass = `tp-thead sticky top-0 z-10 border-b ${
    isDark ? "border-slate-800" : "border-zinc-200"
  }`;

  const livePill = (
    <div className="flex items-center gap-2 mr-2 shrink-0">
      <span
        className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${
          isDark
            ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
            : "text-emerald-600 bg-emerald-50 border-emerald-100"
        }`}
      >
        <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
        LIVE
      </span>
    </div>
  );

  return (
    <div
      className={`space-y-4 md:space-y-6 h-full min-h-0 flex flex-col overflow-hidden pb-4 px-1 ${
        isDark ? "text-slate-200" : "text-slate-800"
      }`}
    >
      <style>{`
        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot {
          animation: realtime-dot 1s ease-in-out infinite;
        }
      `}</style>
      <style>{TX_CSS}</style>

      {/* Header */}
      <div
        className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${
          isDark ? "border-slate-800" : "border-slate-200"
        }`}
      >
        <div>
          <h2
            className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            <History className="text-blue-500" size={26} />
            Transaction Logs
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Monitor all Top-ups, Fare deductions, and Card Transfers in real-time
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${
              isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"
            }`}
          >
            <Zap className="text-blue-500" size={16} />
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide ${
                isDark ? "text-blue-400" : "text-blue-700"
              }`}
            >
              Live Telemetry Active
            </span>
          </div>
          {(isTransferView ? transfersLastUpdated : lastUpdated) && (
            <span className={`text-[10px] font-mono pr-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Last sync:{" "}
              {(isTransferView ? transfersLastUpdated : lastUpdated)!.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ══ ONE FOLDER: transparent tab strip + single white panel ══ */}
      <TxPanel tabs={TX_TABS} active={activeView} onChange={setActiveView} isDark={isDark}>
        {!isTransferView ? (
          <>
            {/* Top-up / Fare toolbar */}
            <div className="tp-toolbar">
              <div className="flex flex-col lg:flex-row gap-4 items-center">
                {livePill}
                <div className="relative flex-1 w-full">
                  <Search
                    className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}
                  />
                  <Input
                    placeholder="Search card UID or name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={`pl-10 font-medium text-sm focus-visible:ring-blue-500 ${
                      isDark
                        ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                        : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                    }`}
                  />
                </div>
                <div className="flex gap-3 w-full lg:w-auto">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger
                      className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${
                        isDark
                          ? "bg-slate-950 border-slate-800 text-slate-300"
                          : "bg-white border-slate-200 text-slate-600"
                      }`}
                    >
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent
                      className={
                        isDark
                          ? "bg-slate-900 border-slate-800 text-slate-300"
                          : "bg-white border-slate-200 text-slate-600"
                      }
                    >
                      <SelectItem value="all" className="cursor-pointer">All Status</SelectItem>
                      <SelectItem value="Success" className="cursor-pointer">Success</SelectItem>
                      <SelectItem value="Failed" className="cursor-pointer">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 px-4 sm:px-6 pb-0 flex flex-col overflow-hidden">
              {showListSkeleton ? (
                <div className="space-y-4 pt-6">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative mt-0 flex-1 min-h-0 overflow-auto">
                    <Table>
                      <TableHeader className={theadClass}>
                        <TableRow className="border-none hover:bg-transparent">
                          <TableHead className={headClass}>Txn ID</TableHead>
                          <TableHead className={headClass}>Timestamp</TableHead>
                          <TableHead className={headClass}>Card UID</TableHead>
                          <TableHead className={headClass}>Full Name</TableHead>
                          {isFareView ? (
                            <>
                              <TableHead className={headClass}>Origin</TableHead>
                              <TableHead className="w-10 px-0 text-center">
                                <ArrowLeftRight
                                  className={`mx-auto h-3.5 w-3.5 ${isDark ? "text-slate-600" : "text-slate-300"}`}
                                  aria-hidden="true"
                                />
                                <span className="sr-only">Both directions</span>
                              </TableHead>
                              <TableHead className={headClass}>Destination</TableHead>
                            </>
                          ) : (
                            <TableHead className={headClass}>Payment Method</TableHead>
                          )}
                          <TableHead className={headClass}>Amount</TableHead>
                          {!isFareView && (
                            <>
                              <TableHead className={headClass}>Fee</TableHead>
                              <TableHead className={headClass}>VAT</TableHead>
                              <TableHead className={headClass}>Net Amount</TableHead>
                            </>
                          )}
                          <TableHead className={headClass}>Status</TableHead>
                          <TableHead className={`${headClass} text-right`}>Actions</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {paginatedList.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={isFareView ? 10 : 11}
                              className="text-center py-32"
                            >
                              <div
                                className={`flex flex-col items-center ${
                                  isDark ? "text-slate-700" : "text-slate-300"
                                }`}
                              >
                                <History size={48} className="mb-2" />
                                <p className="text-xs font-semibold uppercase tracking-widest">
                                  No records found
                                </p>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedList.map((rawTx: any) => {
                            const uid = rawTx?.card_uid ?? rawTx?.cardUid;
                            const passenger = uid ? passengerByCardUid[String(uid)] : undefined;

                            // 🆕 enriched tx: fee/vat/net + passenger name + card type
                            const tx = {
                              ...rawTx,
                              ...(financialById[String(rawTx?.id)] ?? {}),
                              full_name:
                                rawTx?.full_name || rawTx?.fullName || passenger?.full_name || null,
                              passenger_name:
                                rawTx?.passenger_name ||
                                rawTx?.full_name ||
                                rawTx?.fullName ||
                                passenger?.full_name ||
                                null,
                              card_type:
                                rawTx?.card_type || rawTx?.cardType || passenger?.card_type || null,
                            };

                            const matchedRoute = isFareView ? findRouteFor(tx, routes) : null;

                            const paymentMethodLabel = !isFareView
                              ? formatPaymentMethod(tx.payment_method)
                              : null;
                            const paymentMethodLogo = !isFareView
                              ? getPaymentMethodLogo(tx.payment_method)
                              : null;

                            return (
                              <TableRow
                                key={tx.id}
                                className={`transition-colors ${
                                  isDark
                                    ? "border-slate-800 hover:bg-slate-800/50"
                                    : "border-zinc-100 hover:bg-zinc-50"
                                }`}
                              >
                                <TableCell className="text-xs font-mono">#{tx.id}</TableCell>
                                <TableCell className="text-xs font-mono">
                                  {new Date(tx.timestamp || tx.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                                  {tx.card_uid || tx.cardUid || "—"}
                                </TableCell>
                                <TableCell className="text-sm font-medium">
                                  {tx.full_name || tx.fullName || "—"}
                                </TableCell>

                                {isFareView ? (
                                  <>
                                    <TableCell className="text-xs">
                                      {matchedRoute ? matchedRoute.origin : "—"}
                                    </TableCell>
                                    <TableCell className="w-10 px-0 text-center">
                                      <ArrowLeftRight
                                        className={`mx-auto h-4 w-4 ${
                                          isDark ? "text-slate-400" : "text-slate-500"
                                        }`}
                                        aria-label="Both directions"
                                      />
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {matchedRoute ? matchedRoute.destination : "—"}
                                    </TableCell>
                                  </>
                                ) : (
                                  <TableCell className="text-xs">
                                    <div className="flex items-center gap-1.5">
                                      {paymentMethodLogo && (
                                        <img
                                          src={paymentMethodLogo}
                                          alt=""
                                          className="h-6 w-auto max-w-[52px] object-contain shrink-0"
                                        />
                                      )}
                                      <span>{paymentMethodLabel}</span>
                                    </div>
                                  </TableCell>
                                )}

                                <TableCell
                                  className={`text-sm font-semibold ${
                                    isFareView
                                      ? isDark ? "text-red-400" : "text-red-600"
                                      : isDark ? "text-slate-200" : "text-slate-800"
                                  }`}
                                >
                                  {isFareView && "−"}₱{formatAmount(Number(tx.amount))}
                                </TableCell>

                                {!isFareView && (
                                  <>
                                    <TableCell className="text-xs font-medium tabular-nums">
                                      {formatNullableAmount(getFeeAmount(tx))}
                                    </TableCell>
                                    <TableCell className="text-xs font-medium tabular-nums">
                                      {formatNullableAmount(getVatAmount(tx))}
                                    </TableCell>
                                    <TableCell
                                      className={`text-sm font-bold tabular-nums ${
                                        isDark ? "text-emerald-400" : "text-emerald-600"
                                      }`}
                                    >
                                      {formatNetAmountWithSign(getNetAmount(tx))}
                                    </TableCell>
                                  </>
                                )}

                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] font-semibold ${statusColor(tx.status)}`}
                                  >
                                    {tx.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 cursor-pointer text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => setViewTx(tx)}
                                    title="View receipt"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div
                    className={`flex items-center justify-between py-3 border-t mt-0 ${
                      isDark ? "border-slate-800" : "border-zinc-200"
                    }`}
                  >
                    <span className="text-xs font-mono">
                      Showing {currentTypeList.length === 0 ? 0 : startIndex + 1}–
                      {Math.min(startIndex + PAGE_SIZE, currentTypeList.length)} of{" "}
                      {currentTypeList.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        <ChevronLeft className="w-3 h-3 mr-1" />
                        Prev
                      </Button>
                      <span className="text-xs font-semibold px-2 tabular-nums">
                        <span className="text-blue-500">{safePage}</span>
                        {" / "}
                        {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        Next
                        <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Transfers toolbar */}
            <div className="tp-toolbar">
              <div className="flex flex-col lg:flex-row gap-4 items-center">
                {livePill}
                <div className="relative flex-1 w-full">
                  <Search
                    className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}
                  />
                  <Input
                    placeholder="Search source/target card UID or name..."
                    value={transferSearch}
                    onChange={(e) => setTransferSearch(e.target.value)}
                    className="pl-10 text-sm"
                  />
                </div>
                <Select value={transferStatusFilter} onValueChange={setTransferStatusFilter}>
                  <SelectTrigger className="w-full lg:w-[150px] text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex-1 min-h-0 px-4 sm:px-6 pb-0 flex flex-col overflow-hidden">
              {transfersLoading ? (
                <div className="space-y-4 pt-6">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative mt-0 flex-1 min-h-0 overflow-auto">
                    <Table>
                      <TableHeader className={theadClass}>
                        <TableRow>
                          <TableHead>Transfer ID</TableHead>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedTransferList.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-32">
                              <ArrowRightLeft size={48} className="mx-auto mb-2 opacity-30" />
                              <p className="text-xs font-semibold uppercase tracking-widest">
                                No transfers found
                              </p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedTransferList.map((transfer) => {
                            const status = normalizeTransferStatus(transfer.status);
                            return (
                              <TableRow key={transfer.id}>
                                <TableCell className="font-mono text-xs">#{transfer.id}</TableCell>
                                <TableCell className="text-xs font-mono">
                                  {new Date(transfer.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <div className="font-mono text-xs text-blue-500 font-semibold">
                                    {cardUidOf(transfer.source)}
                                  </div>
                                  <div className="text-[11px] opacity-60">
                                    {fullNameOf(transfer.source)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="font-mono text-xs text-blue-500 font-semibold">
                                    {cardUidOf(transfer.target)}
                                  </div>
                                  <div className="text-[11px] opacity-60">
                                    {fullNameOf(transfer.target)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm font-semibold text-blue-500">
                                  ₱{formatAmount(Number(transfer.amount))}
                                </TableCell>
                                <TableCell className="text-xs max-w-[180px] truncate">
                                  {transfer.reason || "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] font-semibold capitalize ${transferStatusColor(status)}`}
                                  >
                                    {status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 cursor-pointer text-blue-500"
                                    onClick={() => setViewTransfer(transfer)}
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div
                    className={`flex items-center justify-between py-3 border-t mt-0 ${
                      isDark ? "border-slate-800" : "border-zinc-200"
                    }`}
                  >
                    <span className="text-xs font-mono">
                      Showing {filteredTransferList.length === 0 ? 0 : transferStartIndex + 1}–
                      {Math.min(transferStartIndex + PAGE_SIZE, filteredTransferList.length)} of{" "}
                      {filteredTransferList.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safeTransferPage <= 1}
                        onClick={() => setTransferPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        <ChevronLeft className="w-3 h-3 mr-1" />
                        Prev
                      </Button>
                      <span className="text-xs font-semibold px-2">
                        {safeTransferPage} / {transferTotalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={safeTransferPage >= transferTotalPages}
                        onClick={() => setTransferPage((p) => Math.min(transferTotalPages, p + 1))}
                        className="h-8 px-3 text-xs border cursor-pointer"
                      >
                        Next
                        <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </TxPanel>

      <ReceiptModal
        tx={viewTx}
        routes={routes}
        onClose={() => setViewTx(null)}
        isDark={isDark}
      />
      <TransferModal
        transfer={viewTransfer}
        onClose={() => setViewTransfer(null)}
        isDark={isDark}
      />
    </div>
  );
}