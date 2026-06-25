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

      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "1rem",
          background: "rgba(2,6,23,0.75)",
          backdropFilter: "blur(4px)",
        }}
      >
        <div className="rgb-container w-full max-w-[420px] relative" style={{ zIndex: 50 }}>
          <div className="p-5 sm:p-7 text-white">

            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <LinkIcon className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight">Link Your Card</h2>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">One-time setup</p>
              </div>
            </div>

            {/* Security notice */}
            <div className="mt-4 mb-5 flex gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <Lock className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300 leading-relaxed">
                <span className="font-bold">Security Notice:</span> For your account's security, a card can
                only be linked <span className="font-bold underline underline-offset-2">once</span>. This
                action is permanent and cannot be changed after confirmation.
              </p>
            </div>

            {/* ── LOCKOUT BANNER ── shown instead of the form when locked */}
            {isLocked && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-5 text-center">
                  <ShieldAlert className="h-8 w-8 text-red-400" />
                  <div>
                    <p className="font-bold text-red-400 text-sm mb-1">Too Many Failed Attempts</p>
                    <p className="text-xs text-red-300/80 leading-relaxed">
                      You have been temporarily locked out for security reasons.
                    </p>
                  </div>

                  {/* ✅ Realtime countdown */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg">
                    <Clock className="h-4 w-4 text-red-400 animate-pulse" />
                    <span className="text-sm text-red-300">
                      Try again in{" "}
                      <span className="font-black text-white tabular-nums">
                        {lockoutSecs}s
                      </span>
                    </span>
                  </div>

                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    The timer will unlock automatically. Do not close this window.
                  </p>
                </div>

                <Button
                  onClick={onCancel}
                  variant="outline"
                  className="w-full border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-12"
                >
                  Cancel and return to sign-in
                </Button>
              </div>
            )}

            {/* ── Step 1: Input ── */}
            {!isConfirmStep && !isLocked && (
              <div className="space-y-4">

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
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
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 font-mono"
                    onKeyDown={(e) => e.key === "Enter" && !isChecking && checkCard()}
                    disabled={isChecking}
                  />
                </div>

                <div className="recaptcha-wrapper flex flex-col items-start gap-1 w-full overflow-hidden">
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Verification
                  </label>
                  <div
                    className="origin-top-left"
                    style={{
                      transform: "scale(0.85)",
                      transformOrigin: "0 0",
                      width: 304 * 0.85,
                      height: 78 * 0.85,
                    }}
                  >
                    <ReCAPTCHA
                      ref={recaptchaRef}
                      sitekey={RECAPTCHA_SITE_KEY}
                      theme="dark"
                      onChange={(token) => { setCaptchaToken(token); setCaptchaError(""); }}
                      onExpired={() => { setCaptchaToken(null); setCaptchaError("reCAPTCHA expired. Please verify again."); }}
                    />
                  </div>
                  {captchaError && (
                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> {captchaError}
                    </p>
                  )}
                </div>

                {isBlocked && (
                  <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-3">
                    <Ban className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
                    <div>
                      <p className="font-bold text-red-400 mb-0.5">Card Blocked</p>
                      <p className="text-red-300/80">This card has been blocked. Please contact support.</p>
                    </div>
                  </div>
                )}

                {error && !isBlocked && (
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {isChecking && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    <span>Checking card in system...</span>
                  </div>
                )}

                <div className="flex gap-2">
                     <button
              onClick={() => window.history.back()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-[#1f2622] text-[#d7ded9] text-sm px-4 py-2.5 hover:border-[#4ea878] hover:text-[#7CFFB2] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Go back
            </button>
                  <Button
                    onClick={checkCard}
                    disabled={isChecking || !input.trim() || !captchaToken}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 transition-all disabled:opacity-50"
                  >
                    {isChecking
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying Card...</>
                      : <><CheckCircle2 className="h-4 w-4 mr-2" />Verify Card UID</>}
                  </Button>
                </div>

                <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                  Complete the reCAPTCHA and verify your card before linking.
                </p>
              </div>
            )}

            {/* ── Step 2: Confirm ── */}
            {isConfirmStep && !isLocked && validation.status === "found" && (
              <div className="space-y-4">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Card Found</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Card UID</p>
                      <p className="text-sm font-mono text-white tracking-widest">{validation.cardData.cardUid}</p>
                    </div>
                    {validation.cardData.fullName && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Registered Name</p>
                        <p className="text-sm font-semibold text-white">{validation.cardData.fullName}</p>
                      </div>
                    )}
                    {validation.cardData.type && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Card Type</p>
                        <p className="text-sm text-slate-300">{validation.cardData.type}</p>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-400 text-center leading-relaxed">
                  Is this your card? Confirm to permanently link it to your account.{" "}
                  <span className="text-amber-400 font-semibold">This cannot be undone.</span>
                </p>

                {error && (
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={backToInput} disabled={loading} variant="outline"
                    className="flex-1 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-12">
                    Back
                  </Button>
                  <Button onClick={confirmLink} disabled={loading}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 transition-all">
                    {loading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Linking...</>
                      : <><LinkIcon className="h-4 w-4 mr-2" />Confirm & Link</>}
                  </Button>
                </div>

                <button
                  onClick={onCancel}
                  disabled={loading}
                  className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2 disabled:opacity-50"
                >
                  Cancel and return to sign-in
                </button>

                <p className="text-center text-[10px] text-slate-600 leading-relaxed">
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