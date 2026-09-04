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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/hooks/use-theme";
import {
  Search, ScanLine, ChevronLeft, ChevronRight, Zap,
  Wifi, WifiOff, Wrench, HelpCircle, Plus, Loader2,
} from "lucide-react";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { supabase } from "@/lib/supabase";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

type DeviceReader = {
  id: number;
  device_id: string;      // e.g. "RDR-001"
  name: string;            // e.g. "Terminal 1 - Gate A"
  location: string;        // e.g. "Calbayog Terminal"
  status: string;          // ONLINE, OFFLINE, MAINTENANCE
  ip_address: string;
  last_ping: string;       // ISO timestamp
  firmware_version: string;
};

// ── Status badge styling ─────────────────────────────────────────────────────

function statusMeta(status: string, isDark: boolean) {
  const key = status.toUpperCase();
  const map: Record<string, { icon: any; light: string; dark: string }> = {
    ONLINE:      { icon: Wifi,     light: "bg-emerald-50 text-emerald-600 border-emerald-200", dark: "bg-emerald-950/40 text-emerald-400 border-emerald-900" },
    OFFLINE:     { icon: WifiOff,  light: "bg-red-50 text-red-600 border-red-200",              dark: "bg-red-950/40 text-red-400 border-red-900" },
    MAINTENANCE: { icon: Wrench,   light: "bg-amber-50 text-amber-600 border-amber-200",        dark: "bg-amber-950/40 text-amber-400 border-amber-900" },
  };
  const fallback = { icon: HelpCircle, light: "bg-slate-100 text-slate-500 border-slate-200", dark: "bg-slate-800 text-slate-400 border-slate-700" };
  const meta = map[key] ?? fallback;
  return { Icon: meta.icon, className: isDark ? meta.dark : meta.light };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DeviceReaderPage() {
  const { isDark } = useTheme();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const [devices, setDevices] = useState<DeviceReader[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  // ── Add Device dialog state ──────────────────────────────────────────────
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newDevice, setNewDevice] = useState({
    device_id: "",
    name: "",
    location: "",
    ip_address: "",
    firmware_version: "",
  });

  // ── Fetch devices from Supabase, with realtime updates ─────────────────
  const loadDevices = async () => {
    const { data, error } = await supabase
      .from("devices")
      .select("id, device_id, name, location, status, ip_address, last_ping, firmware_version")
      .order("last_ping", { ascending: false });
    if (!error && data) setDevices(data as DeviceReader[]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadDevices();
    const channel = supabase
      .channel("admin_devices")
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, loadDevices)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useRealtimeRefetch(["devices"], () => { loadDevices(); });

  // ── Update status (dropdown sa row) ─────────────────────────────────────────
  const handleStatusChange = async (deviceId: number, newStatus: string) => {
    const { error } = await supabase
      .from("devices")
      .update({ status: newStatus })
      .eq("id", deviceId);

    if (error) {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Status Updated", description: `Device set to ${newStatus}.` });
    }
  };

  // ── Create new device ────────────────────────────────────────────────────────
  const handleAddDevice = async () => {
    if (!newDevice.device_id.trim() || !newDevice.name.trim() || !newDevice.location.trim()) {
      toast({ title: "Missing Fields", description: "Device ID, name, and location are required.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.from("devices").insert({
      device_id: newDevice.device_id.trim(),
      name: newDevice.name.trim(),
      location: newDevice.location.trim(),
      ip_address: newDevice.ip_address.trim() || null,
      firmware_version: newDevice.firmware_version.trim() || null,
      status: "OFFLINE",
    });
    setIsSaving(false);

    if (error) {
      toast({ title: "Failed to Add Device", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Device Added", description: `${newDevice.name} has been registered.` });
    setNewDevice({ device_id: "", name: "", location: "", ip_address: "", firmware_version: "" });
    setAddDialogOpen(false);
  };

  // ── Derive filter option lists from the data itself ────────────────────────
  const statusOptions = Array.from(new Set(devices.map((d) => d.status))).sort();
  const locationOptions = Array.from(new Set(devices.map((d) => d.location))).sort();

  // ── Filtering ────────────────────────────────────────────────────────────
  const filteredList = useMemo(() => {
    return devices.filter((device) => {
      if (statusFilter !== "all" && device.status !== statusFilter) return false;
      if (locationFilter !== "all" && device.location !== locationFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !device.name.toLowerCase().includes(q) &&
          !device.device_id.toLowerCase().includes(q) &&
          !device.location.toLowerCase().includes(q) &&
          !device.ip_address.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [devices, statusFilter, locationFilter, search]);

  useEffect(() => { setPage(1); }, [search, statusFilter, locationFilter]);

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

  const onlineCount = devices.filter((d) => d.status.toUpperCase() === "ONLINE").length;
  const offlineCount = devices.filter((d) => d.status.toUpperCase() === "OFFLINE").length;

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
            <ScanLine className="text-blue-500" size={26} />
            Device Reader
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Monitor registered card readers and their connection status
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2">
                <Plus size={14} />
                Add Device
              </Button>
            </DialogTrigger>
            <DialogContent className={isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}>
              <DialogHeader>
                <DialogTitle className={isDark ? "text-white" : "text-slate-900"}>Register New Device</DialogTitle>
                <VisuallyHidden>
                  <DialogDescription>Add a new device reader to the system.</DialogDescription>
                </VisuallyHidden>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Device ID</Label>
                  <Input
                    placeholder="e.g. RDR-004"
                    value={newDevice.device_id}
                    onChange={(e) => setNewDevice({ ...newDevice, device_id: e.target.value })}
                    className={isDark ? "bg-slate-900 border-slate-800 text-white" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Name</Label>
                  <Input
                    placeholder="e.g. Terminal 2 - Gate C"
                    value={newDevice.name}
                    onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
                    className={isDark ? "bg-slate-900 border-slate-800 text-white" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Location</Label>
                  <Input
                    placeholder="e.g. Calbayog Terminal"
                    value={newDevice.location}
                    onChange={(e) => setNewDevice({ ...newDevice, location: e.target.value })}
                    className={isDark ? "bg-slate-900 border-slate-800 text-white" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide">IP Address (optional)</Label>
                  <Input
                    placeholder="e.g. 192.168.1.104"
                    value={newDevice.ip_address}
                    onChange={(e) => setNewDevice({ ...newDevice, ip_address: e.target.value })}
                    className={isDark ? "bg-slate-900 border-slate-800 text-white" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide">Firmware Version (optional)</Label>
                  <Input
                    placeholder="e.g. v1.0.0"
                    value={newDevice.firmware_version}
                    onChange={(e) => setNewDevice({ ...newDevice, firmware_version: e.target.value })}
                    className={isDark ? "bg-slate-900 border-slate-800 text-white" : ""}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAddDevice} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Device"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-2 border rounded-lg ${isDark ? "bg-emerald-950/40 border-emerald-900" : "bg-emerald-50 border-emerald-100"}`}>
              <Wifi className="text-emerald-500" size={14} />
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>{onlineCount} Online</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 border rounded-lg ${isDark ? "bg-red-950/40 border-red-900" : "bg-red-50 border-red-100"}`}>
              <WifiOff className="text-red-500" size={14} />
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-red-400" : "text-red-700"}`}>{offlineCount} Offline</span>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
              <Zap className="text-blue-500" size={16} />
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>Live Telemetry Active</span>
            </div>
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
                placeholder="Search device ID, name, location or IP..."
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className={`w-full lg:w-[150px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Status</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s} className="cursor-pointer">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className={`w-full lg:w-[170px] font-medium text-xs cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                  <SelectItem value="all" className="cursor-pointer">All Locations</SelectItem>
                  {locationOptions.map((l) => (
                    <SelectItem key={l} value={l} className="cursor-pointer">{l}</SelectItem>
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
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Device ID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Name</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Location</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>IP Address</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Last Ping</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Firmware</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-32">
                          <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                            <ScanLine size={48} className="mb-2" />
                            <p className="text-xs font-semibold uppercase tracking-widest">No devices found</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedList.map((device) => {
                        const { Icon, className } = statusMeta(device.status, isDark);
                        return (
                          <TableRow
                            key={device.id}
                            className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                              newRowId === device.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                              {device.device_id}
                            </TableCell>
                            <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                              {device.name}
                            </TableCell>
                            <TableCell className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                              {device.location}
                            </TableCell>
                            <TableCell>
                              <Select value={device.status} onValueChange={(val) => handleStatusChange(device.id, val)}>
                                <SelectTrigger className={`h-7 w-[140px] text-[10px] font-semibold gap-1 border cursor-pointer ${className}`}>
                                  <div className="flex items-center gap-1">
                                    <Icon className="w-3 h-3" />
                                    <SelectValue />
                                  </div>
                                </SelectTrigger>
                                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"}>
                                  <SelectItem value="ONLINE" className="cursor-pointer">ONLINE</SelectItem>
                                  <SelectItem value="OFFLINE" className="cursor-pointer">OFFLINE</SelectItem>
                                  <SelectItem value="MAINTENANCE" className="cursor-pointer">MAINTENANCE</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                              {device.ip_address}
                            </TableCell>
                            <TableCell className={`text-xs font-mono whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {new Date(device.last_ping).toLocaleString()}
                            </TableCell>
                            <TableCell className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                              {device.firmware_version}
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
                  of <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{filteredList.length}</span> devices
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
    </div>
  );
}