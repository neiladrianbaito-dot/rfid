import { useEffect, useRef, useState } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { LinkIcon, Lock, CheckCircle2, XCircle, Loader2, Ban, ShieldAlert, Clock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RECAPTCHA_SITE_KEY } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import type { useLinkCard } from "@/hooks/use-link-card";

type Props = ReturnType<typeof useLinkCard> & {
  onCancel?: () => void;
};

export function LinkCardModal(props: Props) {
  const {
    input, setInput, loading, error, validation, isConfirmStep,
    recaptchaRef, captchaToken, setCaptchaToken, captchaError, setCaptchaError,
    checkCard, confirmLink, backToInput, setValidation,
    lockoutSecs,  // ← countdown seconds from hook
  } = props;
  const { onCancel } = props;

  // ✅ Same theme source as the dashboard — the modal now follows the toggle.
  const { isDark } = useTheme();

  const isChecking = validation.status === "checking";
  const isBlocked  = validation.status === "blocked";
  const isLocked   = validation.status === "locked";

  // ── Responsive reCAPTCHA scaling ──────────────────────────────────────────
  const RECAPTCHA_WIDTH = 304;
  const RECAPTCHA_HEIGHT = 78;
  const recaptchaBoxRef = useRef<HTMLDivElement>(null);
  const [recaptchaScale, setRecaptchaScale] = useState(1);

  useEffect(() => {
    const el = recaptchaBoxRef.current;
    if (!el) return;

    const updateScale = () => {
      const availableWidth = el.offsetWidth;
      if (!availableWidth) return;
      const nextScale = Math.min(availableWidth / RECAPTCHA_WIDTH, 1);
      setRecaptchaScale(nextScale > 0 ? nextScale : 1);
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Backdrop — full-screen overlay, scrollable on small screens.
          z-50 keeps this above the dashboard's sticky header (z-10)
          and mobile bottom nav (z-20). */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
        style={{
          padding: "1rem",
          background: isDark ? "rgba(2,6,23,0.75)" : "rgba(15,23,42,0.45)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <div
          className={`w-full max-w-[420px] relative my-auto rounded-2xl border ${
            isDark
              ? "bg-slate-950 border-slate-800 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)]"
              : "bg-white border-slate-200 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.25)]"
          }`}
          style={{ zIndex: 51 }}
        >
          <div className={`p-4 sm:p-7 max-h-[90vh] overflow-y-auto ${isDark ? "text-slate-100" : "text-slate-900"}`}>

            {/* Header */}
            <div className="flex items-center gap-2.5 sm:gap-3 mb-2">
              <div className={`p-2 sm:p-2.5 rounded-xl border shrink-0 ${
                isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
              }`}>
                <LinkIcon className={`h-5 w-5 sm:h-6 sm:w-6 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
              </div>
              <div className="min-w-0">
                <h2 className={`text-base sm:text-lg font-bold leading-tight truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                  Link Your Card
                </h2>
                <p className={`text-[9px] sm:text-[10px] uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-400"}`}>
                  One-time setup
                </p>
              </div>
            </div>

            {/* Security notice */}
            <div className={`mt-3 sm:mt-4 mb-4 sm:mb-5 flex gap-2.5 sm:gap-3 rounded-xl p-2.5 sm:p-3 border ${
              isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200"
            }`}>
              <Lock className={`h-4 w-4 flex-shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
              <p className={`text-[11px] sm:text-xs leading-relaxed ${isDark ? "text-amber-300" : "text-amber-700"}`}>
                <span className="font-bold">Security Notice:</span> For your account's security, a card can
                only be linked <span className="font-bold underline underline-offset-2">once</span>. This
                action is permanent and cannot be changed after confirmation.
              </p>
            </div>

            {/* ── LOCKOUT BANNER ── shown instead of the form when locked */}
            {isLocked && (
              <div className="space-y-3 sm:space-y-4">
                <div className={`flex flex-col items-center gap-2.5 sm:gap-3 rounded-xl p-4 sm:p-5 text-center border ${
                  isDark ? "bg-red-500/10 border-red-500/30" : "bg-red-50 border-red-200"
                }`}>
                  <ShieldAlert className={`h-7 w-7 sm:h-8 sm:w-8 ${isDark ? "text-red-400" : "text-red-500"}`} />
                  <div>
                    <p className={`font-bold text-sm mb-1 ${isDark ? "text-red-400" : "text-red-600"}`}>Too Many Failed Attempts</p>
                    <p className={`text-[11px] sm:text-xs leading-relaxed ${isDark ? "text-red-300/80" : "text-red-500/80"}`}>
                      You have been temporarily locked out for security reasons.
                    </p>
                  </div>

                  {/* Realtime countdown */}
                  <div className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border ${
                    isDark ? "bg-red-500/20 border-red-500/30" : "bg-red-100 border-red-200"
                  }`}>
                    <Clock className={`h-4 w-4 animate-pulse shrink-0 ${isDark ? "text-red-400" : "text-red-500"}`} />
                    <span className={`text-[13px] sm:text-sm ${isDark ? "text-red-300" : "text-red-600"}`}>
                      Try again in{" "}
                      <span className={`font-black tabular-nums ${isDark ? "text-white" : "text-red-700"}`}>
                        {lockoutSecs}s
                      </span>
                    </span>
                  </div>

                  <p className={`text-[9px] sm:text-[10px] leading-relaxed ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    The timer will unlock automatically. Do not close this window.
                  </p>
                </div>

                <Button
                  onClick={onCancel}
                  variant="outline"
                  className={`w-full h-11 sm:h-12 text-sm cursor-pointer ${
                    isDark
                      ? "border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  Cancel and return to sign-in
                </Button>
              </div>
            )}

            {/* ── Step 1: Input ── */}
            {!isConfirmStep && !isLocked && (
              <div className="space-y-3 sm:space-y-4">

                <div>
                  <label className={`text-[9px] sm:text-[10px] font-bold uppercase block mb-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    Card UID
                  </label>
                  <Input
                    value={input}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^a-zA-Z0-9-_]/g, "");
                      setInput(raw);
                      if (validation.status !== "idle") setValidation({ status: "idle" });
                    }}
                    placeholder="Enter your Card UID..."
                    className={`font-mono text-sm h-11 focus-visible:ring-emerald-500/30 ${
                      isDark
                        ? "bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50"
                        : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-emerald-500"
                    }`}
                    onKeyDown={(e) => e.key === "Enter" && !isChecking && checkCard()}
                    disabled={isChecking}
                  />
                </div>

                <div className="recaptcha-wrapper flex flex-col items-center gap-1 w-full overflow-hidden">
                  <label className={`text-[9px] sm:text-[10px] font-bold uppercase mb-1 self-start ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    Verification
                  </label>
                  {/* Placeholder box — full width of its parent. The recaptcha
                      scales itself to exactly match this box's width. */}
                  <div
                    ref={recaptchaBoxRef}
                    className="w-full max-w-[304px]"
                    style={{ height: RECAPTCHA_HEIGHT * recaptchaScale }}
                  >
                    <div
                      style={{
                        transform: `scale(${recaptchaScale})`,
                        transformOrigin: "0 0",
                        width: RECAPTCHA_WIDTH,
                        height: RECAPTCHA_HEIGHT,
                      }}
                    >
                      <ReCAPTCHA
                        ref={recaptchaRef}
                        sitekey={RECAPTCHA_SITE_KEY}
                        theme={isDark ? "dark" : "light"}
                        onChange={(token) => { setCaptchaToken(token); setCaptchaError(""); }}
                        onExpired={() => { setCaptchaToken(null); setCaptchaError("reCAPTCHA expired. Please verify again."); }}
                      />
                    </div>
                  </div>
                  {captchaError && (
                    <p className={`text-[11px] sm:text-xs mt-1 flex items-center gap-1 self-start ${isDark ? "text-red-400" : "text-red-500"}`}>
                      <XCircle className="h-3 w-3 shrink-0" /> {captchaError}
                    </p>
                  )}
                </div>

                {isBlocked && (
                  <div className={`flex items-start gap-2 text-[11px] sm:text-xs rounded-lg px-3 py-3 border ${
                    isDark ? "text-red-300 bg-red-500/10 border-red-500/30" : "text-red-600 bg-red-50 border-red-200"
                  }`}>
                    <Ban className={`h-4 w-4 flex-shrink-0 mt-0.5 ${isDark ? "text-red-400" : "text-red-500"}`} />
                    <div>
                      <p className={`font-bold mb-0.5 ${isDark ? "text-red-400" : "text-red-600"}`}>Card Blocked</p>
                      <p className={isDark ? "text-red-300/80" : "text-red-500/80"}>This card has been blocked. Please contact support.</p>
                    </div>
                  </div>
                )}

                {error && !isBlocked && (
                  <div className={`flex items-start gap-2 text-[11px] sm:text-xs rounded-lg px-3 py-2.5 border ${
                    isDark ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-red-500 bg-red-50 border-red-200"
                  }`}>
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {isChecking && (
                  <div className={`flex items-center gap-2 text-[11px] sm:text-xs rounded-lg px-3 py-2.5 border ${
                    isDark ? "text-slate-400 bg-slate-800/50 border-slate-700" : "text-slate-500 bg-slate-50 border-slate-200"
                  }`}>
                    <Loader2 className={`h-4 w-4 animate-spin shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-500"}`} />
                    <span>Checking card in system...</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => window.history.back()}
                    className={`flex-1 inline-flex items-center justify-center gap-2 rounded-md border text-sm px-4 py-2.5 h-11 sm:h-12 transition-colors cursor-pointer ${
                      isDark
                        ? "border-[#1f2622] text-[#d7ded9] hover:border-[#4ea878] hover:text-[#7CFFB2]"
                        : "border-slate-200 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50/50"
                    }`}
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Go back
                  </button>
                  <Button
                    onClick={checkCard}
                    disabled={isChecking || !input.trim() || !captchaToken}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11 sm:h-12 text-sm transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-sm shadow-emerald-600/20"
                  >
                    {isChecking
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />Verifying Card...</>
                      : <><CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />Verify Card UID</>}
                  </Button>
                </div>

                <p className={`text-center text-[9px] sm:text-[10px] leading-relaxed ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                  Complete the reCAPTCHA and verify your card before linking.
                </p>
              </div>
            )}

            {/* ── Step 2: Confirm ── */}
            {isConfirmStep && !isLocked && validation.status === "found" && (
              <div className="space-y-3 sm:space-y-4">
                <div className={`rounded-xl p-3 sm:p-4 space-y-3 border ${
                  isDark ? "bg-emerald-500/10 border-emerald-500/30" : "bg-emerald-50 border-emerald-200"
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                    <span className={`text-[11px] sm:text-xs font-bold uppercase tracking-wider ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      Card Found
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className={`text-[9px] sm:text-[10px] uppercase font-bold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card UID</p>
                      <p className={`text-sm font-mono tracking-widest break-all ${isDark ? "text-white" : "text-slate-900"}`}>
                        {validation.cardData.cardUid}
                      </p>
                    </div>
                    {validation.cardData.fullName && (
                      <div>
                        <p className={`text-[9px] sm:text-[10px] uppercase font-bold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Registered Name</p>
                        <p className={`text-sm font-semibold break-words ${isDark ? "text-white" : "text-slate-900"}`}>
                          {validation.cardData.fullName}
                        </p>
                      </div>
                    )}
                    {validation.cardData.type && (
                      <div>
                        <p className={`text-[9px] sm:text-[10px] uppercase font-bold mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card Type</p>
                        <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{validation.cardData.type}</p>
                      </div>
                    )}
                  </div>
                </div>

                <p className={`text-[11px] sm:text-xs text-center leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Is this your card? Confirm to permanently link it to your account.{" "}
                  <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>This cannot be undone.</span>
                </p>

                {error && (
                  <div className={`flex items-start gap-2 text-[11px] sm:text-xs rounded-lg px-3 py-2.5 border ${
                    isDark ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-red-500 bg-red-50 border-red-200"
                  }`}>
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={backToInput} disabled={loading} variant="outline"
                    className={`flex-1 h-11 sm:h-12 text-sm cursor-pointer disabled:cursor-not-allowed ${
                      isDark
                        ? "border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    }`}>
                    Back
                  </Button>
                  <Button onClick={confirmLink} disabled={loading}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11 sm:h-12 text-sm transition-all cursor-pointer disabled:cursor-not-allowed shadow-sm shadow-emerald-600/20">
                    {loading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />Linking...</>
                      : <><LinkIcon className="h-4 w-4 mr-2 shrink-0" />Confirm & Link</>}
                  </Button>
                </div>

                <button
                  onClick={onCancel}
                  disabled={loading}
                  className={`w-full text-center text-[11px] transition-colors underline underline-offset-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                    isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-700"
                  }`}
                >
                  Cancel and return to sign-in
                </button>

                <p className={`text-center text-[9px] sm:text-[10px] leading-relaxed ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                  By clicking above, you agree that this card UID will be permanently tied to your account and cannot be modified.
                </p>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}