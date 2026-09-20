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

// Turns a public URL from the avatar bucket back into "folder/file.ext".
// Used when we only know the URL (no avatar_path), so the old file can still
// be found and deleted.
function getStoragePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    const marker = `/${AVATAR_BUCKET}/`;
    const i = pathname.indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(pathname.slice(i + marker.length)) || null;
  } catch {
    return null;
  }
}

// Deletes the replaced avatar file(s) from the bucket so uploads never pile up.
//   - removes the previous file (oldPath)
//   - also sweeps every other leftover file in the same admin folder,
//     keeping ONLY the new one (newPath)
// Only ever touches the admin-avatars bucket.
// Returns true when the cleanup worked (or there was nothing to delete).
async function cleanupOldAvatarFiles(
  oldPath: string | null,
  newPath: string | null
): Promise<boolean> {
  const referencePath = newPath ?? oldPath;
  if (!referencePath) return true;

  const targets = new Set<string>();
  if (oldPath && oldPath !== newPath) targets.add(oldPath);

  // Sweep leftovers from earlier uploads in this admin's folder
  if (referencePath.includes("/")) {
    const folder = referencePath.split("/")[0];
    try {
      const { data, error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .list(folder, { limit: 1000 });

      if (error) {
        console.warn("Could not list avatar folder:", error.message);
      } else {
        for (const f of data ?? []) {
          // folders come back with id = null; skip them and the placeholder
          if (!f?.name || (f as any).id === null || f.name === ".emptyFolderPlaceholder") continue;
          const p = `${folder}/${f.name}`;
          if (p !== newPath) targets.add(p);
        }
      }
    } catch (listError) {
      console.warn("Could not list avatar folder:", listError);
    }
  }

  const paths = Array.from(targets);
  if (paths.length === 0) return true;

  try {
    const { data, error } = await supabase.storage.from(AVATAR_BUCKET).remove(paths);

    if (error) {
      console.warn("Avatar cleanup failed:", error.message);
      return false;
    }

    // Storage returns an empty list (no error) when a DELETE policy is missing
    if (!data || data.length === 0) {
      console.warn(
        "Avatar cleanup removed nothing. The bucket probably has no DELETE policy:",
        paths
      );
      return false;
    }

    console.log(
      "Avatar cleanup removed:",
      data.map((d: any) => d.name)
    );
    return true;
  } catch (removeError) {
    console.warn("Avatar cleanup threw:", removeError);
    return false;
  }
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
        onError={() => {
          console.warn("Avatar image failed to load:", url);
          setFailed(true);
        }}
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
  // Picking a picture ONLY stores the File + a local preview. Nothing is
  // uploaded or deleted until "Save Changes" is pressed.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const roleLabel = getRoleLabel(user);

  // Numeric id of the row in public.admins (null if the user object has none)
  const adminId: number | null =
    (user as any)?.id != null && /^\d+$/.test(String((user as any).id))
      ? Number((user as any).id)
      : null;

  // Saves (or clears) the avatar on the admins row through the
  // set_admin_avatar() SQL function. Tries every identifier we know about
  // (username, email, email name, admin id) until one matches a row.
  async function syncAvatarToAdmins(
    url: string | null,
    path: string | null,
    authEmail?: string | null
  ) {
    const raw = [
      (user as any)?.username,
      (user as any)?.email,
      authEmail,
      authEmail ? authEmail.split("@")[0] : null,
    ];

    const usernames = Array.from(
      new Set(
        raw
          .filter((v): v is string => typeof v === "string" && v.trim() !== "")
          .map((v) => v.trim())
      )
    );

    const attempts: { p_id: number | null; p_username: string | null }[] = [
      ...usernames.map((u) => ({ p_id: null, p_username: u })),
      ...(adminId !== null ? [{ p_id: adminId, p_username: null }] : []),
    ];

    if (attempts.length === 0) {
      throw new Error("Could not save avatar: no admin id or username found for this account.");
    }

    for (const attempt of attempts) {
      const { data, error } = await supabase.rpc("set_admin_avatar", {
        ...attempt,
        p_url: url,
        p_path: path,
      });
      if (error) throw new Error(`Could not save avatar: ${error.message}`);
      if (data === true) return;
    }

    throw new Error("Could not save avatar: no matching admin account was found.");
  }

  // The avatar lives in its own state so it always displays, even when the
  // `user` object from useAuth doesn't include avatar fields. Sources, in order:
  //   1) the user object   2) Supabase auth user_metadata   3) public.admins row
  const [avatar, setAvatar] = useState<{ url: string | null; path: string | null }>({
    url: getAvatarUrl(user),
    path: getAvatarPath(user),
  });
  const currentAvatarUrl = avatar.url;
  const currentAvatarPath = avatar.path;

  // Storage path of the picture that is about to be replaced. Falls back to
  // parsing the public URL when avatar_path is missing, so the old file can
  // still be deleted.
  const currentAvatarStoragePath = currentAvatarPath || getStoragePathFromUrl(currentAvatarUrl);

  useEffect(() => {
    let cancelled = false;

    async function loadAvatar() {
      const fromUser = getAvatarUrl(user);
      if (fromUser) {
        if (!cancelled) setAvatar({ url: fromUser, path: getAvatarPath(user) });
        return;
      }

      try {
        // 1) public.admins through the get_my_avatar() SQL function
        //    (works with the legacy token login too)
        if (adminId !== null || (user as any)?.username) {
          const { data: rows, error: rpcError } = await supabase.rpc("get_my_avatar", {
            p_id: adminId,
            p_username: (user as any)?.username ?? null,
          });

          if (rpcError) {
            console.warn("get_my_avatar failed:", rpcError.message);
          } else if (Array.isArray(rows) && rows.length > 0 && rows[0].avatar_url) {
            if (!cancelled) {
              setAvatar({ url: rows[0].avatar_url || null, path: rows[0].avatar_path || null });
            }
            return;
          }
        }

        // 2) Supabase auth user_metadata
        const { data } = await supabase.auth.getUser();
        const meta: any = data?.user?.user_metadata;
        if (meta && "avatar_url" in meta) {
          if (!cancelled) {
            setAvatar({ url: meta.avatar_url || null, path: meta.avatar_path || null });
          }

          // Self-heal: the picture exists in auth metadata but not in
          // public.admins (e.g. an earlier save failed). Copy it over so the
          // Settings page can show it too.
          if (meta.avatar_url) {
            try {
              await syncAvatarToAdmins(meta.avatar_url, meta.avatar_path || null, data?.user?.email);
            } catch (healError) {
              console.warn("Could not copy avatar to admins table:", healError);
            }
          }
        }
      } catch (error) {
        console.warn("Could not load avatar:", error);
      }
    }

    loadAvatar();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Keep the header avatar in sync right after supabase.auth.updateUser()
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "USER_UPDATED") {
        const meta: any = session?.user?.user_metadata;
        if (meta && "avatar_url" in meta) {
          setAvatar({ url: meta.avatar_url || null, path: meta.avatar_path || null });
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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

  // Reset the form when the modal opens, and drop any unsaved picture
  // selection when it closes. Only depends on the modal state, so a background
  // refetch of `user` can't wipe what you're typing or the picture you picked.
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
  }, [profileModalOpen]);

  // Picking a picture only shows a preview. It is uploaded when the user
  // presses "Save Changes".
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

    // Allow picking the same file again later
    event.target.value = "";
  }

  // "Discard" drops a picture that was just picked. "Remove" marks the current
  // picture for removal. Neither touches storage until "Save Changes".
  function handleRemoveAvatar() {
    if (avatarFile) {
      resetAvatarSelection();
      return;
    }
    if (currentAvatarUrl) {
      setRemoveAvatar(true);
    }
  }

  // Uploads the picture directly to Supabase Storage (no Base64).
  // Path: <ownerId>/<timestamp>-<random>.<ext>
  async function uploadAvatar(
    ownerId: string,
    file: File | null = avatarFile
  ): Promise<{ path: string; publicUrl: string }> {
    if (!file) throw new Error("No avatar selected.");

    const safeOwner = String(ownerId).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeOwner) throw new Error("Invalid user id for avatar upload.");

    const extension =
      file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const filePath = `${safeOwner}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
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
    // Becomes true once the admins row points to the new picture. After that
    // the new file must NEVER be deleted as an "orphan".
    let avatarSaved = false;

    // Path of the picture being replaced (captured before state changes)
    const oldStoragePath = currentAvatarStoragePath;

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
          newAvatar = await uploadAvatar(adminId !== null ? String(adminId) : supabaseSession.user.id);
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

        // 3) Save the avatar on the admins row (via RPC)
        if (wantsAvatarChange) {
          try {
            await syncAvatarToAdmins(newAvatarUrl ?? null, newAvatarPath ?? null, supabaseSession.user.email);
            avatarSaved = true;
          } catch (syncError: any) {
            console.warn(syncError);
            toast({
              title: "Picture saved, but not to the accounts list",
              description: syncError?.message || "The Settings page may not show it yet.",
              variant: "destructive",
            });
          }
        }

        // 4) Delete the previous picture(s) from the bucket. Only runs after the
        //    admins row points to the new picture.
        if (wantsAvatarChange && avatarSaved) {
          const cleaned = await cleanupOldAvatarFiles(oldStoragePath, newAvatarPath ?? null);
          if (!cleaned) {
            toast({
              title: "Old picture not deleted",
              description:
                "Your profile was saved, but the previous file could not be removed from the admin-avatars bucket. Add the Storage DELETE policy (see console for details).",
              variant: "destructive",
            });
          }
        }

        // Show the new picture immediately (don't wait for refetchUser)
        if (wantsAvatarChange) {
          setAvatar({ url: newAvatarUrl ?? null, path: newAvatarPath ?? null });
        }

        try {
          await refetchUser();
        } catch {
          /* not critical */
        }

        toast({ title: "Success", description: "Profile updated successfully." });
        setProfileModalOpen(false);
        return;
      }

      // Legacy path (non-Supabase)
      if (avatarFile) {
        newAvatar = await uploadAvatar(
          adminId !== null ? String(adminId) : String((user as any)?.username ?? "admin")
        );
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

      // Save the avatar on the admins row (works without any backend change)
      if (wantsAvatarChange) {
        await syncAvatarToAdmins(newAvatar?.publicUrl ?? null, newAvatar?.path ?? null);
        avatarSaved = true;

        // Delete the previous picture(s) from the bucket
        const cleaned = await cleanupOldAvatarFiles(oldStoragePath, newAvatar?.path ?? null);
        if (!cleaned) {
          toast({
            title: "Old picture not deleted",
            description:
              "Your profile was saved, but the previous file could not be removed from the admin-avatars bucket. Add the Storage DELETE policy (see console for details).",
            variant: "destructive",
          });
        }

        setAvatar({ url: newAvatar?.publicUrl ?? null, path: newAvatar?.path ?? null });
      }

      try {
        await refetchUser();
      } catch {
        /* not critical */
      }

      setProfileModalOpen(false);
      toast({ title: "Success", description: "Profile updated successfully." });
    } catch (error: any) {
      // Remove the orphan upload if saving the profile failed
      // (never when the admins row already points to it)
      if (newAvatar && !avatarSaved) {
        try {
          const { error: removeError } = await supabase.storage
            .from(AVATAR_BUCKET)
            .remove([newAvatar.path]);
          if (removeError) console.warn("Failed to remove orphan avatar:", removeError.message);
        } catch (cleanupError) {
          console.warn("Failed to remove orphan avatar:", cleanupError);
        }
      }
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  // Small status line under the avatar buttons. Always rendered (even when
  // empty) with a fixed height so this row NEVER changes the modal's size.
  const avatarStatus = isUpdating
    ? avatarFile
      ? `Uploading ${avatarFile.name}...`
      : removeAvatar
        ? "Removing picture..."
        : null
    : avatarFile
      ? "New picture selected."
      : removeAvatar
        ? "Will be removed on save."
        : null;

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

              {/*
                LOCKED MODAL:
                - Fixed exact size (w-[400px] h-[600px]) — never grows/shrinks
                  no matter what happens inside (upload, error, status text).
                - overflow-hidden on the WHOLE dialog — no scrollbar, ever.
                - Header and footer are fixed-height (shrink-0); everything
                  in between is compact and sized to always fit, so nothing
                  overlaps and nothing needs to scroll.
                - Avatar preview box is a fixed w-16 h-16 (64px) regardless of
                  whether it's the current picture, a new preview, or the
                  fallback initial — so the image box itself never resizes.
              */}
              <DialogContent
                className={`w-[400px] max-w-[92vw] h-[600px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden transition-colors ${
                  isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"
                }`}
              >
                <div className="absolute top-0 left-0 w-full h-[3px] bg-blue-600 z-10" />

                <DialogHeader className="px-5 pt-5 pb-2 shrink-0">
                  <DialogTitle className={`text-base font-bold tracking-tight transition-colors ${isDark ? "text-white" : "text-slate-900"}`}>
                    Security & Profile
                  </DialogTitle>
                  <VisuallyHidden>
                    <DialogDescription>
                      Update your profile picture, display name, or change your account password.
                    </DialogDescription>
                  </VisuallyHidden>
                </DialogHeader>

                {/* Fixed body — no scroll, no overflow, no resize */}
                <div className="flex-1 px-5 overflow-hidden">
                  <div className="flex flex-col gap-4 h-full py-2">
                    {/* Avatar upload — fixed 64px box, never changes size */}
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div
                          className={`w-16 h-16 rounded-2xl border flex items-center justify-center overflow-hidden shrink-0 ${
                            isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"
                          }`}
                        >
                          <UserAvatar
                            url={modalAvatarUrl}
                            name={formData.name || user?.name}
                            isDark={isDark}
                            textClassName="text-xl"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={isUpdating}
                          aria-label="Change profile picture"
                          className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 dark:border-slate-950"
                        >
                          <Camera className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                          Profile picture
                        </p>

                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => avatarInputRef.current?.click()}
                            disabled={isUpdating}
                            className="h-7 gap-1 text-[11px] px-2"
                          >
                            <Upload className="h-3 w-3" />
                            {modalAvatarUrl ? "Change" : "Upload"}
                          </Button>

                          {modalAvatarUrl && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleRemoveAvatar}
                              disabled={isUpdating}
                              className={`h-7 gap-1 text-[11px] px-2 ${
                                isDark ? "text-red-400 hover:text-red-300" : "text-red-600 hover:text-red-700"
                              }`}
                            >
                              <Trash2 className="h-3 w-3" />
                              {avatarFile ? "Discard" : "Remove"}
                            </Button>
                          )}
                        </div>

                        {/* Reserved-height status row — height NEVER changes,
                            whether text is showing or not. Truncated so a
                            long filename can never push the layout. */}
                        <p className={`flex items-center gap-1 text-[10.5px] h-[14px] mt-1 leading-none ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {avatarStatus && (
                            <>
                              {isUpdating && <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />}
                              <span className="truncate">{avatarStatus}</span>
                            </>
                          )}
                        </p>
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

                    <div className="space-y-1.5">
                      <Label className={`text-[10px] uppercase tracking-wide font-semibold transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Full Name
                      </Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={`h-9 focus:border-blue-500 focus-visible:ring-blue-500 transition-colors ${
                          isDark ? "bg-slate-900 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                        }`}
                      />
                    </div>

                    <div
                      className={`flex-1 min-h-0 p-3 rounded-xl border flex flex-col gap-2.5 transition-colors overflow-hidden ${
                        isDark ? "bg-blue-950/20 border-blue-900" : "bg-blue-50/60 border-blue-100"
                      }`}
                    >
                      <div className={`flex items-center gap-2 ${isDark ? "text-blue-400" : "text-blue-700"}`}>
                        <ShieldCheck size={13} />
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide">Authentication Update</span>
                      </div>
                      <p className={`text-[10.5px] leading-relaxed transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Fill both password fields to change it. Leave blank to update only your name or picture.
                      </p>
                      <div className="space-y-1.5">
                        <Label className={`text-[10px] font-medium transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          Current Password
                        </Label>
                        <Input
                          type="password"
                          placeholder="Required if changing password"
                          value={formData.currentPassword}
                          onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                          className={`h-8 text-xs transition-colors ${
                            isDark
                              ? "bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                              : "bg-white border-slate-200 placeholder:text-slate-400"
                          }`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className={`text-[10px] font-medium transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          New Password
                        </Label>
                        <Input
                          type="password"
                          placeholder="Leave blank if not changing"
                          value={formData.newPassword}
                          onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                          className={`h-8 text-xs transition-colors ${
                            isDark
                              ? "bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                              : "bg-white border-slate-200 placeholder:text-slate-400"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fixed footer — always same position, never moves */}
                <div className={`flex justify-end gap-2 px-5 py-3.5 border-t shrink-0 transition-colors ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setProfileModalOpen(false)}
                    disabled={isUpdating}
                    className={`font-medium ${isDark ? "text-slate-400 hover:text-slate-200" : "text-slate-500"}`}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveChanges}
                    disabled={isUpdating}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5"
                  >
                    {isUpdating ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
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