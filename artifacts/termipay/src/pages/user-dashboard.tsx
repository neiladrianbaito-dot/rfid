import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Wallet, User, Phone, Tag, ShieldCheck,
  LogOut, PlusCircle, KeyRound, CreditCard, Mail, Home, Settings,
  ChevronRight, ArrowDownLeft, ArrowUpRight, List,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCardData } from "@/hooks/use-card-data";
import { useChangePassword } from "@/hooks/use-change-password";
import { useLinkCard } from "@/hooks/use-link-card";
import { useTopup } from "@/hooks/use-topup";
import { LinkCardModal } from "@/components/link-card-modal";
import { TopupModal } from "@/components/topup-modal";
import { ChangePasswordModal } from "@/components/change-password-modal";
import { getSignedInUser, cleanCardUid, USER_AUTH_TOKEN_KEY } from "@/lib/api";
import { TransactionDetailModal, type Transaction, type FareRoute } from "@/components/transaction-detail-modal";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
import { supabase } from "@/lib/supabase";

function formatAmount(type: string, amount: number | string): string {
  const sign = type === "Fare" ? "-" : "+";
  const num = Math.abs(Number(amount || 0)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}\u20B1${num}`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

function MobileTxRow({ tx, onClick }: { tx: Transaction; onClick: () => void }) {
  const isFare = tx.type === "Fare";
  const date = new Date(tx.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 active:bg-slate-800/40 transition-colors text-left"
    >
      <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
        isFare ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20"
      }`}>
        {isFare
          ? <ArrowUpRight className="h-3.5 w-3.5 text-red-400" />
          : <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-100 leading-tight">{tx.type}</p>
        <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{dateStr} · {timeStr}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-xs font-bold tabular-nums ${isFare ? "text-red-400" : "text-emerald-400"}`}>
          {formatAmount(tx.type, tx.amount)}
        </p>
        <p className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${
          tx.status === "Success" ? "text-emerald-500/70" : "text-red-500/70"
        }`}>
          {tx.status}
        </p>
      </div>
    </button>
  );
}

type Tab = "home" | "Transactions" | "settings";

