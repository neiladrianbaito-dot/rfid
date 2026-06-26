import ReCAPTCHA from "react-google-recaptcha";
import { LinkIcon, Lock, CheckCircle2, XCircle, Loader2, Ban, ShieldAlert, Clock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RECAPTCHA_SITE_KEY } from "@/lib/api";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
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
  const isLocked   = validation.status === "locked";  // ← new

  return (
    <>
      <style>{DASHBOARD_STYLES}</style>

      {/* Backdrop — full-screen overlay with blur, scrollable on small screens */}
      <div
        className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto"
        style={{
          padding: "1rem",
          background: "rgba(2,6,23,0.75)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      >
        <div
          className="rgb-container w-full max-w-[420px] relative my-auto"
          style={{ zIndex: 50 }}
        >
          <div className="p-4 sm:p-7 text-white max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center gap-2.5 sm:gap-3 mb-2">
              <div className="p-2 sm:p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shrink-0">
                <LinkIcon className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold leading-tight truncate">Link Your Card</h2>
                <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase tracking-widest">One-time setup</p>
              </div>
            </div>

            {/* Security notice */}
            <div className="mt-3 sm:mt-4 mb-4 sm:mb-5 flex gap-2.5 sm:gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 sm:p-3">
              <Lock className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] sm:text-xs text-amber-300 leading-relaxed">
                <span className="font-bold">Security Notice:</span> For your account's security, a card can
                only be linked <span className="font-bold underline underline-offset-2">once</span>. This
                action is permanent and cannot be changed after confirmation.
              </p>
            </div>

            {/* ── LOCKOUT BANNER ── shown instead of the form when locked */}
            {isLocked && (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex flex-col items-center gap-2.5 sm:gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 sm:p-5 text-center">
                  <ShieldAlert className="h-7 w-7 sm:h-8 sm:w-8 text-red-400" />
                  <div>
                    <p className="font-bold text-red-400 text-sm mb-1">Too Many Failed Attempts</p>
                    <p className="text-[11px] sm:text-xs text-red-300/80 leading-relaxed">
                      You have been temporarily locked out for security reasons.
                    </p>
                  </div>

                  {/* ✅ Realtime countdown */}
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg">
                    <Clock className="h-4 w-4 text-red-400 animate-pulse shrink-0" />
                    <span className="text-[13px] sm:text-sm text-red-300">
                      Try again in{" "}
                      <span className="font-black text-white tabular-nums">
                        {lockoutSecs}s
                      </span>
                    </span>
                  </div>

                  <p className="text-[9px] sm:text-[10px] text-slate-500 leading-relaxed">
                    The timer will unlock automatically. Do not close this window.
                  </p>
                </div>

                <Button
                  onClick={onCancel}
                  variant="outline"
                  className="w-full border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-11 sm:h-12 text-sm"
                >
                  Cancel and return to sign-in
                </Button>
              </div>
            )}

            {/* ── Step 1: Input ── */}
            {!isConfirmStep && !isLocked && (
              <div className="space-y-3 sm:space-y-4">

                <div>
                  <label className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
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
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 font-mono text-sm h-11"
                    onKeyDown={(e) => e.key === "Enter" && !isChecking && checkCard()}
                    disabled={isChecking}
                  />
                </div>

                <div className="recaptcha-wrapper flex flex-col items-center gap-1 w-full overflow-hidden">
                  <label className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase mb-1 self-start">
                    Verification
                  </label>
                  <div className="w-full flex justify-center sm:justify-start">
                    <div
                      className="origin-top-left"
                      style={{
                        transform: "scale(var(--recaptcha-scale, 0.85))",
                        transformOrigin: "0 0",
                        width: 304,
                        height: 78,
                      }}
                    >
                      <div className="recaptcha-scale-wrapper">
                        <ReCAPTCHA
                          ref={recaptchaRef}
                          sitekey={RECAPTCHA_SITE_KEY}
                          theme="dark"
                          onChange={(token) => { setCaptchaToken(token); setCaptchaError(""); }}
                          onExpired={() => { setCaptchaToken(null); setCaptchaError("reCAPTCHA expired. Please verify again."); }}
                        />
                      </div>
                    </div>
                  </div>
                  {captchaError && (
                    <p className="text-[11px] sm:text-xs text-red-400 mt-1 flex items-center gap-1 self-start">
                      <XCircle className="h-3 w-3 shrink-0" /> {captchaError}
                    </p>
                  )}
                </div>

                {isBlocked && (
                  <div className="flex items-start gap-2 text-[11px] sm:text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-3">
                    <Ban className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
                    <div>
                      <p className="font-bold text-red-400 mb-0.5">Card Blocked</p>
                      <p className="text-red-300/80">This card has been blocked. Please contact support.</p>
                    </div>
                  </div>
                )}

                {error && !isBlocked && (
                  <div className="flex items-start gap-2 text-[11px] sm:text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {isChecking && (
                  <div className="flex items-center gap-2 text-[11px] sm:text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400 shrink-0" />
                    <span>Checking card in system...</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => window.history.back()}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-[#1f2622] text-[#d7ded9] text-sm px-4 py-2.5 h-11 sm:h-12 hover:border-[#4ea878] hover:text-[#7CFFB2] transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Go back
                  </button>
                  <Button
                    onClick={checkCard}
                    disabled={isChecking || !input.trim() || !captchaToken}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11 sm:h-12 text-sm transition-all disabled:opacity-50"
                  >
                    {isChecking
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />Verifying Card...</>
                      : <><CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />Verify Card UID</>}
                  </Button>
                </div>

                <p className="text-center text-[9px] sm:text-[10px] text-slate-600 leading-relaxed">
                  Complete the reCAPTCHA and verify your card before linking.
                </p>
              </div>
            )}

            {/* ── Step 2: Confirm ── */}
            {isConfirmStep && !isLocked && validation.status === "found" && (
              <div className="space-y-3 sm:space-y-4">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 sm:p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-[11px] sm:text-xs font-bold text-emerald-400 uppercase tracking-wider">Card Found</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[9px] sm:text-[10px] text-slate-500 uppercase font-bold mb-0.5">Card UID</p>
                      <p className="text-sm font-mono text-white tracking-widest break-all">{validation.cardData.cardUid}</p>
                    </div>
                    {validation.cardData.fullName && (
                      <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-500 uppercase font-bold mb-0.5">Registered Name</p>
                        <p className="text-sm font-semibold text-white break-words">{validation.cardData.fullName}</p>
                      </div>
                    )}
                    {validation.cardData.type && (
                      <div>
                        <p className="text-[9px] sm:text-[10px] text-slate-500 uppercase font-bold mb-0.5">Card Type</p>
                        <p className="text-sm text-slate-300">{validation.cardData.type}</p>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-[11px] sm:text-xs text-slate-400 text-center leading-relaxed">
                  Is this your card? Confirm to permanently link it to your account.{" "}
                  <span className="text-amber-400 font-semibold">This cannot be undone.</span>
                </p>

                {error && (
                  <div className="flex items-start gap-2 text-[11px] sm:text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={backToInput} disabled={loading} variant="outline"
                    className="flex-1 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-11 sm:h-12 text-sm">
                    Back
                  </Button>
                  <Button onClick={confirmLink} disabled={loading}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11 sm:h-12 text-sm transition-all">
                    {loading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />Linking...</>
                      : <><LinkIcon className="h-4 w-4 mr-2 shrink-0" />Confirm & Link</>}
                  </Button>
                </div>

                <button
                  onClick={onCancel}
                  disabled={loading}
                  className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2 disabled:opacity-50"
                >
                  Cancel and return to sign-in
                </button>

                <p className="text-center text-[9px] sm:text-[10px] text-slate-600 leading-relaxed">
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