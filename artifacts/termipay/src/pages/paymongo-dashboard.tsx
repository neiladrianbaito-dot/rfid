import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CreditCard, RefreshCcw, Wallet, Activity, User, Phone, Tag, ShieldCheck, LogOut, PlusCircle, LinkIcon, Lock, CheckCircle2, XCircle, Loader2, Mail, Ban, KeyRound, Eye, EyeOff } from "lucide-react";
import ReCAPTCHA from "react-google-recaptcha";
import { buildApiUrl } from "@/lib/api-url";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const RECAPTCHA_SITE_KEY = "6LfbiuQsAAAAAI9iR6ZsDDUGodOeSMUQSu6ALcfc";
const POLL_INTERVAL_MS = 500; // ✅ 500ms real-time polling

type UserRecord = {
  cardUid?: string;
  fullName?: string;
  email?: string | null;
  contactNumber?: string;
  type?: string;
  balance: string | number;
  status: string;
};

type TransactionRecord = {
  id: number;
  timestamp: string;
  cardUid?: string;
  type: string;
  amount: string | number;
  status: string;
};

type CardValidationState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; cardData: { fullName?: string; cardUid: string; type?: string; status?: string } }
  | { status: "blocked" }
  | { status: "not_found" }
  | { status: "error"; message: string };

const USER_AUTH_TOKEN_KEY = "termipay_user_auth_token";

function cleanCardUid(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-_]/g, "");
}

