import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  User, Phone, Tag, ShieldCheck, LogOut, PlusCircle, KeyRound, CreditCard, Mail, Home,
  Settings, ChevronRight, ArrowLeft, ArrowRight, List, Pencil, Check, X as XIcon, Sun, Moon,
  Link2, Unlink2, AlertTriangle, RotateCw, Route, ArrowRightLeft, XCircle, Clock, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useCardData } from "@/hooks/use-card-data";
import { useChangePassword } from "@/hooks/use-change-password";
import { useLinkCard } from "@/hooks/use-link-card";
import { useTopup } from "@/hooks/use-topup";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { useDashboardAuth } from "@/hooks/use-dashboard-auth";
import { useDashboardProfile } from "@/hooks/use-dashboard-profile";
import { useFareRoutes } from "@/hooks/use-fare-routes";
import { useDashboardLayout } from "@/hooks/use-dashboard-layout";
import { LinkCardModal } from "@/components/link-card-modal";
import { TopupModal } from "@/components/topup-modal";
import { ChangePasswordModal } from "@/components/change-password-modal";
import { TransactionDetailModal, type Transaction } from "@/components/transaction-detail-modal";
import { AuthCheckingScreen } from "@/components/dashboard/auth-checking-screen";
import { SkeletonBar, SkeletonRow } from "@/components/dashboard/skeletons";
import { VirtualCard, VirtualCardSkeleton } from "@/components/dashboard/virtual-card";
import { MobileTxRow } from "@/components/dashboard/mobile-tx-row";
import { LinkReminderBanner } from "@/components/dashboard/link-reminder-banner";
import { formatAmount, getInitials, normalizeApiBaseUrl } from "@/lib/dashboard-formatters";
import { USER_AUTH_TOKEN_KEY, unlinkUserCard } from "@/lib/api";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
import { supabase } from "@/lib/supabase";

// ── Transaction type normalizer ─────────────────────────────────────────────
// Same idea as the admin Transactions page: the DB may hand back "Fare",
// "fare", "TopUp", "top_up", "Top Up", etc. This forces one canonical label
// so the Top-up / Fare tabs split correctly no matter how the source data
// is spelled/cased.
type TxType = "Fare" | "Top-up";

function normalizeTxType(type?: string | null): TxType {
  const key = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "fare") return "Fare";
  return "Top-up";
}

// 🆕 Fee / VAT / Net amount helpers — mirrors the admin Transactions page's
// getFeeAmount / getVatAmount / getNetAmount / formatNullableAmount so the
// user dashboard's Top-up view shows the same breakdown.
type FinancialFields = {
  fee_amount: number | null;
  vat_amount: number | null;
  net_amount: number | null;
};

