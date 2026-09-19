import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/hooks/use-theme";
import {
  Search, ScrollText, ChevronLeft, ChevronRight, Zap,
  LogIn, LogOut, PlusCircle, Pencil, Trash2, RotateCcw, Download, Activity,
  Eye,
} from "lucide-react";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditLog = {
  id: number;
  timestamp: string;
  user: string;          // username of whoever performed the action
  action: string;        // LOGIN, LOGOUT, CREATE, UPDATE, DELETE, RESTORE, EXPORT
  entity: string;        // User, Scholars, Database, ...
  details: string;       // free-text description, e.g. "admin updated scholar: ..."
};

// ── Action badge styling ────────────────────────────────────────────────────

function actionMeta(action: string, isDark: boolean) {
  const key = action.toUpperCase();
  const map: Record<string, { icon: any; light: string; dark: string }> = {
    LOGIN:   { icon: LogIn,      light: "bg-blue-50 text-blue-600 border-blue-200",       dark: "bg-blue-950/40 text-blue-400 border-blue-900" },
    LOGOUT:  { icon: LogOut,     light: "bg-slate-100 text-slate-500 border-slate-200",   dark: "bg-slate-800 text-slate-400 border-slate-700" },
    CREATE:  { icon: PlusCircle, light: "bg-emerald-50 text-emerald-600 border-emerald-200", dark: "bg-emerald-950/40 text-emerald-400 border-emerald-900" },
    UPDATE:  { icon: Pencil,     light: "bg-amber-50 text-amber-600 border-amber-200",    dark: "bg-amber-950/40 text-amber-400 border-amber-900" },
    DELETE:  { icon: Trash2,     light: "bg-red-50 text-red-600 border-red-200",          dark: "bg-red-950/40 text-red-400 border-red-900" },
    RESTORE: { icon: RotateCcw,  light: "bg-cyan-50 text-cyan-600 border-cyan-200",       dark: "bg-cyan-950/40 text-cyan-400 border-cyan-900" },
    EXPORT:  { icon: Download,   light: "bg-purple-50 text-purple-600 border-purple-200", dark: "bg-purple-950/40 text-purple-400 border-purple-900" },
  };
  const fallback = { icon: Activity, light: "bg-slate-100 text-slate-500 border-slate-200", dark: "bg-slate-800 text-slate-400 border-slate-700" };
  const meta = map[key] ?? fallback;
  return { Icon: meta.icon, className: isDark ? meta.dark : meta.light };
}

// ── Details parsing (for the "old → new" changes list in the modal) ────────
// Parses strings like:
//   'updated user: Juan (card 123) — full_name: "Juan" → "Juana"; city_name: "Cebu" → "Manila"'
// into a prefix + a list of { field, oldVal, newVal }.
// Works for ANY number of changed fields — 1 field or all of them.
// Returns changes: [] for logs that don't follow this pattern
// (e.g. CREATE/DELETE/EXPORT/toggle logs) — those show as plain text in the modal.
type ParsedDetails = {
  prefix: string;
  changes: { field: string; oldVal: string; newVal: string }[];
};