export default function PaymongoDashboardPage() {
  const [, setLocation] = useLocation();
  const [cardUid, setCardUid] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [routes, setRoutes] = useState<FareRoute[]>([]);

  const { user, transactions, loading, error, lastUpdated, isPulsing } = useCardData(cardUid);
  const currentBalance = Number(user?.balance || 0);

  const linkCard = useLinkCard((uid) => setCardUid(uid));
  const topup = useTopup(cardUid, currentBalance);
  const changePassword = useChangePassword();

  const remainingTopup = Math.max(0, 20000 - currentBalance);
  const isAtMaxBalance = remainingTopup <= 0;

  useEffect(() => {
    const loadRoutes = async () => {
      const { data, error } = await supabase
        .from("fare_routes")
        .select("id, origin, destination, fare_amount, is_active")
        .order("id");
      if (!error && data) {
        setRoutes(data.map((r: any) => ({
          id: r.id,
          origin: r.origin,
          destination: r.destination,
          fareAmount: r.fare_amount,
          isActive: r.is_active,
        })));
      }
    };
    loadRoutes();
    const channel = supabase
      .channel("fare_routes_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fare_routes" }, () => loadRoutes())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (activeTab !== "Transactions") setSelectedTx(null);
  }, [activeTab]);

  useEffect(() => {
    const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);
    if (!token) { setLocation("/signin"); return; }
    void (async () => {
      try {
        const profile = await getSignedInUser();
        const linkedUid = cleanCardUid(profile?.user?.linkedCardUid || "");
        if (linkedUid) { setCardUid(linkedUid); } else { linkCard.setIsOpen(true); }
      } catch {
        window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
        setLocation("/signin");
      }
    })();
  }, []);

  const handleLogout = () => {
    window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
    setLocation("/signin");
  };

  const balanceText = useMemo(() => {
    return `\u20B1${Number(user?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }, [user?.balance]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSelectedTx(null);
  };

  const navItems: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: "home", icon: <Home className="h-5 w-5" />, label: "Home" },
    { tab: "Transactions", icon: <List className="h-5 w-5" />, label: "Transactions" },
    { tab: "settings", icon: <Settings className="h-5 w-5" />, label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100">
      {linkCard.isOpen && <LinkCardModal {...linkCard} />}
      <TopupModal {...topup} cardUid={cardUid} currentBalance={currentBalance} />
      <ChangePasswordModal {...changePassword} />
      <TransactionDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} routes={routes} />
      <style>{DASHBOARD_STYLES}</style>

      {/* STICKY HEADER */}
      <div className="sticky top-0 z-40 w-full bg-[#020617]/95 backdrop-blur-md border-b border-slate-800">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-emerald-500/10 rounded-xl">
              <Wallet className="h-6 w-6 text-emerald-400" />
            </div>
            <h1 className="text-base font-bold tracking-tight text-white leading-none">
              Fare Collection System
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <Button variant="ghost" onClick={changePassword.open}
              className="text-slate-400 hover:text-violet-400 hover:bg-violet-400/10 gap-2 text-sm">
              <KeyRound className="h-4 w-4" /><span>Change Password</span>
            </Button>
            <Button variant="ghost" onClick={handleLogout}
              className="text-slate-400 hover:text-red-400 hover:bg-red-400/10 gap-2 text-sm">
              <LogOut className="h-4 w-4" /><span>Logout</span>
            </Button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE CONTENT — pb-20 ensures content clears the 64px nav */}
      <div className={`mx-auto w-full max-w-6xl px-3 sm:px-8 pb-20 md:pb-8 pt-4 space-y-4 dashboard-content ${
        linkCard.isOpen ? "is-obscured" : ""
      }`}>
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            Warning: {error}
          </div>
        )}

        {/* ── HOME tab ── */}
        <div className={activeTab === "home" ? "block" : "hidden md:block"}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-1 md:col-span-3">
              <p className="text-xl font-bold text-white">
                Welcome back,{" "}
                <span className="text-emerald-400">{user?.fullName?.split(" ")[0] || "User"}</span> 👋
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">Here's your account overview.</p>
            </div>

            {/* Balance Card */}
            <Card className="md:col-span-1 border-slate-800 bg-slate-900/40 backdrop-blur-md border-t-emerald-500/50 border-t-2">
              <CardContent className="pt-4 pb-4 px-4">
                <div className="flex justify-between items-start mb-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Available Balance</p>
                  <Button size="sm" variant="outline" onClick={() => topup.setIsOpen(true)}
                    className="h-6 text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white px-2">
                    <PlusCircle className="h-3 w-3 mr-1" /> TOP UP
                  </Button>
                </div>
                <h2 className={`text-4xl font-black text-white tracking-tighter ${isPulsing ? "balance-pulse" : ""}`}>
                  {balanceText}
                </h2>
                <div className="mt-2 space-y-1">
                  <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                    <div
                      className={`h-1 rounded-full transition-all ${
                        isAtMaxBalance ? "bg-red-500" : currentBalance / 20000 >= 0.8 ? "bg-amber-400" : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min((currentBalance / 20000) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-slate-600 font-mono">
                    {isAtMaxBalance ? (
                      <span className="text-red-400/70">Max balance reached</span>
                    ) : (
                      <>\u20B1{remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })} remaining</>
                    )}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className={user?.status === "Active"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-2 py-0.5 text-[10px]"
                    : "bg-red-500/10 text-red-400 border-red-500/20 px-2 py-0.5 text-[10px]"}>
                    <ShieldCheck className="h-3 w-3 mr-1" />{user?.status || "Inactive"}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-400 px-2 py-0.5 text-[10px]">
                    {user?.type || "Standard User"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Profile Card — desktop only */}
            <Card className="hidden md:block md:col-span-2 border-slate-800 bg-slate-900/40 backdrop-blur-md">
              <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                {[
                  { icon: <User className="h-4 w-4 text-blue-400" />, bg: "bg-blue-500/10 border-blue-500/20", label: "Name", value: user?.fullName || "Not Linked" },
                  { icon: <CreditCard className="h-4 w-4 text-purple-400" />, bg: "bg-purple-500/10 border-purple-500/20", label: "UID", value: user?.cardUid || "----", mono: true },
                  { icon: <Phone className="h-4 w-4 text-orange-400" />, bg: "bg-orange-500/10 border-orange-500/20", label: "Contact", value: user?.contactNumber || "None" },
                  { icon: <Tag className="h-4 w-4 text-emerald-400" />, bg: "bg-emerald-500/10 border-emerald-500/20", label: "Class", value: user?.type || "General" },
                ].map(({ icon, bg, label, value, mono }) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center border ${bg}`}>{icon}</div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-0.5">{label}</p>
                      <p className={`text-sm font-semibold text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-3 sm:col-span-2">
                  <div className="h-9 w-9 rounded-full bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
                    <Mail className="h-4 w-4 text-sky-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500 leading-none mb-0.5">Email</p>
                    <p className="text-sm text-slate-200">{user?.email || "Not linked"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── TRANSACTIONS — Desktop ── */}
        <div className="hidden md:block">
          <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md overflow-hidden">
            <CardHeader className="bg-slate-900/20 border-b border-slate-800 py-3">
              <CardTitle className="text-xs font-bold flex items-center gap-2 text-slate-400 uppercase tracking-widest">
                <List className="h-4 w-4 text-blue-400" />Transactions History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <p className="px-4 pt-2 pb-1 text-[10px] text-slate-600 italic">Tap a row to view transaction details.</p>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-left table-fixed">
                  <colgroup>
                    <col style={{ width: "30%" }} /><col style={{ width: "18%" }} />
                    <col style={{ width: "30%" }} /><col style={{ width: "22%" }} />
                  </colgroup>
                  <thead className="bg-slate-950/50">
                    <tr>
                      {(["Timestamp", "Service", "Amount", "Result"] as const).map((h, i) => (
                        <th key={h} className={`px-3 py-2.5 text-[9px] font-black uppercase text-slate-500 whitespace-nowrap ${
                          i === 2 ? "text-right" : i === 3 ? "text-center" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {transactions.length === 0 ? (
                      <tr><td className="p-12 text-center text-slate-600 text-sm italic" colSpan={4}>No activity recorded.</td></tr>
                    ) : transactions.map((tx) => (
                      <tr key={tx.id} onClick={() => setSelectedTx(tx)}
                        className="hover:bg-slate-800/30 active:bg-slate-800/50 transition-colors cursor-pointer">
                        <td className="px-3 py-2.5">
                          <p className="text-[10px] text-slate-300 font-medium leading-tight whitespace-nowrap">
                            {new Date(tx.timestamp).toLocaleDateString()}
                          </p>
                          <p className="text-[9px] text-slate-500 font-mono leading-tight whitespace-nowrap">
                            {new Date(tx.timestamp).toLocaleTimeString()}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-semibold text-slate-200 uppercase whitespace-nowrap">{tx.type}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`whitespace-nowrap tabular-nums text-[11px] font-bold ${
                            tx.type === "Fare" ? "text-red-400" : "text-emerald-400"}`}>
                            {formatAmount(tx.type, tx.amount)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge variant="outline" className={`text-[9px] font-black tracking-widest uppercase py-0 whitespace-nowrap ${
                            tx.status === "Success"
                              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                              : "text-red-400 border-red-500/30 bg-red-500/5"}`}>
                            {tx.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── TRANSACTIONS — Mobile ── */}
        <div className={activeTab === "Transactions" ? "block md:hidden" : "hidden"}>
          <p className="text-sm font-bold text-white mb-1 px-1">Transactions History</p>
          {transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <List className="h-7 w-7 text-slate-700" />
              <p className="text-slate-600 text-xs italic">No transactions yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50 -mx-3">
              {transactions.map((tx) => (
                <MobileTxRow key={tx.id} tx={tx} onClick={() => setSelectedTx(tx)} />
              ))}
            </div>
          )}
        </div>

        {/* ── SETTINGS tab (mobile only) ── */}
        <div className={activeTab === "settings" ? "block md:hidden" : "hidden"}>
          <div className="space-y-3">

            {/* Profile Card */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              {/* Avatar row */}
              <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-800/60">
                <div className="h-11 w-11 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center shrink-0">
                  <span className="text-emerald-400 font-black text-base tracking-tight">
                    {getInitials(user?.fullName || "?")}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white leading-tight truncate">
                    {user?.fullName || "Not linked"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">{user?.email || "—"}</p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    <Badge className={user?.status === "Active"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-1.5 py-0 text-[9px]"
                      : "bg-red-500/10 text-red-400 border-red-500/20 px-1.5 py-0 text-[9px]"}>
                      <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />{user?.status || "Inactive"}
                    </Badge>
                    <Badge variant="outline" className="border-slate-700 text-slate-400 px-1.5 py-0 text-[9px]">
                      {user?.type || "Standard"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Info rows */}
              {[
                { icon: <CreditCard className="h-3.5 w-3.5 text-purple-400" />, label: "UID", value: user?.cardUid || "----", mono: true },
                { icon: <Phone className="h-3.5 w-3.5 text-orange-400" />, label: "Contact", value: user?.contactNumber || "None", mono: false },
                { icon: <Tag className="h-3.5 w-3.5 text-emerald-400" />, label: "Class", value: user?.type || "General", mono: false },
                { icon: <Mail className="h-3.5 w-3.5 text-sky-400" />, label: "Email", value: user?.email || "Not linked", mono: false },
              ].map(({ icon, label, value, mono }, i, arr) => (
                <div key={label} className={`flex items-center gap-3 px-4 py-3 ${i < arr.length - 1 ? "border-b border-slate-800/50" : ""}`}>
                  <div className="shrink-0 opacity-80">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 leading-none mb-0.5">{label}</p>
                    <p className={`text-xs text-slate-200 truncate ${mono ? "font-mono" : "font-medium"}`}>{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Account actions */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              <p className="px-4 pt-3 pb-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600">Account</p>
              <button onClick={changePassword.open}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/30 active:bg-slate-800/50 transition-colors">
                <div className="h-8 w-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <KeyRound className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-slate-200">Change Password</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Update your account password</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              </button>
              <button onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/5 active:bg-red-500/10 transition-colors">
                <div className="h-8 w-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                  <LogOut className="h-3.5 w-3.5 text-red-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-red-400">Logout</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Sign out of your account</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              </button>
            </div>

            <p className="text-center text-[9px] font-mono uppercase tracking-widest text-slate-700 pb-1">
              Fare Collection System &mdash; v1.0.0
            </p>
          </div>
        </div>

        {/* ── Footer (desktop only) ── */}
        <footer className="hidden md:block border-t border-slate-800/60 pt-4 pb-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-700">
            <span>Fare Collection System</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved. | v1.0.0</span>
          </div>
        </footer>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <nav className={`fixed bottom-0 left-0 right-0 z-20 flex md:hidden h-16 bg-[#0a0f1e]/95 backdrop-blur-md border-t border-slate-800/60 transition-all duration-300 ${
        linkCard.isOpen ? "opacity-0 pointer-events-none blur-sm" : "opacity-100"
      }`}>
        {navItems.map(({ tab, icon, label }) => {
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => handleTabChange(tab)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 ${
                isActive ? "text-emerald-400" : "text-slate-600 hover:text-slate-400"
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