function getFeeAmount(tx: any): number | null {
  const value = tx?.fee_amount ?? tx?.feeAmount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVatAmount(tx: any): number | null {
  const value = tx?.vat_amount ?? tx?.vatAmount;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getNetAmount(tx: any): number | null {
  const value = tx?.net_amount ?? tx?.netAmount;
  if (value != null && value !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const amount = Number(tx?.amount);
  const fee = getFeeAmount(tx);
  const vat = getVatAmount(tx);
  if (Number.isFinite(amount) && fee != null && vat != null) {
    return amount - fee - vat;
  }
  return null;
}

function formatNullableAmount(value: number | null): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `₱${value.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

// ── Card Balance Transfer types + helpers ───────────────────────────────────
// Mirrors the admin Transactions page's card_balance_transfers handling,
// scoped here to just the rows where THIS user's card is source or target.
type TransferStatus = "pending" | "completed" | "failed";

type TransferCard = {
  id: number;
  card_uid?: string | null;
  cardUid?: string | null;
  full_name?: string | null;
  fullName?: string | null;
};

type CardTransfer = {
  id: number;
  source_card_id: number;
  target_card_id: number;
  amount: number;
  reason: string;
  source_balance_before: number | null;
  target_balance_before: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  source: TransferCard | null;
  target: TransferCard | null;
};

function normalizeTransferStatus(status?: string | null): TransferStatus {
  const key = (status ?? "").toLowerCase().trim();
  if (key === "completed" || key === "complete" || key === "success") return "completed";
  if (key === "failed" || key === "failure" || key === "error") return "failed";
  return "pending";
}

function transferCardUid(card?: TransferCard | null): string {
  return card?.card_uid || card?.cardUid || "—";
}

function transferCardName(card?: TransferCard | null): string {
  return card?.full_name || card?.fullName || "Unknown";
}

function transferStatusColorClasses(status: TransferStatus, isDark: boolean): string {
  if (isDark) {
    switch (status) {
      case "completed": return "bg-emerald-950/40 text-emerald-400 border-emerald-900";
      case "failed":    return "bg-red-950/40 text-red-400 border-red-900";
      default:          return "bg-amber-950/40 text-amber-400 border-amber-900";
    }
  }
  switch (status) {
    case "completed": return "bg-emerald-50 text-emerald-600 border-emerald-200";
    case "failed":    return "bg-red-50 text-red-600 border-red-200";
    default:          return "bg-amber-50 text-amber-600 border-amber-200";
  }
}

// ── Transfer Detail Modal — receipt-style view of a single card_balance_
// transfers row, shown when the user taps a row in the Transfer tab. ───────
function TransferDetailModal({
  transfer,
  onClose,
  isDark,
}: {
  transfer: CardTransfer | null;
  onClose: () => void;
  isDark: boolean;
}) {
  if (!transfer) return null;

  const status = normalizeTransferStatus(transfer.status);
  const amount = Math.abs(Number(transfer.amount)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const StatusIcon =
    status === "failed" ? XCircle
    : status === "pending" ? Clock
    : CheckCircle2;

  const statusRingClass = isDark
    ? "ring-blue-900 bg-blue-950/40 text-blue-400"
    : "ring-blue-100 bg-blue-50 text-blue-600";

  return (
    <Dialog open={!!transfer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`max-w-sm p-0 overflow-hidden rounded-2xl gap-0 [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}
      >
        <VisuallyHidden>
          <DialogTitle>Card Balance Transfer</DialogTitle>
          <DialogDescription>
            Transfer #{transfer.id}, ₱{amount} from card {transferCardUid(transfer.source)} to card{" "}
            {transferCardUid(transfer.target)}, status {transfer.status}.
          </DialogDescription>
        </VisuallyHidden>

        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-400" />

        <div className="px-5 pt-5 pb-6 space-y-5">
          <div className="flex flex-col items-center gap-2 pt-1">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full ring-2 ${statusRingClass}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Card Balance Transfer
            </p>
            <p className={`text-4xl font-bold tabular-nums tracking-tight ${isDark ? "text-blue-400" : "text-blue-600"}`}>
              ₱{amount}
            </p>
          </div>

          <div className={`flex items-center gap-2 rounded-xl border p-3 ${isDark ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>From</p>
              <p className={`text-xs font-mono font-semibold truncate ${isDark ? "text-blue-400" : "text-blue-600"}`}>{transferCardUid(transfer.source)}</p>
              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{transferCardName(transfer.source)}</p>
            </div>
            <ArrowRightLeft className={`w-4 h-4 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
            <div className="flex-1 min-w-0 text-right">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>To</p>
              <p className={`text-xs font-mono font-semibold truncate ${isDark ? "text-blue-400" : "text-blue-600"}`}>{transferCardUid(transfer.target)}</p>
              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{transferCardName(transfer.target)}</p>
            </div>
          </div>

          <div className={`border-t border-dashed ${isDark ? "border-slate-800" : "border-slate-200"}`} />

          <div className={`rounded-xl overflow-hidden border divide-y ${isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"}`}>
            {[
              { label: "Transfer ID", value: `#${transfer.id}`, mono: true },
              {
                label: "Requested",
                value: new Date(transfer.created_at).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              },
              ...(transfer.completed_at
                ? [{
                    label: "Completed",
                    value: new Date(transfer.completed_at).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  }]
                : []),
              { label: "Reason", value: transfer.reason || "—" },
              { label: "Status", value: status.charAt(0).toUpperCase() + status.slice(1) },
            ].map(({ label, value, mono }) => (
              <div key={label} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isDark ? "bg-slate-950/60" : "bg-slate-50"}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  {label}
                </span>
                <span className={`text-xs text-right truncate max-w-[60%] font-medium ${mono ? "font-mono" : ""} ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <Button
            onClick={onClose}
            className="w-full text-white font-semibold uppercase text-[11px] tracking-widest bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type TxSubTab = "topup" | "fare" | "transfers";

// 🆕 Shared tab definitions for the GCash-style underline tab bar, used by
// both the desktop and mobile Transactions headers so the two stay in sync.
const TX_TABS: { key: TxSubTab; label: string; icon: typeof CreditCard }[] = [
  { key: "topup", label: "Top-up", icon: CreditCard },
  { key: "fare", label: "Fare", icon: Route },
  { key: "transfers", label: "Transfer", icon: ArrowRightLeft },
];

export default function PaymongoDashboardPage() {
  const [, setLocation] = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const { cardUid, setCardUid, authProfile, authChecking } = useDashboardAuth();
  const { user, transactions, loading, error, isPulsing } = useCardData(cardUid);
  const currentBalance = Number(user?.balance || 0);
  const isLinked = Boolean(cardUid);
  const dullClass = !isLinked ? "opacity-40 grayscale pointer-events-none select-none" : "";
  const cardDataLoading = isLinked && loading && !user;
  const linkCard = useLinkCard((uid) => setCardUid(uid));
  const topup = useTopup(cardUid, currentBalance);
  const changePassword = useChangePassword();
  const { toast } = useToast();
  const routes = useFareRoutes();
  const { headerRef, navRef, headerHeight, navHeight } = useDashboardLayout();
  const displayName = (isLinked ? user?.fullName : authProfile?.fullName) || "";
  const displayContactBase = isLinked ? (user?.contactNumber || "") : "";
  const displayEmailBase = isLinked ? (user?.email || "") : (authProfile?.email || "");
  const profile = useDashboardProfile({ cardUid, isLinked, displayContact: displayContactBase, displayEmail: displayEmailBase, toast });
  const { editingContact, editingEmail, contactValue, emailValue, savingField, localContact, localEmail, setContactValue, setEmailValue, startEditContact, cancelEditContact, handleSaveContact, startEditEmail, cancelEditEmail, handleSaveEmail } = profile;
  const displayContact = isLinked ? (localContact ?? user?.contactNumber ?? "") : "";
  const displayEmail = localEmail ?? (isLinked ? user?.email : authProfile?.email) ?? "";
  const remainingTopup = Math.max(0, 20000 - currentBalance);
  const isAtMaxBalance = remainingTopup <= 0;
  // Card must be linked AND status must be "Active" for top-up (and other
  // card actions) to be allowed. A blocked/inactive card should never let
  // the user push more money onto it.
  const isCardUsable = isLinked && user?.status === "Active";

  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [virtualCardFlipped, setVirtualCardFlipped] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [slowLoadHint, setSlowLoadHint] = useState(false);

  // 🆕 Transactions sub-tab: Top-up / Fare / Transfer — same pattern as the
  // admin Transactions page, scoped to just this user's own card.
  const [activeTxTab, setActiveTxTab] = useState<TxSubTab>("topup");
  const [transfers, setTransfers] = useState<CardTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [viewTransfer, setViewTransfer] = useState<CardTransfer | null>(null);

  // 🆕 Fee / VAT / Net amount lookup, keyed by transaction id (string).
  // Fetched from the `transactions` table the same way the admin page does,
  // then merged into each top-up transaction below.
  const [financialById, setFinancialById] = useState<Record<string, FinancialFields>>({});

  useEffect(() => {
    const isBusy = authChecking || cardDataLoading;
    if (!isBusy) {
      setSlowLoadHint(false);
      return;
    }
    const timer = setTimeout(() => setSlowLoadHint(true), 3500);
    return () => clearTimeout(timer);
  }, [authChecking, cardDataLoading]);

  // 🆕 Fetch this user's card_balance_transfers (sent OR received). Adjust
  // the `users!card_balance_transfers_..._fkey` names below if your
  // Supabase foreign keys are named differently, and adjust `user.id` if
  // your `users` row's primary key field is named something else.
  useEffect(() => {
    if (!isLinked || !user?.id) {
      setTransfers([]);
      setTransfersLoading(false);
      return;
    }
    let cancelled = false;
    const loadTransfers = async () => {
      setTransfersLoading(true);
      const { data, error: transfersError } = await supabase
        .from("card_balance_transfers")
        .select(`
          id, source_card_id, target_card_id, amount, reason,
          source_balance_before, target_balance_before, status,
          created_at, completed_at,
          source:users!card_balance_transfers_source_card_id_fkey(id, card_uid, full_name),
          target:users!card_balance_transfers_target_card_id_fkey(id, card_uid, full_name)
        `)
        .or(`source_card_id.eq.${user.id},target_card_id.eq.${user.id}`)
        .order("created_at", { ascending: false });
      if (!cancelled && !transfersError && data) setTransfers(data as unknown as CardTransfer[]);
      if (!cancelled) setTransfersLoading(false);
    };
    loadTransfers();

    const channel = supabase
      .channel(`user_card_balance_transfers_${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_balance_transfers" }, loadTransfers)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isLinked, user?.id]);

  // 🆕 Fetch fee_amount / vat_amount / net_amount for this card's
  // transactions, same pattern as the admin Transactions page. Keyed by id
  // so it can be merged into topupTransactions below without refetching
  // everything else.
  useEffect(() => {
    let cancelled = false;
    const loadFinancialFields = async () => {
      const ids = transactions
        .map((tx: any) => tx?.id)
        .filter((id: any) => id != null)
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id));
      if (ids.length === 0) {
        setFinancialById({});
        return;
      }
      const { data, error: financialError } = await supabase
        .from("transactions")
        .select("id, fee_amount, vat_amount, net_amount")
        .in("id", ids);
      if (cancelled) return;
      if (financialError) {
        console.warn("Unable to load transaction fee/VAT/net fields:", financialError.message);
        return;
      }
      const next: Record<string, FinancialFields> = {};
      for (const row of data ?? []) {
        next[String(row.id)] = {
          fee_amount: row.fee_amount == null ? null : Number(row.fee_amount),
          vat_amount: row.vat_amount == null ? null : Number(row.vat_amount),
          net_amount: row.net_amount == null ? null : Number(row.net_amount),
        };
      }
      setFinancialById(next);
    };
    loadFinancialFields();
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  // 🆕 Split this card's transactions into Top-up / Fare buckets, same as
  // the admin page — memoized so the array reference stays stable.
  // Top-up rows are merged with their fee_amount / vat_amount / net_amount
  // from financialById so both the table and the detail modal can show them.
  const topupTransactions = useMemo(
    () =>
      transactions
        .filter((tx) => normalizeTxType(tx.type) === "Top-up")
        .map((tx: any) => ({
          ...tx,
          ...(financialById[String(tx.id)] ?? {}),
        })),
    [transactions, financialById],
  );
  const fareTransactions = useMemo(
    () => transactions.filter((tx) => normalizeTxType(tx.type) === "Fare"),
    [transactions],
  );
  const currentTxList = activeTxTab === "fare" ? fareTransactions : topupTransactions;

  // 🆕 Tab → count lookup for the line tab bar (desktop shows counts).
  const txTabCounts: Record<TxSubTab, number> = {
    topup: topupTransactions.length,
    fare: fareTransactions.length,
    transfers: transfers.length,
  };

  // ✅ Actual logout logic — only runs after user confirms
  const handleLogout = async () => {
    const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);

    if (token) {
      try {
        const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);
        await Promise.race([
          fetch(`${apiBaseUrl}/api/auth/user/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
      } catch (err) {
        console.warn("Logout API call failed (ignoring):", err);
      }
    }

    window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
    setLocation("/signin");
  };

  const requestLogout = () => {
    setLogoutConfirmOpen(true);
  };

  const confirmLogout = () => {
    setLogoutConfirmOpen(false);
    void handleLogout();
  };

  // ✅ Unlink card logic — user-initiated, requires confirmation
  const handleUnlinkCard = async () => {
    setUnlinking(true);
    try {
      await unlinkUserCard();
      toast({ title: "Card unlinked", description: "Your card has been unlinked from your account." });
      setUnlinkConfirmOpen(false);
      setCardUid("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to unlink card.";
      toast({ title: "Unlink failed", description: message, variant: "destructive" });
    } finally {
      setUnlinking(false);
    }
  };

  const balanceText = useMemo(() => {
    return `\u20B1${Number(user?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }, [user?.balance]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSelectedTx(null);
  };

  const handleTxClick = useCallback((tx: Transaction) => {
    setSelectedTx(tx);
  }, []);

  useEffect(() => {
    const isBusy = authChecking || cardDataLoading;
    if (!isBusy) { setSlowLoadHint(false); return; }
    const timer = setTimeout(() => setSlowLoadHint(true), 3500);
    return () => clearTimeout(timer);
  }, [authChecking, cardDataLoading]);

  const navItems: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: "home", icon: <Home className="h-5 w-5" />, label: "Home" },
    { tab: "Transactions", icon: <List className="h-5 w-5" />, label: "Transactions" },
    { tab: "settings", icon: <Settings className="h-5 w-5" />, label: "Settings" },
  ];

  // 🆕 Full-page gate — see AuthCheckingScreen above. Bails out before any
  // of the "no card linked yet" UI can render, which is what used to
  // flash on refresh / cold start.
  if (authChecking) {
    return <AuthCheckingScreen isDark={isDark} slowHint={slowLoadHint} />;
  }

  return (
    <div className={`min-h-screen ${isDark ? "bg-[#020617] text-slate-100" : "bg-slate-50 text-slate-800"}`}>
      {linkCard.isOpen && <LinkCardModal {...linkCard} />}
      <TopupModal {...topup} cardUid={cardUid} currentBalance={currentBalance} />
      <ChangePasswordModal {...changePassword} />
      <TransactionDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} routes={routes} />
      <TransferDetailModal transfer={viewTransfer} onClose={() => setViewTransfer(null)} isDark={isDark} />
      <style>{`${DASHBOARD_STYLES}
        /* 🔒 Locked-scale flip card — see LockedFlipCard component above.
           The design canvas itself never reflows; only the outer wrapper's
           transform: scale(...) changes, in a single React inline style.
           Copied 1:1 from User Management's card preview CSS. */
        .card-flip-scene-locked {
          position: relative;
          width: 100%;
          height: 100%;
          perspective: 1600px;
        }
        .card-flip-inner-locked {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1);
          transform-style: preserve-3d;
        }
        .card-flip-inner-locked.is-flipped { transform: rotateY(180deg); }
        .card-face-locked {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .card-face-back-locked { transform: rotateY(180deg); }
      `}</style>

      {/* ✅ Logout confirmation dialog — compact, Yes/No always one line, small boxes */}
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent className={`max-w-[85vw] sm:max-w-xs p-4 rounded-xl ${isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"}`}>
          <AlertDialogHeader className="space-y-1">
            <AlertDialogTitle className={`font-bold text-sm leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
              Are you sure you want to logout?
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-[11px] leading-snug ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              You will need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-row justify-end items-center gap-1.5 mt-3 sm:gap-1.5">
            <AlertDialogCancel
              className={`text-[11px] h-7 px-2.5 min-w-0 mt-0 cursor-pointer ${
                isDark ? "bg-slate-900 border-slate-800 text-white hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              No
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLogout}
              className="bg-red-600 text-white hover:bg-red-500 font-bold text-[11px] h-7 px-2.5 min-w-0 cursor-pointer"
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ✅ Unlink card confirmation dialog */}
      <AlertDialog open={unlinkConfirmOpen} onOpenChange={setUnlinkConfirmOpen}>
        <AlertDialogContent className={`max-w-[85vw] sm:max-w-xs p-4 rounded-xl ${isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"}`}>
          <AlertDialogHeader className="space-y-1">
            <AlertDialogTitle className={`font-bold text-sm leading-snug ${isDark ? "text-white" : "text-slate-900"}`}>
              Unlink this card?
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-[11px] leading-snug ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              You'll lose access to this card's balance and history until you link a card again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-row justify-end items-center gap-1.5 mt-3 sm:gap-1.5">
            <AlertDialogCancel
              disabled={unlinking}
              className={`text-[11px] h-7 px-2.5 min-w-0 mt-0 cursor-pointer ${
                isDark ? "bg-slate-900 border-slate-800 text-white hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleUnlinkCard(); }}
              disabled={unlinking}
              className="bg-red-600 text-white hover:bg-red-500 font-bold text-[11px] h-7 px-2.5 min-w-0 cursor-pointer"
            >
              {unlinking ? "Unlinking…" : "Unlink"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* STICKY HEADER */}
      <div ref={headerRef} className={`sticky top-0 z-40 w-full backdrop-blur-md border-b ${isDark ? "bg-[#020617]/95 border-slate-800" : "bg-white/95 border-slate-200"}`}>
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/calbayog.png"
              alt="Calbayog logo"
              className="h-9 w-9 rounded-lg object-contain shrink-0"
            />
            <h1 className={`text-base font-bold tracking-tight leading-none ${isDark ? "text-white" : "text-slate-900"}`}>
              Fare Collection System
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {!isLinked && (
              <Button
                variant="ghost"
                onClick={() => linkCard.setIsOpen(true)}
                className={`gap-2 text-sm cursor-pointer ${
                  isDark ? "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                }`}>
                <Link2 className="h-4 w-4" /><span>Link Card</span>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={toggleTheme}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={`gap-2 text-sm cursor-pointer ${
                isDark ? "text-slate-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-slate-500 hover:text-amber-600 hover:bg-amber-50"
              }`}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
            </Button>
            <Button variant="ghost" onClick={changePassword.open}
              className={`gap-2 text-sm cursor-pointer ${
                isDark ? "text-slate-400 hover:text-violet-400 hover:bg-violet-400/10" : "text-slate-500 hover:text-violet-600 hover:bg-violet-50"
              }`}>
              <KeyRound className="h-4 w-4" /><span>Change Password</span>
            </Button>
            <Button variant="ghost" onClick={requestLogout}
              className={`gap-2 text-sm cursor-pointer ${
                isDark ? "text-slate-400 hover:text-red-400 hover:bg-red-400/10" : "text-slate-500 hover:text-red-600 hover:bg-red-50"
              }`}>
              <LogOut className="h-4 w-4" /><span>Logout</span>
            </Button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className={`mx-auto w-full max-w-6xl px-3 sm:px-8 pb-20 md:pb-8 pt-4 space-y-4 dashboard-content ${
        linkCard.isOpen ? "is-obscured" : ""
      }`}>
        {error && isLinked && (
          <div className={`p-3 rounded-lg text-xs border ${isDark ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-red-50 border-red-200 text-red-600"}`}>
            Warning: {error}
          </div>
        )}

        {/* ✅ Blocked/inactive card warning — top-up and other card actions
            are disabled while this is visible. */}
        {isLinked && !cardDataLoading && user?.status && user.status !== "Active" && (
          <div className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${isDark ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-red-50 border-red-200 text-red-600"}`}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Your card is currently <strong className="mx-1">{user.status}</strong> — top-up is disabled. You can unlink it below and contact an admin for a new card.
          </div>
        )}

        {/* 🆕 Cold-start hint — only surfaces once a linked account's card
            data has been loading for a while, so it doesn't flash on
            ordinary fast loads. */}
        {cardDataLoading && slowLoadHint && (
          <div className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${
            isDark ? "bg-slate-800/60 border-slate-700 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"
          }`}>
            <RotateCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Still loading your card — the server may be waking up from a cold start.
          </div>
        )}

        {/* ── Persistent reminder banner while no card is linked yet.
            Desktop only — on mobile, Link Card lives inside the Settings tab. ── */}
        {!isLinked && (
          <div className="hidden md:block">
            <LinkReminderBanner isDark={isDark} onLink={() => linkCard.setIsOpen(true)} />
          </div>
        )}

        {/* HOME tab */}
        <div className={activeTab === "home" ? "block" : "hidden md:block"}>
          {/* ── Mobile-only reminder — desktop already shows this banner
              above, outside the tab sections. ── */}
          {!isLinked && (
            <div className="md:hidden mb-4">
              <LinkReminderBanner isDark={isDark} onLink={() => linkCard.setIsOpen(true)} />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-1 md:col-span-3">
              <p className={`text-xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                Welcome back,{" "}
                <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>
                  {cardDataLoading ? "…" : (displayName?.split(" ")[0] || "User")}
                </span> 👋
              </p>
              <p className={`text-[11px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                {cardDataLoading ? "Loading your account overview…" : isLinked ? "Here's your account overview." : "Link a card to see your account overview."}
              </p>
            </div>

            {/* Balance Card — dulled/blank until a card is linked, skeleton while a linked card's data is still loading */}
            <Card className={`md:col-span-1 backdrop-blur-md border-t-emerald-500/50 border-t-2 ${
              isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-white"
            }`}>
              <CardContent className={`pt-4 pb-4 px-4 ${dullClass}`}>
                {cardDataLoading ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <SkeletonBar isDark={isDark} className="h-3 w-28" />
                      <SkeletonBar isDark={isDark} className="h-6 w-16 rounded-md" />
                    </div>
                    <SkeletonBar isDark={isDark} className="h-9 w-40" />
                    <SkeletonBar isDark={isDark} className="h-1 w-full rounded-full" />
                    <div className="flex gap-2 pt-1">
                      <SkeletonBar isDark={isDark} className="h-5 w-16 rounded-full" />
                      <SkeletonBar isDark={isDark} className="h-5 w-24 rounded-full" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-1.5">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>Available Balance</p>
                      <Button size="sm" variant="outline" disabled={!isCardUsable} onClick={() => isCardUsable && topup.setIsOpen(true)}
                        className={`h-6 text-[10px] px-2 cursor-pointer disabled:cursor-not-allowed ${
                          isDark
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                            : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-600 hover:text-white"
                        }`}>
                        <PlusCircle className="h-3 w-3 mr-1" /> TOP UP
                      </Button>
                    </div>
                    <h2 className={`text-4xl font-black tracking-tighter ${isDark ? "text-white" : "text-slate-900"} ${isPulsing ? "balance-pulse" : ""}`}>
                      {isLinked ? balanceText : "\u20B1— .—"}
                    </h2>
                    <div className="mt-2 space-y-1">
                      <div className={`w-full rounded-full h-1 overflow-hidden ${isDark ? "bg-slate-800" : "bg-slate-200"}`}>
                        <div
                          className={`h-1 rounded-full transition-all ${
                            !isLinked ? (isDark ? "bg-slate-700" : "bg-slate-300")
                              : isAtMaxBalance ? "bg-red-500" : currentBalance / 20000 >= 0.8 ? "bg-amber-400" : "bg-emerald-500"
                          }`}
                          style={{ width: isLinked ? `${Math.min((currentBalance / 20000) * 100, 100)}%` : "0%" }}
                        />
                      </div>
                      <p className={`text-[9px] font-mono ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                        {!isLinked ? (
                          <span>— remaining</span>
                        ) : isAtMaxBalance ? (
                          <span className={isDark ? "text-red-400/70" : "text-red-500/80"}>Max balance reached</span>
                        ) : (
                          <>₱{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })} remaining</>
                        )}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className={
                        isLinked && user?.status === "Active"
                          ? isDark
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-2 py-0.5 text-[10px]"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200 px-2 py-0.5 text-[10px]"
                          : isDark
                            ? "bg-red-500/10 text-red-400 border-red-500/20 px-2 py-0.5 text-[10px]"
                            : "bg-red-50 text-red-700 border-red-200 px-2 py-0.5 text-[10px]"
                      }>
                        <ShieldCheck className="h-3 w-3 mr-1" />{isLinked ? (user?.status || "Inactive") : "—"}
                      </Badge>
                      <Badge variant="outline" className={`px-2 py-0.5 text-[10px] ${isDark ? "border-slate-700 text-slate-400" : "border-slate-300 text-slate-500"}`}>
                        {isLinked ? (user?.type || "Standard User") : "—"}
                      </Badge>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Virtual Card — mobile only. Hidden on desktop and placed directly below the Balance card. */}
            {isLinked && (
              <div className="col-span-1 md:hidden">
                {user ? (
                  <VirtualCard
                    user={user}
                    isDark={isDark}
                    flipped={virtualCardFlipped}
                    onFlip={() => setVirtualCardFlipped((f) => !f)}
                  />
                ) : (
                  <VirtualCardSkeleton isDark={isDark} />
                )}
              </div>
            )}

            {/* Profile Card — desktop only, dulled/blank until a card is linked, skeleton while loading */}
            <Card className={`hidden md:block md:col-span-2 backdrop-blur-md ${isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-white"}`}>
              <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                {cardDataLoading ? (
                  <>
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                    <SkeletonRow isDark={isDark} />
                  </>
                ) : (
                  <>
                    {[
                      { icon: <User className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />, bg: "bg-blue-500/10 border-blue-500/20", label: "Name", value: isLinked ? (user?.fullName || "Not Linked") : "—" },
                      { icon: <CreditCard className={`h-4 w-4 ${isDark ? "text-purple-400" : "text-purple-600"}`} />, bg: "bg-purple-500/10 border-purple-500/20", label: "UID", value: isLinked ? (user?.cardUid || "----") : "—", mono: true },
                      { icon: <Tag className={`h-4 w-4 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />, bg: "bg-emerald-500/10 border-emerald-500/20", label: "Class", value: isLinked ? (user?.type || "General") : "—" },
                    ].map(({ icon, bg, label, value, mono }) => (
                      <div key={label} className={`flex items-center gap-3 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center border ${bg}`}>{icon}</div>
                        <div>
                          <p className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>{label}</p>
                          <p className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"} ${mono ? "font-mono" : ""}`}>{value}</p>
                        </div>
                      </div>
                    ))}

                    {/* ✅ Contact — editable, disabled until a card is linked */}
                    <div className={`flex items-center gap-3 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                      <div className="h-9 w-9 rounded-full flex items-center justify-center border bg-orange-500/10 border-orange-500/20 shrink-0">
                        <Phone className={`h-4 w-4 ${isDark ? "text-orange-400" : "text-orange-600"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Contact</p>
                        {editingContact ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="tel"
                              value={contactValue}
                              onChange={(e) => setContactValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveContact();
                                if (e.key === "Escape") cancelEditContact();
                              }}
                              disabled={savingField === "contact"}
                              autoFocus
                              className={`text-sm font-semibold rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                                isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                              }`}
                            />
                            <button
                              onClick={handleSaveContact}
                              disabled={savingField === "contact"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              }`}
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEditContact}
                              disabled={savingField === "contact"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                              title="Cancel"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <p className={`text-sm font-semibold truncate ${isDark ? "text-slate-200" : "text-slate-800"}`}>{isLinked ? (displayContact || "None") : "—"}</p>
                            <button
                              onClick={startEditContact}
                              disabled={!isLinked}
                              className={`h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10" : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              }`}
                              title="Edit contact number"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ✅ Email — editable, disabled until a card is linked */}
                    <div className={`flex items-center gap-3 sm:col-span-2 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                      <div className="h-9 w-9 rounded-full bg-sky-500/10 flex items-center justify-center border border-sky-500/20 shrink-0">
                        <Mail className={`h-4 w-4 ${isDark ? "text-sky-400" : "text-sky-600"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] font-bold uppercase leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Email</p>
                        {editingEmail ? (
                          <div className="flex items-center gap-1.5 max-w-sm">
                            <input
                              type="email"
                              value={emailValue}
                              onChange={(e) => setEmailValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEmail();
                                if (e.key === "Escape") cancelEditEmail();
                              }}
                              disabled={savingField === "email"}
                              autoFocus
                              className={`text-sm rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                                isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                              }`}
                            />
                            <button
                              onClick={handleSaveEmail}
                              disabled={savingField === "email"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              }`}
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEditEmail}
                              disabled={savingField === "email"}
                              className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "bg-slate-800 text-slate-400 hover:bg-slate-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                              title="Cancel"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <p className={`text-sm truncate ${isDark ? "text-slate-200" : "text-slate-800"}`}>{isLinked ? (displayEmail || "Not linked") : "—"}</p>
                            <button
                              onClick={startEditEmail}
                              disabled={!isLinked}
                              className={`h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                                isDark ? "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10" : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              }`}
                              title="Edit email"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* TRANSACTIONS — Desktop */}
        <div className="hidden md:block">
          <Card className={`backdrop-blur-md overflow-hidden ${isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-white"}`}>
            <CardHeader className={`py-3 border-b ${isDark ? "bg-slate-900/20 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
              <CardTitle className={`text-xs font-bold flex items-center gap-2 uppercase tracking-widest mb-2.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <List className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />Transactions History
              </CardTitle>
              {/* 🆕 GCash-style line tabs — flat underline instead of the old
                  pill/segmented control. No background "card" per tab. */}
              {isLinked && (
                <div className={`flex items-center gap-6 border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  {TX_TABS.map(({ key, label, icon: Icon }) => {
                    const active = activeTxTab === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveTxTab(key)}
                        className={`relative flex items-center gap-1.5 pb-2.5 -mb-px text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer border-b-2 ${
                          active
                            ? isDark ? "text-emerald-400 border-emerald-400" : "text-emerald-600 border-emerald-600"
                            : isDark ? "text-slate-500 border-transparent hover:text-slate-300" : "text-slate-400 border-transparent hover:text-slate-600"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                        <span className={`text-[9px] font-mono px-1 rounded ${
                          active
                            ? isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                            : isDark ? "bg-slate-800/70 text-slate-500" : "bg-slate-100 text-slate-400"
                        }`}>{txTabCounts[key]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {!isLinked ? (
                <div className="flex flex-col items-center justify-center py-14 gap-3">
                  <List className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                  <p className={`text-xs italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>Link a card to see your transactions.</p>
                  <Button size="sm" onClick={() => linkCard.setIsOpen(true)}
                    className="h-7 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
                    <Link2 className="h-3 w-3 mr-1" /> Link Card
                  </Button>
                </div>
              ) : cardDataLoading ? (
                <div className="p-4 space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <SkeletonBar isDark={isDark} className="h-2.5 w-24" />
                        <SkeletonBar isDark={isDark} className="h-2 w-16" />
                      </div>
                      <SkeletonBar isDark={isDark} className="h-3 w-20" />
                      <SkeletonBar isDark={isDark} className="h-4 w-16 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : activeTxTab === "transfers" ? (
                transfersLoading ? (
                  <div className="p-4 space-y-3">
                    {[0, 1, 2, 3].map((i) => (
                      <SkeletonBar key={i} isDark={isDark} className="h-12 w-full rounded-lg" />
                    ))}
                  </div>
                ) : transfers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 gap-3">
                    <ArrowRightLeft className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                    <p className={`text-xs italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>No card transfers yet.</p>
                  </div>
                ) : (
                  <>
                    <p className={`px-4 pt-2 pb-1 text-[10px] italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>Tap a row to view transfer details.</p>
                    <div className="max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left table-fixed">
                        <colgroup>
                          <col style={{ width: "22%" }} /><col style={{ width: "22%" }} />
                          <col style={{ width: "22%" }} /><col style={{ width: "16%" }} /><col style={{ width: "18%" }} />
                        </colgroup>
                        <thead className={isDark ? "bg-slate-950/50" : "bg-slate-50"}>
                          <tr>
                            {(["From", "To", "Timestamp", "Amount", "Status"] as const).map((h, i) => (
                              <th key={h} className={`px-3 py-2.5 text-[9px] font-black uppercase whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"} ${
                                i === 3 ? "text-right" : i === 4 ? "text-center" : ""}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className={isDark ? "divide-y divide-slate-800/50" : "divide-y divide-slate-100"}>
                          {transfers.map((t) => {
                            const status = normalizeTransferStatus(t.status);
                            return (
                              <tr key={t.id} onClick={() => setViewTransfer(t)}
                                className={`transition-colors cursor-pointer ${isDark ? "hover:bg-slate-800/30 active:bg-slate-800/50" : "hover:bg-slate-50 active:bg-slate-100"}`}>
                                <td className="px-3 py-2.5">
                                  <p className={`text-[10px] font-mono font-semibold ${isDark ? "text-blue-400" : "text-blue-600"}`}>{transferCardUid(t.source)}</p>
                                  <p className={`text-[9px] leading-tight ${isDark ? "text-slate-500" : "text-slate-400"}`}>{transferCardName(t.source)}</p>
                                </td>
                                <td className="px-3 py-2.5">
                                  <p className={`text-[10px] font-mono font-semibold ${isDark ? "text-blue-400" : "text-blue-600"}`}>{transferCardUid(t.target)}</p>
                                  <p className={`text-[9px] leading-tight ${isDark ? "text-slate-500" : "text-slate-400"}`}>{transferCardName(t.target)}</p>
                                </td>
                                <td className="px-3 py-2.5">
                                  <p className={`text-[10px] font-medium leading-tight whitespace-nowrap ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                    {new Date(t.created_at).toLocaleDateString()}
                                  </p>
                                  <p className={`text-[9px] font-mono leading-tight whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                                    {new Date(t.created_at).toLocaleTimeString()}
                                  </p>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <span className={`whitespace-nowrap tabular-nums text-[11px] font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                                    ₱{Math.abs(Number(t.amount)).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <Badge variant="outline" className={`text-[9px] font-black tracking-widest uppercase py-0 whitespace-nowrap capitalize ${transferStatusColorClasses(status, isDark)}`}>
                                    {status}
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              ) : (
                <>
                  <p className={`px-4 pt-2 pb-1 text-[10px] italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>Tap a row to view transaction details.</p>
                  <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full text-left table-fixed">
                      {activeTxTab === "topup" ? (
                        <colgroup>
                          <col style={{ width: "16%" }} /><col style={{ width: "12%" }} />
                          <col style={{ width: "13%" }} /><col style={{ width: "13%" }} />
                          <col style={{ width: "13%" }} /><col style={{ width: "15%" }} />
                          <col style={{ width: "18%" }} />
                        </colgroup>
                      ) : (
                        <colgroup>
                          <col style={{ width: "30%" }} /><col style={{ width: "18%" }} />
                          <col style={{ width: "30%" }} /><col style={{ width: "22%" }} />
                        </colgroup>
                      )}
                      <thead className={isDark ? "bg-slate-950/50" : "bg-slate-50"}>
                        <tr>
                          {(activeTxTab === "topup"
                            ? (["Timestamp", "Service", "Amount", "Fee", "VAT", "Net Amount", "Result"] as const)
                            : (["Timestamp", "Service", "Amount", "Result"] as const)
                          ).map((h) => (
                            <th
                              key={h}
                              className={`px-3 py-2.5 text-[9px] font-black uppercase whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"} ${
                                h === "Amount" || h === "Fee" || h === "VAT" || h === "Net Amount"
                                  ? "text-right"
                                  : h === "Result"
                                    ? "text-center"
                                    : ""
                              }`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={isDark ? "divide-y divide-slate-800/50" : "divide-y divide-slate-100"}>
                        {currentTxList.length === 0 ? (
                          <tr><td className={`p-12 text-center text-sm italic ${isDark ? "text-slate-600" : "text-slate-400"}`} colSpan={activeTxTab === "topup" ? 7 : 4}>No activity recorded.</td></tr>
                        ) : currentTxList.map((tx: any) => (
                          <tr key={tx.id} onClick={() => handleTxClick(tx)}
                            className={`transition-colors cursor-pointer ${isDark ? "hover:bg-slate-800/30 active:bg-slate-800/50" : "hover:bg-slate-50 active:bg-slate-100"}`}>
                            <td className="px-3 py-2.5">
                              <p className={`text-[10px] font-medium leading-tight whitespace-nowrap ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                {new Date(tx.timestamp).toLocaleDateString()}
                              </p>
                              <p className={`text-[9px] font-mono leading-tight whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                                {new Date(tx.timestamp).toLocaleTimeString()}
                              </p>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-[10px] font-semibold uppercase whitespace-nowrap ${isDark ? "text-slate-200" : "text-slate-700"}`}>{tx.type}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`whitespace-nowrap tabular-nums text-[11px] font-bold ${
                                tx.type === "Fare" ? (isDark ? "text-red-400" : "text-red-600") : (isDark ? "text-emerald-400" : "text-emerald-600")}`}>
                                {formatAmount(tx.type, tx.amount)}
                              </span>
                            </td>
                            {activeTxTab === "topup" && (
                              <>
                                <td className="px-3 py-2.5 text-right">
                                  <span className={`whitespace-nowrap tabular-nums text-[10px] font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                    {formatNullableAmount(getFeeAmount(tx))}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <span className={`whitespace-nowrap tabular-nums text-[10px] font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                    {formatNullableAmount(getVatAmount(tx))}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <span className={`whitespace-nowrap tabular-nums text-[11px] font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                                    {formatNullableAmount(getNetAmount(tx))}
                                  </span>
                                </td>
                              </>
                            )}
                            <td className="px-3 py-2.5 text-center">
                              <Badge variant="outline" className={`text-[9px] font-black tracking-widest uppercase py-0 whitespace-nowrap ${
                                tx.status === "Success"
                                  ? isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" : "text-emerald-700 border-emerald-200 bg-emerald-50"
                                  : isDark ? "text-red-400 border-red-500/30 bg-red-500/5" : "text-red-700 border-red-200 bg-red-50"}`}>
                                {tx.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* TRANSACTIONS — Mobile */}
        <div
          className={
            activeTab === "Transactions"
              ? `fixed inset-0 flex flex-col md:hidden z-10 ${isDark ? "bg-[#020617]" : "bg-slate-50"}`
              : "hidden"
          }
          style={{ top: `${headerHeight}px`, bottom: `${navHeight}px` }}
        >
          <div className={`backdrop-blur-md border-b shrink-0 ${isDark ? "bg-[#020617]/95 border-slate-800/60" : "bg-white/95 border-slate-200"}`}>
            <p className={`text-sm font-bold flex items-center gap-2 px-4 pt-2.5 ${isDark ? "text-white" : "text-slate-900"}`}>
              <List className={`h-4 w-4 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
              Transactions History
            </p>
            {/* 🆕 GCash-style line tabs — full-width, equally spaced, flat
                underline indicator instead of the old rounded pill group. */}
            {isLinked && (
              <div className={`mt-2 flex items-stretch border-t ${isDark ? "border-slate-800/60" : "border-slate-100"}`}>
                {TX_TABS.map(({ key, label, icon: Icon }) => {
                  const active = activeTxTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTxTab(key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer border-b-2 -mt-px ${
                        active
                          ? isDark ? "text-emerald-400 border-emerald-400" : "text-emerald-600 border-emerald-600"
                          : isDark ? "text-slate-500 border-transparent" : "text-slate-400 border-transparent"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className={`flex-1 overflow-y-auto overscroll-contain ${isDark ? "bg-[#020617]" : "bg-slate-50"}`}>
            {!isLinked ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-6">
                <List className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                <p className={`text-xs italic text-center ${isDark ? "text-slate-600" : "text-slate-400"}`}>Link a card to see your transactions.</p>
                <Button size="sm" onClick={() => linkCard.setIsOpen(true)}
                  className="h-8 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
                  <Link2 className="h-3 w-3 mr-1" /> Link Card
                </Button>
              </div>
            ) : cardDataLoading ? (
              <div className="p-4 space-y-4">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <SkeletonBar isDark={isDark} className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <SkeletonBar isDark={isDark} className="h-2.5 w-20" />
                      <SkeletonBar isDark={isDark} className="h-2 w-28" />
                    </div>
                    <SkeletonBar isDark={isDark} className="h-3 w-14" />
                  </div>
                ))}
              </div>
            ) : activeTxTab === "transfers" ? (
              transfersLoading ? (
                <div className="p-4 space-y-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <SkeletonBar key={i} isDark={isDark} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : transfers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <ArrowRightLeft className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                  <p className={`text-xs italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>No card transfers yet.</p>
                </div>
              ) : (
                <div className={isDark ? "divide-y divide-slate-800/50" : "divide-y divide-slate-200 bg-white"}>
                  {transfers.map((t) => {
                    const status = normalizeTransferStatus(t.status);
                    return (
                      <button
                        key={t.id}
                        onClick={() => setViewTransfer(t)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                          isDark ? "hover:bg-slate-800/30 active:bg-slate-800/50" : "hover:bg-slate-50 active:bg-slate-100"
                        }`}
                      >
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center border shrink-0 ${
                          isDark ? "bg-blue-950/40 border-blue-900 text-blue-400" : "bg-blue-50 border-blue-100 text-blue-600"
                        }`}>
                          <ArrowRightLeft className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold truncate ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                            {transferCardUid(t.source)} <span className="opacity-50">→</span> {transferCardUid(t.target)}
                          </p>
                          <p className={`text-[10px] mt-0.5 truncate ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                            {new Date(t.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-xs font-bold tabular-nums ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                            ₱{Math.abs(Number(t.amount)).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                          </p>
                          <Badge variant="outline" className={`mt-1 text-[9px] font-black uppercase capitalize ${transferStatusColorClasses(status, isDark)}`}>
                            {status}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : currentTxList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <List className={`h-7 w-7 ${isDark ? "text-slate-700" : "text-slate-300"}`} />
                <p className={`text-xs italic ${isDark ? "text-slate-600" : "text-slate-400"}`}>No transactions yet.</p>
              </div>
            ) : (
              <div className={isDark ? "divide-y divide-slate-800/50" : "divide-y divide-slate-200 bg-white"}>
                {currentTxList.map((tx) => (
                  <MobileTxRow key={tx.id} tx={tx} onClick={() => handleTxClick(tx)} isDark={isDark} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SETTINGS tab (mobile only) */}
        <div className={activeTab === "settings" ? "block md:hidden" : "hidden"}>
          <div className="space-y-3">


            {/* Profile Card */}
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
              {cardDataLoading ? (
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <SkeletonBar isDark={isDark} className="h-11 w-11 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <SkeletonBar isDark={isDark} className="h-3 w-32" />
                      <SkeletonBar isDark={isDark} className="h-2.5 w-40" />
                    </div>
                  </div>
                  <SkeletonRow isDark={isDark} />
                  <SkeletonRow isDark={isDark} />
                  <SkeletonRow isDark={isDark} />
                </div>
              ) : (
                <>
                  <div className={`flex items-center gap-3 px-4 py-4 border-b ${isDark ? "border-slate-800/60" : "border-slate-100"} ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                    <div className="h-11 w-11 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center shrink-0">
                      <span className={`font-black text-base tracking-tight ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                        {getInitials(isLinked ? (user?.fullName || "?") : "?")}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold leading-tight truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                        {isLinked ? (user?.fullName || "Not linked") : "—"}
                      </p>
                      <p className={`text-[11px] mt-0.5 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>{isLinked ? (displayEmail || "—") : "—"}</p>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        <Badge className={
                          isLinked && user?.status === "Active"
                            ? isDark
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-1.5 py-0 text-[9px]"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200 px-1.5 py-0 text-[9px]"
                            : isDark
                              ? "bg-red-500/10 text-red-400 border-red-500/20 px-1.5 py-0 text-[9px]"
                              : "bg-red-50 text-red-700 border-red-200 px-1.5 py-0 text-[9px]"
                        }>
                          <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />{isLinked ? (user?.status || "Inactive") : "—"}
                        </Badge>
                        <Badge variant="outline" className={`px-1.5 py-0 text-[9px] ${isDark ? "border-slate-700 text-slate-400" : "border-slate-300 text-slate-500"}`}>
                          {isLinked ? (user?.type || "Standard") : "—"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {[
                    { icon: <CreditCard className={`h-3.5 w-3.5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />, label: "UID", value: isLinked ? (user?.cardUid || "----") : "—", mono: true },
                    { icon: <Tag className={`h-3.5 w-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />, label: "Class", value: isLinked ? (user?.type || "General") : "—", mono: false },
                  ].map(({ icon, label, value, mono }) => (
                    <div key={label} className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? "border-slate-800/50" : "border-slate-100"} ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                      <div className="shrink-0 opacity-80">{icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[9px] font-bold uppercase tracking-widest leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>{label}</p>
                        <p className={`text-xs truncate ${isDark ? "text-slate-200" : "text-slate-700"} ${mono ? "font-mono" : "font-medium"}`}>{value}</p>
                      </div>
                    </div>
                  ))}

                  {/* ✅ Contact — editable (mobile), disabled until a card is linked */}
                  <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? "border-slate-800/50" : "border-slate-100"} ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                    <div className="shrink-0 opacity-80"><Phone className={`h-3.5 w-3.5 ${isDark ? "text-orange-400" : "text-orange-600"}`} /></div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[9px] font-bold uppercase tracking-widest leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Contact</p>
                      {editingContact ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="tel"
                            value={contactValue}
                            onChange={(e) => setContactValue(e.target.value)}
                            disabled={savingField === "contact"}
                            autoFocus
                            className={`text-xs rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                              isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                            }`}
                          />
                          <button
                            onClick={handleSaveContact}
                            disabled={savingField === "contact"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={cancelEditContact}
                            disabled={savingField === "contact"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs font-medium truncate ${isDark ? "text-slate-200" : "text-slate-700"}`}>{isLinked ? (displayContact || "None") : "—"}</p>
                          <button
                            onClick={startEditContact}
                            disabled={!isLinked}
                            className={`h-5 w-5 flex items-center justify-center rounded shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "text-slate-600 active:text-emerald-400" : "text-slate-400 active:text-emerald-600"
                            }`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ✅ Email — editable (mobile, auth_users), disabled until a card is linked */}
                  <div className={`flex items-center gap-3 px-4 py-3 ${!isLinked ? "opacity-40 grayscale" : ""}`}>
                    <div className="shrink-0 opacity-80"><Mail className={`h-3.5 w-3.5 ${isDark ? "text-sky-400" : "text-sky-600"}`} /></div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[9px] font-bold uppercase tracking-widest leading-none mb-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Email</p>
                      {editingEmail ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            type="email"
                            value={emailValue}
                            onChange={(e) => setEmailValue(e.target.value)}
                            disabled={savingField === "email"}
                            autoFocus
                            className={`text-xs rounded px-2 py-1 w-full min-w-0 focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
                              isDark ? "text-slate-200 bg-slate-950 border border-slate-700" : "text-slate-800 bg-white border border-slate-300"
                            }`}
                          />
                          <button
                            onClick={handleSaveEmail}
                            disabled={savingField === "email"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={cancelEditEmail}
                            disabled={savingField === "email"}
                            className={`h-6 w-6 flex items-center justify-center rounded shrink-0 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs truncate ${isDark ? "text-slate-200" : "text-slate-700"}`}>{isLinked ? (displayEmail || "Not linked") : "—"}</p>
                          <button
                            onClick={startEditEmail}
                            disabled={!isLinked}
                            className={`h-5 w-5 flex items-center justify-center rounded shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                              isDark ? "text-slate-600 active:text-emerald-400" : "text-slate-400 active:text-emerald-600"
                            }`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Account actions — always usable regardless of link status */}
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
              <p className={`px-4 pt-3 pb-1.5 text-[9px] font-black uppercase tracking-widest ${isDark ? "text-slate-600" : "text-slate-400"}`}>Account</p>

              {!isLinked && (
                <button onClick={() => linkCard.setIsOpen(true)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                    isDark ? "border-slate-800/50 hover:bg-emerald-500/5 active:bg-emerald-500/10" : "border-slate-100 hover:bg-emerald-50 active:bg-emerald-100"
                  }`}>
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <Link2 className={`h-3.5 w-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`text-xs font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>Link Card</p>
                    <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Connect a card to activate your account</p>
                  </div>
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
                </button>
              )}

              {isLinked && (
                <button onClick={() => setUnlinkConfirmOpen(true)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                    isDark ? "border-slate-800/50 hover:bg-red-500/5 active:bg-red-500/10" : "border-slate-100 hover:bg-red-50 active:bg-red-100"
                  }`}>
                  <div className="h-8 w-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                    <Unlink2 className={`h-3.5 w-3.5 ${isDark ? "text-red-400" : "text-red-600"}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`text-xs font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>Unlink Card</p>
                    <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Remove this card from your account</p>
                  </div>
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
                </button>
              )}

              <button onClick={toggleTheme}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                  isDark ? "border-slate-800/50 hover:bg-slate-800/30 active:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50 active:bg-slate-100"
                }`}>
                <div className="h-8 w-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  {isDark ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-amber-600" />}
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-xs font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                    {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Change app appearance</p>
                </div>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
              </button>

              <button onClick={changePassword.open}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b transition-colors cursor-pointer ${
                  isDark ? "border-slate-800/50 hover:bg-slate-800/30 active:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50 active:bg-slate-100"
                }`}>
                <div className="h-8 w-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <KeyRound className={`h-3.5 w-3.5 ${isDark ? "text-violet-400" : "text-violet-600"}`} />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-xs font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>Change Password</p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Update your account password</p>
                </div>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
              </button>
              <button onClick={requestLogout}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                  isDark ? "hover:bg-red-500/5 active:bg-red-500/10" : "hover:bg-red-50 active:bg-red-100"
                }`}>
                <div className="h-8 w-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                  <LogOut className={`h-3.5 w-3.5 ${isDark ? "text-red-400" : "text-red-600"}`} />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-xs font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>Logout</p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Sign out of your account</p>
                </div>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-slate-600" : "text-slate-300"}`} />
              </button>
            </div>

            <p className={`text-center text-[9px] font-mono uppercase tracking-widest pb-1 ${isDark ? "text-slate-700" : "text-slate-300"}`}>
              Fare Collection System &mdash; v1.0.0
            </p>
          </div>
        </div>

        {/* Footer (desktop only) */}
        <footer className={`hidden md:block border-t pt-4 pb-2 ${isDark ? "border-slate-800/60" : "border-slate-200"}`}>
          <div className={`flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest ${isDark ? "text-slate-700" : "text-slate-400"}`}>
            <span>Fare Collection System</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved. | v1.0.0</span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Nav */}
     <nav
  ref={navRef}
  className={`fixed bottom-0 left-0 right-0 z-20 flex md:hidden h-16 border-t transition-all duration-300 ${
    isDark ? "bg-[#020617] border-slate-800/60" : "bg-white border-slate-200"
  } ${
    linkCard.isOpen ? "opacity-0 pointer-events-none blur-sm" : "opacity-100"
  }`}
>
        {navItems.map(({ tab, icon, label }) => {
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => handleTabChange(tab)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 cursor-pointer ${
                isActive
                  ? isDark ? "text-emerald-400" : "text-emerald-600"
                  : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-400 hover:text-slate-600"
              }`}>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-emerald-400" />
              )}
              {icon}
              <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}