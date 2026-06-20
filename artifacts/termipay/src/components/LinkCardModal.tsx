import { CheckCircle2, XCircle, Loader2, LinkIcon, Lock, Ban } from "lucide-react";
import ReCAPTCHA from "react-google-recaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardValidationState } from "../lib/types";
import { RECAPTCHA_SITE_KEY } from "../lib/constants";

type Props = {
  isOpen: boolean;
  input: string;
  onInputChange: (val: string) => void;
  loading: boolean;
  error: string;
  validation: CardValidationState;
  isConfirmStep: boolean;
  recaptchaRef: React.RefObject<ReCAPTCHA>;
  captchaToken: string | null;
  setCaptchaToken: (token: string | null) => void;
  captchaError: string;
  setCaptchaError: (err: string) => void;
  onCheckCard: () => void;
  onConfirmLink: () => void;
  onBack: () => void;
};

export function LinkCardModal({
  isOpen, input, onInputChange, loading, error, validation,
  isConfirmStep, recaptchaRef, captchaToken, setCaptchaToken,
  captchaError, setCaptchaError, onCheckCard, onConfirmLink, onBack,
}: Props) {
  if (!isOpen) return null;

  const isChecking = validation.status === "checking";
  const isBlocked = validation.status === "blocked";

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
    >
      <div className="rgb-container w-full max-w-[420px] z-50 relative">
        <div className="p-7 text-white">
          {/* Title */}
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
              <span className="font-bold">Security Notice:</span> A card can only be linked{" "}
              <span className="font-bold underline underline-offset-2">once</span>. This action is permanent and cannot be changed after confirmation.
            </p>
          </div>

          {/* Step 1: Input */}
          {!isConfirmStep && (
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Card UID</label>
                <Input
                  value={input}
                  onChange={(e) => onInputChange(e.target.value)}
                  placeholder="Enter your Card UID..."
                  className="bg-white/5 border-white/10 text-white focus:border-emerald-500/50 font-mono"
                  onKeyDown={(e) => e.key === "Enter" && !isChecking && onCheckCard()}
                  disabled={isChecking}
                />
              </div>

              <div className="flex flex-col items-start gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Verification</label>
                <ReCAPTCHA
                  ref={recaptchaRef}
                  sitekey={RECAPTCHA_SITE_KEY}
                  theme="dark"
                  onChange={(token) => { setCaptchaToken(token); setCaptchaError(""); }}
                  onExpired={() => { setCaptchaToken(null); setCaptchaError("reCAPTCHA expired. Please verify again."); }}
                />
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
                    <p className="text-red-300/80">This card has been blocked and cannot be linked. Please contact support.</p>
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

              <Button
                onClick={onCheckCard}
                disabled={isChecking || !input.trim() || !captchaToken}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 transition-all disabled:opacity-50"
              >
                {isChecking
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying Card...</>
                  : <><CheckCircle2 className="h-4 w-4 mr-2" />Verify Card UID</>
                }
              </Button>

              <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                Complete the reCAPTCHA and verify your card before linking.
              </p>
            </div>
          )}

          {/* Step 2: Confirm */}
          {isConfirmStep && validation.status === "found" && (
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
                Is this your card? Confirm to permanently link it.{" "}
                <span className="text-amber-400 font-semibold">This cannot be undone.</span>
              </p>

              {error && (
                <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                  <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={onBack}
                  disabled={loading}
                  variant="outline"
                  className="flex-1 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-12"
                >
                  Back
                </Button>
                <Button
                  onClick={onConfirmLink}
                  disabled={loading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 transition-all"
                >
                  {loading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Linking...</>
                    : <><LinkIcon className="h-4 w-4 mr-2" />Confirm & Link</>
                  }
                </Button>
              </div>

              <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                By confirming, this card UID will be permanently tied to your account.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
