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

function FullPageLoading({ isDone }: { isDone: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (isDone) return 100;
        if (prev >= 90) return prev;
        return Math.min(90, prev + 3);
      });
    }, 50);
    return () => clearInterval(interval);
  }, [isDone]);

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background">
      <div className="w-64 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            TermiPay: Validating Session...
          </p>
          <span className="text-sm font-semibold tabular-nums text-primary">
            {progress}%
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

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullPageLoading isDone={false} />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullPageLoading isDone={false} />;
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