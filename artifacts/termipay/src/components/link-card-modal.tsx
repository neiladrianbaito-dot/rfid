import { useEffect, useRef, useState } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { LinkIcon, Lock, CheckCircle2, XCircle, Loader2, Ban, ShieldAlert, Clock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RECAPTCHA_SITE_KEY } from "@/lib/api";
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
          background: "rgba(15,23,42,0.45)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <div
          className="w-full max-w-[420px] relative my-auto rounded-2xl bg-white shadow-[0_20px_60px_-15px_rgba(15,23,42,0.25)] border border-slate-200"
          style={{ zIndex: 51 }}
        >
          <div className="p-4 sm:p-7 text-slate-900 max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center gap-2.5 sm:gap-3 mb-2">
              <div className="p-2 sm:p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 shrink-0">
                <LinkIcon className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold leading-tight truncate text-slate-900">Link Your Card</h2>
                <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase tracking-widest">One-time setup</p>
              </div>
            </div>

            {/* Security notice */}
            <div className="mt-3 sm:mt-4 mb-4 sm:mb-5 flex gap-2.5 sm:gap-3 bg-amber-50 border border-amber-200 rounded-xl p-2.5 sm:p-3">
              <Lock className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] sm:text-xs text-amber-700 leading-relaxed">
                <span className="font-bold">Security Notice:</span> For your account's security, a card can
                only be linked <span className="font-bold underline underline-offset-2">once</span>. This
                action is permanent and cannot be changed after confirmation.
              </p>
            </div>

            {/* ── LOCKOUT BANNER ── shown instead of the form when locked */}
            {isLocked && (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex flex-col items-center gap-2.5 sm:gap-3 bg-red-50 border border-red-200 rounded-xl p-4 sm:p-5 text-center">
                  <ShieldAlert className="h-7 w-7 sm:h-8 sm:w-8 text-red-500" />
                  <div>
                    <p className="font-bold text-red-600 text-sm mb-1">Too Many Failed Attempts</p>
                    <p className="text-[11px] sm:text-xs text-red-500/80 leading-relaxed">
                      You have been temporarily locked out for security reasons.
                    </p>
                  </div>

                  {/* Realtime countdown */}
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-red-100 border border-red-200 rounded-lg">
                    <Clock className="h-4 w-4 text-red-500 animate-pulse shrink-0" />
                    <span className="text-[13px] sm:text-sm text-red-600">
                      Try again in{" "}
                      <span className="font-black text-red-700 tabular-nums">
                        {lockoutSecs}s
                      </span>
                    </span>
                  </div>

                  <p className="text-[9px] sm:text-[10px] text-slate-400 leading-relaxed">
                    The timer will unlock automatically. Do not close this window.
                  </p>
                </div>

                <Button
                  onClick={onCancel}
                  variant="outline"
                  className="w-full border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 h-11 sm:h-12 text-sm cursor-pointer"
                >
                  Cancel and return to sign-in
                </Button>
              </div>
            )}

            {/* ── Step 1: Input ── */}
            {!isConfirmStep && !isLocked && (
              <div className="space-y-3 sm:space-y-4">

                <div>
                  <label className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase block mb-1.5">
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
                    className="bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus-visible:ring-emerald-500/30 font-mono text-sm h-11"
                    onKeyDown={(e) => e.key === "Enter" && !isChecking && checkCard()}
                    disabled={isChecking}
                  />
                </div>

                <div className="recaptcha-wrapper flex flex-col items-center gap-1 w-full overflow-hidden">
                  <label className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase mb-1 self-start">
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
                        theme="light"
                        onChange={(token) => { setCaptchaToken(token); setCaptchaError(""); }}
                        onExpired={() => { setCaptchaToken(null); setCaptchaError("reCAPTCHA expired. Please verify again."); }}
                      />
                    </div>
                  </div>
                  {captchaError && (
                    <p className="text-[11px] sm:text-xs text-red-500 mt-1 flex items-center gap-1 self-start">
                      <XCircle className="h-3 w-3 shrink-0" /> {captchaError}
                    </p>
                  )}
                </div>

                {isBlocked && (
                  <div className="flex items-start gap-2 text-[11px] sm:text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-3">
                    <Ban className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-500" />
                    <div>
                      <p className="font-bold text-red-600 mb-0.5">Card Blocked</p>
                      <p className="text-red-500/80">This card has been blocked. Please contact support.</p>
                    </div>
                  </div>
                )}

                {error && !isBlocked && (
                  <div className="flex items-start gap-2 text-[11px] sm:text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {isChecking && (
                  <div className="flex items-center gap-2 text-[11px] sm:text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-500 shrink-0" />
                    <span>Checking card in system...</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => window.history.back()}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 text-slate-500 text-sm px-4 py-2.5 h-11 sm:h-12 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50/50 transition-colors cursor-pointer"
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

                <p className="text-center text-[9px] sm:text-[10px] text-slate-400 leading-relaxed">
                  Complete the reCAPTCHA and verify your card before linking.
                </p>
              </div>
            )}

            {/* ── Step 2: Confirm ── */}
            {isConfirmStep && !isLocked && validation.status === "found" && (
              <div className="space-y-3 sm:space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 sm:p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="text-[11px] sm:text-xs font-bold text-emerald-600 uppercase tracking-wider">Card Found</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold mb-0.5">Card UID</p>
                      <p className="text-sm font-mono text-slate-900 tracking-widest break-all">{validation.cardData.cardUid}</p>
                    </div>
                    {validation.cardData.fullName && (
                      <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold mb-0.5">Registered Name</p>
                        <p className="text-sm font-semibold text-slate-900 break-words">{validation.cardData.fullName}</p>
                      </div>
                    )}
                    {validation.cardData.type && (
                      <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold mb-0.5">Card Type</p>
                        <p className="text-sm text-slate-600">{validation.cardData.type}</p>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-[11px] sm:text-xs text-slate-500 text-center leading-relaxed">
                  Is this your card? Confirm to permanently link it to your account.{" "}
                  <span className="text-amber-600 font-semibold">This cannot be undone.</span>
                </p>

                {error && (
                  <div className="flex items-start gap-2 text-[11px] sm:text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={backToInput} disabled={loading} variant="outline"
                    className="flex-1 border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 h-11 sm:h-12 text-sm cursor-pointer disabled:cursor-not-allowed">
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
                  className="w-full text-center text-[11px] text-slate-400 hover:text-slate-700 transition-colors underline underline-offset-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  Cancel and return to sign-in
                </button>

                <p className="text-center text-[9px] sm:text-[10px] text-slate-400 leading-relaxed">
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