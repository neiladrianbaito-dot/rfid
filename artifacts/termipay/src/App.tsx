import React, { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import PaymongoTopup from "@/pages/Paymongo-Topup";
import PaymongoDashboardPage from "@/pages/user-dashboard";
import LoginPage from "@/pages/login";
import SigninPage from "@/pages/signin";
import SignupPage from "@/pages/signup";
import ResetPasswordPage from "@/pages/reset-password";
import DashboardPage from "@/pages/dashboard";
import CardRegistrationPage from "@/pages/card-registration";
import TransactionsPage from "@/pages/transactions";
import UserManagementPage from "@/pages/user-management";
import FareMatrixPage from "@/pages/fare-matrix";
import ReportsPage from "@/pages/reports";
import ReportPreviewPage from "@/pages/report-preview";
import Layout from "@/components/layout";
import { useAuth } from "@/hooks/use-auth";

const USER_AUTH_TOKEN_KEY = "termipay_user_auth_token";

function normalizeApiBaseUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

const baseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);
setBaseUrl(baseUrl);
setAuthTokenGetter(() => window.localStorage.getItem("termipay_auth_token"));

// ── Loading duration config ─────────────────────────────────────────────
const LOADING_DURATION_MS = 60_000; // exact 60 seconds — palitan dito kung iba
const FAST_FINISH_MS = 400;         // pag tapos na ang server, ganito katagal
                                     // ang "sprint" papuntang 100% (smooth,
                                     // hindi biglaang jump)
const CAP_WHILE_WAITING = 98;       // max % habang naghihintay pa sa server,
                                     // para laging may "room" papuntang 100%

function FullPageLoading({ isDone }: { isDone: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf: number;
    let startTime: number | null = null;
    let finishStartTime: number | null = null;
    let finishStartProgress = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;

      if (!isDone) {
        // ── Normal pacing: exact 60 seconds papunta 0% → 98% ────────────
        if (startTime === null) startTime = now;
        const elapsed = now - startTime;
        const pct = Math.min(
          CAP_WHILE_WAITING,
          (elapsed / LOADING_DURATION_MS) * 100
        );
        setProgress(pct);
      } else {
        // ── Server tapos na: i-sprint papuntang 100% sa loob ng
        //    FAST_FINISH_MS, smooth mula sa kasalukuyang % (di jarring) ──
        if (finishStartTime === null) {
          finishStartTime = now;
          setProgress(prev => {
            finishStartProgress = prev;
            return prev;
          });
        }
        const finishElapsed = now - finishStartTime;
        const finishPct = Math.min(1, finishElapsed / FAST_FINISH_MS);
        const pct =
          finishStartProgress + (100 - finishStartProgress) * finishPct;
        setProgress(pct);

        if (finishPct >= 1) return; // nasa 100% na, huminto
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [isDone]);

  const displayPct = Math.round(progress);

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background">
      <div className="w-64 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            TermiPay: Validating Session...
          </p>
          <span className="text-sm font-semibold tabular-nums text-primary">
            {displayPct}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Minimum display-time gate ────────────────────────────────────────────
// Pinipilit manatili sa loading screen ng EXACT na ibinigay na duration
// (default 60s), kahit matapos na agad ang aktwal na auth check. "isReady"
// ay nagiging true lang kapag (a) tapos na ang auth check AT (b) lumipas
// na ang minimum time — alin man ang matagal, hihintayin.
function useMinimumLoadingTime(actuallyDone: boolean, minMs: number = 60_000) {
  const [timeElapsed, setTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimeElapsed(true), minMs);
    return () => clearTimeout(timer);
  }, [minMs]);

  return actuallyDone && timeElapsed;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  const isReady = useMinimumLoadingTime(!isLoading, 60_000);

  if (!isReady) return <FullPageLoading isDone={false} />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const isReady = useMinimumLoadingTime(!isLoading, 60_000);

  if (!isReady) return <FullPageLoading isDone={false} />;
  if (isAuthenticated) return <Redirect to="/" />;

  return <LoginPage />;
}

function SigninRoute() {
  return <SigninPage />;
}

function PaymongoRoute() {
  const hasUserToken =
    typeof window !== "undefined" && !!window.localStorage.getItem(USER_AUTH_TOKEN_KEY);

  if (!hasUserToken) return <Redirect to="/signin" />;

  return <PaymongoDashboardPage />;
}

function AppRouter() {
  return (
    <Switch>
      {/* PUBLIC ROUTES */}
      <Route path="/login" component={LoginRoute} />
      <Route path="/signin" component={SigninRoute} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/paymongo-topup" component={PaymongoTopup} />
      <Route path="/user-dashboard" component={PaymongoRoute} />
      <Route path="/reports/preview" component={ReportPreviewPage} />

      {/* PROTECTED ROUTES */}
      <Route path="/">
        <ProtectedRoute component={DashboardPage} />
      </Route>
      <Route path="/card-registration">
        <ProtectedRoute component={CardRegistrationPage} />
      </Route>
      <Route path="/transactions">
        <ProtectedRoute component={TransactionsPage} />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={UserManagementPage} />
      </Route>
      <Route path="/fare-matrix">
        <ProtectedRoute component={FareMatrixPage} />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={ReportsPage} />
      </Route>

      {/* NOT FOUND */}
      <Route component={NotFound} />
    </Switch>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={(import.meta.env.BASE_URL || "").replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;