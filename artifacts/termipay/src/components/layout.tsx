import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  CreditCard,
  ArrowLeftRight,
  Users,
  Map,
  FileBarChart,
  LogOut,
  Menu,
  X,
  User,
  Lock,
  Loader2,
  Cpu,
  ShieldCheck,
  Clock,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/hooks/use-theme";

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/card-registration", label: "Card Registration", icon: CreditCard },
  { path: "/transactions", label: "Transaction Logs", icon: ArrowLeftRight },
  { path: "/users", label: "User Management", icon: Users },
  { path: "/fare-matrix", label: "Fare Matrix", icon: Map },
  { path: "/reports", label: "Reports", icon: FileBarChart },
];

function CurrentDateTime({ isDark }: { isDark: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 border rounded-md font-mono text-[11px] transition-colors ${
        isDark ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-600"
      }`}
    >
      <Clock size={12} className="text-blue-500" />
      <span>
        {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </span>
      <span className={isDark ? "text-slate-700" : "text-slate-300"}>|</span>
      <span>{now.toLocaleTimeString("en-US", { hour12: false })}</span>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoggingOut, refetchUser } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const { isDark, toggleTheme } = useTheme();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const [isUpdating, setIsUpdating] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || "",
    currentPassword: "",
    newPassword: "",
  });

  useEffect(() => {
    if (profileModalOpen) {
      setFormData({
        name: user?.name || "",
        currentPassword: "",
        newPassword: "",
      });
    }
  }, [profileModalOpen, user]);

  const handleSaveChanges = async () => {
    const wantsPasswordChange = formData.newPassword.trim().length > 0;
    const wantsNameChange = formData.name.trim() !== (user?.name || "").trim();

    if (!wantsNameChange && !wantsPasswordChange) {
      toast({
        title: "No Changes Detected",
        description: "No changes detected in your profile.",
        variant: "destructive",
      });
      return;
    }

    if (wantsPasswordChange && !formData.currentPassword.trim()) {
      toast({
        title: "Security Check",
        description: "Please enter your Current Password to authorize the password change.",
        variant: "destructive",
      });
      return;
    }

    if (wantsPasswordChange && formData.newPassword.trim() === formData.currentPassword.trim()) {
      toast({
        title: "Invalid Password",
        description: "Your new password must be different from your current password.",
        variant: "destructive",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const supabaseSession = sessionData.session;

      if (supabaseSession?.user) {
        if (wantsPasswordChange) {
          if (!supabaseSession.user.email) {
            throw new Error("Cannot update password for this account");
          }
          const { error: verifyError } = await supabase.auth.signInWithPassword({
            email: supabaseSession.user.email,
            password: formData.currentPassword,
          });
          if (verifyError) throw new Error("Incorrect current password. Please try again.");
        }

        const payload: any = {};

        if (wantsNameChange) {
          payload.data = {
            full_name: formData.name.trim(),
            name: formData.name.trim(),
          };
        }

        if (wantsPasswordChange) {
          payload.password = formData.newPassword.trim();
        }

        const { error: updateError } = await supabase.auth.updateUser(payload);
        if (updateError) throw new Error(updateError.message);

        await refetchUser();
        toast({ title: "Success", description: "Profile updated successfully." });
        setProfileModalOpen(false);
        return;
      }

      // Legacy path (non-Supabase)
      const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);
      const token = window.localStorage.getItem("termipay_auth_token");
      const response = await fetch(`${apiBaseUrl}/api/auth/update-profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update profile");

      if (data?.token) window.localStorage.setItem("termipay_auth_token", data.token);
      await refetchUser();
      setProfileModalOpen(false);
      toast({ title: "Success", description: "Profile updated successfully." });
    } catch (error: any) {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      className={`flex h-screen overflow-hidden font-sans ${
        isDark ? "bg-slate-950 text-slate-200" : "bg-slate-50 text-slate-800"
      }`}
    >
      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 border-r print:hidden
          transform transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}
          ${isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className={`p-6 border-b transition-colors ${isDark ? "border-slate-800" : "border-slate-200"}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm shrink-0">
                <img
                  src="/calbayog.png"
                  alt="Calbayog Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h1 className={`text-sm font-bold tracking-tight transition-colors ${isDark ? "text-white" : "text-slate-900"}`}>
                  Fare Collection<span className="text-blue-500"> System</span>
                </h1>
                <p className={`text-[10px] font-semibold uppercase tracking-widest leading-tight transition-colors ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Admin Console
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              const Icon = item.icon;
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      group flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer
                      transition-all duration-150
                      ${isActive
                        ? isDark
                          ? "bg-blue-950/50 text-blue-400"
                          : "bg-blue-50 text-blue-700"
                        : isDark
                          ? "text-slate-400 hover:text-white hover:bg-slate-900"
                          : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                      }
                    `}
                  >
                    <Icon
                      size={17}
                      className={
                        isActive
                          ? "text-blue-500"
                          : isDark
                            ? "text-slate-600 group-hover:text-slate-300"
                            : "text-slate-400 group-hover:text-slate-600"
                      }
                    />
                    {item.label}
                    {isActive && (
                      <motion.div layoutId="activeNav" className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* User Section at bottom of Sidebar */}
          <div className={`p-4 border-t transition-colors ${isDark ? "border-slate-800" : "border-slate-200"}`}>
            <Button
              variant="ghost"
              onClick={logout}
              disabled={isLoggingOut}
              className={`w-full justify-start gap-3 rounded-lg text-sm font-medium ${
                isDark
                  ? "text-slate-400 hover:text-red-400 hover:bg-red-950/30"
                  : "text-slate-500 hover:text-red-600 hover:bg-red-50"
              }`}
            >
              <LogOut size={17} />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className={`h-16 border-b flex items-center justify-between px-6 shrink-0 z-30 print:hidden transition-colors ${
            isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"
          }`}
        >
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className={isDark ? "lg:hidden text-slate-400 hover:text-white" : "lg:hidden text-slate-500 hover:text-slate-900"}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </Button>
            <CurrentDateTime isDark={isDark} />
          </div>

          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="button-theme-toggle"
              className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                isDark
                  ? "bg-slate-900 border-slate-800 text-blue-400 hover:border-blue-600"
                  : "bg-white border-slate-200 text-blue-600 hover:border-blue-400"
              }`}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="text-right hidden sm:block">
              <p className={`text-[10px] font-semibold uppercase tracking-widest transition-colors ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Super Admin
              </p>
              <p className={`text-sm font-semibold transition-colors ${isDark ? "text-slate-100" : "text-slate-800"}`}>
                {user?.name || "Admin_User"}
              </p>
            </div>

            <Dialog open={profileModalOpen} onOpenChange={setProfileModalOpen}>
              <DialogTrigger asChild>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer overflow-hidden group transition-colors ${
                    isDark
                      ? "bg-blue-950/40 border-blue-900 hover:border-blue-600"
                      : "bg-blue-50 border-blue-100 hover:border-blue-300"
                  }`}
                >
                  <span className={`font-bold text-sm transition-colors ${isDark ? "text-blue-400 group-hover:text-blue-300" : "text-blue-600 group-hover:text-blue-700"}`}>
                    {user?.name ? user.name.trim().charAt(0).toUpperCase() : "A"}
                  </span>
                </motion.div>
              </DialogTrigger>

              <DialogContent
                className={`sm:max-w-[425px] transition-colors ${
                  isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"
                }`}
              >
                <div className="absolute top-0 left-0 w-full h-[3px] bg-blue-600 rounded-t-lg" />
                <DialogHeader>
                  <DialogTitle className={`font-bold tracking-tight transition-colors ${isDark ? "text-white" : "text-slate-900"}`}>
                    Security & Profile
                  </DialogTitle>
                  <VisuallyHidden>
                    <DialogDescription>
                      Update your display name or change your account password.
                    </DialogDescription>
                  </VisuallyHidden>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                  <div className="space-y-2">
                    <Label className={`text-xs uppercase tracking-wide font-semibold transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      Full Name
                    </Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className={`focus:border-blue-500 focus-visible:ring-blue-500 transition-colors ${
                        isDark ? "bg-slate-900 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    />
                  </div>
                  <div
                    className={`p-4 rounded-xl border space-y-4 transition-colors ${
                      isDark ? "bg-blue-950/20 border-blue-900" : "bg-blue-50/60 border-blue-100"
                    }`}
                  >
                    <div className={`flex items-center gap-2 ${isDark ? "text-blue-400" : "text-blue-700"}`}>
                      <ShieldCheck size={14} />
                      <span className="text-xs font-semibold uppercase tracking-wide">Authentication Update</span>
                    </div>
                    <p className={`text-xs leading-relaxed transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      To change your password, fill in both fields below. To update your name only, leave the password fields blank.
                    </p>
                    <div className="space-y-2">
                      <Label className={`text-xs font-medium transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Current Password
                      </Label>
                      <Input
                        type="password"
                        placeholder="Required if changing password"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                        className={`h-9 transition-colors ${
                          isDark
                            ? "bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                            : "bg-white border-slate-200 placeholder:text-slate-400"
                        }`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className={`text-xs font-medium transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        New Password
                      </Label>
                      <Input
                        type="password"
                        placeholder="Leave blank if not changing password"
                        value={formData.newPassword}
                        onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                        className={`h-9 transition-colors ${
                          isDark
                            ? "bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                            : "bg-white border-slate-200 placeholder:text-slate-400"
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setProfileModalOpen(false)}
                    className={`font-medium ${isDark ? "text-slate-400 hover:text-slate-200" : "text-slate-500"}`}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveChanges}
                    disabled={isUpdating}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6"
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Main Content Area */}
        <main className={`flex-1 overflow-auto p-6 relative print:p-0 ${isDark ? "bg-slate-950" : "bg-slate-50"}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>

          {/* Footer */}
          <footer className={`mt-10 border-t pt-4 pb-1 print:hidden transition-colors ${isDark ? "border-slate-800" : "border-slate-200"}`}>
            <div className={`flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] transition-colors ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <div className="flex items-center gap-2">
                <Cpu size={11} className={isDark ? "text-slate-600" : "text-slate-300"} />
                <span>Fare Collection System — Admin Console</span>
              </div>
              <div className="flex items-center gap-3">
                <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
                <span className={isDark ? "text-slate-700" : "text-slate-200"}>|</span>
                <span className={isDark ? "text-slate-500" : "text-slate-400"}>v1.0.0</span>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}