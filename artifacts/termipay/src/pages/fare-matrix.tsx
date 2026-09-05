import { useState, useMemo, useRef, useEffect } from "react";
import {
  useListRoutes,
  useCreateRoute,
  useUpdateRoute,
  useDeleteRoute,
  useToggleRoute,
  getListRoutesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase"; // 👈 adjust to your actual supabase client path
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import {
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Power,
  PowerOff,
  ArrowLeftRight,
  CheckCircle2,
  AlertCircle,
  Search,
  Zap,
  ShieldAlert,
  Cpu,
  Wifi,
  WifiOff,
} from "lucide-react";
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
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";

const CALBAYOG_BARANGAYS = [
  "Bugtong",
  "Tinaplacan",
  "Malaga",
  "Cag-Manipis",
  "Malayog",
  "Peña",
  "Cag-Olango",
  "Cagnipa",
  "San Joaquin",
  "Baay",
  "Binaliw",
  "Manginoo",
  "Bantian",
  "Marcatubig",
  "Malajog",
  "Malopalo",
  "Tinambacan",
  "Amampacang",
  "Lonoy",
  "Sabang",
  "Talahid",
];

const DEFAULT_DESTINATION = "Calbayog";

// ✅ Small helper so the toast title shows a green check icon next to the text
function SuccessTitle({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2.5} />
      {text}
    </span>
  );
}

// ✅ Device type coming from Supabase `devices` table
type Device = {
  device_id: string;
  name: string;
  location: string | null;
  status: string;
  ip_address: string | null;
  firmware_version: string | null;
  last_ping: string | null;
  created_at: string;
  // updated_at removed — column does not exist on this table
};

