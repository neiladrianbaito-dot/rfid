import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { LockKeyhole, Crown, Shield } from "lucide-react";

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function getAuthHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("termipay_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type CatalogRow = { permission_key: string; label: string; module: string; sort_order: number };
type RuleRow = { role: string; permission_key: string; allowed: boolean };

const ROLES = ["staff", "super_admin"] as const;
const ROLE_LABEL: Record<string, string> = { staff: "Staff", super_admin: "Super Admin" };
const ROLE_ICON: Record<string, typeof Crown> = { staff: Shield, super_admin: Crown };

// ── PermissionMatrixCard ─────────────────────────────────────────────────
// Renders permission_catalog rows (grouped by module) as a Roles × Permissions
// grid of checkboxes, bound directly to role_permissions via
// GET/PATCH /admin/permissions. Super Admin's column is always checked and
// locked — it can't be turned off from here, matching the backend's
// hard-coded "super_admin is always allowed" rule.
export function PermissionMatrixCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { isDark } = useTheme();
  const { toast } = useToast();
  const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);

  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) {
      setIsLoading(false);
      return;
    }
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/admin/permissions`, {
          headers: { ...getAuthHeaders() },
        });
        const data = await response.json();
        if (response.ok) {
          setCatalog(data.catalog ?? []);
          setRules(data.rules ?? []);
        } else {
          toast({ title: "Failed to load permissions", description: data.error, variant: "destructive" });
        }
      } catch (error: any) {
        toast({ title: "Failed to load permissions", description: error.message, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isSuperAdmin]);

  const grouped = useMemo(() => {
    const byModule = new Map<string, CatalogRow[]>();
    for (const row of catalog) {
      const list = byModule.get(row.module) ?? [];
      list.push(row);
      byModule.set(row.module, list);
    }
    return Array.from(byModule.entries());
  }, [catalog]);

  const isAllowed = (role: string, key: string): boolean => {
    if (role === "super_admin") return true; // always locked on
    return rules.find((r) => r.role === role && r.permission_key === key)?.allowed === true;
  };

  async function toggle(role: string, key: string, next: boolean) {
    if (role !== "staff") return; // only staff is editable — see backend note
    setSavingKey(`${role}:${key}`);
    // optimistic update
    setRules((prev) => {
      const exists = prev.some((r) => r.role === role && r.permission_key === key);
      return exists
        ? prev.map((r) => (r.role === role && r.permission_key === key ? { ...r, allowed: next } : r))
        : [...prev, { role, permission_key: key, allowed: next }];
    });

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ role, permission_key: key, allowed: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update permission");
    } catch (error: any) {
      // revert on failure
      setRules((prev) =>
        prev.map((r) => (r.role === role && r.permission_key === key ? { ...r, allowed: !next } : r))
      );
      toast({ title: "Failed to update permission", description: error.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  }

  if (!isSuperAdmin) return null;

  return (
    <Card className={`shadow-sm ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400 rounded-t-xl" />
      <CardHeader className={`pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
        <div className="flex items-center gap-2">
          <LockKeyhole className="text-blue-500" size={18} />
          <h3 className={`text-sm font-bold uppercase tracking-wide ${isDark ? "text-slate-200" : "text-slate-700"}`}>
            Permission Matrix
          </h3>
        </div>
        <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-slate-500"}`}>
          Control exactly what each role can do. Unchecked actions stay visible to Staff, but disabled.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={`h-9 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  <th className={`text-left font-semibold text-[11px] uppercase tracking-wide px-6 py-3 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    Permission
                  </th>
                  {ROLES.map((role) => {
                    const Icon = ROLE_ICON[role];
                    return (
                      <th key={role} className={`text-center font-semibold text-[11px] uppercase tracking-wide px-6 py-3 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5" />
                          {ROLE_LABEL[role]}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {grouped.map(([module, rows]) => (
                  <>
                    <tr key={`${module}-header`} className={isDark ? "bg-slate-950/40" : "bg-slate-50/60"}>
                      <td
                        colSpan={ROLES.length + 1}
                        className={`px-6 py-2 text-[11px] font-bold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-600"}`}
                      >
                        {module}
                      </td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.permission_key} className={`border-b ${isDark ? "border-slate-800/60" : "border-slate-100"}`}>
                        <td className={`px-6 py-3 ${isDark ? "text-slate-300" : "text-slate-700"}`}>{row.label}</td>
                        {ROLES.map((role) => {
                          const locked = role === "super_admin";
                          const checked = isAllowed(role, row.permission_key);
                          const busy = savingKey === `${role}:${row.permission_key}`;
                          return (
                            <td key={role} className="px-6 py-3 text-center">
                              <Checkbox
                                checked={checked}
                                disabled={locked || busy}
                                onCheckedChange={(v) => toggle(role, row.permission_key, v === true)}
                                aria-label={`${row.label} — ${ROLE_LABEL[role]}`}
                                className="mx-auto cursor-pointer disabled:cursor-not-allowed"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}