function getUserAuthHeaders(): HeadersInit {
  const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getUserByCardUid(normalizedUid: string) {
  const response = await fetch(
    buildApiUrl(`/paymongo/dashboard?cardUid=${encodeURIComponent(normalizedUid)}`),
    { headers: getUserAuthHeaders() }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to load dashboard data");
  }
  return payload;
}

async function getSignedInUser() {
  const response = await fetch(buildApiUrl("/auth/user-me"), {
    headers: getUserAuthHeaders(),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Not authenticated");
  }
  return payload as { user?: { linkedCardUid?: string } };
}

async function saveLinkedCardUid(cardUid: string) {
  const response = await fetch(buildApiUrl("/auth/user/link-card"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getUserAuthHeaders(),
    },
    body: JSON.stringify({ cardUid }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to save linked card.");
  }
}

async function validateCardUidExists(
  uid: string
): Promise<{ fullName?: string; cardUid: string; type?: string; status?: string }> {
  const response = await fetch(
    buildApiUrl(`/auth/check-card-uid?cardUid=${encodeURIComponent(uid)}`),
    { headers: getUserAuthHeaders() }
  );
  const payload = await response.json();
  if (!response.ok) {
    const msg = payload?.message || payload?.error || "Card UID not found in the system.";
    throw new Error(msg);
  }
  const data = payload?.card ?? payload;
  if (!data || !data.cardUid) {
    throw new Error("Card UID not found in the system.");
  }
  return {
    fullName: data.fullName ?? data.full_name,
    cardUid: data.cardUid ?? data.card_uid ?? uid,
    type: data.type,
    status: data.status,
  };
}

async function changeUserPassword(currentPassword: string, newPassword: string) {
  const response = await fetch(buildApiUrl("/auth/user/change-password"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getUserAuthHeaders(),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Failed to change password.");
  }
  return payload;
}

export default function PaymongoDashboardPage() {
  const [, setLocation] = useLocation();
  const [cardUid, setCardUid] = useState("");
  const [isCardLinked, setIsCardLinked] = useState(false);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── realtime pulse indicator ──
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);
  const prevBalanceRef = useRef<number | null>(null);
  const prevTxCountRef = useRef<number>(0);

  // ── Link Card Modal ──
  const [isLinkCardOpen, setIsLinkCardOpen] = useState(false);
  const [linkCardInput, setLinkCardInput] = useState("");
  const [linkCardLoading, setLinkCardLoading] = useState(false);
  const [linkCardError, setLinkCardError] = useState("");
  const [cardValidation, setCardValidation] = useState<CardValidationState>({ status: "idle" });
  const [isConfirmStep, setIsConfirmStep] = useState(false);

  // ── reCAPTCHA ──
  const recaptchaRef = useRef<ReCAPTCHA>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState("");

  // ── Top-up Modal ──
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", msg: "" });

  // ── Change Password Modal ──
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [cpCurrentPassword, setCpCurrentPassword] = useState("");
  const [cpNewPassword, setCpNewPassword] = useState("");
  const [cpConfirmPassword, setCpConfirmPassword] = useState("");
  const [cpShowCurrent, setCpShowCurrent] = useState(false);
  const [cpShowNew, setCpShowNew] = useState(false);
  const [cpShowConfirm, setCpShowConfirm] = useState(false);
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState(false);

  const handleOpenChangePassword = () => {
    setCpCurrentPassword("");
    setCpNewPassword("");
    setCpConfirmPassword("");
    setCpShowCurrent(false);
    setCpShowNew(false);
    setCpShowConfirm(false);
    setCpError("");
    setCpSuccess(false);
    setIsChangePasswordOpen(true);
  };

  const handleChangePassword = async () => {
    setCpError("");
    if (!cpCurrentPassword || !cpNewPassword || !cpConfirmPassword) {
      setCpError("All fields are required.");
      return;
    }
    if (cpNewPassword.length < 8) {
      setCpError("New password must be at least 8 characters.");
      return;
    }
    if (cpNewPassword !== cpConfirmPassword) {
      setCpError("New passwords do not match.");
      return;
    }
    if (cpCurrentPassword === cpNewPassword) {
      setCpError("New password must be different from the current password.");
      return;
    }
    setCpLoading(true);
    try {
      await changeUserPassword(cpCurrentPassword, cpNewPassword);
      setCpSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to change password. Please try again.";
      setCpError(message);
    } finally {
      setCpLoading(false);
    }
  };

  // ── Auth check on mount ──
  useEffect(() => {
    const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);
    if (!token) {
      setLocation("/signin");
      return;
    }
    void (async () => {
      try {
        const profile = await getSignedInUser();
        const linkedUid = cleanCardUid(profile?.user?.linkedCardUid || "");
        if (linkedUid) {
          setCardUid(linkedUid);
          setIsCardLinked(true);
        } else {
          setIsLinkCardOpen(true);
        }
      } catch {
        window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
        setLocation("/signin");
      }
    })();
  }, []);

  // ── ✅ Real-time fetch: 500ms polling, no loading flicker ──
  const fetchCardData = async (uid: string, showLoading = false) => {
    if (!uid) return;
    if (showLoading) setLoading(true);

    try {
      const payload = await getUserByCardUid(uid);
      const rawUser = payload.user || null;

      if (rawUser) {
        const newBalance = Number(rawUser.balance ?? 0);
        const newTxCount = (payload.transactions || []).length;

        // ✅ Pulse animation when balance or transactions change
        if (
          prevBalanceRef.current !== null &&
          (prevBalanceRef.current !== newBalance || prevTxCountRef.current !== newTxCount)
        ) {
          setIsPulsing(true);
          setTimeout(() => setIsPulsing(false), 800);
        }

        prevBalanceRef.current = newBalance;
        prevTxCountRef.current = newTxCount;

        setUser({
          cardUid: rawUser.cardUid ?? rawUser.card_uid,
          fullName: rawUser.fullName ?? rawUser.full_name,
          email: rawUser.email ?? null,
          contactNumber: rawUser.contactNumber ?? rawUser.contact_number,
          type: rawUser.type,
          balance: newBalance,
          status: rawUser.status ?? "Inactive",
        });
      } else {
        setUser(null);
      }

      setTransactions((payload.transactions || []) as TransactionRecord[]);
      setLastUpdated(new Date());
      setError("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Card UID not found.";
      setError(message);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // ✅ 500ms real-time polling
  useEffect(() => {
    if (!cardUid) return;

    // Initial load with loading indicator
    void fetchCardData(cardUid, true);

    // Then poll every 500ms silently
    const interval = setInterval(() => {
      void fetchCardData(cardUid, false);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [cardUid]);

  // ── Link Card handlers ──
  const handleCheckCard = async () => {
    const cleaned = cleanCardUid(linkCardInput.trim());
    if (!cleaned) {
      setLinkCardError("Please enter a Card UID.");
      return;
    }
    if (!captchaToken) {
      setCaptchaError("Please complete the reCAPTCHA verification.");
      return;
    }
    setCaptchaError("");
    setLinkCardError("");
    setCardValidation({ status: "checking" });
    try {
      const cardData = await validateCardUidExists(cleaned);
      if (cardData.status && cardData.status.toLowerCase() === "blocked") {
        setCardValidation({ status: "blocked" });
        setLinkCardError("This card is blocked and cannot be linked. Please contact support.");
        recaptchaRef.current?.reset();
        setCaptchaToken(null);
        return;
      }
      setCardValidation({ status: "found", cardData });
      setIsConfirmStep(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Card UID not found. Please check and try again.";
      const isNotFound = /not found/i.test(message);
      setCardValidation(isNotFound ? { status: "not_found" } : { status: "error", message });
      setLinkCardError(message);
      recaptchaRef.current?.reset();
      setCaptchaToken(null);
    }
  };

  const handleLinkCardSubmit = async () => {
    if (cardValidation.status !== "found") return;
    const confirmed = cleanCardUid(cardValidation.cardData.cardUid);
    setLinkCardLoading(true);
    setLinkCardError("");
    try {
      await saveLinkedCardUid(confirmed);
      setCardUid(confirmed);
      setIsCardLinked(true);
      setIsLinkCardOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to link card. Please try again.";
      setLinkCardError(message);
    } finally {
      setLinkCardLoading(false);
    }
  };

  const handleBackToInput = () => {
    setIsConfirmStep(false);
    setCardValidation({ status: "idle" });
    setLinkCardError("");
    setCaptchaError("");
    recaptchaRef.current?.reset();
    setCaptchaToken(null);
  };

  const handleLogout = () => {
    window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
    setLocation("/signin");
  };

  const handleTopup = async () => {
    if (!cardUid || !amount) {
      setAlertContent({ title: "Missing Information", msg: "Please enter an amount." });
      setAlertOpen(true);
      return;
    }
    if (parseFloat(amount) <= 0) {
      setAlertContent({ title: "Invalid Amount", msg: "Please enter a valid amount." });
      setAlertOpen(true);
      return;
    }
    try {
      setTopupLoading(true);
      const res = await fetch(
        "https://bpznyktrerwtnpqjrvgz.supabase.co/functions/v1/create-checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card_uid: cardUid, amount: amount }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setAlertContent({ title: data.error || "Error", msg: data.message || "Failed to initiate payment." });
        setAlertOpen(true);
        return;
      }
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch {
      setAlertContent({ title: "Connection Error", msg: "Could not connect to the payment server." });
      setAlertOpen(true);
    } finally {
      setTopupLoading(false);
    }
  };

  const balanceText = useMemo(() => {
    const value = Number(user?.balance || 0);
    return `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }, [user?.balance]);

  const isChecking = cardValidation.status === "checking";
  const isBlocked = cardValidation.status === "blocked";

  return (
    <div className="min-h-screen bg-[#020617] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-slate-100 p-4 sm:p-8">
      <style>{`
        @keyframes border-rotate { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes balance-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.04); color: #34d399; }
          100% { transform: scale(1); }
        }
        .rgb-container {
          position: relative; padding: 3px; border-radius: 23px; overflow: hidden; z-index: 0;
        }
        .rgb-container::before {
          content: ''; position: absolute; width: 200%; height: 200%;
          background: conic-gradient(#ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
          animation: border-rotate 4s linear infinite; z-index: -2; top: -50%; left: -50%;
        }
        .rgb-container::after {
          content: ''; position: absolute; inset: 3px; background: rgba(15, 23, 42, 0.95); border-radius: 20px; z-index: -1;
        }
        .recaptcha-wrapper iframe { border-radius: 8px; }
        .dashboard-content {
          transition: filter 0.35s ease, opacity 0.35s ease;
        }
        .dashboard-content.is-obscured {
          filter: blur(8px) brightness(0.4);
          opacity: 0.6;
          pointer-events: none;
          user-select: none;
        }
        [data-link-card-overlay] {
          position: fixed; inset: 0; z-index: 40;
          display: flex; align-items: center; justify-content: center; padding: 1rem;
        }
        .balance-pulse {
          animation: balance-pulse 0.8s ease-in-out;
        }
        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot {
          animation: realtime-dot 1s ease-in-out infinite;
        }
      `}</style>

      {/* ── ONE-TIME LINK CARD MODAL ── */}
      {isLinkCardOpen && (
        <div data-link-card-overlay>
          <div className="rgb-container w-full max-w-[420px] z-50 relative">
            <div className="p-7 text-white">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                  <LinkIcon className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-tight">Link Your Card</h2>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest">One-time setup</p>
                </div>
              </div>

              <div className="mt-4 mb-5 flex gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                <Lock className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300 leading-relaxed">
                  <span className="font-bold">Security Notice:</span> For your account's security, a card can only be linked{" "}
                  <span className="font-bold underline underline-offset-2">once</span>. This action is permanent and cannot be changed after confirmation.
                </p>
              </div>

              {!isConfirmStep && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Card UID</label>
                    <Input
                      value={linkCardInput}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^a-zA-Z0-9-_]/g, "");
                        setLinkCardInput(raw);
                        if (cardValidation.status !== "idle") {
                          setCardValidation({ status: "idle" });
                          setLinkCardError("");
                        }
                      }}
                      placeholder="Enter your Card UID..."
                      className="bg-white/5 border-white/10 text-white focus:border-emerald-500/50 font-mono"
                      onKeyDown={(e) => e.key === "Enter" && !isChecking && handleCheckCard()}
                      disabled={isChecking}
                    />
                  </div>

                  <div className="recaptcha-wrapper flex flex-col items-start gap-1">
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
                        <p className="text-red-300/80">This card has been blocked and cannot be linked to any account. Please contact support for assistance.</p>
                      </div>
                    </div>
                  )}

                  {linkCardError && !isBlocked && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                      <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>{linkCardError}</span>
                    </div>
                  )}

                  {isChecking && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2.5">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                      <span>Checking card in system...</span>
                    </div>
                  )}

                  <Button
                    onClick={handleCheckCard}
                    disabled={isChecking || !linkCardInput.trim() || !captchaToken}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 transition-all disabled:opacity-50"
                  >
                    {isChecking ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying Card...</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />Verify Card UID</>
                    )}
                  </Button>

                  <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                    Complete the reCAPTCHA and verify your card before linking.
                  </p>
                </div>
              )}

              {isConfirmStep && cardValidation.status === "found" && (
                <div className="space-y-4">
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Card Found</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Card UID</p>
                        <p className="text-sm font-mono text-white tracking-widest">{cardValidation.cardData.cardUid}</p>
                      </div>
                      {cardValidation.cardData.fullName && (
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Registered Name</p>
                          <p className="text-sm font-semibold text-white">{cardValidation.cardData.fullName}</p>
                        </div>
                      )}
                      {cardValidation.cardData.type && (
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Card Type</p>
                          <p className="text-sm text-slate-300">{cardValidation.cardData.type}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 text-center leading-relaxed">
                    Is this your card? Confirm to permanently link it to your account.{" "}
                    <span className="text-amber-400 font-semibold">This cannot be undone.</span>
                  </p>

                  {linkCardError && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                      <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>{linkCardError}</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={handleBackToInput}
                      disabled={linkCardLoading}
                      variant="outline"
                      className="flex-1 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-12"
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleLinkCardSubmit}
                      disabled={linkCardLoading}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 transition-all"
                    >
                      {linkCardLoading ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Linking...</>
                      ) : (
                        <><LinkIcon className="h-4 w-4 mr-2" />Confirm & Link</>
                      )}
                    </Button>
                  </div>

                  <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                    By clicking above, you agree that this card UID will be permanently tied to your account and cannot be modified.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Alert Dialog ── */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent className="bg-slate-900 text-white border-slate-800">
          <DialogHeader>
            <DialogTitle>{alertContent.title}</DialogTitle>
            <DialogDescription className="text-slate-400">{alertContent.msg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAlertOpen(false)} className="bg-emerald-600 hover:bg-emerald-700">Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Topup Modal ── */}
      <Dialog open={isTopupOpen} onOpenChange={setIsTopupOpen}>
        <DialogContent className="p-0 border-none bg-transparent max-w-[380px]">
          <div className="rgb-container">
            <div className="p-6 text-white">
              <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                <CreditCard className="text-emerald-400" /> Top-up Wallet
              </h2>
              <p className="text-[11px] text-slate-400 mb-6 uppercase tracking-wider">Secure Payment via PayMongo</p>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Card UID</label>
                  <Input disabled value={cardUid} className="bg-white/5 border-white/10 text-slate-300 font-mono" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Amount (PHP)</label>
                  <Input
                    type="number"
                    placeholder="Enter amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-white/5 border-white/10 text-white focus:border-emerald-500/50"
                  />
                </div>
                <Button
                  onClick={handleTopup}
                  disabled={topupLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12"
                >
                  {topupLoading ? "Verifying..." : "Pay via GCash / Maya"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Change Password Modal ── */}
      <Dialog open={isChangePasswordOpen} onOpenChange={(open) => { if (!cpLoading) setIsChangePasswordOpen(open); }}>
        <DialogContent className="p-0 border-none bg-transparent max-w-[420px]">
          <div className="rgb-container">
            <div className="p-7 text-white">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20">
                  <KeyRound className="h-6 w-6 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-tight">Change Password</h2>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest">Account Security</p>
                </div>
              </div>

              {cpSuccess ? (
                <div className="space-y-5">
                  <div className="flex flex-col items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                    <div>
                      <p className="font-bold text-emerald-400 text-base">Password Changed!</p>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Your password has been updated successfully. Please use your new password on your next login.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => setIsChangePasswordOpen(false)} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12">
                    Done
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Current Password</label>
                    <div className="relative">
                      <Input
                        type={cpShowCurrent ? "text" : "password"}
                        value={cpCurrentPassword}
                        onChange={(e) => { setCpCurrentPassword(e.target.value); setCpError(""); }}
                        placeholder="Enter current password"
                        className="bg-white/5 border-white/10 text-white focus:border-violet-500/50 pr-10"
                        disabled={cpLoading}
                      />
                      <button type="button" onClick={() => setCpShowCurrent((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
                        {cpShowCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">New Password</label>
                    <div className="relative">
                      <Input
                        type={cpShowNew ? "text" : "password"}
                        value={cpNewPassword}
                        onChange={(e) => { setCpNewPassword(e.target.value); setCpError(""); }}
                        placeholder="At least 8 characters"
                        className="bg-white/5 border-white/10 text-white focus:border-violet-500/50 pr-10"
                        disabled={cpLoading}
                      />
                      <button type="button" onClick={() => setCpShowNew((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
                        {cpShowNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {cpNewPassword.length > 0 && (
                      <div className="mt-1.5 flex gap-1">
                        {[...Array(4)].map((_, i) => {
                          const strength = Math.min(Math.floor(cpNewPassword.length / 3), 4);
                          const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500"];
                          return <div key={i} className={`h-0.5 flex-1 rounded-full transition-all ${i < strength ? colors[strength - 1] : "bg-slate-700"}`} />;
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Confirm New Password</label>
                    <div className="relative">
                      <Input
                        type={cpShowConfirm ? "text" : "password"}
                        value={cpConfirmPassword}
                        onChange={(e) => { setCpConfirmPassword(e.target.value); setCpError(""); }}
                        placeholder="Repeat new password"
                        className={`bg-white/5 border-white/10 text-white focus:border-violet-500/50 pr-10 ${
                          cpConfirmPassword && cpNewPassword !== cpConfirmPassword ? "border-red-500/50"
                          : cpConfirmPassword && cpNewPassword === cpConfirmPassword ? "border-emerald-500/50" : ""
                        }`}
                        disabled={cpLoading}
                        onKeyDown={(e) => e.key === "Enter" && !cpLoading && handleChangePassword()}
                      />
                      <button type="button" onClick={() => setCpShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
                        {cpShowConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {cpConfirmPassword && cpNewPassword !== cpConfirmPassword && (
                      <p className="text-[10px] text-red-400 mt-1">Passwords do not match.</p>
                    )}
                    {cpConfirmPassword && cpNewPassword === cpConfirmPassword && (
                      <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Passwords match
                      </p>
                    )}
                  </div>

                  {cpError && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                      <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>{cpError}</span>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button onClick={() => setIsChangePasswordOpen(false)} disabled={cpLoading} variant="outline" className="flex-1 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-12">
                      Cancel
                    </Button>
                    <Button
                      onClick={handleChangePassword}
                      disabled={cpLoading || !cpCurrentPassword || !cpNewPassword || !cpConfirmPassword}
                      className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold h-12 transition-all disabled:opacity-50"
                    >
                      {cpLoading ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</>
                      ) : (
                        <><KeyRound className="h-4 w-4 mr-2" />Update Password</>
                      )}
                    </Button>
                  </div>

                  <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                    You'll use your new password on your next login.
                  </p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── MAIN DASHBOARD ── */}
      <div className={`dashboard-content mx-auto w-full max-w-6xl space-y-6 ${isLinkCardOpen ? "is-obscured" : ""}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Wallet className="h-7 w-7 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white leading-none">Fare Collection System</h1>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-1 font-semibold">User Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleOpenChangePassword} className="text-slate-400 hover:text-violet-400 hover:bg-violet-400/10 gap-2">
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">Change Password</span>
            </Button>
            <Button variant="ghost" onClick={handleLogout} className="text-slate-400 hover:text-red-400 hover:bg-red-400/10 gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>

        {/* Linked Card + Realtime indicator */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/20 p-4 rounded-2xl border border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Lock className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-300">Linked Card</p>
              <p className="text-[10px] text-slate-500">Permanently linked · Cannot be changed</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 font-mono text-sm text-slate-300 tracking-widest select-all">
              {cardUid || "Not linked"}
            </div>
            {/* ✅ Real-time indicator */}
            <div className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${loading ? "bg-yellow-400" : "bg-emerald-400 realtime-dot"}`} />
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                {loading ? "Loading..." : lastUpdated ? `${lastUpdated.toLocaleTimeString()}` : "Connecting..."}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in fade-in slide-in-from-top-1">
            ⚠️ {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* ✅ Balance card with pulse on update */}
          <Card className="md:col-span-1 border-slate-800 bg-slate-900/40 backdrop-blur-md overflow-hidden border-t-emerald-500/50 border-t-2">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Available Balance</p>
                <Button
                  size="sm" variant="outline" onClick={() => setIsTopupOpen(true)}
                  className="h-7 text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
                >
                  <PlusCircle className="h-3 w-3 mr-1" /> TOP UP
                </Button>
              </div>
              {/* ✅ Pulse animation when balance updates */}
              <h2 className={`text-5xl font-black text-white tracking-tighter ${isPulsing ? "balance-pulse" : ""}`}>
                {balanceText}
              </h2>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge className={user?.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-3 py-1" : "bg-red-500/10 text-red-400 border-red-500/20 px-3 py-1"}>
                  <ShieldCheck className="h-3 w-3 mr-1.5" />
                  {user?.status || "Inactive"}
                </Badge>
                <Badge variant="outline" className="border-slate-700 text-slate-400 px-3 py-1">
                  {user?.type || "Standard User"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* User Info */}
          <Card className="md:col-span-2 border-slate-800 bg-slate-900/40 backdrop-blur-md">
            <CardContent className="pt-8 grid grid-cols-1 sm:grid-cols-2 gap-y-8 gap-x-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <User className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-1">Name</p>
                  <p className="text-base font-semibold text-slate-200">{user?.fullName || "Not Linked"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                  <CreditCard className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-1">UID</p>
                  <p className="text-base font-mono text-slate-200">{user?.cardUid || "----"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                  <Phone className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-1">Contact</p>
                  <p className="text-base text-slate-200">{user?.contactNumber || "None"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <Tag className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-1">Class</p>
                  <p className="text-base text-slate-200">{user?.type || "General"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:col-span-2">
                <div className="h-10 w-10 rounded-full bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
                  <Mail className="h-5 w-5 text-sky-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-1">Email</p>
                  <p className="text-base text-slate-200">{user?.email || "Not linked"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transaction History */}
        <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md overflow-hidden">
          <CardHeader className="bg-slate-900/20 border-b border-slate-800">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-400 uppercase tracking-widest">
              <Activity className="h-4 w-4 text-blue-400" />
              Activity Log
              {/* ✅ Live badge */}
              <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                LIVE
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="p-4 text-[10px] font-black uppercase text-slate-500">Timestamp</th>
                    <th className="p-4 text-[10px] font-black uppercase text-slate-500">Service</th>
                    <th className="p-4 text-[10px] font-black uppercase text-slate-500 text-right">Amount</th>
                    <th className="p-4 text-[10px] font-black uppercase text-slate-500 text-center">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {transactions.length === 0 ? (
                    <tr>
                      <td className="p-12 text-center text-slate-600 text-sm italic" colSpan={4}>
                        No activity recorded.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="p-4">
                          <p className="text-xs text-slate-300 font-medium">{new Date(tx.timestamp).toLocaleDateString()}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{new Date(tx.timestamp).toLocaleTimeString()}</p>
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-semibold text-slate-200 uppercase">{tx.type}</span>
                        </td>
                        <td className="p-4 text-right">
                          <span className={`text-xs font-bold ${tx.type === "Fare" ? "text-red-400" : "text-emerald-400"}`}>
                            {tx.type === "Fare" ? "-" : "+"} ₱{Math.abs(Number(tx.amount || 0)).toFixed(2)}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <Badge variant="outline" className={`text-[9px] font-black tracking-widest uppercase py-0 ${tx.status === "Success" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" : "text-red-400 border-red-500/30 bg-red-500/5"}`}>
                            {tx.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="border-t border-slate-800/60 pt-4 pb-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-700">
            <div className="flex items-center gap-2">
              <Wallet size={10} className="text-emerald-500/30" />
              <span>Fare Collection System &mdash; User Dashboard</span>
            </div>
            <div className="flex items-center gap-3">
              <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
              <span className="text-slate-800">|</span>
              <span className="text-emerald-500/30">v1.0.0</span>
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}