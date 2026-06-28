import { useRef, useState, useEffect, useCallback } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { cleanCardUid, saveLinkedCardUid, validateCardUidExists } from "@/lib/api";
import type { CardValidationState } from "@/lib/types";

export function useLinkCard(onLinked: (uid: string) => void) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState<CardValidationState>({ status: "idle" });
  const [isConfirmStep, setIsConfirmStep] = useState(false);

  // ── Lockout countdown (timestamp-based) ──────────────────────────────────
  const [lockoutSecs, setLockoutSecs] = useState(0);
  const lockoutEndRef = useRef<number | null>(null);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearLockoutTimer = useCallback(() => {
    if (lockoutTimerRef.current) {
      clearInterval(lockoutTimerRef.current);
      lockoutTimerRef.current = null;
    }
    lockoutEndRef.current = null;
  }, []);

  const startLockoutCountdown = useCallback((initialSecs: number) => {
    clearLockoutTimer();

    const endTime = Date.now() + initialSecs * 1000;
    lockoutEndRef.current = endTime;

    setLockoutSecs(initialSecs);

    lockoutTimerRef.current = setInterval(() => {
      if (!lockoutEndRef.current) return;
      const remaining = Math.ceil((lockoutEndRef.current - Date.now()) / 1000);

      if (remaining <= 0) {
        clearLockoutTimer();
        setLockoutSecs(0);
        setValidation({ status: "idle" });
        setError("");
        return;
      }

      setLockoutSecs(remaining);
    }, 500);
  }, [clearLockoutTimer]);

  useEffect(() => {
    return () => clearLockoutTimer();
  }, [clearLockoutTimer]);
  // ─────────────────────────────────────────────────────────────────────────

  const recaptchaRef = useRef<ReCAPTCHA>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState("");

  const resetCaptcha = useCallback(() => {
    recaptchaRef.current?.reset();
    setCaptchaToken(null);
  }, []);

  const checkCard = async () => {
    if (validation.status === "locked") return;

    const cleaned = cleanCardUid(input.trim());
    if (!cleaned) { setError("Please enter a Card UID."); return; }
    if (!captchaToken) { setCaptchaError("Please complete the reCAPTCHA verification."); return; }

    setCaptchaError("");
    setError("");
    setValidation({ status: "checking" });

    try {
      const cardData = await validateCardUidExists(cleaned);

      if (cardData.status && cardData.status.toLowerCase() === "blocked") {
        setValidation({ status: "blocked" });
        setError("This card is blocked and cannot be linked. Please contact support.");
        resetCaptcha();
        return;
      }

      setValidation({ status: "found", cardData });
      setIsConfirmStep(true);

    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Card UID not found. Please check and try again.";
      const errAny = err as any;

      // ✅ FIXED: early return — never falls through to the generic handler below
      if (errAny?.forceExit) {
        const secs = errAny?.lockoutRemainingMs
          ? Math.ceil(errAny.lockoutRemainingMs / 1000)
          : 60;
        setError(message);
        resetCaptcha();
        startLockoutCountdown(secs);
        // Set locked LAST so it's the final state — nothing overrides it
        setValidation({ status: "locked" });
        return; // ← this was missing / ineffective before
      }

      // Only reached if NOT a forceExit
      setValidation(
        /not found/i.test(message)
          ? { status: "not_found" }
          : { status: "error", message }
      );
      setError(message);
      resetCaptcha();
    }
  };

  const confirmLink = async () => {
    if (validation.status !== "found") return;
    const confirmed = cleanCardUid(validation.cardData.cardUid);
    setLoading(true);
    setError("");
    try {
      await saveLinkedCardUid(confirmed);
      onLinked(confirmed);
      setIsOpen(false);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to link card. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const backToInput = () => {
    setIsConfirmStep(false);
    setValidation({ status: "idle" });
    setError("");
    setCaptchaError("");
    resetCaptcha();
  };

  return {
    isOpen, setIsOpen,
    input, setInput,
    loading, error,
    validation, setValidation,
    isConfirmStep,
    lockoutSecs,
    recaptchaRef, captchaToken, setCaptchaToken, captchaError, setCaptchaError,
    checkCard, confirmLink, backToInput,
  };
}