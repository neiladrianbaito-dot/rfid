import { useState, useMemo, useRef, useEffect } from "react";
import {
  useListRoutes,
  useCreateRoute,
  useUpdateRoute,
  useDeleteRoute,
  getListRoutesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase"; // 👈 adjust to your actual supabase client path
import { useAuth } from "@/hooks/use-auth"; // ⬅️ NEW: for the current admin's username
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
  Map,
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

// 🔒 ADMIN ACCESS: nagbibigay ng `canManage` (false kapag view_only ang admin)
// at `loaded` (true kapag tapos na ma-fetch ang access info).
import { useAdminAccess } from "@/hooks/use-admin-access";

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
// NOTE: `location` column removed — it does not exist on this table.
type Device = {
  device_id: string;
  name: string;
  status: string;
  ip_address: string | null;
  firmware_version: string | null;
  last_ping: string | null;
  created_at: string;
  // updated_at removed — column does not exist on this table
};

export default function FareMatrixPage() {
  const { isDark } = useTheme();
  const { user } = useAuth(); // ⬅️ NEW: current logged-in admin
  // ⬅️ NEW: username to attribute audit log entries to when activating/
  // deactivating a route (matches GetMeResponse.username from api-zod).
  const actorUsername = user?.username ?? "unknown";

  // 🔒 ADMIN ACCESS: `canManage` = false kapag view_only.
  // `loaded` = true kapag tapos na ma-load ang access info.
  const { canManage, loaded } = useAdminAccess();

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

  // ✅ Holds the device rows linked to EACH currently active route, keyed by
  // route id — fetched live from Supabase, powers the "Reader: ..." badges.
  // Multiple routes can be active at once (one per reader device).
  const [activeDeviceMap, setActiveDeviceMap] = useState<Record<string, Device | null>>({});
  const [loadingActiveDevices, setLoadingActiveDevices] = useState(false);

  // ✅ Replaces toggleMutation.isPending now that activate/deactivate go
  // through Supabase RPC calls instead of the generated toggle-route mutation.
  const [isTogglePending, setIsTogglePending] = useState(false);
  const [pendingRouteId, setPendingRouteId] = useState<string | number | null>(null);

  // 🗺️ MAP PREVIEW — Leaflet is loaded dynamically so this page does not
  // require react-leaflet or Leaflet TypeScript packages.
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<any>(null);
  const leafletLayerRef = useRef<any>(null);
  const leafletRouteLineRef = useRef<any>(null);
  const leafletStartMarkerRef = useRef<any>(null);
  const leafletEndMarkerRef = useRef<any>(null);
  const [mapTab, setMapTab] = useState<"routes" | "map">("routes");
  const [mapRouteId, setMapRouteId] = useState<string | number | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapDistanceKm, setMapDistanceKm] = useState<number | null>(null);
  const [mapDurationMin, setMapDurationMin] = useState<number | null>(null);
  const geocodeCacheRef = useRef<Record<string, [number, number]>>({});
  const mapRequestRef = useRef(0);

  const selectedMapRoute =
    (Array.isArray(routes) ? routes.find((r) => r.id === mapRouteId) : null) ??
    (Array.isArray(routes) && routes.length > 0 ? routes[0] : null);

  const ensureLeaflet = async () => {
    const w = window as any;

    if (w.L) return w.L;

    const existingScript = document.querySelector(
      'script[data-termipay-leaflet="true"]'
    ) as HTMLScriptElement | null;

    const existingCss = document.querySelector(
      'link[data-termipay-leaflet-css="true"]'
    ) as HTMLLinkElement | null;

    if (!existingCss) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.setAttribute("data-termipay-leaflet-css", "true");
      document.head.appendChild(link);
    }

    if (existingScript) {
      await new Promise<void>((resolve, reject) => {
        if (w.L) {
          resolve();
          return;
        }
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Leaflet failed to load")), { once: true });
      });
      return w.L;
    }

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.async = true;
      script.setAttribute("data-termipay-leaflet", "true");
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Leaflet failed to load"));
      document.head.appendChild(script);
    });

    return w.L;
  };

  const geocodePlace = async (place: string): Promise<[number, number]> => {
    const normalized = place.trim().toLowerCase();
    if (geocodeCacheRef.current[normalized]) {
      return geocodeCacheRef.current[normalized];
    }

    const queries = [
      `${place}, Calbayog City, Samar, Philippines`,
      `${place}, Samar, Philippines`,
      `${place}, Philippines`,
    ];

    for (const query of queries) {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
      );

      if (!response.ok) continue;

      const results = await response.json();
      if (Array.isArray(results) && results.length > 0) {
        const coords: [number, number] = [
          Number(results[0].lat),
          Number(results[0].lon),
        ];

        if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
          geocodeCacheRef.current[normalized] = coords;
          return coords;
        }
      }
    }

    throw new Error(`Could not find "${place}" on OpenStreetMap.`);
  };

  const haversineKm = (
    a: [number, number],
    b: [number, number]
  ) => {
    const R = 6371;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLon = ((b[1] - a[1]) * Math.PI) / 180;
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;

    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };

  const clearMapLayers = () => {
    if (leafletLayerRef.current) {
      leafletLayerRef.current.clearLayers();
    }

    leafletRouteLineRef.current = null;
    leafletStartMarkerRef.current = null;
    leafletEndMarkerRef.current = null;
  };

  const loadRouteOnMap = async (route: any) => {
    if (!route || !mapContainerRef.current) return;

    const requestId = ++mapRequestRef.current;
    setMapLoading(true);
    setMapError("");
    setMapDistanceKm(null);
    setMapDurationMin(null);

    try {
      const L = await ensureLeaflet();

      if (!leafletMapRef.current) {
        leafletMapRef.current = L.map(mapContainerRef.current, {
          zoomControl: true,
          scrollWheelZoom: true,
        });

        L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
          }
        ).addTo(leafletMapRef.current);

        leafletLayerRef.current = L.layerGroup().addTo(leafletMapRef.current);
        leafletMapRef.current.setView([12.07, 124.60], 10);
      }

      // Leaflet sometimes calculates a wrong size when the map is inside
      // a hidden tab. Recalculate after the map tab becomes visible.
      setTimeout(() => {
        leafletMapRef.current?.invalidateSize?.();
      }, 50);

      const [origin, destination] = await Promise.all([
        geocodePlace(route.origin),
        geocodePlace(route.destination),
      ]);

      if (requestId !== mapRequestRef.current) return;

      clearMapLayers();

      // Ask OSRM for the actual drivable route instead of simply drawing a
      // straight line between the two places.
      const osrmUrl =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${origin[1]},${origin[0]};${destination[1]},${destination[0]}` +
        `?overview=full&geometries=geojson`;

      const routingResponse = await fetch(osrmUrl);
      let roadCoordinates: [number, number][] = [];
      let distanceKm = haversineKm(origin, destination);
      let durationMin: number | null = null;

      if (routingResponse.ok) {
        const routingData = await routingResponse.json();
        const osrmRoute = routingData?.routes?.[0];

        if (osrmRoute?.geometry?.coordinates?.length) {
          roadCoordinates = osrmRoute.geometry.coordinates.map(
            (point: [number, number]) => [point[1], point[0]]
          );
          distanceKm = Number(osrmRoute.distance) / 1000;
          durationMin = Number(osrmRoute.duration) / 60;
        }
      }

      // Fallback: show a direct line if the routing service is temporarily
      // unavailable. The displayed distance is then marked as estimated.
      if (roadCoordinates.length === 0) {
        roadCoordinates = [origin, destination];
      }

      if (requestId !== mapRequestRef.current) return;

      const line = L.polyline(roadCoordinates, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(leafletLayerRef.current);

      const startMarker = L.marker(origin)
        .addTo(leafletLayerRef.current)
        .bindPopup(
          `<strong>${escapeHtml(route.origin)}</strong><br/>Origin`
        );

      const endMarker = L.marker(destination)
        .addTo(leafletLayerRef.current)
        .bindPopup(
          `<strong>${escapeHtml(route.destination)}</strong><br/>Destination`
        );

      leafletRouteLineRef.current = line;
      leafletStartMarkerRef.current = startMarker;
      leafletEndMarkerRef.current = endMarker;

      const bounds = L.latLngBounds(roadCoordinates);
      leafletMapRef.current.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 14,
      });

      setMapDistanceKm(distanceKm);
      setMapDurationMin(durationMin);
    } catch (error) {
      console.error("Map preview error:", error);
      if (requestId === mapRequestRef.current) {
        setMapError(
          error instanceof Error
            ? error.message
            : "Unable to load the route map."
        );
      }
    } finally {
      if (requestId === mapRequestRef.current) {
        setMapLoading(false);
      }
    }
  };

  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");


  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 🔒 Safety guard helper — ginagamit sa lahat ng Add/Edit/Delete/Activate/
  // Deactivate handlers. Kapag view_only, magpapakita ng toast at ibabalik
  // ang `true` para mag-early return ang caller. Proteksyon ito kahit
  // ma-bypass ang UI.
  const blockIfViewOnly = (): boolean => {
    if (canManage) return false;
    toast({
      title: "View Only Access",
      description: "You don't have permission to perform this action.",
      variant: "destructive",
    });
    return true;
  };

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

  // ✅ Now supports MULTIPLE simultaneous active routes — one per reader
  // device. "Active" is no longer exclusive globally; it's exclusive per
  // device_id (enforced by the activate_route RPC).
  const activeRoutes = Array.isArray(routes) ? routes.filter((r) => r.isActive) : [];

  // ✅ TAB STATE for the "Active Routes" panel — instead of stacking every
  // active route as its own row (which gets unwieldy once several readers
  // are running at once), the panel now shows one tab per active route and
  // a single detail card for whichever tab is selected. Falls back to the
  // first active route whenever the current selection no longer exists
  // (e.g. that route just got deactivated).
  const [selectedActiveRouteId, setSelectedActiveRouteId] = useState<string | number | null>(null);
  const activeRouteIdsKey = activeRoutes.map((r) => r.id).join(",");

  useEffect(() => {
    if (activeRoutes.length === 0) {
      setSelectedActiveRouteId(null);
      return;
    }
    const stillActive = activeRoutes.some((r) => r.id === selectedActiveRouteId);
    if (!stillActive) {
      setSelectedActiveRouteId(activeRoutes[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteIdsKey]);

  const selectedActiveRoute =
    activeRoutes.find((r) => r.id === selectedActiveRouteId) ?? activeRoutes[0] ?? null;

  // ✅ Fetches device info for ALL currently active routes in one go (instead
  // of a single activeDeviceInfo), keyed by route id. We still go straight to
  // the fare_routes table for device_id since the generated API client's
  // route object doesn't reliably expose it.
  const activeDeviceRouteIdsRef = useRef<string>("");

  const fetchActiveRoutesDevices = async (routeIds: (string | number)[]) => {
    if (routeIds.length === 0) {
      activeDeviceRouteIdsRef.current = "";
      setActiveDeviceMap({});
      return;
    }

    // Only flash "Loading..." when the SET of active routes actually changed
    // (not on every background realtime tick, e.g. devices.last_ping).
    const key = [...routeIds].sort().join(",");
    const isNewSet = activeDeviceRouteIdsRef.current !== key;
    if (isNewSet) setLoadingActiveDevices(true);

    const { data: routeRows, error: routeErr } = await supabase
      .from("fare_routes") // 👈 adjust table name if different
      .select("id, device_id") // 👈 adjust column names if different
      .in("id", routeIds);

    if (routeErr || !routeRows) {
      activeDeviceRouteIdsRef.current = key;
      setActiveDeviceMap({});
      setLoadingActiveDevices(false);
      return;
    }

    const deviceIds = Array.from(
      new Set(routeRows.map((r: any) => r.device_id).filter(Boolean))
    );

    let devicesData: Device[] = [];
    if (deviceIds.length > 0) {
      const { data: devs } = await supabase
        .from("devices")
        .select(
          "device_id, name, status, ip_address, firmware_version, last_ping, created_at"
        )
        .in("device_id", deviceIds);
      devicesData = (devs as Device[]) ?? [];
    }

    const map: Record<string, Device | null> = {};
    routeRows.forEach((r: any) => {
      map[String(r.id)] =
        devicesData.find((d) => d.device_id === r.device_id) ?? null;
    });

    activeDeviceRouteIdsRef.current = key;
    setActiveDeviceMap(map);
    if (isNewSet) setLoadingActiveDevices(false);
  };

  useEffect(() => {
    fetchActiveRoutesDevices(activeRoutes.map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(routes) ? routes.filter((r) => r.isActive).map((r) => r.id).join(",") : ""]);

  // ✅ Keep the active-route device badges live too (e.g. reflects if a reader goes offline)
  useRealtimeRefetch(["devices"], () => {
    if (activateRoute) {
      fetchActiveDevices(activateRoute.id);
    }
    fetchActiveRoutesDevices(activeRoutes.map((r) => r.id));
  });

  const sortOrderRef = useRef<(string | number)[]>([]);

  useEffect(() => {
    if (mapTab !== "map") return;

    if (!Array.isArray(routes) || routes.length === 0) {
      setMapRouteId(null);
      return;
    }

    if (!routes.some((r) => r.id === mapRouteId)) {
      setMapRouteId(routes[0].id);
    }
  }, [mapTab, routes, mapRouteId]);

  useEffect(() => {
    if (mapTab !== "map" || !selectedMapRoute) return;

    const timer = window.setTimeout(() => {
      loadRouteOnMap(selectedMapRoute);
    }, 80);

    return () => {
      window.clearTimeout(timer);
      mapRequestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapTab, selectedMapRoute?.id]);

  useEffect(() => {
    return () => {
      mapRequestRef.current += 1;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

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

  const openEdit = (route: any) => {
    // 🔒 Guard: bawal mag-edit kapag view_only
    if (blockIfViewOnly()) return;

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

  // ✅ Fetch active (ONLINE) devices from Supabase, excluding readers that are
  // already assigned to another active route. Each device can only power one
  // active route at a time — once that route is deactivated, the device
  // becomes free and reappears here.
  const fetchActiveDevices = async (excludeRouteId?: string | number) => {
    setLoadingDevices(true);

    // Get device_ids currently in use by OTHER active routes.
    const { data: activeRows, error: activeErr } = await supabase
      .from("fare_routes") // 👈 adjust table name if different
      .select("id, device_id") // 👈 adjust column names if different
      .eq("is_active", true);

    const inUseDeviceIds = (activeRows ?? [])
      .filter((r: any) => r.device_id && r.id !== excludeRouteId)
      .map((r: any) => r.device_id);

    let query = supabase
      .from("devices")
      .select(
        "device_id, name, status, ip_address, firmware_version, last_ping, created_at"
      )
      .eq("status", "ONLINE") // 👈 matches the actual enum value in the devices table
      .order("name", { ascending: true });

    if (inUseDeviceIds.length > 0) {
      query = query.not("device_id", "in", `(${inUseDeviceIds.join(",")})`);
    }

    const { data, error } = await query;

    if (error || activeErr) {
      toast({ title: "Failed to load devices", variant: "destructive" });
      setDevices([]);
    } else {
      setDevices((data as Device[]) ?? []);
    }
    setLoadingDevices(false);
  };

  const openActivateModal = (route: any) => {
    // 🔒 Guard: bawal mag-activate kapag view_only
    if (blockIfViewOnly()) return;

    setActivateRoute(route);
    setSelectedDeviceId("");
    fetchActiveDevices(route.id);
  };

  // ✅ FIXED: activate now goes through a single SECURITY DEFINER Postgres
  // RPC function (`activate_route`) instead of calling the toggle-route API
  // and then separately writing device_id via the client. The old two-step
  // approach could silently fail to persist device_id if RLS blocked the
  // client-side update (no thrown error, just 0 rows updated) — the RPC
  // approach runs at the DB level, bypasses RLS, and is atomic.
  //
  // ✅ VICE VERSA: one physical reader sits on one vehicle and taps riders in
  // BOTH directions (e.g. Barangay A → Calbayog and Calbayog → Barangay A).
  // So activating one direction also activates its reverse-direction
  // counterpart route on the SAME device, if that reverse route exists.
  const findReverseRoute = (route: any) =>
    Array.isArray(routes)
      ? routes.find(
          (r) =>
            r.id !== route.id &&
            r.origin === route.destination &&
            r.destination === route.origin
        ) ?? null
      : null;

  const confirmActivate = async () => {
    // 🔒 Guard: bawal mag-confirm ng activation kapag view_only
    if (blockIfViewOnly()) {
      setActivateRoute(null);
      setSelectedDeviceId("");
      return;
    }

    if (!activateRoute || !selectedDeviceId) return;

    setIsTogglePending(true);
    setPendingRouteId(activateRoute.id);

    const reverseRoute = findReverseRoute(activateRoute);

    const { error } = await supabase.rpc("activate_route", {
      p_route_id: activateRoute.id,
      p_device_id: selectedDeviceId,
      p_actor: actorUsername, // ⬅️ NEW: who activated this route
    });

    if (error) {
      console.error("activate_route error:", error);
      toast({ title: "Failed to activate route", variant: "destructive" });
      setIsTogglePending(false);
      setPendingRouteId(null);
      return;
    }

    // Activate the reverse-direction route too, on the same device. Not
    // fatal if this one fails — the primary direction is already active —
    // but we do surface a toast so it isn't silently missed.
    if (reverseRoute) {
      const { error: reverseError } = await supabase.rpc("activate_route", {
        p_route_id: reverseRoute.id,
        p_device_id: selectedDeviceId,
        p_actor: actorUsername, // ⬅️ NEW: who activated this route
      });
      if (reverseError) {
        console.error("activate_route (reverse) error:", reverseError);
        toast({
          title: "Route activated, but couldn't activate the return direction",
          variant: "destructive",
        });
      }
    }

    toast({ title: <SuccessTitle text="Route Status Updated" /> });

    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
    await fetchActiveRoutesDevices(
      Array.isArray(routes)
        ? [
            ...routes.filter((r) => r.isActive && r.id !== activateRoute.id && r.id !== reverseRoute?.id).map((r) => r.id),
            activateRoute.id,
            ...(reverseRoute ? [reverseRoute.id] : []),
          ]
        : [activateRoute.id]
    );

    // Jump the tab focus to the route that was just activated.
    setSelectedActiveRouteId(activateRoute.id);

    setActivateRoute(null);
    setSelectedDeviceId("");
    setIsTogglePending(false);
    setPendingRouteId(null);
  };

  // ✅ FIXED: deactivate now goes through a matching `deactivate_route` RPC
  // function that also clears device_id, instead of the old toggle mutation.
  // ✅ VICE VERSA: also deactivates the reverse-direction counterpart route
  // (same reasoning as activate — one reader serves both directions).
  const handleDeactivate = async (routeId: string | number) => {
    // 🔒 Guard: bawal mag-deactivate kapag view_only
    if (blockIfViewOnly()) return;

    setIsTogglePending(true);
    setPendingRouteId(routeId);

    const route = Array.isArray(routes) ? routes.find((r) => r.id === routeId) : null;
    const reverseRoute = route ? findReverseRoute(route) : null;

    const { error } = await supabase.rpc("deactivate_route", {
      p_route_id: routeId,
      p_actor: actorUsername, // ⬅️ NEW: who deactivated this route
    });

    if (error) {
      console.error("deactivate_route error:", error);
      toast({ title: "Failed to update route status", variant: "destructive" });
      setIsTogglePending(false);
      setPendingRouteId(null);
      return;
    }

    if (reverseRoute?.isActive) {
      const { error: reverseError } = await supabase.rpc("deactivate_route", {
        p_route_id: reverseRoute.id,
        p_actor: actorUsername, // ⬅️ NEW: who deactivated this route
      });
      if (reverseError) {
        console.error("deactivate_route (reverse) error:", reverseError);
        toast({
          title: "Deactivated, but couldn't deactivate the return direction",
          variant: "destructive",
        });
      }
    }

    toast({ title: <SuccessTitle text="Route Status Updated" /> });
    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
    setIsTogglePending(false);
    setPendingRouteId(null);
  };

  const handleAdd = async () => {
    // 🔒 Guard: bawal mag-add ng route kapag view_only
    if (blockIfViewOnly()) return;

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
    // 🔒 Guard: bawal mag-delete kapag view_only
    if (blockIfViewOnly()) {
      setDeleteRoute(null);
      return;
    }

    if (!deleteRoute) return;
    deleteMutation.mutate(
      { id: deleteRoute.id },
      { onSettled: () => setDeleteRoute(null) }
    );
  };

  const handleUpdate = () => {
    // 🔒 Guard: bawal mag-save ng edit kapag view_only
    if (blockIfViewOnly()) return;

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

            {/* 🔒 Add Route button — makikita lang kapag loaded na at may permission (hindi view_only) */}
            {loaded && canManage && (
              <Button
                onClick={() => setShowAdd(true)}
                data-testid="button-add-route"
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Route
              </Button>
            )}
          </div>
        </div>
      </div>

      <div
        className={`rounded-xl border p-4 sm:p-5 flex flex-col gap-4 ${
          activeRoutes.length > 0
            ? isDark ? "border-emerald-900 bg-emerald-950/30" : "border-emerald-200 bg-emerald-50"
            : isDark ? "border-amber-900 bg-amber-950/30" : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${
            activeRoutes.length > 0
              ? isDark ? "bg-emerald-900/50" : "bg-emerald-100"
              : isDark ? "bg-amber-900/50" : "bg-amber-100"
          }`}>
            {activeRoutes.length > 0 ? (
              <CheckCircle2 className={`w-6 h-6 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
            ) : (
              <AlertCircle className={`w-6 h-6 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
            )}
          </div>
          <div>
            <p className={`font-semibold text-sm ${
              activeRoutes.length > 0
                ? isDark ? "text-emerald-400" : "text-emerald-700"
                : isDark ? "text-amber-400" : "text-amber-700"
            }`}>
              {activeRoutes.length > 0
                ? `${activeRoutes.length} Active Route${activeRoutes.length > 1 ? "s" : ""} — RFID Ready`
                : "No Active Route"}
            </p>
            {activeRoutes.length === 0 && (
              <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                Activate a route below so an ESP32 RFID reader can process fare deductions.
              </p>
            )}
          </div>
        </div>

        {/* ✅ TAB VIEW — one tab per active route instead of stacking every
            active route as its own row. Keeps the panel compact and easy to
            scan even when several readers are active at once; click a tab to
            see that route's fare + assigned reader below. */}
        {activeRoutes.length > 0 && (
          <div className="flex flex-col gap-3">
            <div
              className={`flex items-center gap-1 overflow-x-auto rounded-lg border p-1 ${
                isDark ? "bg-slate-900/60 border-slate-800" : "bg-white/70 border-emerald-200"
              }`}
            >
              {activeRoutes.map((route) => {
                const device = activeDeviceMap[String(route.id)];
                const isSelected = selectedActiveRoute?.id === route.id;
                return (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => setSelectedActiveRouteId(route.id)}
                    title={`${route.origin} → ${route.destination}`}
                    data-testid={`tab-active-route-${route.id}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      isSelected
                        ? isDark
                          ? "bg-slate-800 text-white shadow-sm"
                          : "bg-emerald-600 text-white shadow-sm"
                        : isDark
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-emerald-700/70 hover:text-emerald-900"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        device?.device_id ? "bg-emerald-400" : isSelected ? "bg-white/60" : "bg-slate-400"
                      }`}
                    />
                    <span className="max-w-[100px] truncate">{route.origin}</span>
                    <ArrowLeftRight className="w-3 h-3 opacity-60 shrink-0" />
                    <span className="max-w-[100px] truncate">{route.destination}</span>
                  </button>
                );
              })}
            </div>

            {/* Detail card for whichever tab is currently selected */}
            {selectedActiveRoute && (
              <div
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border p-3 ${
                  isDark ? "bg-slate-900/60 border-emerald-900" : "bg-white border-emerald-200"
                }`}
              >
                <p className={`font-bold tracking-tight flex items-center gap-1.5 flex-wrap ${isDark ? "text-white" : "text-slate-900"}`}>
                  {selectedActiveRoute.origin}
                  <ArrowLeftRight className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                  {selectedActiveRoute.destination} &nbsp;·&nbsp; ₱
                  {selectedActiveRoute.fareAmount.toFixed(2)} per tap VICE-VERSA
                </p>
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0 ${
                    isDark ? "bg-slate-950/60 border-emerald-900" : "bg-emerald-50 border-emerald-200"
                  }`}
                >
                  <Zap className={`w-3.5 h-3.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
                  <span className={`text-xs font-semibold ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
                    {loadingActiveDevices
                      ? "Reader: Loading..."
                      : activeDeviceMap[String(selectedActiveRoute.id)]?.device_id
                        ? `Reader: ${activeDeviceMap[String(selectedActiveRoute.id)]?.device_id}`
                        : "Reader: Unassigned"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Card className={`h-full shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />

        {/* 🗺️ ROUTE / MAP PREVIEW TABS */}
        <div className={`flex items-center gap-1 px-6 pt-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-white border-slate-100"}`}>
          <button
            type="button"
            onClick={() => setMapTab("routes")}
            className={`relative px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
              mapTab === "routes"
                ? isDark
                  ? "text-white"
                  : "text-slate-900"
                : isDark
                  ? "text-slate-500 hover:text-slate-300"
                  : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Configured Routes
            </span>
            {mapTab === "routes" && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-600 rounded-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMapTab("map")}
            className={`relative px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
              mapTab === "map"
                ? isDark
                  ? "text-white"
                  : "text-slate-900"
                : isDark
                  ? "text-slate-500 hover:text-slate-300"
                  : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="flex items-center gap-2">
              <Map className="w-4 h-4" />
              Map Preview
            </span>
            {mapTab === "map" && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-600 rounded-full" />
            )}
          </button>
        </div>

        {mapTab === "routes" && (
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
                  One active route per reader device. A route stays active until you deactivate it or reassign that reader.
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
        )}

        {mapTab === "routes" ? (
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

                        {/* 🔒 Activate / Deactivate — makikita lang kapag may permission (hindi view_only).
                            Ang view_only ay "—" lang ang makikita. */}
                        <TableCell>
                          {canManage ? (
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
                                  handleDeactivate(route.id);
                                } else {
                                  // Activating opens the device-selection modal
                                  openActivateModal(route);
                                }
                              }}
                              disabled={isTogglePending && pendingRouteId === route.id}
                              data-testid={`toggle-route-${route.id}`}
                            >
                              {route.isActive ? (
                                <><PowerOff className="w-3.5 h-3.5 mr-1" /> Deactivate</>
                              ) : (
                                <><Power className="w-3.5 h-3.5 mr-1" /> Activate</>
                              )}
                            </Button>
                          ) : (
                            <span className={`text-xs ${isDark ? "text-slate-600" : "text-slate-300"}`}>—</span>
                          )}
                        </TableCell>

                        {/* 🔒 Edit / Delete — makikita lang kapag may permission (hindi view_only) */}
                        <TableCell className="text-right">
                          {canManage && (
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
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        ) : (
          <div className="p-0">
            <div className={`px-6 py-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Map className="w-5 h-5 text-blue-500" />
                    <h3 className={`text-sm font-bold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                      Route Map Preview
                    </h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      isDark
                        ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
                        : "text-emerald-600 bg-emerald-50 border-emerald-200"
                    }`}>
                      LIVE ROUTE DATA
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                    Select an origin and destination to preview the road route and distance.
                  </p>
                </div>

                <div className="w-full lg:w-80">
                  <Select
                    value={selectedMapRoute ? String(selectedMapRoute.id) : ""}
                    onValueChange={(value) => {
                      const route = (Array.isArray(routes) ? routes : []).find((r) => String(r.id) === value);
                      setMapRouteId(route?.id ?? null);
                    }}
                    disabled={!Array.isArray(routes) || routes.length === 0}
                  >
                    <SelectTrigger className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
                      <SelectValue placeholder="Select a route" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Array.isArray(routes) ? routes : []).map((route) => (
                        <SelectItem key={route.id} value={String(route.id)}>
                          {route.origin} → {route.destination}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {selectedMapRoute ? (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-950/50 border-slate-800" : "bg-white border-slate-200"}`}>
                    <p className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Route
                    </p>
                    <p className={`mt-1 text-sm font-bold truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                      {selectedMapRoute.origin} → {selectedMapRoute.destination}
                    </p>
                  </div>

                  <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-950/50 border-slate-800" : "bg-white border-slate-200"}`}>
                    <p className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Road Distance
                    </p>
                    <p className={`mt-1 text-lg font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                      {mapLoading
                        ? "Calculating..."
                        : mapDistanceKm !== null
                          ? `${mapDistanceKm.toFixed(2)} km`
                          : "—"}
                    </p>
                  </div>

                  <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-950/50 border-slate-800" : "bg-white border-slate-200"}`}>
                    <p className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Est. Drive Time
                    </p>
                    <p className={`mt-1 text-lg font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      {mapLoading
                        ? "Calculating..."
                        : mapDurationMin !== null
                          ? `${Math.round(mapDurationMin)} min`
                          : "—"}
                    </p>
                  </div>
                </div>

                <div className={`relative overflow-hidden rounded-xl border shadow-sm ${isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-slate-100"}`}>
                  <div
                    ref={mapContainerRef}
                    className="w-full h-[520px] z-0"
                    data-testid="route-map-preview"
                  />

                  {mapLoading && (
                    <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/60 dark:bg-slate-950/60 backdrop-blur-[1px]">
                      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg ${
                        isDark
                          ? "bg-slate-900 border-slate-700 text-slate-200"
                          : "bg-white border-slate-200 text-slate-700"
                      }`}>
                        <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                        <span className="text-sm font-medium">Loading route map...</span>
                      </div>
                    </div>
                  )}

                  {!mapLoading && mapError && (
                    <div className="absolute inset-0 z-[500] flex items-center justify-center p-6">
                      <div className={`max-w-md rounded-xl border p-5 text-center shadow-lg ${
                        isDark
                          ? "bg-slate-900 border-slate-700"
                          : "bg-white border-slate-200"
                      }`}>
                        <MapPin className="mx-auto mb-2 h-8 w-8 text-red-500" />
                        <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                          Unable to load this route
                        </p>
                        <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {mapError}
                        </p>
                        <Button
                          size="sm"
                          className="mt-4 bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => loadRouteOnMap(selectedMapRoute)}
                        >
                          Try Again
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                  isDark ? "text-slate-500" : "text-slate-500"
                }`}>
                  <span>
                    Map data © OpenStreetMap contributors · Routing by OSRM
                  </span>
                  <span>
                    Fare: <strong className={isDark ? "text-slate-300" : "text-slate-700"}>₱{Number(selectedMapRoute.fareAmount).toFixed(2)}</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className={`py-24 text-center ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                <Map className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="text-sm font-semibold">No routes configured</p>
                <p className="text-xs mt-1">Add a route first to preview it on the map.</p>
              </div>
            )}
          </div>
        )}

      </Card>

      {/* Add Route Dialog
          🔒 `open` naka-gate sa canManage — hindi kailanman magbubukas kapag view_only */}
      <Dialog
        open={canManage && showAdd}
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
              variant="ghost"
              onClick={() => setShowAdd(false)}
              className={`cursor-pointer border-0 shadow-none bg-transparent hover:bg-transparent ${
                isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
              }`}
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

      {/* Edit Route Dialog — styled to match User Management's Edit User dialog
          🔒 `open` naka-gate sa canManage */}
      <Dialog open={canManage && !!editRoute} onOpenChange={(open) => !open && setEditRoute(null)}>
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
              className={`text-xs font-medium cursor-pointer border-0 shadow-none bg-transparent hover:bg-transparent ${isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"}`}
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

      {/* ✅ Activate Route Dialog — device selection, pulled live from Supabase `devices` table
          🔒 `open` naka-gate sa canManage */}
      <Dialog
        open={canManage && !!activateRoute}
        onOpenChange={(open) => {
          if (!open) {
            setActivateRoute(null);
            setSelectedDeviceId("");
          }
        }}
      >
        <DialogContent className={`[&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-500">
              <Power size={18} /> Activate Route
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {activateRoute && (
              <div className={`text-sm border rounded-lg p-3 ${isDark ? "text-slate-300 bg-slate-950/60 border-slate-800" : "text-slate-700 bg-slate-50 border-slate-200"}`}>
                <p className="font-semibold flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-blue-500" />
                  {activateRoute.origin}
                  <ArrowLeftRight className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                  {activateRoute.destination}
                </p>
                <p className={`mt-1 ${isDark ? "text-blue-400" : "text-blue-600"} font-bold`}>
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
                        <Wifi className="w-3.5 h-3.5 text-blue-500" />
                        <span>
                          {d.name}
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
              variant="ghost"
              onClick={() => {
                setActivateRoute(null);
                setSelectedDeviceId("");
              }}
              className={`cursor-pointer border-0 shadow-none bg-transparent hover:bg-transparent ${
                isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmActivate}
              disabled={!selectedDeviceId || isTogglePending}
              data-testid="button-confirm-activate"
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:cursor-not-allowed"
            >
              {isTogglePending ? "Activating..." : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm — styled to match User Management's Delete Confirm dialog
          🔒 `open` naka-gate sa canManage */}
      <AlertDialog open={canManage && !!deleteRoute} onOpenChange={(open) => !open && setDeleteRoute(null)}>
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
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed border-0 shadow-none bg-transparent hover:bg-transparent ${
                isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
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