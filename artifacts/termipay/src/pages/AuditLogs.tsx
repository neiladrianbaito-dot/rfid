import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/use-theme";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, LogIn, LogOut, Plus, Pencil, Trash2, History } from "lucide-react";

type AuditLog = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

const ACTION_STYLES: Record<string, { icon: any; className: string }> = {
  LOGIN: { icon: LogIn, className: "text-emerald-500 bg-emerald-500/10" },
  LOGOUT: { icon: LogOut, className: "text-slate-500 bg-slate-500/10" },
  CREATE: { icon: Plus, className: "text-blue-500 bg-blue-500/10" },
  UPDATE: { icon: Pencil, className: "text-amber-500 bg-amber-500/10" },
  DELETE: { icon: Trash2, className: "text-red-500 bg-red-500/10" },
};

const ACTION_FILTERS = ["ALL", "LOGIN", "LOGOUT", "CREATE", "UPDATE", "DELETE"];

export default function AuditLogs() {
  const { isDark } = useTheme();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let isMounted = true;

    const fetchLogs = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isMounted) return;

      if (error) {
        setError(error.message);
      } else {
        setLogs(data || []);
        setError(null);
      }
      setIsLoading(false);
    };

    fetchLogs();

    // Realtime: bagong logs, instant lumalabas nang walang refresh
    const channel = supabase
      .channel("audit_logs_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_logs" },
        (payload) => {
          setLogs((prev) => [payload.new as AuditLog, ...prev]);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesAction = actionFilter === "ALL" || log.action === actionFilter;
      const searchLower = search.trim().toLowerCase();
      const matchesSearch =
        !searchLower ||
        log.actor_username?.toLowerCase().includes(searchLower) ||
        log.entity?.toLowerCase().includes(searchLower) ||
        log.entity_id?.toLowerCase().includes(searchLower) ||
        log.ip_address?.toLowerCase().includes(searchLower);
      return matchesAction && matchesSearch;
    });
  }, [logs, actionFilter, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${isDark ? "bg-blue-950/40" : "bg-blue-50"}`}>
          <History className="text-blue-500" size={20} />
        </div>
        <div>
          <h1 className={`text-lg font-bold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
            Audit Logs
          </h1>
          <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            Login, create, update, and delete activity across the system
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={15}
            className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-slate-600" : "text-slate-400"}`}
          />
          <Input
            placeholder="Search by user, entity, or IP address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`pl-9 ${isDark ? "bg-slate-900 border-slate-800 text-white" : "bg-white border-slate-200"}`}
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger
            className={`w-full sm:w-40 ${isDark ? "bg-slate-900 border-slate-800 text-white" : "bg-white border-slate-200"}`}
          >
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTERS.map((action) => (
              <SelectItem key={action} value={action}>
                {action === "ALL" ? "All Actions" : action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div
        className={`rounded-xl border overflow-hidden ${
          isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"
        }`}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-500">
            Failed to load audit logs: {error}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className={`p-10 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            No audit log entries found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className={`border-b text-left text-[11px] font-semibold uppercase tracking-wide ${
                    isDark ? "border-slate-800 text-slate-500" : "border-slate-200 text-slate-400"
                  }`}
                >
                  <th className="px-4 py-3">Date &amp; Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">IP Address</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const style = ACTION_STYLES[log.action] || {
                    icon: History,
                    className: "text-slate-500 bg-slate-500/10",
                  };
                  const Icon = style.icon;
                  return (
                    <tr
                      key={log.id}
                      className={`border-b last:border-0 ${
                        isDark ? "border-slate-900 hover:bg-slate-900/50" : "border-slate-100 hover:bg-slate-50"
                      }`}
                    >
                      <td className={`px-4 py-3 whitespace-nowrap font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {new Date(log.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${style.className}`}
                        >
                          <Icon size={12} />
                          {log.action}
                        </span>
                      </td>
                      <td className={`px-4 py-3 ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                        {log.actor_username || "—"}
                      </td>
                      <td className={`px-4 py-3 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {log.entity ? `${log.entity}${log.entity_id ? ` #${log.entity_id}` : ""}` : "—"}
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {log.ip_address || "—"}
                      </td>
                      <td className={`px-4 py-3 text-xs max-w-xs truncate ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        {log.details && Object.keys(log.details).length > 0
                          ? JSON.stringify(log.details)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}