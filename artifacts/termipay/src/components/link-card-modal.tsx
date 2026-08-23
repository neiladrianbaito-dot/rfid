import { useEffect, useRef, useState } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import {
  LinkIcon,
  Lock,
  CheckCircle2,
  XCircle,
  Loader2,
  Ban,
  ShieldAlert,
  Clock,
  ArrowLeft,
} from "lucide-react";
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
    input,
    setInput,
    loading,
    error,
    validation,
    isConfirmStep,
    recaptchaRef,
    captchaToken,
    setCaptchaToken,
    captchaError,
    setCaptchaError,
    checkCard,
    confirmLink,
    backToInput,
    setValidation,
    lockoutSecs,
  } = props;

  const { onCancel } = props;

  const isChecking = validation.status === "checking";
  const isBlocked = validation.status === "blocked";
  const isLocked = validation.status === "locked";

  // ---------------------------------------------------------------------------
  // Responsive reCAPTCHA
  // ---------------------------------------------------------------------------
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

      const nextScale = Math.min(
        availableWidth / RECAPTCHA_WIDTH,
        1
      );

      setRecaptchaScale(nextScale > 0 ? nextScale : 1);
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <style>{DASHBOARD_STYLES}</style>

      {/* =====================================================================
          MODAL BACKDROP
      ===================================================================== */}
      <div
        className="
          fixed inset-0 z-50
          flex items-center justify-center
          overflow-y-auto
          p-4
          bg-slate-950/75
          dark:bg-slate-950/80
          backdrop-blur-md
        "
      >
        {/* ===================================================================
            MODAL
        =================================================================== */}
        <div
          className="
            rgb-container
            w-full
            max-w-[420px]
            relative
            my-auto
            overflow-hidden
            rounded-2xl

            bg-white
            border border-slate-200
            shadow-2xl shadow-slate-900/20

            dark:bg-slate-900
            dark:border-slate-700
            dark:shadow-black/40
          "
          style={{ zIndex: 51 }}
        >
          <div
            className="
              p-4 sm:p-7
              text-slate-900
              dark:text-white
              max-h-[90vh]
              overflow-y-auto
            "
          >
            {/* =================================================================
                HEADER
            ================================================================= */}
            <div className="flex items-center gap-2.5 sm:gap-3 mb-2">
              <div
                className="
                  p-2 sm:p-2.5
                  rounded-xl
                  shrink-0

                  bg-emerald-500/10
                  border border-emerald-500/20

                  dark:bg-emerald-500/10
                  dark:border-emerald-500/20
                "
              >
                <LinkIcon className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-500 dark:text-emerald-400" />
              </div>

              <div className="min-w-0">
                <h2
                  className="
                    text-base sm:text-lg
                    font-bold
                    leading-tight
                    truncate
                    text-slate-900
                    dark:text-white
                  "
                >
                  Link Your Card
                </h2>

                <p
                  className="
                    text-[9px] sm:text-[10px]
                    uppercase
                    tracking-widest
                    text-slate-500
                    dark:text-slate-400
                  "
                >
                  One-time setup
                </p>
              </div>
            </div>

            {/* =================================================================
                SECURITY NOTICE
            ================================================================= */}
            <div
              className="
                mt-3 sm:mt-4
                mb-4 sm:mb-5
                flex gap-2.5 sm:gap-3
                rounded-xl
                p-2.5 sm:p-3

                bg-amber-50
                border border-amber-200

                dark:bg-amber-500/10
                dark:border-amber-500/20
              "
            >
              <Lock
                className="
                  h-4 w-4
                  flex-shrink-0
                  mt-0.5

                  text-amber-600
                  dark:text-amber-400
                "
              />

              <p
                className="
                  text-[11px] sm:text-xs
                  leading-relaxed

                  text-amber-800
                  dark:text-amber-300
                "
              >
                <span className="font-bold">Security Notice:</span>{" "}
                For your account's security, a card can only be linked{" "}
                <span className="font-bold underline underline-offset-2">
                  once
                </span>
                . This action is permanent and cannot be changed after
                confirmation.
              </p>
            </div>

            {/* =================================================================
                LOCKED STATE
            ================================================================= */}
            {isLocked && (
              <div className="space-y-3 sm:space-y-4">
                <div
                  className="
                    flex flex-col
                    items-center
                    gap-2.5 sm:gap-3
                    rounded-xl
                    p-4 sm:p-5
                    text-center

                    bg-red-50
                    border border-red-200

                    dark:bg-red-500/10
                    dark:border-red-500/30
                  "
                >
                  <ShieldAlert
                    className="
                      h-7 w-7 sm:h-8 sm:w-8
                      text-red-500
                      dark:text-red-400
                    "
                  />

                  <div>
                    <p
                      className="
                        font-bold
                        text-sm
                        mb-1

                        text-red-600
                        dark:text-red-400
                      "
                    >
                      Too Many Failed Attempts
                    </p>

                    <p
                      className="
                        text-[11px] sm:text-xs
                        leading-relaxed

                        text-red-600/80
                        dark:text-red-300/80
                      "
                    >
                      You have been temporarily locked out for security
                      reasons.
                    </p>
                  </div>

                  {/* Countdown */}
                  <div
                    className="
                      flex items-center
                      gap-2
                      px-3 sm:px-4
                      py-2
                      rounded-lg

                      bg-red-100
                      border border-red-200

                      dark:bg-red-500/20
                      dark:border-red-500/30
                    "
                  >
                    <Clock
                      className="
                        h-4 w-4
                        animate-pulse
                        shrink-0

                        text-red-500
                        dark:text-red-400
                      "
                    />

                    <span
                      className="
                        text-[13px] sm:text-sm

                        text-red-700
                        dark:text-red-300
                      "
                    >
                      Try again in{" "}
                      <span
                        className="
                          font-black
                          tabular-nums

                          text-red-900
                          dark:text-white
                        "
                      >
                        {lockoutSecs}s
                      </span>
                    </span>
                  </div>

                  <p
                    className="
                      text-[9px] sm:text-[10px]
                      leading-relaxed

                      text-slate-500
                      dark:text-slate-500
                    "
                  >
                    The timer will unlock automatically. Do not close this
                    window.
                  </p>
                </div>

                <Button
                  onClick={onCancel}
                  variant="outline"
                  className="
                    w-full
                    h-11 sm:h-12
                    text-sm
                    cursor-pointer

                    border-slate-300
                    text-slate-600
                    hover:bg-slate-100
                    hover:text-slate-900

                    dark:border-slate-700
                    dark:text-slate-400
                    dark:hover:bg-slate-800
                    dark:hover:text-white
                  "
                >
                  Cancel and return to sign-in
                </Button>
              </div>
            )}

            {/* =================================================================
                STEP 1 — CARD UID INPUT
            ================================================================= */}
            {!isConfirmStep && !isLocked && (
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <label
                    className="
                      text-[9px] sm:text-[10px]
                      font-bold
                      uppercase
                      block
                      mb-1.5

                      text-slate-500
                      dark:text-slate-500
                    "
                  >
                    Card UID
                  </label>

                  <Input
                    value={input}
                    onChange={(e) => {
                      const raw = e.target.value.replace(
                        /[^a-zA-Z0-9-_]/g,
                        ""
                      );

                      setInput(raw);

                      if (validation.status !== "idle") {
                        setValidation({ status: "idle" });
                      }
                    }}
                    placeholder="Enter your Card UID..."
                    className="
                      h-11
                      font-mono
                      text-sm

                      bg-slate-50
                      border-slate-200
                      text-slate-900
                      placeholder:text-slate-400

                      focus:border-emerald-500
                      focus:ring-emerald-500/20

                      dark:bg-slate-950/50
                      dark:border-slate-700
                      dark:text-white
                      dark:placeholder:text-slate-600
                      dark:focus:border-emerald-500/50
                    "
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isChecking) {
                        checkCard();
                      }
                    }}
                    disabled={isChecking}
                  />
                </div>

                {/* =============================================================
                    RECAPTCHA
                ============================================================= */}
                <div
                  className="
                    recaptcha-wrapper
                    flex flex-col
                    items-center
                    gap-1
                    w-full
                    overflow-hidden
                  "
                >
                  <label
                    className="
                      text-[9px] sm:text-[10px]
                      font-bold
                      uppercase
                      mb-1
                      self-start

                      text-slate-500
                      dark:text-slate-500
                    "
                  >
                    Verification
                  </label>

                  <div
                    ref={recaptchaBoxRef}
                    className="w-full max-w-[304px]"
                    style={{
                      height:
                        RECAPTCHA_HEIGHT * recaptchaScale,
                    }}
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

                        /*
                         * Automatically use the current application theme.
                         * Tailwind's dark class controls this value.
                         */
                        theme={
                          document.documentElement.classList.contains(
                            "dark"
                          )
                            ? "dark"
                            : "light"
                        }

                        onChange={(token) => {
                          setCaptchaToken(token);
                          setCaptchaError("");
                        }}
                        onExpired={() => {
                          setCaptchaToken(null);
                          setCaptchaError(
                            "reCAPTCHA expired. Please verify again."
                          );
                        }}
                      />
                    </div>
                  </div>

                  {captchaError && (
                    <p
                      className="
                        text-[11px] sm:text-xs
                        mt-1
                        flex items-center gap-1
                        self-start

                        text-red-500
                        dark:text-red-400
                      "
                    >
                      <XCircle className="h-3 w-3 shrink-0" />
                      {captchaError}
                    </p>
                  )}
                </div>

                {/* =============================================================
                    BLOCKED CARD
                ============================================================= */}
                {isBlocked && (
                  <div
                    className="
                      flex items-start
                      gap-2
                      text-[11px] sm:text-xs
                      rounded-lg
                      px-3
                      py-3

                      text-red-700
                      bg-red-50
                      border border-red-200

                      dark:text-red-300
                      dark:bg-red-500/10
                      dark:border-red-500/30
                    "
                  >
                    <Ban
                      className="
                        h-4 w-4
                        flex-shrink-0
                        mt-0.5

                        text-red-500
                        dark:text-red-400
                      "
                    />

                    <div>
                      <p
                        className="
                          font-bold
                          mb-0.5

                          text-red-600
                          dark:text-red-400
                        "
                      >
                        Card Blocked
                      </p>

                      <p
                        className="
                          text-red-600/80
                          dark:text-red-300/80
                        "
                      >
                        This card has been blocked. Please contact support.
                      </p>
                    </div>
                  </div>
                )}

                {/* =============================================================
                    ERROR
                ============================================================= */}
                {error && !isBlocked && (
                  <div
                    className="
                      flex items-start
                      gap-2
                      text-[11px] sm:text-xs
                      rounded-lg
                      px-3
                      py-2.5

                      text-red-600
                      bg-red-50
                      border border-red-200

                      dark:text-red-400
                      dark:bg-red-500/10
                      dark:border-red-500/20
                    "
                  >
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {/* =============================================================
                    CHECKING
                ============================================================= */}
                {isChecking && (
                  <div
                    className="
                      flex items-center
                      gap-2
                      text-[11px] sm:text-xs
                      rounded-lg
                      px-3
                      py-2.5

                      text-slate-600
                      bg-slate-100
                      border border-slate-200

                      dark:text-slate-400
                      dark:bg-slate-800/50
                      dark:border-slate-700
                    "
                  >
                    <Loader2
                      className="
                        h-4 w-4
                        animate-spin
                        shrink-0

                        text-emerald-500
                        dark:text-emerald-400
                      "
                    />

                    <span>Checking card in system...</span>
                  </div>
                )}

                {/* =============================================================
                    ACTION BUTTONS
                ============================================================= */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => window.history.back()}
                    className="
                      flex-1
                      inline-flex
                      items-center
                      justify-center
                      gap-2
                      rounded-md
                      border
                      px-4
                      py-2.5
                      h-11 sm:h-12
                      text-sm
                      transition-colors
                      cursor-pointer

                      border-slate-300
                      text-slate-600
                      hover:border-emerald-500
                      hover:text-emerald-600
                      hover:bg-emerald-50

                      dark:border-slate-700
                      dark:text-slate-400
                      dark:hover:border-emerald-500
                      dark:hover:text-emerald-300
                      dark:hover:bg-emerald-500/5
                    "
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Go back
                  </button>

                  <Button
                    onClick={checkCard}
                    disabled={
                      isChecking ||
                      !input.trim() ||
                      !captchaToken
                    }
                    className="
                      flex-1
                      h-11 sm:h-12
                      text-sm
                      font-bold
                      transition-all
                      cursor-pointer
                      disabled:opacity-50
                      disabled:cursor-not-allowed

                      bg-emerald-600
                      hover:bg-emerald-500
                      text-white
                    "
                  >
                    {isChecking ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                        Verifying Card...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />
                        Verify Card UID
                      </>
                    )}
                  </Button>
                </div>

                <p
                  className="
                    text-center
                    text-[9px] sm:text-[10px]
                    leading-relaxed

                    text-slate-500
                    dark:text-slate-600
                  "
                >
                  Complete the reCAPTCHA and verify your card before linking.
                </p>
              </div>
            )}

            {/* =================================================================
                STEP 2 — CONFIRM CARD
            ================================================================= */}
            {isConfirmStep &&
              !isLocked &&
              validation.status === "found" && (
                <div className="space-y-3 sm:space-y-4">
                  {/* Card found */}
                  <div
                    className="
                      rounded-xl
                      p-3 sm:p-4
                      space-y-3

                      bg-emerald-50
                      border border-emerald-200

                      dark:bg-emerald-500/10
                      dark:border-emerald-500/30
                    "
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2
                        className="
                          h-4 w-4
                          shrink-0

                          text-emerald-600
                          dark:text-emerald-400
                        "
                      />

                      <span
                        className="
                          text-[11px] sm:text-xs
                          font-bold
                          uppercase
                          tracking-wider

                          text-emerald-600
                          dark:text-emerald-400
                        "
                      >
                        Card Found
                      </span>
                    </div>

                    <div className="space-y-2">
                      {/* Card UID */}
                      <div>
                        <p
                          className="
                            text-[9px] sm:text-[10px]
                            uppercase
                            font-bold
                            mb-0.5

                            text-slate-500
                            dark:text-slate-500
                          "
                        >
                          Card UID
                        </p>

                        <p
                          className="
                            text-sm
                            font-mono
                            tracking-widest
                            break-all

                            text-slate-900
                            dark:text-white
                          "
                        >
                          {validation.cardData.cardUid}
                        </p>
                      </div>

                      {/* Registered Name */}
                      {validation.cardData.fullName && (
                        <div>
                          <p
                            className="
                              text-[9px] sm:text-[10px]
                              uppercase
                              font-bold
                              mb-0.5

                              text-slate-500
                              dark:text-slate-500
                            "
                          >
                            Registered Name
                          </p>

                          <p
                            className="
                              text-sm
                              font-semibold
                              break-words

                              text-slate-900
                              dark:text-white
                            "
                          >
                            {validation.cardData.fullName}
                          </p>
                        </div>
                      )}

                      {/* Card Type */}
                      {validation.cardData.type && (
                        <div>
                          <p
                            className="
                              text-[9px] sm:text-[10px]
                              uppercase
                              font-bold
                              mb-0.5

                              text-slate-500
                              dark:text-slate-500
                            "
                          >
                            Card Type
                          </p>

                          <p
                            className="
                              text-sm

                              text-slate-700
                              dark:text-slate-300
                            "
                          >
                            {validation.cardData.type}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Confirmation message */}
                  <p
                    className="
                      text-[11px] sm:text-xs
                      text-center
                      leading-relaxed

                      text-slate-600
                      dark:text-slate-400
                    "
                  >
                    Is this your card? Confirm to permanently link it to your
                    account.{" "}
                    <span
                      className="
                        font-semibold

                        text-amber-600
                        dark:text-amber-400
                      "
                    >
                      This cannot be undone.
                    </span>
                  </p>

                  {/* Error */}
                  {error && (
                    <div
                      className="
                        flex items-start
                        gap-2
                        text-[11px] sm:text-xs
                        rounded-lg
                        px-3
                        py-2.5

                        text-red-600
                        bg-red-50
                        border border-red-200

                        dark:text-red-400
                        dark:bg-red-500/10
                        dark:border-red-500/20
                      "
                    >
                      <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Confirm buttons */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      onClick={backToInput}
                      disabled={loading}
                      variant="outline"
                      className="
                        flex-1
                        h-11 sm:h-12
                        text-sm
                        cursor-pointer
                        disabled:cursor-not-allowed

                        border-slate-300
                        text-slate-600
                        hover:bg-slate-100
                        hover:text-slate-900

                        dark:border-slate-700
                        dark:text-slate-400
                        dark:hover:bg-slate-800
                        dark:hover:text-white
                      "
                    >
                      Back
                    </Button>

                    <Button
                      onClick={confirmLink}
                      disabled={loading}
                      className="
                        flex-1
                        h-11 sm:h-12
                        text-sm
                        font-bold
                        transition-all
                        cursor-pointer
                        disabled:cursor-not-allowed

                        bg-emerald-600
                        hover:bg-emerald-500
                        text-white
                      "
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                          Linking...
                        </>
                      ) : (
                        <>
                          <LinkIcon className="h-4 w-4 mr-2 shrink-0" />
                          Confirm & Link
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Cancel */}
                  <button
                    onClick={onCancel}
                    disabled={loading}
                    className="
                      w-full
                      text-center
                      text-[11px]
                      underline
                      underline-offset-2
                      transition-colors
                      disabled:opacity-50
                      cursor-pointer
                      disabled:cursor-not-allowed

                      text-slate-500
                      hover:text-slate-800

                      dark:text-slate-500
                      dark:hover:text-slate-300
                    "
                  >
                    Cancel and return to sign-in
                  </button>

                  <p
                    className="
                      text-center
                      text-[9px] sm:text-[10px]
                      leading-relaxed

                      text-slate-500
                      dark:text-slate-600
                    "
                  >
                    By clicking above, you agree that this card UID will be
                    permanently tied to your account and cannot be modified.
                  </p>
                </div>
              )}
          </div>
        </div>
      </div>
    </>
  );
}