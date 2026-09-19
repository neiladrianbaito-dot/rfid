import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  CreditCard,
  ArrowLeftRight,
  Users,
  Map,
  ScrollText,
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
  ScanLine,
  Settings,
  Banknote,
  Camera,
  Upload,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
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

// Supabase Storage bucket for admin profile pictures (see admins-avatar.sql)
const AVATAR_BUCKET = "admin-avatars";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

// Maps whatever role value your backend/auth returns into a display label.
// Adjust the string comparisons below (e.g. "super_admin", "admin", "staff")
// to match the actual values coming from your user object / Supabase metadata.
function getRoleLabel(user: any): string {
  const rawRole =
    user?.role ||
    user?.userRole ||
    user?.user_metadata?.role ||
    user?.app_metadata?.role ||
    "";

  const role = String(rawRole).toLowerCase().trim();

  if (role === "super_admin" || role === "superadmin" || role === "super admin") {
    return "Super Admin";
  }
  if (role === "staff" || role === "admin") {
    return "Staff";
  }

  // Fallback: show whatever role string exists, or a generic label
  return rawRole ? String(rawRole) : "User";
}

// Reads the avatar public URL from whichever shape your user object has
// (admins table column, camelCase API field, or Supabase user_metadata).
function getAvatarUrl(user: any): string | null {
  return (
    user?.avatar_url ||
    user?.avatarUrl ||
    user?.user_metadata?.avatar_url ||
    null
  );
}

// Reads the storage path (used to delete the old file after replacing it).
function getAvatarPath(user: any): string | null {
  return (
    user?.avatar_path ||
    user?.avatarPath ||
    user?.user_metadata?.avatar_path ||
    null
  );
}

// Shows the avatar image, or falls back to the first letter of the name
// (also when the image fails to load).
function UserAvatar({
  url,
  name,
  isDark,
  textClassName = "text-sm",
}: {
  url: string | null;
  name?: string | null;
  isDark: boolean;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name ? `${name}'s avatar` : "Avatar"}
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    );
  }

  return (
    <span className={`font-bold ${textClassName} ${isDark ? "text-blue-400" : "text-blue-600"}`}>
      {name ? name.trim().charAt(0).toUpperCase() : "A"}
    </span>
  );
}

