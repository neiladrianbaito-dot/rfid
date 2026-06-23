import { useRef, useState, useEffect } from "react";
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

  // ── Lockout countdown ─────────────────────────────────────────────────────
  const [lockoutSecs, setLockoutSecs] = useState(0);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startLockoutCountdown = (initialSecs: number) => {
    // Clear any existing timer first
    if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);

    setLockoutSecs(initialSecs);

    lockoutTimerRef.current = setInterval(() => {
      setLockoutSecs((prev) => {
        if (prev <= 1) {
          clearInterval(lockoutTimerRef.current!);
          lockoutTimerRef.current = null;
          // Auto-unlock: go back to idle so user can try again
          setValidation({ status: "idle" });
          setError("");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    };
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  const recaptchaRef = useRef<ReCAPTCHA>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState("");

  const resetCaptcha = () => {
    recaptchaRef.current?.reset();
    setCaptchaToken(null);
  };

  const checkCard = async () => {
    // Block if currently locked out
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
      const message = err instanceof Error ? err.message : "Card UID not found. Please check and try again.";
      const errAny = err as any;

      // ✅ forceExit = locked out (3 failed attempts)
      if (errAny?.forceExit) {
        const secs = errAny?.lockoutRemainingMs
          ? Math.ceil(errAny.lockoutRemainingMs / 1000)
          : 60;
        setValidation({ status: "locked" });
        setError(message);
        resetCaptcha();
        startLockoutCountdown(secs);
        return;
      }

      // Normal failed attempt — show remaining attempts
      setValidation(/not found/i.test(message) ? { status: "not_found" } : { status: "error", message });
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
      setError(err instanceof Error ? err.message : "Failed to link card. Please try again.");
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
    lockoutSecs,           // ← expose for UI countdown
    recaptchaRef, captchaToken, setCaptchaToken, captchaError, setCaptchaError,
    checkCard, confirmLink, backToInput,
  };
}