export default function FareMatrixPage() {
  const { isDark } = useTheme();
  const [showAdd, setShowAdd] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [addForm, setAddForm] = useState({
    origin: "",
    destination: DEFAULT_DESTINATION,
    fareAmount: "",
    viceVersa: true,
  });
  const [editRoute, setEditRoute] = useState<any>(null);
  const [deleteRoute, setDeleteRoute] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    origin: "",
    destination: "",
    fareAmount: "",
  });
  // Snapshot of the edit form's values at the moment the dialog opened — used
  // to detect whether the user actually changed anything before allowing Save.
  const [originalEditForm, setOriginalEditForm] = useState(editForm);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ✅ Activate-with-device modal state
  const [activateRoute, setActivateRoute] = useState<any>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  // ✅ Holds the actual device row linked to the currently active route,
  // fetched live from Supabase — powers the "Reader: ..." badge.
  const [activeDeviceInfo, setActiveDeviceInfo] = useState<Device | null>(null);
  const [loadingActiveDevice, setLoadingActiveDevice] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: routes, isLoading, refetch: refetchRoutes } = useListRoutes(undefined, {
    query: {
      refetchOnWindowFocus: true,
    },
  });

  useRealtimeRefetch(["fare_routes"], () => {
    refetchRoutes();
  });

  useEffect(() => {
    if (Array.isArray(routes) && routes.length >= 0) {
      setLastUpdated(new Date());
    }
  }, [routes]);

  const activeRoute = Array.isArray(routes)
    ? routes.find((r) => r.isActive) ?? null
    : null;

  // ✅ FIXED: fetch the device_id straight from the `fare_routes` table in
  // Supabase instead of trusting the generated API client to expose it.
  // The API client's serialized route object doesn't reliably include the
  // device_id/deviceId field, so we go directly to the DB for it, then use
  // that id to look up the device row.
  const fetchRouteDeviceIdFromDb = async (
    routeId: string | number
  ): Promise<string | null> => {
    const { data, error } = await supabase
      .from("fare_routes") // 👈 adjust table name if different
      .select("device_id") // 👈 adjust column name if different
      .eq("id", routeId) // 👈 adjust PK column name if different
      .maybeSingle();

    if (error || !data) return null;
    return (data as { device_id: string | null }).device_id ?? null;
  };

  const fetchActiveRouteDevice = async (routeId: string | number | null) => {
    if (!routeId) {
      setActiveDeviceInfo(null);
      return;
    }
    setLoadingActiveDevice(true);

    const deviceId = await fetchRouteDeviceIdFromDb(routeId);
    if (!deviceId) {
      setActiveDeviceInfo(null);
      setLoadingActiveDevice(false);
      return;
    }

    const { data, error } = await supabase
      .from("devices")
      .select(
        "device_id, name, location, status, ip_address, firmware_version, last_ping, created_at"
      )
      .eq("device_id", deviceId)
      .maybeSingle();

    setActiveDeviceInfo(error ? null : (data as Device) ?? null);
    setLoadingActiveDevice(false);
  };

  useEffect(() => {
    fetchActiveRouteDevice(activeRoute?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute?.id]);

  // ✅ Keep the active-route device badge live too (e.g. reflects if reader goes offline)
  useRealtimeRefetch(["devices"], () => {
    if (activateRoute) {
      fetchActiveDevices();
    }
    fetchActiveRouteDevice(activeRoute?.id ?? null);
  });

  const sortOrderRef = useRef<(string | number)[]>([]);

  const filteredRoutes = useMemo(() => {
    if (!Array.isArray(routes)) return [];

    const filtered = routes.filter(
      (r) =>
        r.origin.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.destination.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const activeItems = filtered.filter((r) => r.isActive);
    const inactiveItems = filtered.filter((r) => !r.isActive);

    inactiveItems.sort((a, b) => {
      const ai = sortOrderRef.current.indexOf(a.id);
      const bi = sortOrderRef.current.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const sorted = [...activeItems, ...inactiveItems];
    sortOrderRef.current = sorted.map((r) => r.id);
    return sorted;
  }, [routes, searchTerm]);

  const createMutation = useCreateRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      },
    },
  });

  const updateMutation = useUpdateRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
        setEditRoute(null);
        toast({ title: <SuccessTitle text="Route Updated Successfully" /> });
      },
    },
  });

  const deleteMutation = useDeleteRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
        toast({ title: <SuccessTitle text="Route Deleted Successfully" /> });
      },
    },
  });

  const toggleMutation = useToggleRoute({
    mutation: {
      onMutate: async ({ id }: { id: string | number }) => {
        await queryClient.cancelQueries({ queryKey: getListRoutesQueryKey() });
        const previous = queryClient.getQueryData(getListRoutesQueryKey());
        queryClient.setQueryData(getListRoutesQueryKey(), (old: any) => {
          if (!Array.isArray(old)) return old;
          const clickedIsCurrentlyActive = old.find((r: any) => r.id === id)?.isActive;
          return old.map((r: any) => ({
            ...r,
            isActive: clickedIsCurrentlyActive ? (r.id === id ? false : r.isActive) : r.id === id,
          }));
        });
        return { previous };
      },
      onError: (_err: any, _vars: any, context: any) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(getListRoutesQueryKey(), context.previous);
        }
        toast({ title: "Failed to update route status", variant: "destructive" });
      },
      onSuccess: () => {
        toast({ title: <SuccessTitle text="Route Status Updated" /> });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      },
    },
  });

  const openEdit = (route: any) => {
    setEditRoute(route);
    const initial = {
      origin: route.origin,
      destination: route.destination,
      fareAmount: String(route.fareAmount),
    };
    setEditForm(initial);
    setOriginalEditForm(initial);
  };

  // True only if origin, destination, or fare amount actually differ from
  // what they were when the Edit dialog opened.
  const hasRouteChanges =
    editForm.origin.trim() !== originalEditForm.origin.trim() ||
    editForm.destination.trim() !== originalEditForm.destination.trim() ||
    editForm.fareAmount.trim() !== originalEditForm.fareAmount.trim();

  // ✅ Fetch active (ONLINE) devices from Supabase — fully dynamic, no hardcoding
  const fetchActiveDevices = async () => {
    setLoadingDevices(true);
    const { data, error } = await supabase
      .from("devices")
      .select(
        "device_id, name, location, status, ip_address, firmware_version, last_ping, created_at"
      )
      .eq("status", "ONLINE") // 👈 matches the actual enum value in the devices table
      .order("name", { ascending: true });

    if (error) {
      toast({ title: "Failed to load devices", variant: "destructive" });
      setDevices([]);
    } else {
      setDevices((data as Device[]) ?? []);
    }
    setLoadingDevices(false);
  };

  const openActivateModal = (route: any) => {
    setActivateRoute(route);
    setSelectedDeviceId("");
    fetchActiveDevices();
  };

  const confirmActivate = () => {
    if (!activateRoute || !selectedDeviceId) return;
    toggleMutation.mutate(
      {
        id: activateRoute.id,
        data: { deviceId: selectedDeviceId }, // 👈 adjust field name to match your API payload
      } as any,
      {
        onSuccess: async () => {
          // ⚠️ WORKAROUND: the toggle-route API doesn't persist device_id onto
          // fare_routes (confirmed null in the DB), so we write it directly
          // to Supabase here as a stopgap. The real fix belongs in the
          // backend's toggle/activate route handler — once that's fixed,
          // this direct write can be removed.
          const { error } = await supabase
            .from("fare_routes") // 👈 adjust table name if different
            .update({ device_id: selectedDeviceId }) // 👈 adjust column name if different
            .eq("id", activateRoute.id); // 👈 adjust PK column name if different

          if (error) {
            toast({
              title: "Route activated, but failed to link device",
              variant: "destructive",
            });
          } else {
            // Refresh the reader badge immediately instead of waiting for
            // the realtime subscription to catch up.
            fetchActiveRouteDevice(activateRoute.id);
          }

          setActivateRoute(null);
          setSelectedDeviceId("");
        },
      }
    );
  };

  const handleAdd = async () => {
    const origin = addForm.origin.trim();
    const destination = addForm.destination.trim();
    const fare = parseFloat(addForm.fareAmount) || 0;
    if (!origin || !destination || fare <= 0) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        data: { origin, destination, fareAmount: fare },
      });

      if (addForm.viceVersa && origin !== destination) {
        await createMutation.mutateAsync({
          data: { origin: destination, destination: origin, fareAmount: fare },
        });
      }

      setShowAdd(false);
      setAddForm({
        origin: "",
        destination: DEFAULT_DESTINATION,
        fareAmount: "",
        viceVersa: true,
      });

      toast({
        title: (
          <SuccessTitle
            text={
              addForm.viceVersa
                ? "Routes Added (Both Directions)"
                : "Route Added Successfully"
            }
          />
        ),
      });
    } catch (error) {
      toast({ title: "Failed to add route", variant: "destructive" });
    }
  };

  const confirmDelete = () => {
    if (!deleteRoute) return;
    deleteMutation.mutate(
      { id: deleteRoute.id },
      { onSettled: () => setDeleteRoute(null) }
    );
  };

  const handleUpdate = () => {
    if (!editRoute || !hasRouteChanges) return;
    const origin = editForm.origin.trim();
    const destination = editForm.destination.trim();
    const fare = parseFloat(editForm.fareAmount) || 0;
    if (!origin || !destination || fare <= 0) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: editRoute.id,
      data: { origin, destination, fareAmount: fare },
    });
  };

  return (
    <div className={`space-y-8 ${isDark ? "text-slate-200" : "text-slate-800"}`} data-testid="fare-matrix-page">
      <style>{`
        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }
      `}</style>

      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
            <MapPin className="w-6 h-6 text-blue-500" />
            Fare Matrix
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Manage transit routes and fares for RFID tap deduction
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3 flex-nowrap">
            <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg shrink-0 whitespace-nowrap ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
              <Zap className="text-blue-500" size={16} />
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-blue-400" : "text-blue-700"}`}>Live Telemetry Active</span>
            </div>
            <Button
              onClick={() => setShowAdd(true)}
              data-testid="button-add-route"
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Route
            </Button>
          </div>
        </div>
      </div>

      <div
        className={`rounded-xl border p-4 sm:p-5 flex items-center justify-between gap-4 ${
          activeRoute
            ? isDark ? "border-emerald-900 bg-emerald-950/30" : "border-emerald-200 bg-emerald-50"
            : isDark ? "border-amber-900 bg-amber-950/30" : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${
            activeRoute
              ? isDark ? "bg-emerald-900/50" : "bg-emerald-100"
              : isDark ? "bg-amber-900/50" : "bg-amber-100"
          }`}>
            {activeRoute ? (
              <CheckCircle2 className={`w-6 h-6 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
            ) : (
              <AlertCircle className={`w-6 h-6 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
            )}
          </div>
          <div>
            <p className={`font-semibold text-sm ${
              activeRoute
                ? isDark ? "text-emerald-400" : "text-emerald-700"
                : isDark ? "text-amber-400" : "text-amber-700"
            }`}>
              {activeRoute ? "Active Route — RFID Ready" : "No Active Route"}
            </p>
            {activeRoute ? (
              <p className={`font-bold text-lg tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
                {activeRoute.origin} → {activeRoute.destination} &nbsp;·&nbsp; ₱
                {activeRoute.fareAmount.toFixed(2)} per tap
              </p>
            ) : (
              <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                Activate a route below so the ESP32 RFID reader can process fare deductions.
              </p>
            )}
          </div>
        </div>

        {/* ✅ FIXED: RFID Reader badge pulls device_id straight from the fare_routes
            table via fetchActiveRouteDevice, then resolves the device name from
            the devices table (via activeDeviceInfo). No more hardcoded IDs and
            no more relying on the API client to expose deviceId/device_id. */}
        {activeRoute && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0 ${
              isDark ? "bg-slate-900/60 border-emerald-900" : "bg-white border-emerald-200"
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
            <span className={`text-xs font-semibold ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
              {loadingActiveDevice
                ? "Reader: Loading..."
                : activeDeviceInfo?.name
                  ? `Reader: ${activeDeviceInfo.name}`
                  : "Reader: Unassigned"}
            </span>
          </div>
        )}
      </div>

      <Card className={`h-full shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
        <CardHeader className={`pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 flex items-center gap-3">
              <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${
                isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
              }`}>
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                LIVE
              </span>
              <div>
                <CardTitle className={`text-sm font-bold flex items-center gap-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  <MapPin className="w-4 h-4 text-blue-500" />
                  Configured Routes
                </CardTitle>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Only <strong>one route</strong> can be active at a time. Active route is pinned to the top.
                </p>
              </div>
            </div>
            <div className="relative w-full md:w-72">
              <Search className={`absolute left-2.5 top-2.5 h-4 w-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
              <Input
                placeholder="Search origin or destination..."
                className={`pl-9 focus-visible:ring-blue-500 ${
                  isDark
                    ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                }`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-y-auto p-0 px-6 pb-6">
          {isLoading ? (
            <div className="space-y-4 pt-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : (
            <div className={`relative mt-6 overflow-x-auto max-h-[500px] overflow-y-auto rounded-md border ${isDark ? "border-slate-800" : "border-slate-200"}`}>
              <Table>
                <TableHeader className={`sticky top-0 z-10 border-b ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                  <TableRow className="border-none hover:bg-transparent">
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Origin</TableHead>
                    <TableHead />
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Destination</TableHead>
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Fare Amount</TableHead>
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                    <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Activate</TableHead>
                    <TableHead className={`text-right text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoutes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20">
                        <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                          <MapPin size={48} className="mb-2" />
                          <p className="text-xs font-semibold uppercase tracking-widest">
                            {searchTerm ? "No routes matched" : "No routes configured"}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRoutes.map((route) => (
                      <TableRow
                        key={route.id}
                        data-testid={`row-route-${route.id}`}
                        className={`transition-all duration-300 ease-in-out ${
                          route.isActive
                            ? isDark
                              ? "bg-emerald-950/20 shadow-[inset_2px_0_0_0_rgb(16,185,129)] border-slate-800"
                              : "bg-emerald-50/50 shadow-[inset_2px_0_0_0_rgb(16,185,129)] border-slate-100"
                            : isDark
                              ? "hover:bg-slate-800/50 border-slate-800"
                              : "hover:bg-slate-50 border-slate-100"
                        }`}
                      >
                        <TableCell className={`font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-blue-500" />
                            {route.origin}
                          </div>
                        </TableCell>
                        <TableCell className={`text-xs px-1 ${isDark ? "text-slate-600" : "text-slate-300"}`}>→</TableCell>
                        <TableCell className={`font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                          <div className="flex items-center gap-2">
                            <MapPin className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                            {route.destination}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`font-bold ${isDark ? "text-white" : "text-slate-900"} ${route.isActive ? "text-base" : "text-sm"}`}>
                            ₱{route.fareAmount.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={route.isActive ? "default" : "secondary"}
                            className={
                              route.isActive
                                ? isDark
                                  ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900"
                                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : isDark
                                  ? "bg-slate-800 text-slate-400 border border-slate-700"
                                  : "bg-slate-100 text-slate-500 border border-slate-200"
                            }
                          >
                            {route.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={route.isActive ? "destructive" : "default"}
                            className={
                              (route.isActive
                                ? "bg-red-500 hover:bg-red-600 text-white"
                                : "bg-emerald-600 hover:bg-emerald-700 text-white") +
                              " cursor-pointer disabled:cursor-not-allowed"
                            }
                            onClick={() => {
                              if (route.isActive) {
                                // Deactivating doesn't need a device selection
                                toggleMutation.mutate({ id: route.id });
                              } else {
                                // Activating opens the device-selection modal
                                openActivateModal(route);
                              }
                            }}
                            disabled={toggleMutation.isPending}
                            data-testid={`toggle-route-${route.id}`}
                          >
                            {route.isActive ? (
                              <><PowerOff className="w-3.5 h-3.5 mr-1" /> Deactivate</>
                            ) : (
                              <><Power className="w-3.5 h-3.5 mr-1" /> Activate</>
                            )}
                          </Button>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-8 w-8 cursor-pointer ${isDark ? "text-blue-400 hover:text-blue-300 hover:bg-blue-950/40" : "text-blue-500 hover:text-blue-700 hover:bg-blue-50"}`}
                              onClick={() => openEdit(route)}
                              data-testid={`button-edit-route-${route.id}`}
                              title="Edit route"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-8 w-8 cursor-pointer ${isDark ? "text-red-400 hover:text-red-300 hover:bg-red-950/40" : "text-red-500 hover:text-red-700 hover:bg-red-50"}`}
                              onClick={() => setDeleteRoute(route)}
                              data-testid={`button-delete-route-${route.id}`}
                              title="Delete route"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
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

      {/* Add Route Dialog */}
      <Dialog
        open={showAdd}
        onOpenChange={(open) => {
          setShowAdd(open);
          if (!open)
            setAddForm({ origin: "", destination: DEFAULT_DESTINATION, fareAmount: "", viceVersa: true });
        }}
      >
        <DialogContent className={`[&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <div className="absolute top-0 left-0 w-full h-[2px] bg-blue-600/60" />
          <DialogHeader>
            <DialogTitle className={`font-bold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
              Add New Route
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Origin (Barangay)</Label>
              <Input
                data-testid="input-add-origin"
                list="barangay-suggestions"
                placeholder="Type or select barangay..."
                value={addForm.origin}
                onChange={(e) => setAddForm({ ...addForm, origin: e.target.value })}
                className={isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}
              />
            </div>
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Destination</Label>
              <Input
                data-testid="input-add-destination"
                list="barangay-suggestions"
                placeholder="Type or select destination..."
                value={addForm.destination}
                onChange={(e) => setAddForm({ ...addForm, destination: e.target.value })}
                className={isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}
              />
            </div>
            <datalist id="barangay-suggestions">
              <option value={DEFAULT_DESTINATION} />
              {CALBAYOG_BARANGAYS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Fare Amount (PHP)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className={`font-semibold focus-visible:ring-emerald-500 ${isDark ? "bg-slate-950 border-slate-800 text-emerald-400" : "bg-white border-slate-200 text-emerald-600"}`}
                value={addForm.fareAmount}
                onChange={(e) => setAddForm({ ...addForm, fareAmount: e.target.value })}
                data-testid="input-add-fare"
              />
            </div>
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
              <Checkbox
                id="vice-versa"
                checked={addForm.viceVersa}
                onCheckedChange={(v) => setAddForm({ ...addForm, viceVersa: !!v })}
                className="cursor-pointer"
              />
              <div>
                <Label htmlFor="vice-versa" className={`font-medium cursor-pointer flex items-center gap-1 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  Add vice versa route
                </Label>
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                  Also creates the reverse direction at the same fare
                </p>
              </div>
            </div>
            {addForm.origin && addForm.destination && (
              <div className={`text-sm border rounded-lg p-3 space-y-1 ${isDark ? "text-slate-300 bg-blue-950/30 border-blue-900" : "text-slate-700 bg-blue-50 border-blue-100"}`}>
                <p className={`font-medium ${isDark ? "text-blue-400" : "text-blue-700"}`}>Routes to be created:</p>
                <p>• {addForm.origin} → {addForm.destination} @ ₱{addForm.fareAmount || "0.00"}</p>
                {addForm.viceVersa && addForm.origin !== addForm.destination && (
                  <p>• {addForm.destination} → {addForm.origin} @ ₱{addForm.fareAmount || "0.00"}</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setShowAdd(false)}
              className={`cursor-pointer ${isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              data-testid="button-save-route"
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? "Adding..." : "Add Route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Route Dialog — styled to match User Management's Edit User dialog */}
      <Dialog open={!!editRoute} onOpenChange={(open) => !open && setEditRoute(null)}>
        <DialogContent className={`[&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-500">
              <Pencil size={18} /> Update Route
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Origin</Label>
              <Input
                data-testid="input-edit-origin"
                list="barangay-suggestions-edit"
                placeholder="Type or select barangay..."
                value={editForm.origin}
                onChange={(e) => setEditForm({ ...editForm, origin: e.target.value })}
                className={`text-sm font-medium ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200"}`}
              />
            </div>
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Destination</Label>
              <Input
                data-testid="input-edit-destination"
                list="barangay-suggestions-edit"
                placeholder="Type or select destination..."
                value={editForm.destination}
                onChange={(e) => setEditForm({ ...editForm, destination: e.target.value })}
                className={`text-sm font-medium ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200"}`}
              />
            </div>
            <datalist id="barangay-suggestions-edit">
              <option value={DEFAULT_DESTINATION} />
              {CALBAYOG_BARANGAYS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Fare Amount (PHP)</Label>
              <Input
                type="number"
                step="0.01"
                className={`font-semibold text-sm font-mono focus-visible:ring-emerald-500 ${isDark ? "bg-slate-950 border-slate-800 text-emerald-400" : "bg-white border-slate-200 text-emerald-600"}`}
                value={editForm.fareAmount}
                onChange={(e) => setEditForm({ ...editForm, fareAmount: e.target.value })}
                data-testid="input-edit-fare"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditRoute(null)}
              className={`text-xs font-medium cursor-pointer ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500"}`}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending || !hasRouteChanges}
              title={!hasRouteChanges ? "No changes to save" : undefined}
              data-testid="button-update-route"
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-6 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-600"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Activate Route Dialog — device selection, pulled live from Supabase `devices` table */}
      <Dialog
        open={!!activateRoute}
        onOpenChange={(open) => {
          if (!open) {
            setActivateRoute(null);
            setSelectedDeviceId("");
          }
        }}
      >
        <DialogContent className={`[&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-emerald-500">
              <Power size={18} /> Activate Route
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {activateRoute && (
              <div className={`text-sm border rounded-lg p-3 ${isDark ? "text-slate-300 bg-slate-950/60 border-slate-800" : "text-slate-700 bg-slate-50 border-slate-200"}`}>
                <p className="font-semibold flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-blue-500" />
                  {activateRoute.origin} → {activateRoute.destination}
                </p>
                <p className={`mt-1 ${isDark ? "text-emerald-400" : "text-emerald-600"} font-bold`}>
                  ₱{activateRoute.fareAmount?.toFixed(2)} per tap
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label className={`text-xs font-semibold flex items-center gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <Cpu className="w-3.5 h-3.5" />
                Select Active Device (RFID Reader)
              </Label>
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId} disabled={loadingDevices}>
                <SelectTrigger
                  data-testid="select-activate-device"
                  className={isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"}
                >
                  <SelectValue placeholder={loadingDevices ? "Loading devices..." : "Choose a device"} />
                </SelectTrigger>
                <SelectContent>
                  {!loadingDevices && devices.length === 0 && (
                    <div className={`px-3 py-4 text-xs text-center ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      No active devices found
                    </div>
                  )}
                  {devices.map((d) => (
                    <SelectItem key={d.device_id} value={d.device_id} data-testid={`device-option-${d.device_id}`}>
                      <div className="flex items-center gap-2">
                        <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                        <span>
                          {d.name}
                          {d.location ? ` · ${d.location}` : ""}
                          {d.ip_address ? ` · ${d.ip_address}` : ""}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!loadingDevices && devices.length === 0 && (
                <p className={`text-xs flex items-center gap-1 mt-1 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                  <WifiOff className="w-3 h-3" />
                  No devices are currently online. Check ESP32 connectivity.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setActivateRoute(null);
                setSelectedDeviceId("");
              }}
              className={`cursor-pointer ${isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmActivate}
              disabled={!selectedDeviceId || toggleMutation.isPending}
              data-testid="button-confirm-activate"
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:cursor-not-allowed"
            >
              {toggleMutation.isPending ? "Activating..." : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm — styled to match User Management's Delete Confirm dialog */}
      <AlertDialog open={!!deleteRoute} onOpenChange={(open) => !open && setDeleteRoute(null)}>
        <AlertDialogContent className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <AlertDialogHeader>
            <AlertDialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <ShieldAlert className="text-red-500" size={18} /> Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              This will permanently remove this route from the fare matrix. If this route is
              currently active, RFID tap deductions will stop working until another route is
              activated. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending}
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed ${
                isDark ? "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-700 font-semibold text-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {deleteMutation.isPending ? "Deleting..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}