// Nav items are grouped under a section label so the sidebar reads as
// organized categories instead of one long flat list.
const navGroups = [
  {
    label: "Main",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/card-registration", label: "Card Registration", icon: CreditCard },
    ],
  },
  {
    label: "Management",
    items: [
      { path: "/users", label: "User Management", icon: Users },
    ],
  },
  {
    label: "Transactions & Fares",
    items: [
      { path: "/transactions", label: "Transaction Logs", icon: ArrowLeftRight },
      { path: "/fare-matrix", label: "Fare Matrix", icon: Map },
    ],
  },
  {
    label: "Devices & System Audit",
    items: [
      { path: "/device-reader", label: "Device Reader", icon: ScanLine },
      { path: "/audit-logs", label: "Audit Logs", icon: ScrollText },
    ],
  },
  {
    label: "Payout",
    items: [
      { path: "/disbursement", label: "Disbursement Payments", icon: Banknote },
    ],
  },
  {
    label: "Reports & Settings",
    items: [
      { path: "/reports", label: "Reports", icon: FileBarChart },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
  },
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

  // ── Avatar state ──────────────────────────────────────────────────────
  // Same approach as Card Registration's ID image: keep the File + a local
  // preview URL, and only upload to Supabase Storage when "Save Changes"
  // is pressed.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const roleLabel = getRoleLabel(user);
  const currentAvatarUrl = getAvatarUrl(user);
  const currentAvatarPath = getAvatarPath(user);

  // What the modal shows right now: new selection > current (unless marked for removal)
  const modalAvatarUrl = avatarPreview ?? (removeAvatar ? null : currentAvatarUrl);

  function resetAvatarSelection() {
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setAvatarFile(null);
    setRemoveAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  useEffect(() => {
    if (profileModalOpen) {
      setFormData({
        name: user?.name || "",
        currentPassword: "",
        newPassword: "",
      });
    } else {
      resetAvatarSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileModalOpen, user]);

  function handleAvatarSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid File",
        description: "Please select an image file.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      toast({
        title: "Image Too Large",
        description: "The profile picture must be 2 MB or smaller.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setRemoveAvatar(false);
  }

  // Removes the selected/current picture (applied when Save Changes is pressed)
  function handleRemoveAvatar() {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    setRemoveAvatar(true);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  // Uploads the picture directly to Supabase Storage (no Base64).
  // Path: <ownerId>/<timestamp>-<random>.<ext>
  async function uploadAvatar(ownerId: string): Promise<{ path: string; publicUrl: string }> {
    if (!avatarFile) throw new Error("No avatar selected.");

    const safeOwner = String(ownerId).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeOwner) throw new Error("Invalid user id for avatar upload.");

    const extension =
      avatarFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const filePath = `${safeOwner}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, avatarFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: avatarFile.type,
      });

    if (uploadError) {
      throw new Error(uploadError.message || "Failed to upload avatar to Supabase Storage.");
    }

    const { data: publicUrlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);

    if (!publicUrlData?.publicUrl) {
      await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
      throw new Error("Avatar was uploaded, but its public URL could not be generated.");
    }

    return { path: filePath, publicUrl: publicUrlData.publicUrl };
  }

  const handleSaveChanges = async () => {
    const wantsPasswordChange = formData.newPassword.trim().length > 0;
    const wantsNameChange = formData.name.trim() !== (user?.name || "").trim();
    const wantsAvatarChange = !!avatarFile || (removeAvatar && !!currentAvatarUrl);

    if (!wantsNameChange && !wantsPasswordChange && !wantsAvatarChange) {
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

    // Track the freshly uploaded file so it can be removed if saving fails
    let newAvatar: { path: string; publicUrl: string } | null = null;

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

        // 1) Upload the new avatar first (if any)
        if (avatarFile) {
          newAvatar = await uploadAvatar(supabaseSession.user.id);
        }

        const newAvatarUrl = wantsAvatarChange ? newAvatar?.publicUrl ?? null : undefined;
        const newAvatarPath = wantsAvatarChange ? newAvatar?.path ?? null : undefined;

        // 2) Save name / avatar / password on the Supabase auth user
        const payload: any = {};
        const metadata: Record<string, any> = {};

        if (wantsNameChange) {
          metadata.full_name = formData.name.trim();
          metadata.name = formData.name.trim();
        }

        if (wantsAvatarChange) {
          metadata.avatar_url = newAvatarUrl;
          metadata.avatar_path = newAvatarPath;
        }

        if (Object.keys(metadata).length > 0) {
          payload.data = metadata;
        }

        if (wantsPasswordChange) {
          payload.password = formData.newPassword.trim();
        }

        const { error: updateError } = await supabase.auth.updateUser(payload);
        if (updateError) throw new Error(updateError.message);

        // 3) Best-effort: mirror the avatar into public.admins
        //    (avatar_url / avatar_path columns). Adjust the .eq() column/value
        //    to however your admin row is linked to the logged-in user.
        if (wantsAvatarChange) {
          try {
            const adminKey = (user as any)?.username || supabaseSession.user.email;
            if (adminKey) {
              const { error: adminError } = await supabase
                .from("admins")
                .update({
                  avatar_url: newAvatarUrl,
                  avatar_path: newAvatarPath,
                  updated_at: new Date().toISOString(),
                })
                .eq("username", adminKey);
              if (adminError) console.warn("Could not sync avatar to admins table:", adminError.message);
            }
          } catch (syncError) {
            console.warn("Could not sync avatar to admins table:", syncError);
          }
        }

        // 4) Delete the previous file from storage (best-effort)
        if (wantsAvatarChange && currentAvatarPath) {
          try {
            await supabase.storage.from(AVATAR_BUCKET).remove([currentAvatarPath]);
          } catch (cleanupError) {
            console.warn("Failed to remove old avatar:", cleanupError);
          }
        }

        await refetchUser();
        toast({ title: "Success", description: "Profile updated successfully." });
        setProfileModalOpen(false);
        return;
      }

      // Legacy path (non-Supabase)
      if (avatarFile) {
        newAvatar = await uploadAvatar(String((user as any)?.id ?? "admin"));
      }

      const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);
      const token = window.localStorage.getItem("termipay_auth_token");
      const response = await fetch(`${apiBaseUrl}/api/auth/update-profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...formData,
          // Backend should save these into admins.avatar_url / admins.avatar_path
          ...(wantsAvatarChange
            ? {
                avatarUrl: newAvatar?.publicUrl ?? null,
                avatarPath: newAvatar?.path ?? null,
              }
            : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update profile");

      if (data?.token) window.localStorage.setItem("termipay_auth_token", data.token);

      if (wantsAvatarChange && currentAvatarPath) {
        try {
          await supabase.storage.from(AVATAR_BUCKET).remove([currentAvatarPath]);
        } catch (cleanupError) {
          console.warn("Failed to remove old avatar:", cleanupError);
        }
      }

      await refetchUser();
      setProfileModalOpen(false);
      toast({ title: "Success", description: "Profile updated successfully." });
    } catch (error: any) {
      // Remove the orphan upload if saving the profile failed
      if (newAvatar) {
        try {
          await supabase.storage.from(AVATAR_BUCKET).remove([newAvatar.path]);
        } catch (cleanupError) {
          console.warn("Failed to remove orphan avatar:", cleanupError);
        }
      }
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
      {/* Sidebar — themed blue to match the app's accent color */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 border-r print:hidden
          transform transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}
          ${isDark
            ? "bg-gradient-to-b from-blue-950 via-slate-950 to-slate-950 border-blue-950"
            : "bg-gradient-to-b from-blue-950 to-slate-900 border-blue-950"
          }
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className={`p-6 border-b transition-colors ${isDark ? "border-blue-900/50" : "border-blue-900/50"}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm shrink-0 ring-2 ring-white/20">
                <img
                  src="/calbayog.png"
                  alt="Calbayog Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight text-white">
                  Fare Collection<span className="text-blue-300"> System</span>
                </h1>
                <p className={`text-[10px] font-semibold uppercase tracking-widest leading-tight ${isDark ? "text-blue-400/70" : "text-blue-200"}`}>
                  Admin Console
                </p>
              </div>
            </div>
          </div>

          {/* Navigation — grouped into labeled categories */}
          <nav className="flex-1 p-4 space-y-5 overflow-y-auto">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p
                  className={`px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest ${
                    isDark ? "text-blue-500/50" : "text-blue-300/80"
                  }`}
                >
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
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
                                ? "bg-blue-600/30 text-white"
                                : "bg-blue-600/30 text-white"
                              : isDark
                                ? "text-blue-200/70 hover:text-white hover:bg-blue-900/40"
                                : "text-blue-200/70 hover:text-white hover:bg-blue-900/40"
                            }
                          `}
                        >
                          <Icon
                            size={17}
                            className={
                              isActive
                                ? isDark ? "text-blue-300" : "text-white"
                                : isDark
                                  ? "text-blue-400/60 group-hover:text-blue-200"
                                  : "text-blue-300 group-hover:text-blue-100"
                            }
                          />
                          {item.label}
                          {isActive && (
                            <motion.div layoutId="activeNav" className={`ml-auto w-1.5 h-1.5 rounded-full ${isDark ? "bg-blue-400" : "bg-white"}`} />
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* User Section at bottom of Sidebar */}
          <div className={`p-4 border-t transition-colors ${isDark ? "border-blue-900/50" : "border-blue-600/60"}`}>
            <Button
              variant="ghost"
              onClick={logout}
              disabled={isLoggingOut}
              className={`w-full justify-start gap-3 rounded-lg text-sm font-medium ${
                isDark
                  ? "text-blue-200/70 hover:text-red-300 hover:bg-red-950/40"
                  : "text-blue-100 hover:text-white hover:bg-red-500/20"
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
                {roleLabel}
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
                  <UserAvatar url={currentAvatarUrl} name={user?.name} isDark={isDark} />
                </motion.div>
              </DialogTrigger>

              <DialogContent
                className={`sm:max-w-[425px] max-h-[92vh] overflow-y-auto transition-colors ${
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
                      Update your profile picture, display name, or change your account password.
                    </DialogDescription>
                  </VisuallyHidden>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                  {/* Avatar upload */}
                  <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                      <div
                        className={`w-20 h-20 rounded-2xl border flex items-center justify-center overflow-hidden ${
                          isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"
                        }`}
                      >
                        <UserAvatar
                          url={modalAvatarUrl}
                          name={formData.name || user?.name}
                          isDark={isDark}
                          textClassName="text-2xl"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={isUpdating}
                        aria-label="Change profile picture"
                        className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 dark:border-slate-950"
                      >
                        <Camera className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <p className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                        Profile picture
                      </p>
                      <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        JPG, PNG or WEBP, up to 2 MB.
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={isUpdating}
                          className="h-8 gap-1.5 text-xs"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {modalAvatarUrl ? "Change" : "Upload"}
                        </Button>

                        {modalAvatarUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleRemoveAvatar}
                            disabled={isUpdating}
                            className={`h-8 gap-1.5 text-xs ${
                              isDark ? "text-red-400 hover:text-red-300" : "text-red-600 hover:text-red-700"
                            }`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </Button>
                        )}
                      </div>

                      {(avatarFile || removeAvatar) && (
                        <p className={`truncate text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          {avatarFile
                            ? `${avatarFile.name} • ${(avatarFile.size / 1024 / 1024).toFixed(2)} MB`
                            : "Picture will be removed when you save."}
                        </p>
                      )}
                    </div>

                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarSelect}
                      disabled={isUpdating}
                    />
                  </div>

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
                      To change your password, fill in both fields below. To update your name or picture only, leave the password fields blank.
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
                    disabled={isUpdating}
                    className={`font-medium ${isDark ? "text-slate-400 hover:text-slate-200" : "text-slate-500"}`}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveChanges}
                    disabled={isUpdating}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6"
                  >
                    {isUpdating ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {avatarFile ? "Uploading..." : "Saving..."}
                      </span>
                    ) : (
                      "Save Changes"
                    )}
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