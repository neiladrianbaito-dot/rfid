import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import {
  Settings, UserPlus, Users, Lock, Shield,
  Loader2, ShieldCheck, Trash2, RefreshCw, Crown, ShieldAlert,
  Camera, Upload,
} from "lucide-react";

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function getAuthHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("termipay_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned a non-JSON response (status ${response.status}). ` +
      `Response started with: "${text.slice(0, 120).replace(/\s+/g, " ")}"`
    );
  }
}

// ── Avatar storage helpers ───────────────────────────────────────────────────
// Mirrors Layout.tsx's admin-avatars handling exactly, so any account's
// picture (the logged-in admin's own, via Layout.tsx, or another staff
// member's, via this page) ends up in the same bucket, same path shape,
// and is saved/cleaned up the same way.
const AVATAR_BUCKET = "admin-avatars";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB

// Turns a public URL from the avatar bucket back into "folder/file.ext".
// Used when we only know the URL (no avatar_path column value), so the old
// file can still be found and deleted after a replace.
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

// Deletes the replaced avatar file(s) from the bucket so uploads never pile
// up — removes the previous file (oldPath) and sweeps any other leftovers in
// the same owner folder, keeping only the new one (newPath). Same logic as
// Layout.tsx's cleanupOldAvatarFiles.
async function cleanupOldAvatarFiles(
  oldPath: string | null,
  newPath: string | null
): Promise<boolean> {
  const referencePath = newPath ?? oldPath;
  if (!referencePath) return true;

  const targets = new Set<string>();
  if (oldPath && oldPath !== newPath) targets.add(oldPath);

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
    if (!data || data.length === 0) {
      console.warn("Avatar cleanup removed nothing. The bucket probably has no DELETE policy:", paths);
      return false;
    }
    return true;
  } catch (removeError) {
    console.warn("Avatar cleanup threw:", removeError);
    return false;
  }
}

// Uploads directly to Supabase Storage (no Base64). Path shape:
// <ownerId>/<timestamp>-<random>.<ext> — identical to Layout.tsx's
// uploadAvatar, so both places write into the same folder-per-admin layout.
async function uploadAvatarFile(
  ownerId: string,
  file: File
): Promise<{ path: string; publicUrl: string }> {
  const safeOwner = String(ownerId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeOwner) throw new Error("Invalid admin id for avatar upload.");

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const filePath = `${safeOwner}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, file, { cacheControl: "3600", upsert: false, contentType: file.type });

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

// Saves (or clears) the avatar on a specific admins row through the same
// set_admin_avatar() SQL function Layout.tsx uses for the logged-in admin's
// own picture — this just targets it by numeric id (p_username left null),
// since here we always already know the staff row's id.
async function saveAvatarToAdmin(adminId: number, url: string | null, path: string | null): Promise<void> {
  const { data, error } = await supabase.rpc("set_admin_avatar", {
    p_id: adminId,
    p_username: null,
    p_url: url,
    p_path: path,
  });
  if (error) throw new Error(`Could not save avatar: ${error.message}`);
  if (data !== true) throw new Error("Could not save avatar: no matching admin account was found.");
}

type StaffUser = {
  id: number;
  username: string;
  full_name: string;
  role: string; // "staff" | "super_admin"
  status: string;
  created_at: string;
  avatar_url?: string | null;
  avatar_path?: string | null;
};

// The API may return snake_case (avatar_url) or camelCase (avatarUrl).
// Normalize both into avatar_url / avatar_path so the UI only reads one shape.
function normalizeStaff(row: any): StaffUser {
  return {
    ...row,
    avatar_url: row?.avatar_url ?? row?.avatarUrl ?? null,
    avatar_path: row?.avatar_path ?? row?.avatarPath ?? null,
  };
}

// ── Role label helpers ───────────────────────────────────────────────────────
function roleLabel(role: string): string {
  return role === "super_admin" ? "Super Admin" : "Staff";
}

function roleBadgeClass(role: string, isDark: boolean) {
  if (role === "super_admin") {
    return isDark
      ? "bg-blue-950/40 text-blue-400 border-blue-900"
      : "bg-blue-50 text-blue-600 border-blue-200";
  }
  return isDark
    ? "bg-slate-800 text-slate-400 border-slate-700"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

// ── Avatar ───────────────────────────────────────────────────────────────────
// Shows the uploaded picture; falls back to the first letter of the name when
// there is no picture or the image fails to load.
function StaffAvatar({
  url,
  name,
  role,
  isDark,
}: {
  url?: string | null;
  name: string;
  role: string;
  isDark: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const showImage = !!url && !failed;
  const isSuper = role === "super_admin";

  const frameClass = isSuper
    ? isDark
      ? "bg-blue-950/40 border-blue-900"
      : "bg-blue-50 border-blue-100"
    : isDark
      ? "bg-slate-800 border-slate-700"
      : "bg-slate-100 border-slate-200";

  const letterClass = isSuper
    ? isDark
      ? "text-blue-400"
      : "text-blue-600"
    : isDark
      ? "text-slate-300"
      : "text-slate-600";

  return (
    <div
      className={`w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center overflow-hidden ${frameClass}`}
    >
      {showImage ? (
        <img
          src={url as string}
          alt={`${name}'s avatar`}
          loading="lazy"
          onError={() => {
            console.warn("Avatar image failed to load:", url);
            setFailed(true);
          }}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={`text-sm font-bold ${letterClass}`}>
          {name ? name.trim().charAt(0).toUpperCase() : "?"}
        </span>
      )}
    </div>
  );
}