function parseChanges(details: string): ParsedDetails {
  const separatorIndex = details.indexOf(" — ");
  if (separatorIndex === -1) return { prefix: details, changes: [] };

  const prefix = details.slice(0, separatorIndex);
  const changesPart = details.slice(separatorIndex + 3);

  const changeRegex = /([a-zA-Z0-9_]+):\s*"([^"]*)"\s*→\s*"([^"]*)"/g;
  const changes: ParsedDetails["changes"] = [];
  let match: RegExpExecArray | null;
  while ((match = changeRegex.exec(changesPart)) !== null) {
    changes.push({ field: match[1], oldVal: match[2], newVal: match[3] });
  }

  if (changes.length === 0) return { prefix: details, changes: [] };

  return { prefix, changes };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const { isDark } = useTheme();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  // ── Fetch audit_logs from Supabase, with realtime updates ─────────────────
  const loadLogs = async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, timestamp, user, action, entity, details")
      .order("timestamp", { ascending: false });
    if (!error && data) setLogs(data as AuditLog[]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadLogs();
    const channel = supabase
      .channel("admin_audit_logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_logs" }, loadLogs)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useRealtimeRefetch(["audit_logs"], () => { loadLogs(); });

  // ── Derive filter option lists from the data itself ────────────────────────
  const actionOptions = Array.from(new Set(logs.map((l) => l.action))).sort();
  const entityOptions = Array.from(new Set(logs.map((l) => l.entity))).sort();

  // ── Filtering ────────────────────────────────────────────────────────────
  // useMemo is required here — without it this array gets a brand new
  // reference on every render, which the useEffect below depends on,
  // causing an infinite render loop (React error #185).
  const filteredList = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter !== "all" && log.action !== actionFilter) return false;
      if (entityFilter !== "all" && log.entity !== entityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !log.details.toLowerCase().includes(q) &&
          !log.entity.toLowerCase().includes(q) &&
          !log.user.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [logs, actionFilter, entityFilter, search]);

  useEffect(() => { setPage(1); }, [search, actionFilter, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = filteredList.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    if (filteredList.length === 0) return;
    const topId = filteredList[0]?.id;
    if (prevTopIdRef.current !== null && topId !== prevTopIdRef.current) {
      setNewRowId(topId);
      setTimeout(() => setNewRowId(null), 800);
    }
    prevTopIdRef.current = topId;
    setLastUpdated(new Date());
  }, [filteredList]);

  // ── Parsed details for whichever log is currently open in the modal ────────
  const selectedParsed = selectedLog ? parseChanges(selectedLog.details) : null;

  return (
    <div className={`space-y-8 h-full min-h-0 flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`}>
      <style>{`
        @keyframes row-pulse {
          0%   { background-color: transparent; }
          50%  { background-color: rgba(37,99,235,0.08); }
          100% { background-color: transparent; }
        }
        .row-pulse { animation: row-pulse 0.8s ease-in-out; }
        @keyframes realtime-dot { 0%,100% { opacity:1; } 50% { opacity:0.2; } }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <ScrollText className="text-blue-500" size={26} />
            Audit Logs
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Track every account and record change across the system
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
            <Zap className="text-blue-500" size={16} />
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>Live Telemetry Active</span>
          </div>
          {lastUpdated && (
            <span className={`text-[10px] font-mono pr-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              Last sync: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <Card className={`shadow-sm flex flex-col overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />

        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex flex-col lg:flex-row gap-4 items-center">
            <div className="flex items-center gap-2 mr-2 shrink-0">
              <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${
                isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
              }`}>
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                LIVE
              </span>
            </div>
            <div className="relative flex-1 w-full">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
              <Input
                placeholder="Search user, entity or details..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`pl-10 font-medium text-sm focus-visible:ring-blue-500 ${
                  isDark
                    ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                }`}
              />
            </div>
            <div className="flex gap-3 w-full lg:w-auto">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a} className="cursor-pointer">{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Entity" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Entities</SelectItem>
                  {entityOptions.map((e) => (
                    <SelectItem key={e} value={e} className="cursor-pointer">{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-6">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : (
            <>
              <div className="relative mt-6 flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className={`sticky top-0 z-10 border-b ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Timestamp</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>User</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Action</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Entity</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Details</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-32">
                          <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                            <ScrollText size={48} className="mb-2" />
                            <p className="text-xs font-semibold uppercase tracking-widest">No records found</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedList.map((log) => {
                        const { Icon, className } = actionMeta(log.action, isDark);
                        return (
                          <TableRow
                            key={log.id}
                            className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                              newRowId === log.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className={`text-xs font-mono whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {new Date(log.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                              {log.user}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${className}`}>
                                <Icon className="w-3 h-3" />
                                {log.action}
                              </Badge>
                            </TableCell>
                            <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              {log.entity}
                            </TableCell>
                            <TableCell className={`text-xs max-w-[420px] truncate ${isDark ? "text-slate-400" : "text-slate-500"}`} title={log.details}>
                              {log.details}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedLog(log)}
                                className={`h-7 px-2.5 text-xs font-medium gap-1.5 cursor-pointer ${
                                  isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                                }`}
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className={`flex items-center justify-between pt-4 border-t mt-2 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                <span className={`text-xs font-mono uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Showing{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {filteredList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, filteredList.length)}
                  </span>{" "}
                  of <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{filteredList.length}</span> records
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}>
                    <ChevronLeft className="w-3 h-3 mr-1" />Prev
                  </Button>
                  <span className={`text-xs font-semibold px-2 tabular-nums ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                    <span className="text-blue-500">{safePage}</span>
                    <span className={isDark ? "text-slate-700" : "text-slate-300"}> / {totalPages}</span>
                  </span>
                  <Button variant="ghost" size="sm" disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}>
                    Next<ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── View Details Modal ──────────────────────────────────────────────── */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className={`max-w-lg ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          {selectedLog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const { Icon, className } = actionMeta(selectedLog.action, isDark);
                    return (
                      <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${className}`}>
                        <Icon className="w-3 h-3" />
                        {selectedLog.action}
                      </Badge>
                    );
                  })()}
                  <span className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                    {selectedLog.entity}
                  </span>
                </DialogTitle>
                <DialogDescription className={`text-xs font-mono pt-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  {new Date(selectedLog.timestamp).toLocaleString()} · by{" "}
                  <span className="text-blue-500 font-semibold">{selectedLog.user}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="pt-2">
                <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {selectedParsed?.prefix}
                </p>

                {selectedParsed && selectedParsed.changes.length > 0 ? (
                  <div className={`mt-4 rounded-lg border overflow-hidden ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                    <div className={`grid grid-cols-[1fr_1fr_1fr] text-[10px] font-semibold uppercase tracking-wide px-3 py-2 ${
                      isDark ? "bg-slate-950/60 text-slate-500 border-b border-slate-800" : "bg-slate-50 text-slate-400 border-b border-slate-200"
                    }`}>
                      <span>Field</span>
                      <span>Old Value</span>
                      <span>New Value</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {selectedParsed.changes.map((c, i) => (
                        <div
                          key={i}
                          className={`grid grid-cols-[1fr_1fr_1fr] text-xs px-3 py-2 font-mono ${
                            i % 2 === 0
                              ? (isDark ? "bg-slate-900" : "bg-white")
                              : (isDark ? "bg-slate-950/40" : "bg-slate-50/60")
                          }`}
                        >
                          <span className={isDark ? "text-slate-300" : "text-slate-700"}>{c.field}</span>
                          <span className="text-red-500 truncate" title={c.oldVal}>{c.oldVal || "—"}</span>
                          <span className="text-emerald-500 truncate" title={c.newVal}>{c.newVal || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  // No parsed "old -> new" pairs (CREATE/DELETE/EXPORT/toggle logs, etc.)
                  // — nothing more to show beyond the prefix line above.
                  null
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}