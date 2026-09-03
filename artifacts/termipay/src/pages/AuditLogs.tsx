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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, LogIn, LogOut, Plus, Pencil, Trash2, History, Activity } from "lucide-react";

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

    // Realtime: new logs stream in instantly without a refresh
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
    <div
      className={`space-y-8 h-full flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`}
      style={{ overflowX: "hidden", maxWidth: "100%", boxSizing: "border-box" }}
      data-testid="audit-logs-page"
    >
      {/* ══ HEADER ══ */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${isDark ? "bg-blue-950/40" : "bg-blue-50"}`}>
            <History className="text-blue-500" size={22} />
          </div>
          <div>
            <h2 className={`text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
              Audit Logs
            </h2>
            <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Login, create, update, and delete activity across the system
            </p>
          </div>
        </div>
        <div className={`hidden lg:flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
          <Activity className="text-blue-500" size={16} />
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>
            Real-time Stream Active
          </span>
        </div>
      </div>

      {/* ══ FILTERS ══ */}
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

      {/* ══ TABLE ══ */}
      <Card className={`shadow-sm flex-1 flex flex-col overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />
        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <CardTitle className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <History size={14} className="text-blue-500" />
            Activity Log
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto overflow-x-auto p-0 px-6 pb-6 mt-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className={`h-12 w-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-red-500">
              Failed to load audit logs: {error}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className={`py-10 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              No audit log entries found.
            </div>
          ) : (
            <Table>
              <TableHeader className={isDark ? "bg-slate-900" : "bg-white"}>
                <TableRow className={`hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Date &amp; Time</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Action</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>User</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Entity</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>IP Address</TableHead>
                  <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => {
                  const style = ACTION_STYLES[log.action] || {
                    icon: History,
                    className: "text-slate-500 bg-slate-500/10",
                  };
                  const Icon = style.icon;
                  return (
                    <TableRow
                      key={log.id}
                      className={`transition-colors cursor-default ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}`}
                    >
                      <TableCell className={`whitespace-nowrap font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {new Date(log.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${style.className}`}
                        >
                          <Icon size={12} />
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                        {log.actor_username || "—"}
                      </TableCell>
                      <TableCell className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {log.entity ? `${log.entity}${log.entity_id ? ` #${log.entity_id}` : ""}` : "—"}
                      </TableCell>
                      <TableCell className={`font-mono text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {log.ip_address || "—"}
                      </TableCell>
                      <TableCell className={`text-xs max-w-xs truncate ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        {log.details && Object.keys(log.details).length > 0
                          ? JSON.stringify(log.details)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}