// Larger version used inside the avatar picker/preview boxes (64px), shared
// by the "Add Account" form and the "Edit Picture" dialog below.
function AvatarPreviewBox({
  url,
  name,
  isDark,
}: {
  url: string | null;
  name?: string | null;
  isDark: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  return (
    <div
      className={`w-16 h-16 rounded-2xl border flex items-center justify-center overflow-hidden shrink-0 ${
        isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"
      }`}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={name ? `${name}'s avatar` : "Avatar"}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={`text-xl font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
          {name ? name.trim().charAt(0).toUpperCase() : "?"}
        </span>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { isDark } = useTheme();
  const { toast } = useToast();
  const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);

  // ── Who am I? (needed to know if the Add Staff form should even show) ──────
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myRoleLoaded, setMyRoleLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
          headers: { ...getAuthHeaders() },
        });
        const data = await parseJsonSafe(response);
        if (response.ok && data.role) setMyRole(data.role);
      } catch (error) {
        console.error("Failed to load current admin role:", error);
      } finally {
        setMyRoleLoaded(true);
      }
    })();
  }, []);

  const isSuperAdmin = myRole === "super_admin";

  // ── Add staff form state ───────────────────────────────────────────────
  // ── FIX: form now lives inside a Dialog instead of an always-visible
  // card. `isAddOpen` controls the modal's open state. ──
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "staff",
  });

  // Picking a picture in the Add Account form only stores the File + a
  // local preview — nothing is uploaded until "Create Account" is pressed,
  // same pattern as the avatar picker in Layout.tsx.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setForm({ fullName: "", username: "", password: "", role: "staff" });
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  function handleAvatarSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid File", description: "Please select an image file.", variant: "destructive" });
      event.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      toast({ title: "Image Too Large", description: "The profile picture must be 2 MB or smaller.", variant: "destructive" });
      event.target.value = "";
      return;
    }

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    event.target.value = ""; // allow picking the same file again later
  }

  function handleDiscardNewAvatar() {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  const handleAddStaff = async () => {
    if (!form.fullName.trim() || !form.username.trim() || !form.password.trim()) {
      toast({
        title: "Missing Information",
        description: "Please fill in full name, username and password.",
        variant: "destructive",
      });
      return;
    }

    if (form.password.trim().length < 6) {
      toast({
        title: "Weak Password",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          password: form.password.trim(),
          role: form.role,
        }),
      });

      const data = await parseJsonSafe(response);
      if (!response.ok) throw new Error(data.error || "Failed to create staff account");

      // The account exists now (row id comes back from the insert). Avatar
      // upload happens as a second, best-effort step — a failure here
      // should NOT be reported as "failed to create staff", since the
      // account itself was already created successfully.
      const newId = data?.staff?.id;
      if (avatarFile && newId != null) {
        try {
          const { path, publicUrl } = await uploadAvatarFile(String(newId), avatarFile);
          await saveAvatarToAdmin(Number(newId), publicUrl, path);
        } catch (avatarError: any) {
          console.warn("Avatar upload failed for new staff:", avatarError);
          toast({
            title: "Account created, but picture not saved",
            description: avatarError?.message || "You can add a picture later from the staff list.",
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Account Created",
        description: `${form.fullName.trim()} has been added as ${roleLabel(form.role)}.`,
      });
      resetForm();
      setIsAddOpen(false);
      loadStaff();
    } catch (error: any) {
      toast({
        title: "Failed to Add Staff",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Staff list state ────────────────────────────────────────────────────
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // ── Delete confirmation modal. Super Admins can remove "staff" accounts
  // only — a Super Admin can never delete another Super Admin, so the
  // delete action is hidden entirely on super_admin rows. ──
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ── Edit-picture modal for an EXISTING staff row. Opened by clicking an
  // account's avatar (Super Admin only). Same upload/cleanup logic as
  // Layout.tsx's own "Security & Profile" avatar section, just targeting
  // whichever staff row was clicked instead of "me". ──
  const [editAvatarTarget, setEditAvatarTarget] = useState<StaffUser | null>(null);
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editRemoveAvatar, setEditRemoveAvatar] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const editAvatarInputRef = useRef<HTMLInputElement>(null);
  const isSavingAvatarRef = useRef(false); // hard lock, same reasoning as Layout.tsx's isSavingRef

  const editModalAvatarUrl = editAvatarPreview ?? (editRemoveAvatar ? null : editAvatarTarget?.avatar_url ?? null);

  function openEditAvatar(s: StaffUser) {
    if (isSavingAvatar) return;
    setEditAvatarTarget(s);
    setEditAvatarFile(null);
    setEditAvatarPreview(null);
    setEditRemoveAvatar(false);
  }

  function closeEditAvatar() {
    if (isSavingAvatar) return;
    if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
    setEditAvatarTarget(null);
    setEditAvatarFile(null);
    setEditAvatarPreview(null);
    setEditRemoveAvatar(false);
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = "";
  }

  function handleEditAvatarSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid File", description: "Please select an image file.", variant: "destructive" });
      event.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      toast({ title: "Image Too Large", description: "The profile picture must be 2 MB or smaller.", variant: "destructive" });
      event.target.value = "";
      return;
    }

    if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
    setEditAvatarFile(file);
    setEditAvatarPreview(URL.createObjectURL(file));
    setEditRemoveAvatar(false);
    event.target.value = "";
  }

  function handleRemoveEditAvatarPick() {
    if (editAvatarFile) {
      if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
      setEditAvatarFile(null);
      setEditAvatarPreview(null);
      if (editAvatarInputRef.current) editAvatarInputRef.current.value = "";
      return;
    }
    if (editAvatarTarget?.avatar_url) {
      setEditRemoveAvatar(true);
    }
  }

  async function saveEditAvatar() {
    if (!editAvatarTarget) return;
    if (isSavingAvatarRef.current) return; // block double-submit, same as Layout.tsx
    isSavingAvatarRef.current = true;

    const target = editAvatarTarget;
    const oldStoragePath = target.avatar_path || getStoragePathFromUrl(target.avatar_url || null);
    const wantsChange = !!editAvatarFile || (editRemoveAvatar && !!target.avatar_url);

    if (!wantsChange) {
      isSavingAvatarRef.current = false;
      closeEditAvatar();
      return;
    }

    setIsSavingAvatar(true);
    let newAvatar: { path: string; publicUrl: string } | null = null;

    try {
      if (editAvatarFile) {
        newAvatar = await uploadAvatarFile(String(target.id), editAvatarFile);
      }

      const newUrl = newAvatar?.publicUrl ?? null; // null covers the "remove" case too
      const newPath = newAvatar?.path ?? null;

      await saveAvatarToAdmin(target.id, newUrl, newPath);

      const cleaned = await cleanupOldAvatarFiles(oldStoragePath, newPath);
      if (!cleaned) {
        toast({
          title: "Old picture not deleted",
          description:
            "The picture was updated, but the previous file could not be removed from the admin-avatars bucket. Check the Storage DELETE policy.",
          variant: "destructive",
        });
      }

      setStaff((prev) =>
        prev.map((s) => (s.id === target.id ? { ...s, avatar_url: newUrl, avatar_path: newPath } : s))
      );

      toast({ title: "Picture Updated", description: `${target.full_name}'s profile picture has been updated.` });
      closeEditAvatar();
    } catch (error: any) {
      // Orphan cleanup — never delete once saveAvatarToAdmin succeeded, but
      // we only reach here if it threw, so newAvatar (if any) is always safe
      // to remove.
      if (newAvatar) {
        try {
          await supabase.storage.from(AVATAR_BUCKET).remove([newAvatar.path]);
        } catch (cleanupError) {
          console.warn("Failed to remove orphan avatar:", cleanupError);
        }
      }
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingAvatar(false);
      isSavingAvatarRef.current = false;
    }
  }

  const loadStaff = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/staff`, {
        headers: { ...getAuthHeaders() },
      });
      const data = await parseJsonSafe(response);
      if (response.ok && Array.isArray(data.staff)) {
        const rows = (data.staff as any[]).map(normalizeStaff);
        setStaff(rows); // show the list right away

        // Fill in the avatars straight from Supabase, so they show even if
        // the API doesn't return avatar_url.
        try {
          const { data: avatars, error: avatarError } = await supabase.rpc("get_admin_avatars");
          if (avatarError) {
            console.warn("get_admin_avatars failed:", avatarError.message);
            toast({
              title: "Avatars could not be loaded",
              description: `${avatarError.message} — make sure admins-avatar.sql was run in Supabase.`,
              variant: "destructive",
            });
          } else if (Array.isArray(avatars)) {
            const byId = new Map<number, any>(avatars.map((a: any) => [Number(a.id), a]));
            setStaff(
              rows.map((r) => {
                const match = byId.get(Number(r.id));
                return match ? { ...r, avatar_url: match.avatar_url ?? null } : r;
              })
            );
          }
        } catch (avatarError) {
          console.warn("Could not load avatars:", avatarError);
        }
      } else if (!response.ok) {
        console.error("Failed to load staff:", data.error || data);
      }
    } catch (error) {
      console.error("Failed to load staff:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const roleOptions = Array.from(new Set(staff.map((s) => s.role))).sort();

  const filteredStaff = useMemo(() => {
    return staff.filter((s) => {
      if (roleFilter !== "all" && s.role !== roleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!s.full_name.toLowerCase().includes(q) && !s.username.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [staff, roleFilter, search]);

  const confirmRemoveStaff = async () => {
    if (!deleteTarget) return;
    const { id: userId, full_name: name } = deleteTarget;

    setDeletingId(userId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/staff/${userId}`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() },
      });

      const data = await parseJsonSafe(response);
      if (!response.ok) throw new Error(data.error || "Failed to remove staff account");

      toast({ title: "Staff Removed", description: `${name} has been removed.` });
      loadStaff();
    } catch (error: any) {
      toast({ title: "Failed to Remove Staff", description: error.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <div className={`space-y-8 h-full min-h-0 flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`}>
      {/* Header */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <Settings className="text-blue-500" size={26} />
            Settings
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Manage staff accounts and system access
          </p>
        </div>
        <div className="flex items-center gap-3">
          {myRoleLoaded && myRole && (
            <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${roleBadgeClass(myRole, isDark)}`}>
              {myRole === "super_admin" ? <Crown className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
              You are logged in as {roleLabel(myRole)}
            </Badge>
          )}
          {myRoleLoaded && isSuperAdmin && (
            <Button
              onClick={() => setIsAddOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Add Account
            </Button>
          )}
        </div>
      </div>

      {myRoleLoaded && !isSuperAdmin && (
        <div className={`p-4 rounded-lg border flex items-start gap-3 ${isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
          <Shield className={`mt-0.5 shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`} size={18} />
          <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Only a <strong>Super Admin</strong> can create or remove staff accounts. You can still view the list below.
          </p>
        </div>
      )}

      {/* Staff List */}
      <Card className={`shadow-sm flex-1 flex flex-col overflow-hidden relative min-h-0 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="text-blue-500" size={18} />
              <h3 className={`text-sm font-bold uppercase tracking-wide ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                Staff &amp; Super Admin Accounts
              </h3>
            </div>
            <div className="flex gap-3 w-full lg:w-auto">
              <Input
                placeholder="Search name or username..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full lg:w-64 text-sm ${isDark ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600" : "bg-white border-slate-200 placeholder:text-slate-400"}`}
              />
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className={`w-[150px] text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all">All Roles</SelectItem>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={loadStaff}
                className={isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : (
            <div className="relative mt-6 flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader className={`sticky top-0 z-10 border-b ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                  <TableRow className="border-none hover:bg-transparent">
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Name</TableHead>
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Username</TableHead>
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Role</TableHead>
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Date Added</TableHead>
                    {isSuperAdmin && (
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 5 : 4} className="text-center py-32">
                        <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                          <Users size={48} className="mb-2" />
                          <p className="text-xs font-semibold uppercase tracking-widest">No accounts found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStaff.map((s) => (
                      <TableRow
                        key={s.id}
                        className={isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {isSuperAdmin ? (
                              <button
                                type="button"
                                onClick={() => openEditAvatar(s)}
                                title="Change profile picture"
                                className="rounded-xl cursor-pointer transition-opacity hover:opacity-80"
                              >
                                <StaffAvatar
                                  url={s.avatar_url}
                                  name={s.full_name}
                                  role={s.role}
                                  isDark={isDark}
                                />
                              </button>
                            ) : (
                              <StaffAvatar
                                url={s.avatar_url}
                                name={s.full_name}
                                role={s.role}
                                isDark={isDark}
                              />
                            )}
                            <span className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              {s.full_name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {s.username}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${roleBadgeClass(s.role, isDark)}`}>
                            {s.role === "super_admin" ? <Crown className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                            {roleLabel(s.role)}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          {new Date(s.created_at).toLocaleDateString()}
                        </TableCell>
                        {isSuperAdmin && (
                          <TableCell className="text-right">
                            {s.role === "staff" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={deletingId === s.id}
                                onClick={() => setDeleteTarget(s)}
                                className={isDark ? "text-slate-500 hover:text-red-400" : "text-slate-400 hover:text-red-500"}
                              >
                                {deletingId === s.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </Button>
                            ) : (
                              <span className={`text-[11px] ${isDark ? "text-slate-700" : "text-slate-300"}`}>—</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add New Account Modal ────────────────────────────────────────── */}
      <Dialog
        open={isAddOpen}
        onOpenChange={(open) => {
          if (!isSubmitting) {
            setIsAddOpen(open);
            if (!open) resetForm();
          }
        }}
      >
        <DialogContent className={`sm:max-w-lg ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
          <DialogHeader>
            <DialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <UserPlus className="text-blue-500" size={18} />
              Add New Account
            </DialogTitle>
            <DialogDescription className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Create a login for a staff member or another super admin.
            </DialogDescription>
          </DialogHeader>

          {/* Avatar picker — optional, same pattern as Layout.tsx's own
              profile picture upload. Nothing is uploaded until the account
              is created and we have a real id to attach it to. */}
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <AvatarPreviewBox url={avatarPreview} name={form.fullName} isDark={isDark} />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={isSubmitting}
                aria-label="Add profile picture"
                className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 dark:border-slate-900"
              >
                <Camera className="h-3 w-3" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                Profile picture (optional)
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="h-7 gap-1 text-[11px] px-2"
                >
                  <Upload className="h-3 w-3" />
                  {avatarPreview ? "Change" : "Upload"}
                </Button>
                {avatarPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleDiscardNewAvatar}
                    disabled={isSubmitting}
                    className={`h-7 gap-1 text-[11px] px-2 ${isDark ? "text-red-400 hover:text-red-300" : "text-red-600 hover:text-red-700"}`}
                  >
                    <Trash2 className="h-3 w-3" />
                    Discard
                  </Button>
                )}
              </div>
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarSelect}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={`text-xs uppercase tracking-wide font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Full Name
              </Label>
              <Input
                placeholder="Juan Dela Cruz"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className={isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"}
              />
            </div>

            <div className="space-y-2">
              <Label className={`text-xs uppercase tracking-wide font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Username
              </Label>
              <Input
                placeholder="jdelacruz"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className={isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"}
              />
            </div>

            <div className="space-y-2">
              <Label className={`text-xs uppercase tracking-wide font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Temporary Password
              </Label>
              <div className="relative">
                <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                <Input
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={`pl-10 ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"}`}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className={`text-xs uppercase tracking-wide font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Role
              </Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger className={isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={`p-3 rounded-lg border flex items-start gap-2 ${isDark ? "bg-blue-950/20 border-blue-900" : "bg-blue-50/60 border-blue-100"}`}>
            <ShieldCheck size={14} className={`mt-0.5 shrink-0 ${isDark ? "text-blue-400" : "text-blue-700"}`} />
            <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              The staff member will use this username and password to log in on the admin console. Advise them to change their password after first login.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                setIsAddOpen(false);
                resetForm();
              }}
              className={isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddStaff}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 gap-2"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {isSubmitting ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Picture Modal — change/remove an EXISTING staff member's
          avatar. Opened by clicking their avatar in the table above. ────── */}
      <Dialog open={!!editAvatarTarget} onOpenChange={(open) => !open && closeEditAvatar()}>
        <DialogContent className={`sm:max-w-sm ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
          <DialogHeader>
            <DialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <Camera className="text-blue-500" size={18} />
              Change Profile Picture
            </DialogTitle>
            <DialogDescription className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {editAvatarTarget?.full_name}'s profile picture.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 py-2">
            <div className="relative shrink-0">
              <AvatarPreviewBox url={editModalAvatarUrl} name={editAvatarTarget?.full_name} isDark={isDark} />
              <button
                type="button"
                onClick={() => editAvatarInputRef.current?.click()}
                disabled={isSavingAvatar}
                aria-label="Change profile picture"
                className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 dark:border-slate-900"
              >
                <Camera className="h-3 w-3" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => editAvatarInputRef.current?.click()}
                  disabled={isSavingAvatar}
                  className="h-7 gap-1 text-[11px] px-2"
                >
                  <Upload className="h-3 w-3" />
                  {editModalAvatarUrl ? "Change" : "Upload"}
                </Button>
                {editModalAvatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveEditAvatarPick}
                    disabled={isSavingAvatar}
                    className={`h-7 gap-1 text-[11px] px-2 ${isDark ? "text-red-400 hover:text-red-300" : "text-red-600 hover:text-red-700"}`}
                  >
                    <Trash2 className="h-3 w-3" />
                    {editAvatarFile ? "Discard" : "Remove"}
                  </Button>
                )}
              </div>
              <p className={`text-[10.5px] h-[14px] mt-1 leading-none ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                {isSavingAvatar
                  ? "Saving..."
                  : editAvatarFile
                    ? "New picture selected."
                    : editRemoveAvatar
                      ? "Will be removed on save."
                      : ""}
              </p>
            </div>
            <input
              ref={editAvatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleEditAvatarSelect}
              disabled={isSavingAvatar}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isSavingAvatar}
              onClick={closeEditAvatar}
              className={isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}
            >
              Cancel
            </Button>
            <Button
              onClick={saveEditAvatar}
              disabled={isSavingAvatar}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 gap-2"
            >
              {isSavingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSavingAvatar ? "Saving..." : "Save Picture"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Modal — Super Admin removing a Staff account only ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <AlertDialogHeader>
            <AlertDialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <ShieldAlert className="text-red-500" size={18} /> Confirm Removal
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              This will permanently remove{" "}
              <strong>{deleteTarget?.full_name}</strong> (
              {deleteTarget ? roleLabel(deleteTarget.role) : ""}) from staff access.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deletingId !== null}
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed ${
                isDark ? "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveStaff}
              disabled={deletingId !== null}
              className="bg-red-600 text-white hover:bg-red-700 font-semibold text-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {deletingId !== null ? "Removing..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}