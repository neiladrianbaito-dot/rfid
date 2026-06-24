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

function CurrentDateTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/50 border border-slate-800 rounded-md font-mono text-[10px] text-blue-400">
      <Clock size={12} className="text-blue-500" />
      <span>
        {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </span>
      <span className="text-blue-500/50">|</span>
      <span>{now.toLocaleTimeString("en-US", { hour12: false })}</span>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoggingOut, refetchUser } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();

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
    <div className="flex h-screen bg-[#020617] text-slate-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 bg-slate-950/80 border-r border-slate-800 backdrop-blur-xl print:hidden
          transform transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0 shadow-[20px_0_50px_rgba(0,0,0,0.5)]" : "-translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className="p-6 border-b border-slate-900">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.4)] border border-blue-400/50">
                <Cpu className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-black text-white tracking-tighter uppercase italic">
                  Fare Collection<span className="text-blue-500"> System</span>
                </h1>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-tight">
                  Admin Console
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              const Icon = item.icon;
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      group flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer
                      transition-all duration-200 border
                      ${isActive
                        ? "bg-blue-600/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                        : "border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-900/50 hover:border-slate-800"
                      }
                    `}
                  >
                    <Icon size={16} className={isActive ? "text-blue-400" : "text-slate-600 group-hover:text-slate-400"} />
                    {item.label}
                    {isActive && (
                      <motion.div layoutId="activeNav" className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* User Section at bottom of Sidebar */}
          <div className="p-4 border-t border-slate-900 bg-slate-950/40">
            <Button
              variant="ghost"
              onClick={logout}
              disabled={isLoggingOut}
              className="w-full justify-start gap-3 text-slate-500 hover:text-red-400 hover:bg-red-500/5 rounded-xl uppercase text-[10px] font-black tracking-widest"
            >
              <LogOut size={16} />
              Terminate Session
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
            className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-slate-900 bg-slate-950/50 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-30 print:hidden">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-slate-400 hover:text-white"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </Button>
            <CurrentDateTime />
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Super Admin
              </p>
              <p className="text-xs font-bold text-white tracking-tight">
                {user?.name || "Admin_User"}
              </p>
            </div>

            <Dialog open={profileModalOpen} onOpenChange={setProfileModalOpen}>
              <DialogTrigger asChild>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center cursor-pointer overflow-hidden shadow-inner group hover:border-blue-500/50 transition-colors"
                >
                  <span className="text-blue-500 font-black text-sm group-hover:text-blue-400 transition-colors">
                    {user?.name ? user.name.trim().charAt(0).toUpperCase() : "A"}
                  </span>
                </motion.div>
              </DialogTrigger>

              {/* ✅ FIX: Added DialogDescription wrapped in VisuallyHidden to silence the Radix warning */}
              <DialogContent className="sm:max-w-[425px] bg-slate-950 border-slate-800 text-slate-200">
                <div className="absolute top-0 left-0 w-full h-[2px] bg-blue-600/50" />
                <DialogHeader>
                  <DialogTitle className="text-white font-black uppercase tracking-tighter italic">
                    Security & Profile
                  </DialogTitle>
                  <VisuallyHidden>
                    <DialogDescription>
                      Update your display name or change your account password.
                    </DialogDescription>
                  </VisuallyHidden>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                  <div className="space-y-4">
                    <Label className="text-[10px] uppercase tracking-widest text-slate-500 font-black">Full Name</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="bg-slate-900 border-slate-800 text-white focus:border-blue-500"
                    />
                  </div>
                  <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 space-y-4">
                    <div className="flex items-center gap-2 text-blue-400">
                      <ShieldCheck size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Authentication Update</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      To change your password, fill in both fields below. To update your name only, leave the password fields blank.
                    </p>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase text-slate-400">Current Password</Label>
                      <Input
                        type="password"
                        placeholder="Required if changing password"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                        className="bg-slate-950 border-slate-800 h-9 placeholder:text-slate-700"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase text-slate-400">New Password</Label>
                      <Input
                        type="password"
                        placeholder="Leave blank if not changing password"
                        value={formData.newPassword}
                        onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                        className="bg-slate-950 border-slate-800 h-9 placeholder:text-slate-700"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setProfileModalOpen(false)}
                    className="text-slate-500 font-bold uppercase text-[10px]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveChanges}
                    disabled={isUpdating}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-[10px] tracking-widest px-6"
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Authorize Update"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Dynamic Background Pattern */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_50%,_rgba(15,23,42,1)_0%,_rgba(2,6,23,1)_100%)] print:hidden">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M54.627 0l.83.83L1.205 55.082l-.83-.83L54.627 0zM.605 5.45l.83.83L5.45.605l-.83-.83L.605 5.45z' fill='%23ffffff' fill-opacity='1' fill-rule='evenodd'/%3E%3C/svg%3E")` }} />
        </div>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-6 relative print:p-0">
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
          <footer className="mt-10 border-t border-slate-900 pt-4 pb-1 print:hidden">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-700">
              <div className="flex items-center gap-2">
                <Cpu size={10} className="text-blue-600/40" />
                <span>Fare Collection System &mdash; Admin Console</span>
              </div>
              <div className="flex items-center gap-3">
                <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
                <span className="text-slate-800">|</span>
                <span className="text-blue-600/40">v1.0.0</span>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}