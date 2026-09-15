import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  User, Phone, Tag, ShieldCheck,
  LogOut, PlusCircle, KeyRound, CreditCard, Mail, Home, Settings,
  ChevronRight, ArrowLeft, ArrowRight, List, Pencil, Check, X as XIcon,
  Sun, Moon, Link2, AlertTriangle, RotateCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCardData } from "@/hooks/use-card-data";
import { useChangePassword } from "@/hooks/use-change-password";
import { useLinkCard } from "@/hooks/use-link-card";
import { useTopup } from "@/hooks/use-topup";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { LinkCardModal } from "@/components/link-card-modal";
import { TopupModal } from "@/components/topup-modal";
import { ChangePasswordModal } from "@/components/change-password-modal";
import { getSignedInUser, cleanCardUid, USER_AUTH_TOKEN_KEY } from "@/lib/api";
import { TransactionDetailModal, type Transaction, type FareRoute } from "@/components/transaction-detail-modal";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
import { supabase } from "@/lib/supabase";

function formatAmount(type: string, amount: number | string): string {
  const sign = type === "Fare" ? "-" : "+";
  const num = Math.abs(Number(amount || 0)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}\u20B1${num}`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

// ✅ Basic email format check for the inline editor
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ── shared helper to normalize the API base URL for direct fetch()
// calls (same logic used in Layout.tsx / ReportsPage.tsx) ──
function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// ═══════════════════════════════════════════════════════════════════════
// 🆕 SKELETON HELPERS — plain pulse blocks used everywhere we need a
// "data is still loading" placeholder instead of a misleading blank /
// "Not Linked" fallback. Kept dumb on purpose (just a sized div) so it
// can be dropped into any layout.
// ═══════════════════════════════════════════════════════════════════════
function SkeletonBar({ className = "", isDark }: { className?: string; isDark: boolean }) {
  return <div className={`animate-pulse rounded ${isDark ? "bg-slate-800" : "bg-slate-200"} ${className}`} />;
}

function SkeletonRow({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <SkeletonBar isDark={isDark} className="h-9 w-9 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <SkeletonBar isDark={isDark} className="h-2.5 w-16" />
        <SkeletonBar isDark={isDark} className="h-3.5 w-32" />
      </div>
    </div>
  );
}

// Full-page gate shown while we're still confirming who's logged in /
// whether their account has a linked card. Prevents the dashboard from
// flashing an "unlinked" or blank state on refresh while that check is
// still in flight (this is what shows up as a long blank screen when the
// backend is cold-starting).
function AuthCheckingScreen({ isDark, slowHint }: { isDark: boolean; slowHint: boolean }) {
  return (
    <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-[#020617] text-slate-100" : "bg-slate-50 text-slate-800"}`}>
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <img src="/calbayog.png" alt="Calbayog" className="h-14 w-14 rounded-xl object-contain animate-pulse" />
        <div className="flex items-center gap-2">
          {[0, 150, 300].map((delay) => (
            <div
              key={delay}
              className={`h-2 w-2 rounded-full animate-bounce ${isDark ? "bg-emerald-400" : "bg-emerald-500"}`}
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
        <p className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Loading your account…
        </p>
        {slowHint && (
          <p className={`text-[11px] max-w-xs leading-snug ${isDark ? "text-slate-600" : "text-slate-400"}`}>
            The server may be waking up from a cold start — this can take up to a minute on the first load.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Virtual card design — matches the User Management card preview 1:1 ──
function getCardTheme(type: string | null | undefined) {
  const t = (type || "Regular").toLowerCase();
  switch (t) {
    case "student":
      return {
        accent: "#2563eb",
        pattern: "#3b82f6",
        label: "STUDENT",
        cardBg: "#ffffff",
        textColor: "#0f172a",
        subTextColor: "#475569",
        uidColor: "#1b1f5c",
        isLight: true,
      };
    case "senior":
      return {
        accent: "#ca8a04",
        pattern: "#eab308",
        label: "SENIOR",
        cardBg: "#ffffff",
        textColor: "#0f172a",
        subTextColor: "#475569",
        uidColor: "#1b1f5c",
        isLight: true,
      };
    case "pwd":
      return {
        accent: "#059669",
        pattern: "#10b981",
        label: "PWD",
        cardBg: "#ffffff",
        textColor: "#0f172a",
        subTextColor: "#475569",
        uidColor: "#1b1f5c",
        isLight: true,
      };
    case "regular":
    default:
      return {
        accent: "#f87171",
        pattern: "#f97316",
        label: "REGULAR",
        cardBg: "#1b1f5c",
        textColor: "#ffffff",
        subTextColor: "rgba(255,255,255,0.7)",
        uidColor: "#5eead4",
        isLight: false,
      };
  }
}

function ChevronStaircase({ color }: { color: string }) {
  const rows = 6;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: rows }).map((_, i) => {
        const offset = (rows - 1 - i) * 11;
        return (
          <div
            key={i}
            className="absolute right-0 h-[15%] w-full"
            style={{ top: `${i * (100 / rows)}%`, transform: `translateX(${offset}%)` }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 10px, transparent 10px 16px)`,
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-[70%] opacity-80"
              style={{
                backgroundImage: `repeating-linear-gradient(135deg, ${color}55 0px, ${color}55 7px, transparent 7px, transparent 14px), repeating-linear-gradient(45deg, ${color}55 0px, ${color}55 7px, transparent 7px, transparent 14px)`,
                backgroundSize: "28px 100%",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function formatPeso(value: number | string): string {
  return `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCardDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 🔒 LOCKED-SCALE CARD SYSTEM — copied verbatim from User Management so the
// dashboard's virtual card behaves identically.
//
// Why: the OLD dashboard card used Tailwind responsive classes
// (p-4 sm:p-6 md:p-7, text-lg sm:text-2xl md:text-3xl, etc). At certain
// container widths the browser jumps between breakpoints, so text,
// padding, and the logo each resize at DIFFERENT moments — the card
// visibly "reflows" / elements drift out of position instead of scaling
// together as one unit.
//
// The fix: author the card ONCE at a fixed pixel canvas
// (CARD_DESIGN_WIDTH x CARD_DESIGN_HEIGHT). Every element inside uses
// fixed px values only — no breakpoints, no "sm:"/"md:" classes. That
// canvas is dropped into a responsive-width container and scaled
// down/up with a single CSS `transform: scale(ratio)`, where ratio is
// measured live (via ResizeObserver) from the space actually available.
// Because it's one transform on one wrapper, every child (logo, UID,
// name, "Valid Until" label) shrinks or grows by the exact same amount,
// in the exact same relative position — nothing reflows, nothing
// repositions independently, no matter how far the container is
// stretched or shrunk. It behaves exactly like scaling a locked image.
// ═══════════════════════════════════════════════════════════════════════

const CARD_DESIGN_WIDTH = 700;
// Keeps the real 1376:774 physical-card aspect ratio, just authored at a
// smaller, easier-to-design canvas size.
const CARD_DESIGN_HEIGHT = Math.round((CARD_DESIGN_WIDTH * 774) / 1376); // 394

function useScaleToFit(designWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const w = el.offsetWidth;
      if (w > 0) setScale(w / designWidth);
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);

  return { containerRef, scale };
}

// 🔒 Renders a fixed-size, flippable card canvas that scales as one locked
// unit to fit whatever width its parent gives it.
function LockedFlipCard({
  flipped,
  onFlip,
  front,
  back,
}: {
  flipped: boolean;
  onFlip: () => void;
  front: React.ReactNode;
  back: React.ReactNode;
}) {
  const { containerRef, scale } = useScaleToFit(CARD_DESIGN_WIDTH);

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-pointer select-none"
      style={{ aspectRatio: `${CARD_DESIGN_WIDTH} / ${CARD_DESIGN_HEIGHT}` }}
      onClick={onFlip}
      role="button"
      tabIndex={0}
      aria-label="Flip card"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFlip();
        }
      }}
    >
      {/* Fixed-size design canvas, scaled as a single locked unit */}
      <div
        className="absolute top-0 left-0"
        style={{
          width: CARD_DESIGN_WIDTH,
          height: CARD_DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="card-flip-scene-locked">
          <div className={`card-flip-inner-locked ${flipped ? "is-flipped" : ""}`}>
            <div className="card-face-locked">{front}</div>
            <div className="card-face-locked card-face-back-locked">{back}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── VirtualCard — now built on the same LockedFlipCard system as
// User Management's card preview. Design values (padding 30, logo 62px,
// UID 44px, name 25px, type label 24px, "Valid Until" 11/15px) are copied
// 1:1 from the admin preview so both surfaces render identically and the
// card never reflows at any screen width. ──
function VirtualCard({
  user,
  isDark,
  flipped,
  onFlip,
}: {
  user: any;
  isDark: boolean;
  flipped: boolean;
  onFlip: () => void;
}) {
  const theme = getCardTheme(user?.type);
  const cardUid = user?.cardUid || "----";
  const fullName = user?.fullName || "Card Holder";

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-2 px-0.5">
        <div className="flex items-center gap-2">
          <CreditCard className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            My Virtual Card
          </p>
        </div>
        <button
          type="button"
          onClick={onFlip}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${
            isDark
              ? "text-slate-400 hover:text-white hover:bg-slate-800"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <RotateCw className="h-3 w-3" />
          {flipped ? "Front" : "Back"}
        </button>
      </div>

      <div className="w-full max-w-2xl mx-auto">
        <LockedFlipCard
          flipped={flipped}
          onFlip={onFlip}
          front={
            <div
              className="rounded-2xl overflow-hidden border h-full w-full relative"
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.isLight ? "#cbd5e1" : "transparent",
                boxShadow: theme.isLight
                  ? "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)"
                  : "0 10px 25px -5px rgba(0,0,0,0.4), 0 4px 6px -2px rgba(0,0,0,0.2)",
              }}
            >
              <ChevronStaircase color={theme.pattern} />

              <div className="relative h-full w-full flex flex-col justify-between" style={{ padding: 30 }}>
                {/* Header / logo badge */}
                <div className="flex items-center" style={{ gap: 16 }}>
                  <div
                    className="rounded-full border-2 flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{
                      width: 62,
                      height: 62,
                      backgroundColor: theme.isLight ? "#f1f5f9" : "rgba(255,255,255,0.10)",
                      borderColor: theme.isLight ? "#cbd5e1" : "rgba(255,255,255,0.30)",
                    }}
                  >
                    <img src="/calbayog.png" alt="Calbayog" className="w-full h-full object-cover" />
                  </div>
                  <span
                    className="font-bold tracking-wide uppercase"
                    style={{ color: theme.textColor, fontSize: 22, lineHeight: 1.15 }}
                  >
                    Fare Collection System
                  </span>
                </div>

                {/* Body */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    className="font-mono font-extrabold tracking-wide"
                    style={{ color: theme.uidColor, fontSize: 44, lineHeight: 1.1 }}
                  >
                    {cardUid}
                  </div>
                  <div
                    className="font-semibold"
                    style={{ color: theme.textColor, fontSize: 25, lineHeight: 1.2 }}
                  >
                    {fullName}
                  </div>
                </div>

                {/* Footer row: type label (left) + valid until (right) — fixed px, position locked */}
                <div className="flex items-end justify-between">
                  <div
                    className="font-extrabold tracking-wide"
                    style={{ color: theme.accent, fontSize: 24, lineHeight: 1.1 }}
                  >
                    {theme.label}
                  </div>
                  <div className="text-right">
                    <div
                      className="uppercase tracking-wide font-semibold"
                      style={{ color: "#ffffff", fontSize: 11, lineHeight: 1.3 }}
                    >
                      Valid Until
                    </div>
                    <div
                      className="font-mono font-bold"
                      style={{ color: "#ffffff", fontSize: 15, lineHeight: 1.3 }}
                    >
                      {formatCardDate(user?.expirationDate)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }
          back={
            <div
              className="rounded-2xl overflow-hidden bg-[#eceae4] flex flex-col border border-slate-300 h-full w-full"
              style={{ boxShadow: "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)" }}
            >
              <div style={{ height: "18%" }} className="bg-[#221f20] flex-shrink-0" />
              <div className="flex-1 min-h-0 flex flex-col" style={{ padding: "12px 28px" }}>
                <div className="bg-white border-y border-slate-300" style={{ padding: "8px 14px", marginBottom: 14 }}>
                  <span className="font-extrabold text-slate-900" style={{ fontSize: 19 }}>
                    Terms and Condition
                  </span>
                </div>
                <ul
                  className="text-slate-800 flex-1 min-h-0 overflow-hidden"
                  style={{ fontSize: 13, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 3 }}
                >
                  <li>• Property of the Fare Collection System Operator.</li>
                  <li>• Non-transferable and subject to transit system rules.</li>
                  <li>• Positive balance required to pass through.</li>
                  <li>• Non-refundable card issuance fee applies.</li>
                  <li>• Operator is not responsible for lost or stolen cards.</li>
                  <li>• Unused balances on unregistered cards are non-refundable.</li>
                  <li>• Tampering or unauthorized duplication is strictly prohibited.</li>
                </ul>
                <div className="flex items-center border-t border-slate-300" style={{ gap: 10, paddingTop: 10, marginTop: 6 }}>
                  <div
                    className="rounded-full bg-[#1b1f5c] flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ width: 38, height: 38 }}
                  >
                    <img src="/calbayog.png" alt="Calbayog" className="w-full h-full object-cover" />
                  </div>
                  <span className="font-extrabold tracking-wide text-slate-900 uppercase" style={{ fontSize: 15 }}>
                    Fare Collection System
                  </span>
                </div>
              </div>
            </div>
          }
        />
      </div>

      <p className={`text-center text-[9px] sm:text-[10px] mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
        Tap the card to flip
      </p>
    </div>
  );
}

// 🆕 Skeleton placeholder for the virtual card, shown while a linked
// card's data is still being fetched (e.g. right after refresh, or a
// backend cold start) instead of just not rendering anything.
function VirtualCardSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-2 px-0.5">
        <div className="flex items-center gap-2">
          <CreditCard className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            My Virtual Card
          </p>
        </div>
      </div>
      <div className="w-full max-w-2xl mx-auto">
        <div
          className={`w-full rounded-2xl animate-pulse ${isDark ? "bg-slate-800" : "bg-slate-200"}`}
          style={{ aspectRatio: `${CARD_DESIGN_WIDTH} / ${CARD_DESIGN_HEIGHT}` }}
        />
      </div>
      <p className={`text-center text-[9px] sm:text-[10px] mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
        Loading your card…
      </p>
    </div>
  );
}

// ✅ Fix: memo — hindi na mag-re-render ang row kapag hindi nagbago ang tx
const MobileTxRow = memo(function MobileTxRow({
  tx,
  onClick,
  isDark,
}: {
  tx: Transaction;
  onClick: () => void;
  isDark: boolean;
}) {
  const isFare = tx.type === "Fare";
  const date = new Date(tx.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left cursor-pointer ${
        isDark ? "active:bg-slate-800/40" : "active:bg-slate-100"
      }`}
    >
      <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
        isFare ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20"
      }`}>
        {isFare
          ? <ArrowRight className={`h-3.5 w-3.5 ${isDark ? "text-red-400" : "text-red-600"}`} />
          : <ArrowLeft className={`h-3.5 w-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold leading-tight ${isDark ? "text-slate-100" : "text-slate-800"}`}>{tx.type}</p>
        <p className={`text-[10px] mt-0.5 leading-tight ${isDark ? "text-slate-500" : "text-slate-500"}`}>{dateStr} · {timeStr}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-xs font-bold tabular-nums ${isFare ? (isDark ? "text-red-400" : "text-red-600") : (isDark ? "text-emerald-400" : "text-emerald-600")}`}>
          {formatAmount(tx.type, tx.amount)}
        </p>
        <p className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${
          tx.status === "Success"
            ? isDark ? "text-emerald-500/70" : "text-emerald-600/80"
            : isDark ? "text-red-500/70" : "text-red-600/80"
        }`}>
          {tx.status}
        </p>
      </div>
    </button>
  );
}, (prev, next) => prev.tx.id === next.tx.id && prev.tx.amount === next.tx.amount && prev.isDark === next.isDark);

type Tab = "home" | "Transactions" | "settings";

export default function PaymongoDashboardPage() {
  const [, setLocation] = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const [cardUid, setCardUid] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [virtualCardFlipped, setVirtualCardFlipped] = useState(false);
  const [routes, setRoutes] = useState<FareRoute[]>([]);
  // ✅ Logout confirmation dialog state
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  // 🆕 True until the initial "who's logged in / do they have a linked
  // card" check finishes. While true we show a full-page loading gate
  // instead of the dashboard, so a refresh (or a cold-starting backend)
  // never flashes the "no card linked" empty state for an account that
  // actually DOES have one.
  const [authChecking, setAuthChecking] = useState(true);
  // 🆕 Shown only if a loading state (auth check OR card-data fetch) runs
  // past ~3.5s — most likely explanation at that point is a cold-started
  // backend waking up, so we say so instead of leaving a bare spinner.
  const [slowLoadHint, setSlowLoadHint] = useState(false);

  const { user, transactions, loading, error, lastUpdated, isPulsing } = useCardData(cardUid);
  const currentBalance = Number(user?.balance || 0);

  // ── NEW: single source of truth for "does this account have a linked
  // card yet". Dashboard is ALWAYS reachable once logged in — this flag
  // only controls whether the real data/actions are shown, or a
  // dulled/blank placeholder state. ──
  const isLinked = Boolean(cardUid);
  const dullClass = !isLinked ? "opacity-40 grayscale pointer-events-none select-none" : "";

  // 🆕 True when we KNOW a card is linked but its data hasn't arrived yet
  // (fresh mount, tab refresh, or the backend is cold-starting). This is
  // distinct from `!isLinked` — that means "confirmed, no card at all".
  // Using this instead of falling straight to "—" / "Not Linked" fixes
  // the "hindi makita ang user" bug: previously a linked account would
  // render the exact same blank fallback text as an unlinked one while
  // data was still in flight.
  const cardDataLoading = isLinked && loading && !user;

  const linkCard = useLinkCard((uid) => setCardUid(uid));
  const topup = useTopup(cardUid, currentBalance);
  const changePassword = useChangePassword();
  const { toast } = useToast();

  const remainingTopup = Math.max(0, 20000 - currentBalance);
  const isAtMaxBalance = remainingTopup <= 0;

  // ✅ editable Contact + Email state
  const [editingContact, setEditingContact] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [contactValue, setContactValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [savingField, setSavingField] = useState<"contact" | "email" | null>(null);
  // Local optimistic overrides so the UI updates immediately after save,
  // even if useCardData doesn't refetch right away.
  const [localContact, setLocalContact] = useState<string | null>(null);
  const [localEmail, setLocalEmail] = useState<string | null>(null);

  // ── NEW: temporary account-level profile, fetched once at login from
  // auth_users (name + email tied to the logged-in Supabase account).
  // Used ONLY as a fallback for display before a card is linked. Once
  // isLinked flips true, the real source of truth becomes the card-linked
  // `user` record from useCardData — this temp profile is ignored. ──
  const [authProfile, setAuthProfile] = useState<{ fullName: string; email: string } | null>(null);

  const displayName = (isLinked ? user?.fullName : authProfile?.fullName) || "";
  // Contact number has no home in auth_users — it only ever exists once a
  // card is linked, so it stays blank until then.
  const displayContact = isLinked ? (localContact ?? user?.contactNumber ?? "") : "";
  const displayEmail = localEmail ?? (isLinked ? user?.email : authProfile?.email) ?? "";

  // Reset local overrides + editing state whenever a different card is loaded
  useEffect(() => {
    setVirtualCardFlipped(false);
    setLocalContact(null);
    setLocalEmail(null);
    setEditingContact(false);
    setEditingEmail(false);
  }, [cardUid]);

  // 🆕 Shows the cold-start hint once any busy state (auth check or
  // card-data fetch) has been running for a little while, and clears it
  // the moment we're not busy anymore.
  useEffect(() => {
    const isBusy = authChecking || cardDataLoading;
    if (!isBusy) {
      setSlowLoadHint(false);
      return;
    }
    const t = setTimeout(() => setSlowLoadHint(true), 3500);
    return () => clearTimeout(t);
  }, [authChecking, cardDataLoading]);

  const startEditContact = () => {
    // ── Guard: can't edit contact info for an account with no linked card yet ──
    if (!isLinked) {
      toast({ title: "Link a card first", description: "You need to link a card before editing your contact number.", variant: "destructive" });
      return;
    }
    setContactValue(displayContact);
    setEditingContact(true);
  };
  const cancelEditContact = () => {
    setEditingContact(false);
    setContactValue(displayContact);
  };
  const handleSaveContact = async () => {
    if (!isLinked) return;
    const trimmed = contactValue.trim();
    if (!trimmed) {
      toast({ title: "Contact number cannot be empty", variant: "destructive" });
      return;
    }
    setSavingField("contact");
    try {
      // ⚠️ No phone/contact column found in the auth_users schema you shared.
      // Adjust table/column names here once you confirm where contact number lives.
      const { error } = await supabase
        .from("users")
        .update({ contact_number: trimmed })
        .eq("card_uid", cardUid);
      if (error) throw error;
      setLocalContact(trimmed);
      setEditingContact(false);
      toast({ title: "Contact number updated" });
    } catch (err: any) {
      toast({
        title: "Failed to update contact number",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingField(null);
    }
  };

  const startEditEmail = () => {
    // ── Guard: can't edit email for an account with no linked card yet ──
    if (!isLinked) {
      toast({ title: "Link a card first", description: "You need to link a card before editing your email address.", variant: "destructive" });
      return;
    }
    setEmailValue(displayEmail);
    setEditingEmail(true);
  };
  const cancelEditEmail = () => {
    setEditingEmail(false);
    setEmailValue(displayEmail);
  };
  const handleSaveEmail = async () => {
    if (!isLinked) return;
    const trimmed = emailValue.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      toast({ title: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    setSavingField("email");
    try {
      // ✅ auth_users table — matched via linked_card_uid, per your schema:
      // id (uuid), supabase_auth_id (uuid), full_name (text), email (text),
      // created_at, password_hash, linked_card_uid, password_change..., updated_at
      const { error } = await supabase
        .from("auth_users")
        .update({ email: trimmed, updated_at: new Date().toISOString() })
        .eq("linked_card_uid", cardUid);
      if (error) throw error;
      setLocalEmail(trimmed);
      setEditingEmail(false);
      toast({ title: "Email updated" });
    } catch (err: any) {
      toast({
        title: "Failed to update email",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingField(null);
    }
  };

  useEffect(() => {
    const loadRoutes = async () => {
      const { data, error } = await supabase
        .from("fare_routes")
        .select("id, origin, destination, fare_amount, is_active")
        .order("id");
      if (!error && data) {
        setRoutes(data.map((r: any) => ({
          id: r.id,
          origin: r.origin,
          destination: r.destination,
          fareAmount: r.fare_amount,
          isActive: r.is_active,
        })));
      }
    };
    loadRoutes();
    const channel = supabase
      .channel("fare_routes_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fare_routes" }, () => loadRoutes())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (activeTab !== "Transactions") setSelectedTx(null);
  }, [activeTab]);

  // ── Login only checks the token and fetches the profile. It NEVER blocks
  // the dashboard from rendering, and it NEVER auto-opens the LinkCardModal.
  // After login the user always lands on the Home tab of the dashboard —
  // if there's no linked card yet, cardUid just stays empty and the UI
  // renders in its dulled/blank state (see isLinked below). Linking is
  // opt-in: the user opens the modal themselves via the reminder banner
  // or the "Link Card" buttons.
  //
  // 🆕 `authChecking` wraps this whole flow now (see AuthCheckingScreen
  // above). It's set to false in `finally`, whether the check succeeded,
  // failed, or the token was simply missing — that way a slow/cold-started
  // profile fetch keeps the loading gate up instead of letting the
  // dashboard render prematurely with `isLinked` false. ──
  useEffect(() => {
    const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);
    if (!token) {
      setLocation("/signin");
      setAuthChecking(false);
      return;
    }
    void (async () => {
      try {
        const profile = await getSignedInUser();
        // ✅ Temporary display values straight from auth_users — these show
        // on the dashboard immediately, whether or not a card is linked yet.
        setAuthProfile({
          fullName: profile?.user?.fullName || "",
          email: profile?.user?.email || "",
        });
        const linkedUid = cleanCardUid(profile?.user?.linkedCardUid || "");
        if (linkedUid) {
          setCardUid(linkedUid);
        }
        // No `else` branch here on purpose — do NOT auto-open the modal.
        // The dashboard (Home tab) is always what the user sees first.
      } catch {
        window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
        setLocation("/signin");
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  // ✅ Actual logout logic — only runs after user confirms
  const handleLogout = async () => {
    const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);

    if (token) {
      try {
        const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);
        await Promise.race([
          fetch(`${apiBaseUrl}/api/auth/user/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
      } catch (err) {
        console.warn("Logout API call failed (ignoring):", err);
      }
    }

    window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
    setLocation("/signin");
  };

  const requestLogout = () => {
    setLogoutConfirmOpen(true);
  };

  const confirmLogout = () => {
    setLogoutConfirmOpen(false);
    void handleLogout();
  };

  const balanceText = useMemo(() => {
    return `\u20B1${Number(user?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }, [user?.balance]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSelectedTx(null);
  };

  const handleTxClick = useCallback((tx: Transaction) => {
    setSelectedTx(tx);
  }, []);

  const headerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(57);
  const [navHeight, setNavHeight] = useState(64);

  useEffect(() => {
    const headerEl = headerRef.current;
    const navEl = navRef.current;
    if (!headerEl || !navEl) return;

    const updateHeights = () => {
      setHeaderHeight(headerEl.offsetHeight);
      setNavHeight(navEl.offsetHeight);
    };
    updateHeights();

    const ro = new ResizeObserver(updateHeights);
    ro.observe(headerEl);
    ro.observe(navEl);
    return () => ro.disconnect();
  }, []);

  const navItems: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: "home", icon: <Home className="h-5 w-5" />, label: "Home" },
    { tab: "Transactions", icon: <List className="h-5 w-5" />, label: "Transactions" },
    { tab: "settings", icon: <Settings className="h-5 w-5" />, label: "Settings" },
  ];

  // ── NEW: reusable "link your card" reminder banner, shown whenever the
  // account has no linked card yet, regardless of which tab is active. ──
  const LinkReminderBanner = () => (
    <button
      onClick={() => linkCard.setIsOpen(true)}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
        isDark
          ? "bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15"
          : "bg-amber-50 border-amber-200 hover:bg-amber-100"
      }`}
    >
      <AlertTriangle className={`h-4 w-4 shrink-0 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
      <span className={`flex-1 text-[11px] font-semibold ${isDark ? "text-amber-300" : "text-amber-800"}`}>
        No card linked yet. Your balance, profile, and transactions will stay blank until you link one.
      </span>
      <span className={`flex items-center gap-1 text-[10px] font-bold uppercase shrink-0 ${isDark ? "text-amber-300" : "text-amber-700"}`}>
        <Link2 className="h-3 w-3" /> Link Card
      </span>
    </button>
  );

  // 🆕 Full-page gate — see AuthCheckingScreen above. Bails out before any
  // of the "no card linked yet" UI can render, which is what used to
  // flash on refresh / cold start.
  if (authChecking) {
    return <AuthCheckingScreen isDark={isDark} slowHint={slowLoadHint} />;
  }

  return (
    <div className={`min-h-screen ${isDark ? "bg-[#020617] text-slate-100" : "bg-slate-50 text-slate-800"}`}>
      {linkCard.isOpen && <LinkCardModal {...linkCard} />}
      <TopupModal {...topup} cardUid={cardUid} currentBalance={currentBalance} />
      <ChangePasswordModal {...changePassword} />
      <TransactionDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} routes={routes} />
      <style>{`${DASHBOARD_STYLES}
        /* 🔒 Locked-scale flip card — see LockedFlipCard component above.
           The design canvas itself never reflows; only the outer wrapper's
           transform: scale(...) changes, in a single React inline style.
           Copied 1:1 from User Management's card preview CSS. */
        .card-flip-scene-locked {
          position: relative;
          width: 100%;
          height: 100%;
          perspective: 1600px;
        }
        .card-flip-inner-locked {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1);
          transform-style: preserve-3d;
        }
        .card-flip-inner-locked.is-flipped { transform: rotateY(180deg); }
        .card-face-locked {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .card-face-back-locked { transform: rotateY(180deg); }
      `}</style>

      {/* ✅ Logout confirmation dialog — compact, Yes/No always one line, small boxes */}
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent className={`max-w-[85vw] sm:max-w-xs p-4 rounded-xl ${isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"}`}>
          <AlertDialogHeader className="space-y-1">
            <AlertDialogTitle className={`font-bold text-sm leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
              Are you sure you want to logout?
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-[11px] leading-snug ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              You will need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-row justify-end items-center gap-1.5 mt-3 sm:gap-1.5">
            <AlertDialogCancel
              className={`text-[11px] h-7 px-2.5 min-w-0 mt-0 cursor-pointer ${
                isDark ? "bg-slate-900 border-slate-800 text-white hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              No
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLogout}
              className="bg-red-600 text-white hover:bg-red-500 font-bold text-[11px] h-7 px-2.5 min-w-0 cursor-pointer"
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* STICKY HEADER */}
      <div ref={headerRef} className={`sticky top-0 z-40 w-full backdrop-blur-md border-b ${isDark ? "bg-[#020617]/95 border-slate-800" : "bg-white/95 border-slate-200"}`}>
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/calbayog.png"
              alt="Calbayog logo"
              className="h-9 w-9 rounded-lg object-contain shrink-0"
            />
            <h1 className={`text-base font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-slate-900"}`}>
              Fare Collection System
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {!isLinked && (
              <Button
                variant="ghost"
                onClick={() => linkCard.setIsOpen(true)}
                className={`gap-2 text-sm cursor-pointer ${
                  isDark ? "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                }`}>
                <Link2 className="h-4 w-4" /><span>Link Card</span>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={toggleTheme}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={`gap-2 text-sm cursor-pointer ${
                isDark ? "text-slate-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-slate-500 hover:text-amber-600 hover:bg-amber-50"
              }`}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
            </Button>
            <Button variant="ghost" onClick={changePassword.open}
              className={`gap-2 text-sm cursor-pointer ${
                isDark ? "text-slate-400 hover:text-violet-400 hover:bg-violet-400/10" : "text-slate-500 hover:text-violet-600 hover:bg-violet-50"
              }`}>
              <KeyRound className="h-4 w-4" /><span>Change Password</span>
            </Button>
            <Button variant="ghost" onClick={requestLogout}
              className={`gap-2 text-sm cursor-pointer ${
                isDark ? "text-slate-400 hover:text-red-400 hover:bg-red-400/10" : "text-slate-500 hover:text-red-600 hover:bg-red-50"
              }`}>
              <LogOut className="h-4 w-4" /><span>Logout</span>
            </Button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className={`mx-auto w-full max-w-6xl px-3 sm:px-8 pb-20 md:pb-8 pt-4 space-y-4 dashboard-content ${
        linkCard.isOpen ? "is-obscured" : ""
      }`}>
        {error && isLinked && (
          <div className={`p-3 rounded-lg text-xs border ${isDark ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-red-50 border-red-200 text-red-600"}`}>
            Warning: {error}
          </div>
        )}

        {/* 🆕 Cold-start hint — only surfaces once a linked account's card
            data has been loading for a while, so it doesn't flash on
            ordinary fast loads. */}
        {cardDataLoading && slowLoadHint && (
          <div className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${
            isDark ? "bg-slate-800/60 border-slate-700 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"
          }`}>
            <RotateCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Still loading your card — the server may be waking up from a cold start.
          </div>
        )}

        {/* ── Persistent reminder banner while no card is linked yet.
            Desktop only — on mobile, Link Card lives inside the Settings tab. ── */}
        {!isLinked && (
          <div className="hidden md:block">
            <LinkReminderBanner />
          </div>
        )}

        {/* HOME tab */}
        <div className={activeTab === "home" ? "block" : "hidden md:block"}>
          {/* ── Mobile-only reminder — desktop already shows this banner
              above, outside the tab sections. ── */}
          {!isLinked && (
            <div className="md:hidden mb-4">
              <LinkReminderBanner />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-1 md:col-span-3">
              <p className={`text-xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                Welcome back,{" "}
                <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>
                  {cardDataLoading ? "…" : (displayName?.split(" ")[0] || "User")}
                </span> 👋
              </p>
              <p className={`text-[11px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                {cardDataLoading ? "Loading your account overview…" : isLinked ? "Here's your account overview." : "Link a card to see your account overview."}
              </p>
            </div>

            {/* Balance Card — dulled/blank until a card is linked, skeleton while a linked card's data is still loading */}
            <Card className={`md:col-span-1 backdrop-blur-md border-t-emerald-500/50 border-t-2 ${
              isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-white"
            }`}>
              <CardContent className={`pt-4 pb-4 px-4 ${dullClass}`}>
                {cardDataLoading ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <SkeletonBar isDark={isDark} className="h-3 w-28" />
                      <SkeletonBar isDark={isDark} className="h-6 w-16 rounded-md" />
                    </div>
                    <SkeletonBar isDark={isDark} className="h-9 w-40" />
                    <SkeletonBar isDark={isDark} className="h-1 w-full rounded-full" />
                    <div className="flex gap-2 pt-1">
                      <SkeletonBar isDark={isDark} className="h-5 w-16 rounded-full" />
                      <SkeletonBar isDark={isDark} className="h-5 w-24 rounded-full" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-1.5">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>Available Balance</p>
                      <Button size="sm" variant="outline" disabled={!isLinked} onClick={() => isLinked && topup.setIsOpen(true)}
                        className={`h-6 text-[10px] px-2 cursor-pointer disabled:cursor-not-allowed ${
                          isDark
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                            : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-600 hover:text-white"
                        }`}>
                        <PlusCircle className="h-3 w-3 mr-1" /> TOP UP
                      </Button>
                    </div>
                    <h2 className={`text-4xl font-black tracking-tighter ${isDark ? "text-white" : "text-slate-900"} ${isPulsing ? "balance-pulse" : ""}`}>
                      {isLinked ? balanceText : "\u20B1— .—"}
                    </h2>
                    <div className="mt-2 space-y-1">
                      <div className={`w-full rounded-full h-1 overflow-hidden ${isDark ? "bg-slate-800" : "bg-slate-200"}`}>
                        <div
                          className={`h-1 rounded-full transition-all ${
                            !isLinked ? (isDark ? "bg-slate-700" : "bg-slate-300")
                              : isAtMaxBalance ? "bg-red-500" : currentBalance / 20000 >= 0.8 ? "bg-amber-400" : "bg-emerald-500"
                          }`}
                          style={{ width: isLinked ? `${Math.min((currentBalance / 20000) * 100, 100)}%` : "0%" }}
                        />
                      </div>
                      <p className={`text-[9px] font-mono ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                        {!isLinked ? (
                          <span>— remaining</span>
                        ) : isAtMaxBalance ? (
                          <span className={isDark ? "text-red-400/70" : "text-red-500/80"}>Max balance reached</span>
                        ) : (
                          <>₱{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })} remaining</>
                        )}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className={
                        isLinked && user?.status === "Active"
                          ? isDark
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-2 py-0.5 text-[10px]"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200 px-2 py-0.5 text-[10px]"
                          : isDark
                            ? "bg-red-500/10 text-red-400 border-red-500/20 px-2 py-0.5 text-[10px]"
                            : "bg-red-50 text-red-700 border-red-200 px-2 py-0.5 text-[10px]"
                      }>
                        <ShieldCheck className="h-3 w-3 mr-1" />{isLinked ? (user?.status || "Inactive") : "—"}
                      </Badge>
                      <Badge variant="outline" className={`px-2 py-0.5 text-[10px] ${isDark ? "border-slate-700 text-slate-400" : "border-slate-300 text-slate-500"}`}>
                        {isLinked ? (user?.type || "Standard User") : "—"}
                      </Badge>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Virtual Card — mobile only. Hidden on desktop and placed directly below the Balance card. */}
            {isLinked && (
              <div className="col-span-1 md:hidden">
                {user ? (
                  <VirtualCard
                    user={user}
                    isDark={isDark}
                    flipped={virtualCardFlipped}
                    onFlip={() => setVirtualCardFlipped((f) => !f)}
                  />
                ) : (
                  <VirtualCardSkeleton isDark={isDark} />
                )}
              </div>
            )}

            {/* Profile Card — desktop only, dulled/blank until a card is linked, skeleton while loading */}
            <Card className={`hidden md:block md:col-span-2 backdrop-blur-md ${isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-white"}`}>
              <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                {cardDataLoading ? (
                  <>
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                  </>
                ) : (
                  <>
                    {[
                      { icon: <User className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />, bg: "bg-blue-500/10 border-blue-500/20", label: "Name", value: isLinked ? (user?.fullName || "Not Linked") : "—" },
                      { icon: <CreditCard className={`h-4 w-4 ${isDark ? "text-purple-400" : "text-purple-600"}`} />, bg: "bg-purple-500/10 border-purple-500/20", label: "UID", value: isLinked ? (user?.cardUid || "----") : "—", mono: true },
                      { icon: <Tag className={`h-4 w-4 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />, bg: "bg-emerald-500/10 border-emerald-500/20", label: "Class", value: isLinked ? (user?.type || "General") : "—" },
                    ].map(({ icon, bg, label, value, mono }) => (
                      <div key={label} className={`flex items-center gap-3 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center border ${bg}`}>{icon}</div>
                        <div>
                          <p className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>{label}</p>
                          <p className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"} ${mono ? "font-mono" : ""}`}>{value}</p>
                        </div>
                      </div>
                    ))}

                    {/* ✅ Contact — editable, disabled until a card is linked */}
                    <div className={`flex items-center gap-3 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                      <div className="h-9 w-9 rounded-full flex items-center justify-center border bg-orange-500/10 border-orange-500/20 shrink-0">
                        <Phone className={`h-4 w-4 ${isDark ? "text-orange-400" : "text-orange-600"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Contact</p>
                        {editingContact ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="tel"
                              value={contactValue}
                              onChange={(e) => setContactValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveContact();
                                if (e.key === "Escape") cancelEditContact();
                              }}
                              disabled={savingField === "contact"}
                              autoFocus
                              className={`text-sm font-semibold rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                                isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                              }`}
                            />
                            <button
                              onClick={handleSaveContact}
                              disabled={savingField === "contact"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              }`}
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEditContact}
                              disabled={savingField === "contact"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                              title="Cancel"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <p className={`text-sm font-semibold truncate ${isDark ? "text-slate-200" : "text-slate-800"}`}>{isLinked ? (displayContact || "None") : "—"}</p>
                            <button
                              onClick={startEditContact}
                              disabled={!isLinked}
                              className={`h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10" : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              }`}
                              title="Edit contact number"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ✅ Email — editable, disabled until a card is linked */}
                    <div className={`flex items-center gap-3 sm:col-span-2 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                      <div className="h-9 w-9 rounded-full bg-sky-500/10 flex items-center justify-center border border-sky-500/20 shrink-0">
                        <Mail className={`h-4 w-4 ${isDark ? "text-sky-400" : "text-sky-600"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Email</p>
                        {editingEmail ? (
                          <div className="flex items-center gap-1.5 max-w-sm">
                            <input
                              type="email"
                              value={emailValue}
                              onChange={(e) => setEmailValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEmail();
                                if (e.key === "Escape") cancelEditEmail();
                              }}
                              disabled={savingField === "email"}
                              autoFocus
                              className={`text-sm rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                                isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                              }`}
                            />
                            <button
                              onClick={handleSaveEmail}
                              disabled={savingField === "email"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              }`}
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEditEmail}
                              disabled={savingField === "email"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                              title="Cancel"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <p className={`text-sm truncate ${isDark ? "text-slate-200" : "text-slate-800"}`}>{isLinked ? (displayEmail || "Not linked") : "—"}</p>
                            <button
                              onClick={startEditEmail}
                              disabled={!isLinked}
                              className={`h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10" : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              }`}
                              title="Edit email"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* TRANSACTIONS — Desktop */}
        <div className="hidden md:block">
          <Card className={`backdrop-blur-md overflow-hidden ${isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-white"}`}>
            <CardHeader className={`py-3 border-b ${isDark ? "bg-slate-900/20 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
              <CardTitle className={`text-xs font-bold flex items-center gap-2 uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <List className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />Transactions History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!isLinked ? (
                <div className="flex flex-col items-center justify-center py-14 gap-3">
                  <List className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                  <p className={`text-xs italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>Link a card to see your transactions.</p>
                  <Button size="sm" onClick={() => linkCard.setIsOpen(true)}
                    className="h-7 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
                    <Link2 className="h-3 w-3 mr-1" /> Link Card
                  </Button>
                </div>
              ) : cardDataLoading ? (
                <div className="p-4 space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <SkeletonBar isDark={isDark} className="h-2.5 w-24" />
                        <SkeletonBar isDark={isDark} className="h-2 w-16" />
                      </div>
                      <SkeletonBar isDark={isDark} className="h-3 w-20" />
                      <SkeletonBar isDark={isDark} className="h-4 w-16 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <p className={`px-4 pt-2 pb-1 text-[10px] italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>Tap a row to view transaction details.</p>
                  <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full text-left table-fixed">
                      <colgroup>
                        <col style={{ width: "30%" }} /><col style={{ width: "18%" }} />
                        <col style={{ width: "30%" }} /><col style={{ width: "22%" }} />
                      </colgroup>
                      <thead className={isDark ? "bg-slate-950/50" : "bg-slate-50"}>
                        <tr>
                          {(["Timestamp", "Service", "Amount", "Result"] as const).map((h, i) => (
                            <th key={h} className={`px-3 py-2.5 text-[9px] font-black uppercase whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"} ${
                              i === 2 ? "text-right" : i === 3 ? "text-center" : ""}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={isDark ? "divide-y divide-slate-800/50" : "divide-y divide-slate-100"}>
                        {transactions.length === 0 ? (
                          <tr><td className={`p-12 text-center text-sm italic ${isDark ? "text-slate-600" : "text-slate-400"}`} colSpan={4}>No activity recorded.</td></tr>
                        ) : transactions.map((tx) => (
                          <tr key={tx.id} onClick={() => handleTxClick(tx)}
                            className={`transition-colors cursor-pointer ${isDark ? "hover:bg-slate-800/30 active:bg-slate-800/50" : "hover:bg-slate-50 active:bg-slate-100"}`}>
                            <td className="px-3 py-2.5">
                              <p className={`text-[10px] font-medium leading-tight whitespace-nowrap ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                {new Date(tx.timestamp).toLocaleDateString()}
                              </p>
                              <p className={`text-[9px] font-mono leading-tight whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                                {new Date(tx.timestamp).toLocaleTimeString()}
                              </p>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-[10px] font-semibold uppercase whitespace-nowrap ${isDark ? "text-slate-200" : "text-slate-700"}`}>{tx.type}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`whitespace-nowrap tabular-nums text-[11px] font-bold ${
                                tx.type === "Fare" ? (isDark ? "text-red-400" : "text-red-600") : (isDark ? "text-emerald-400" : "text-emerald-600")}`}>
                                {formatAmount(tx.type, tx.amount)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <Badge variant="outline" className={`text-[9px] font-black tracking-widest uppercase py-0 whitespace-nowrap ${
                                tx.status === "Success"
                                  ? isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" : "text-emerald-700 border-emerald-200 bg-emerald-50"
                                  : isDark ? "text-red-400 border-red-500/30 bg-red-500/5" : "text-red-700 border-red-200 bg-red-50"}`}>
                                {tx.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* TRANSACTIONS — Mobile */}
        <div
          className={
            activeTab === "Transactions"
              ? `fixed inset-0 flex flex-col md:hidden z-10 ${isDark ? "bg-[#020617]" : "bg-slate-50"}`
              : "hidden"
          }
          style={{ top: `${headerHeight}px`, bottom: `${navHeight}px` }}
        >
          <div className={`backdrop-blur-md px-4 py-2.5 border-b shrink-0 ${isDark ? "bg-[#020617]/95 border-slate-800/60" : "bg-white/95 border-slate-200"}`}>
            <p className={`text-sm font-bold flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <List className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
              Transactions History
            </p>
          </div>
          <div className={`flex-1 overflow-y-auto overscroll-contain ${isDark ? "bg-[#020617]" : "bg-slate-50"}`}>
            {!isLinked ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-6">
                <List className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                <p className={`text-xs italic text-center ${isDark ? "text-slate-600" : "text-slate-400"}`}>Link a card to see your transactions.</p>
                <Button size="sm" onClick={() => linkCard.setIsOpen(true)}
                  className="h-8 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
                  <Link2 className="h-3 w-3 mr-1" /> Link Card
                </Button>
              </div>
            ) : cardDataLoading ? (
              <div className="p-4 space-y-4">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <SkeletonBar isDark={isDark} className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <SkeletonBar isDark={isDark} className="h-2.5 w-20" />
                      <SkeletonBar isDark={isDark} className="h-2 w-28" />
                    </div>
                    <SkeletonBar isDark={isDark} className="h-3 w-14" />
                  </div>
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <List className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                <p className={`text-xs italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>No transactions yet.</p>
              </div>
            ) : (
              <div className={isDark ? "divide-y divide-slate-800/50" : "divide-y divide-slate-200 bg-white"}>
                {transactions.map((tx) => (
                  <MobileTxRow key={tx.id} tx={tx} onClick={() => handleTxClick(tx)} isDark={isDark} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SETTINGS tab (mobile only) */}
        <div className={activeTab === "settings" ? "block md:hidden" : "hidden"}>
          <div className="space-y-3">


            {/* Profile Card */}
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
              {cardDataLoading ? (
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <SkeletonBar isDark={isDark} className="h-11 w-11 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <SkeletonBar isDark={isDark} className="h-3 w-32" />
                      <SkeletonBar isDark={isDark} className="h-2.5 w-40" />
                    </div>
                  </div>
                  <SkeletonRow isDark={isDark} />
                  <SkeletonRow isDark={isDark} />
                  <SkeletonRow isDark={isDark} />
                </div>
              ) : (
                <>
                  <div className={`flex items-center gap-3 px-4 py-4 border-b ${isDark ? "border-slate-800/60" : "border-slate-100"} ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                    <div className="h-11 w-11 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center shrink-0">
                      <span className={`font-black text-base tracking-tight ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                        {getInitials(isLinked ? (user?.fullName || "?") : "?")}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold leading-tight truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                        {isLinked ? (user?.fullName || "Not linked") : "—"}
                      </p>
                      <p className={`text-[11px] mt-0.5 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{isLinked ? (displayEmail || "—") : "—"}</p>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        <Badge className={
                          isLinked && user?.status === "Active"
                            ? isDark
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-1.5 py-0 text-[9px]"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200 px-1.5 py-0 text-[9px]"
                            : isDark
                              ? "bg-red-500/10 text-red-400 border-red-500/20 px-1.5 py-0 text-[9px]"
                              : "bg-red-50 text-red-700 border-red-200 px-1.5 py-0 text-[9px]"
                        }>
                          <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />{isLinked ? (user?.status || "Inactive") : "—"}
                        </Badge>
                        <Badge variant="outline" className={`px-1.5 py-0 text-[9px] ${isDark ? "border-slate-700 text-slate-400" : "border-slate-300 text-slate-500"}`}>
                          {isLinked ? (user?.type || "Standard") : "—"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {[
                    { icon: <CreditCard className={`h-3.5 w-3.5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />, label: "UID", value: isLinked ? (user?.cardUid || "----") : "—", mono: true },
                    { icon: <Tag className={`h-3.5 w-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />, label: "Class", value: isLinked ? (user?.type || "General") : "—", mono: false },
                  ].map(({ icon, label, value, mono }) => (
                    <div key={label} className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? "border-slate-800/50" : "border-slate-100"} ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                      <div className="shrink-0 opacity-80">{icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[9px] font-bold uppercase tracking-widest leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>{label}</p>
                        <p className={`text-xs truncate ${isDark ? "text-slate-200" : "text-slate-700"} ${mono ? "font-mono" : "font-medium"}`}>{value}</p>
                      </div>
                    </div>
                  ))}

                  {/* ✅ Contact — editable (mobile), disabled until a card is linked */}
                  <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? "border-slate-800/50" : "border-slate-100"} ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                    <div className="shrink-0 opacity-80"><Phone className={`h-3.5 w-3.5 ${isDark ? "text-orange-400" : "text-orange-600"}`} /></div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[9px] font-bold uppercase tracking-widest leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Contact</p>
                      {editingContact ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="tel"
                            value={contactValue}
                            onChange={(e) => setContactValue(e.target.value)}
                            disabled={savingField === "contact"}
                            autoFocus
                            className={`text-xs rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                              isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                            }`}
                          />
                          <button
                            onClick={handleSaveContact}
                            disabled={savingField === "contact"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={cancelEditContact}
                            disabled={savingField === "contact"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs font-medium truncate ${isDark ? "text-slate-200" : "text-slate-700"}`}>{isLinked ? (displayContact || "None") : "—"}</p>
                          <button
                            onClick={startEditContact}
                            disabled={!isLinked}
                            className={`h-5 w-5 flex items-center justify-center rounded shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "text-slate-600 active:text-emerald-400" : "text-slate-400 active:text-emerald-600"
                            }`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ✅ Email — editable (mobile, auth_users), disabled until a card is linked */}
                  <div className={`flex items-center gap-3 px-4 py-3 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                    <div className="shrink-0 opacity-80"><Mail className={`h-3.5 w-3.5 ${isDark ? "text-sky-400" : "text-sky-600"}`} /></div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[9px] font-bold uppercase tracking-widest leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Email</p>
                      {editingEmail ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="email"
                            value={emailValue}
                            onChange={(e) => setEmailValue(e.target.value)}
                            disabled={savingField === "email"}
                            autoFocus
                            className={`text-xs rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                              isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                            }`}
                          />
                          <button
                            onClick={handleSaveEmail}
                            disabled={savingField === "email"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={cancelEditEmail}
                            disabled={savingField === "email"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs truncate ${isDark ? "text-slate-200" : "text-slate-700"}`}>{isLinked ? (displayEmail || "Not linked") : "—"}</p>
                          <button
                            onClick={startEditEmail}
                            disabled={!isLinked}
                            className={`h-5 w-5 flex items-center justify-center rounded shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "text-slate-600 active:text-emerald-400" : "text-slate-400 active:text-emerald-600"
                            }`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Account actions — always usable regardless of link status */}
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
              <p className={`px-4 pt-3 pb-1.5 text-[9px] font-black uppercase tracking-widest ${isDark ? "text-slate-600" : "text-slate-400"}`}>Account</p>

              {!isLinked && (
                <button onClick={() => linkCard.setIsOpen(true)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                    isDark ? "border-slate-800/50 hover:bg-emerald-500/5 active:bg-emerald-500/10" : "border-slate-100 hover:bg-emerald-50 active:bg-emerald-100"
                  }`}>
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <Link2 className={`h-3.5 w-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`text-xs font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>Link Card</p>
                    <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Connect a card to activate your account</p>
                  </div>
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
                </button>
              )}

              <button onClick={toggleTheme}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                  isDark ? "border-slate-800/50 hover:bg-slate-800/30 active:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50 active:bg-slate-100"
                }`}>
                <div className="h-8 w-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  {isDark ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-amber-600" />}
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-xs font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                    {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Change app appearance</p>
                </div>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
              </button>

              <button onClick={changePassword.open}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                  isDark ? "border-slate-800/50 hover:bg-slate-800/30 active:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50 active:bg-slate-100"
                }`}>
                <div className="h-8 w-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <KeyRound className={`h-3.5 w-3.5 ${isDark ? "text-violet-400" : "text-violet-600"}`} />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-xs font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>Change Password</p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Update your account password</p>
                </div>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
              </button>
              <button onClick={requestLogout}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                  isDark ? "hover:bg-red-500/5 active:bg-red-500/10" : "hover:bg-red-50 active:bg-red-100"
                }`}>
                <div className="h-8 w-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                  <LogOut className={`h-3.5 w-3.5 ${isDark ? "text-red-400" : "text-red-600"}`} />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-xs font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>Logout</p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Sign out of your account</p>
                </div>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
              </button>
            </div>

            <p className={`text-center text-[9px] font-mono uppercase tracking-widest pb-1 ${isDark ? "text-slate-700" : "text-slate-300"}`}>
              Fare Collection System &mdash; v1.0.0
            </p>
          </div>
        </div>

        {/* Footer (desktop only) */}
        <footer className={`hidden md:block border-t pt-4 pb-2 ${isDark ? "border-slate-800/60" : "border-slate-200"}`}>
          <div className={`flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest ${isDark ? "text-slate-700" : "text-slate-400"}`}>
            <span>Fare Collection System</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved. | v1.0.0</span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Nav */}
      <nav
        ref={navRef}
        className={`fixed bottom-0 left-0 right-0 z-20 flex md:hidden h-16 border-t transition-all duration-300 ${
          isDark ? "bg-[#020617] border-slate-800/60" : "bg-slate-50 border-slate-200"
        } ${
          linkCard.isOpen ? "opacity-0 pointer-events-none blur-sm" : "opacity-100"
        }`}
      >
        {navItems.map(({ tab, icon, label }) => {
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => handleTabChange(tab)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 cursor-pointer ${
                isActive
                  ? isDark ? "text-emerald-400" : "text-emerald-600"
                  : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-400 hover:text-slate-600"
              }`}>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-emerald-400" />
              )}
              {icon}
              <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}