import { useEffect, useRef, useState, type ReactNode } from "react";
import { CreditCard, RotateCw } from "lucide-react";
import { formatCardDate } from "@/lib/dashboard-formatters";

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
  front: ReactNode;
  back: ReactNode;
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
export function VirtualCard({
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
export function VirtualCardSkeleton({ isDark }: { isDark: boolean }) {
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

