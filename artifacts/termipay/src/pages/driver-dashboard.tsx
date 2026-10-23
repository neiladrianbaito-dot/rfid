import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Bus,
  LogOut,
  Sun,
  Moon,
  Wallet,
  Users,
  Route,
  QrCode,
  Home,
  History,
  UserRound,
  CheckCircle2,
} from "lucide-react";
import { useAuthTheme } from "@/lib/auth-theme";

const DRIVER_TOKEN_KEY = "termipay_driver_auth_token";
const AUTH_ROLE_KEY = "termipay_auth_role";

type Tab = "home" | "trips" | "profile";

/* Sample data lang ito para sa testing. Palitan ng real API later. */
const SAMPLE_TRIPS = [
  { id: 1, route: "Terminal → Rawis", time: "7:42 AM", passengers: 14, fare: 168 },
  { id: 2, route: "Rawis → Terminal", time: "8:25 AM", passengers: 11, fare: 132 },
  { id: 3, route: "Terminal → Trinidad", time: "9:10 AM", passengers: 16, fare: 224 },
];

export default function DriverDashboardPage() {
  const [, setLocation] = useLocation();
  const { isDark, toggleTheme } = useAuthTheme();

  const [authorized, setAuthorized] = useState(false);
  const [online, setOnline] = useState(false);
  const [tab, setTab] = useState<Tab>("home");

  /* Guard: kung walang driver token, balik sa signin */
  useEffect(() => {
    const token = window.localStorage.getItem(DRIVER_TOKEN_KEY);
    if (!token) {
      setLocation("/signin");
      return;
    }
    setAuthorized(true);
  }, [setLocation]);

  function handleSignOut() {
    window.localStorage.removeItem(DRIVER_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_ROLE_KEY);
    setLocation("/signin");
  }

  if (!authorized) return null;

  const totalFare = SAMPLE_TRIPS.reduce((sum, t) => sum + t.fare, 0);
  const totalPassengers = SAMPLE_TRIPS.reduce((sum, t) => sum + t.passengers, 0);

  const page = isDark ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-900";
  const card = isDark
    ? "bg-slate-900/70 border-slate-800"
    : "bg-white border-slate-200 shadow-sm";
  const muted = isDark ? "text-slate-400" : "text-slate-500";

  const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "trips", label: "Trips", icon: History },
    { id: "profile", label: "Profile", icon: UserRound },
  ];

  return (
    <div className={`min-h-[100dvh] flex flex-col ${page}`}>
      {/* Top bar */}
      <header
        className={`sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b backdrop-blur-md ${
          isDark
            ? "bg-slate-950/80 border-slate-800"
            : "bg-white/80 border-slate-200"
        }`}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Bus className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">Driver Console</p>
            <p className={`text-[11px] ${muted}`}>Digital Transit Network</p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className={`w-9 h-9 rounded-full border-2 flex items-center justify-center ${
            isDark
              ? "border-slate-700 text-blue-300"
              : "border-slate-200 text-blue-600"
          }`}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-4 py-5 pb-28 space-y-4">
        {/* Redirect test confirmation */}
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            isDark
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-emerald-50 border-emerald-200 text-emerald-700"
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Redirect works. You are signed in as a driver.
        </div>

        {tab === "home" && (
          <>
            {/* Duty toggle */}
            <section className={`rounded-xl border p-4 ${card}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-bold">
                    {online ? "You are on duty" : "You are off duty"}
                  </h1>
                  <p className={`text-xs mt-0.5 ${muted}`}>
                    {online
                      ? "Commuters can pay your fare by QR."
                      : "Go on duty to start collecting fares."}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={online}
                  aria-label="Toggle duty status"
                  onClick={() => setOnline((v) => !v)}
                  className={`relative h-8 w-14 rounded-full transition-colors ${
                    online
                      ? "bg-emerald-500"
                      : isDark
                      ? "bg-slate-700"
                      : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                      online ? "translate-x-6" : ""
                    }`}
                  />
                </button>
              </div>
            </section>

            {/* Stats */}
            <section className="grid grid-cols-3 gap-3">
              {[
                { label: "Earned today", value: `₱${totalFare}`, icon: Wallet },
                { label: "Passengers", value: String(totalPassengers), icon: Users },
                { label: "Trips", value: String(SAMPLE_TRIPS.length), icon: Route },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className={`rounded-xl border p-3 ${card}`}>
                  <Icon className="h-4 w-4 text-blue-500 mb-2" />
                  <p className="text-lg font-bold leading-none">{value}</p>
                  <p className={`text-[11px] mt-1 ${muted}`}>{label}</p>
                </div>
              ))}
            </section>

            {/* Collect fare */}
            <Button
              type="button"
              disabled={!online}
              className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2"
            >
              <QrCode className="h-5 w-5" />
              Show my fare QR
            </Button>
          </>
        )}

        {tab === "trips" && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Today's trips</h2>
            {SAMPLE_TRIPS.map((t) => (
              <div
                key={t.id}
                className={`rounded-xl border p-4 flex items-center justify-between ${card}`}
              >
                <div>
                  <p className="text-sm font-semibold">{t.route}</p>
                  <p className={`text-xs mt-0.5 ${muted}`}>
                    {t.time}, {t.passengers} passengers
                  </p>
                </div>
                <p className="text-sm font-bold text-emerald-500">₱{t.fare}</p>
              </div>
            ))}
            <p className={`text-[11px] ${muted}`}>
              Sample data. Connect this list to your trips API.
            </p>
          </section>
        )}

        {tab === "profile" && (
          <section className={`rounded-xl border p-4 space-y-4 ${card}`}>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
                <UserRound className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="font-bold">Driver account</p>
                <p className={`text-xs ${muted}`}>Role: driver</p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleSignOut}
              className={`w-full h-11 gap-2 ${
                isDark
                  ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                  : "border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </section>
        )}
      </main>

      {/* Bottom nav (app-style) */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-20 border-t backdrop-blur-md ${
          isDark
            ? "bg-slate-950/90 border-slate-800"
            : "bg-white/90 border-slate-200"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-md mx-auto grid grid-cols-3">
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${
                  active ? "text-blue-500" : muted
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}