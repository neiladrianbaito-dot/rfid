import { useState, useEffect, useMemo } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import {
  Settings, UserPlus, Users, Lock, Shield,
  Loader2, ShieldCheck, Trash2, RefreshCw,
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

// ── NEW: safe JSON parsing helper ───────────────────────────────────────────
// Reads the response as text first, then tries to parse it as JSON. If the
// server (or a proxy, or a SPA fallback) returned HTML/plaintext instead of
// JSON, this throws a readable error instead of a cryptic
// "Unexpected token '<'" crash.
async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned a non-JSON response (status ${response.status}). ` +
      `This usually means the request didn't reach the API (check VITE_API_URL, ` +
      `routing, or that the backend is running). Response started with: ` +
      `"${text.slice(0, 120).replace(/\s+/g, " ")}"`
    );
  }
}

type StaffUser = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  status: string;
  created_at: string;
};

function roleBadgeClass(role: string, isDark: boolean) {
  const key = role.toLowerCase();
  if (key === "admin") {
    return isDark
      ? "bg-blue-950/40 text-blue-400 border-blue-900"
      : "bg-blue-50 text-blue-600 border-blue-200";
  }
  return isDark
    ? "bg-slate-800 text-slate-400 border-slate-700"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

export default function SettingsPage() {
  const { isDark } = useTheme();
  const { toast } = useToast();
  const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);

  // Dev-time sanity check: warn loudly if VITE_API_URL isn't set, since that's
  // the #1 cause of "request hits the frontend origin and gets HTML back".
  useEffect(() => {
    if (!apiBaseUrl) {
      console.warn(
        "[SettingsPage] VITE_API_URL is not set — API requests will be sent " +
        "to relative paths on this app's own origin, which will likely fail."
      );
    }
  }, [apiBaseUrl]);

  // ── Add staff form state ───────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "staff",
  });

  const resetForm = () => {
    setForm({ fullName: "", username: "", password: "", role: "staff" });
  };

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

      toast({
        title: "Staff Account Created",
        description: `${form.fullName.trim()} has been added as ${form.role}.`,
      });
      resetForm();
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
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadStaff = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/staff`, {
        headers: { ...getAuthHeaders() },
      });
      const data = await parseJsonSafe(response);
      if (response.ok && data.staff) setStaff(data.staff as StaffUser[]);
      else if (!response.ok) {
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

  const handleRemoveStaff = async (userId: number, name: string) => {
    const confirmed = window.confirm(`Remove ${name} from staff? This cannot be undone.`);
    if (!confirmed) return;

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
      </div>

      {/* Add New Staff User */}
      <Card className={`shadow-sm relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
        <CardHeader className={`pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex items-center gap-2">
            <UserPlus className="text-blue-500" size={18} />
            <h3 className={`text-sm font-bold uppercase tracking-wide ${isDark ? "text-slate-200" : "text-slate-700"}`}>
              Add New Staff User
            </h3>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid gap-5 md:grid-cols-2">
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
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={`mt-5 p-3 rounded-lg border flex items-start gap-2 ${isDark ? "bg-blue-950/20 border-blue-900" : "bg-blue-50/60 border-blue-100"}`}>
            <ShieldCheck size={14} className={`mt-0.5 shrink-0 ${isDark ? "text-blue-400" : "text-blue-700"}`} />
            <p className={`text-xs leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              The staff member will use this username and password to log in on the admin console. Advise them to change their password after first login.
            </p>
          </div>

          <div className="flex justify-end mt-6">
            <Button
              onClick={handleAddStaff}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 gap-2"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {isSubmitting ? "Creating..." : "Create Staff Account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Staff List */}
      <Card className={`shadow-sm flex-1 flex flex-col overflow-hidden relative min-h-0 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="text-blue-500" size={18} />
              <h3 className={`text-sm font-bold uppercase tracking-wide ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                Staff Accounts
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
                <SelectTrigger className={`w-[130px] text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all">All Roles</SelectItem>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
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
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-32">
                        <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                          <Users size={48} className="mb-2" />
                          <p className="text-xs font-semibold uppercase tracking-widest">No staff accounts found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStaff.map((s) => (
                      <TableRow
                        key={s.id}
                        className={isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}
                      >
                        <TableCell className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                          {s.full_name}
                        </TableCell>
                        <TableCell className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {s.username}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${roleBadgeClass(s.role, isDark)}`}>
                            <Shield className="w-3 h-3" />
                            {s.role}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          {new Date(s.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={deletingId === s.id}
                            onClick={() => handleRemoveStaff(s.id, s.full_name)}
                            className={isDark ? "text-slate-500 hover:text-red-400" : "text-slate-400 hover:text-red-500"}
                          >
                            {deletingId === s.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}