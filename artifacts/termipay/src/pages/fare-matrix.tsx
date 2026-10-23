import { useState, useMemo, useRef, useEffect } from "react";
import {
  useListRoutes,
  useCreateRoute,
  useUpdateRoute,
  useDeleteRoute,
  getListRoutesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import L from "leaflet"; // npm i leaflet && npm i -D @types/leaflet
import "leaflet/dist/leaflet.css";
import { supabase } from "@/lib/supabase"; // 👈 adjust to your actual supabase client path
import { useAuth } from "@/hooks/use-auth";
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
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import {
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
  Route as RouteIcon,
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
import { useAdminAccess } from "@/hooks/use-admin-access";

/* ═══════════════════════════════════════════════════════════════════════
   📍 PLACES — Calbayog → Tacloban (Maharlika Highway)
   Ang mga bayan at barangay ay galing sa PSGC API (psgc.gitlab.io).
   Kapag nag-fail ang API, may fallback na listahan ng mga bayan.
   ═══════════════════════════════════════════════════════════════════════ */

type Place = {
  name: string; // ito ang masa-save bilang origin / destination
  area: string; // subtext sa dropdown
  kind: "terminal" | "town" | "barangay";
  lat?: number;
  lng?: number;
  query?: string; // geocode query kapag walang lat/lng
};

// ⚠️ Approximate lang ang coordinates ng terminal — i-verify sa Google Maps.
const TERMINAL: Place = {
  name: "Turbanda Terminal (Awang)",
  area: "Calbayog City",
  kind: "terminal",
  lat: 12.0617,
  lng: 124.5987,
};

// Pagkakasunod: north → south. `match` = bahagi ng pangalan sa PSGC.
// Magdagdag / magbawas lang dito kung may kulang o sobrang bayan.
const ROUTE_TOWNS: { match: string; label: string; province: string }[] = [
  { match: "calbayog", label: "Calbayog", province: "Samar" },
  { match: "santa margarita", label: "Santa Margarita", province: "Samar" },
  { match: "gandara", label: "Gandara", province: "Samar" },
  { match: "san jorge", label: "San Jorge", province: "Samar" },
  { match: "catbalogan", label: "Catbalogan", province: "Samar" },
  { match: "jiabong", label: "Jiabong", province: "Samar" },
  { match: "motiong", label: "Motiong", province: "Samar" },
  { match: "paranas", label: "Paranas", province: "Samar" },
  { match: "pinabacdao", label: "Pinabacdao", province: "Samar" },
  { match: "basey", label: "Basey", province: "Samar" },
  { match: "tacloban", label: "Tacloban", province: "Leyte" },
];

const PSGC = "https://psgc.gitlab.io/api";
const REGION_VIII = "080000000";

const FALLBACK_PLACES: Place[] = [
  TERMINAL,
  ...ROUTE_TOWNS.map<Place>((t) => ({
    name: t.label,
    area: t.province,
    kind: "town",
    query: `${t.label}, ${t.province}, Philippines`,
  })),
];

let psgcCache: Promise<Place[]> | null = null;

async function loadPsgcPlaces(): Promise<Place[]> {
  const res = await fetch(`${PSGC}/regions/${REGION_VIII}/cities-municipalities/`);
  if (!res.ok) throw new Error("PSGC towns failed");
  const all: { code: string; name: string }[] = await res.json();

  // hanapin ang bawat bayan sa route (sa pagkakasunod ng ROUTE_TOWNS)
  const found = ROUTE_TOWNS.map((t) => ({
    t,
    row: all.find((c) => c.name.toLowerCase().includes(t.match)),
  })).filter((x) => x.row) as {
    t: (typeof ROUTE_TOWNS)[number];
    row: { code: string; name: string };
  }[];

  // kunin ang barangays ng lahat ng bayan nang sabay-sabay
  const brgyLists = await Promise.all(
    found.map(async ({ t, row }) => {
      try {
        const r = await fetch(`${PSGC}/cities-municipalities/${row.code}/barangays/`);
        if (!r.ok) return [] as Place[];
        const rows: { name: string }[] = await r.json();
        return rows.map<Place>((b) => ({
          name: `${b.name}, ${t.label}`,
          area: t.label,
          kind: "barangay",
          query: `${b.name}, ${t.label}, ${t.province}, Philippines`,
        }));
      } catch {
        return [] as Place[];
      }
    })
  );

  const towns: Place[] = found.map(({ t }) => ({
    name: t.label,
    area: t.province,
    kind: "town",
    query: `${t.label}, ${t.province}, Philippines`,
  }));

  return [TERMINAL, ...towns, ...brgyLists.flat()];
}

function usePsgcPlaces() {
  const [places, setPlaces] = useState<Place[]>(FALLBACK_PLACES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!psgcCache) psgcCache = loadPsgcPlaces();
    psgcCache
      .then((p) => {
        if (!cancelled) setPlaces(p);
      })
      .catch(() => {
        psgcCache = null; // payagan ang retry sa susunod
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { places, loading };
}

type PlacePickerProps = {
  value: string;
  onChange: (text: string) => void;
  onSelect: (place: Place) => void;
  places: Place[];
  loading?: boolean;
  placeholder?: string;
  className?: string;
  isDark: boolean;
  testId?: string;
};

function PlacePicker({
  value,
  onChange,
  onSelect,
  places,
  loading,
  placeholder,
  className,
  isDark,
  testId,
}: PlacePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q
      ? places.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.area.toLowerCase().includes(q)
        )
      : places.filter((p) => p.kind !== "barangay"); // blangko = terminal + bayan lang
    return list.slice(0, 8);
  }, [value, places]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        className={className}
        data-testid={testId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <ul
          className={`absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border shadow-lg text-sm ${
            isDark
              ? "bg-slate-900 border-slate-700 text-slate-200"
              : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          {matches.length === 0 ? (
            <li className={`px-3 py-3 text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {loading ? "Loading places..." : "No match — you can still type a custom place."}
            </li>
          ) : (
            matches.map((p) => (
              <li key={`${p.kind}-${p.name}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer ${
                    isDark ? "hover:bg-slate-800" : "hover:bg-slate-100"
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-[10px] uppercase opacity-60 shrink-0">
                    {p.kind === "barangay" ? "Brgy" : p.area}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ✅ Small helper so the toast title shows a green check icon next to the text
function SuccessTitle({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2.5} />
      {text}
    </span>
  );
}

type Device = {
  device_id: string;
  name: string;
  status: string;
  ip_address: string | null;
  firmware_version: string | null;
  last_ping: string | null;
  created_at: string;
};

/* ═══════════════════════════════════════════════════════════════════════
   🗺️ DISTANCE-BASED FARE (LTFRB: Base Fare + Succeeding Distance)
   Total Fare = Base Fare + max(0, Distance − Base Distance) × Succeeding Rate
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_BASE_FARE = 15;
const DEFAULT_BASE_KM = 4;
const DEFAULT_RATE = 2.2;

type LatLng = { lat: number; lng: number };

function computeLtfrbFare(
  distanceKm: number,
  baseFare: number,
  baseKm: number,
  ratePerKm: number
) {
  const excess = Math.max(0, distanceKm - baseKm);
  return Math.round((baseFare + excess * ratePerKm) * 100) / 100;
}

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nominatim (OpenStreetMap) geocoder — free, keep usage light (1 req/sec policy).
async function geocode(query: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// OSRM public demo server — real road distance + route geometry.
async function roadRoute(
  a: LatLng,
  b: LatLng
): Promise<{ km: number; coords: [number, number][] } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) return null;
  return {
    km: r.distance / 1000,
    coords: r.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]),
  };
}

const mapPin = (color: string, label: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:100%;display:flex;flex-direction:column;align-items:center;">
      <div style="background:${color};color:#fff;padding:3px 10px;border-radius:999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font:700 11px sans-serif;white-space:nowrap;line-height:1.2;">${label}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid ${color};margin-top:-1px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));"></div>
    </div>`,
    iconSize: [100, 34],
    iconAnchor: [50, 34],
  });

type DistanceFareSavePayload = {
  origin: string;
  destination: string;
  fareAmount: number;
};

type DistanceFareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDark: boolean;
  saving: boolean;
  places: Place[];
  placesLoading: boolean;
  onSave: (payload: DistanceFareSavePayload) => Promise<void>;
};

function DistanceFareDialog({
  open,
  onOpenChange,
  isDark,
  saving,
  places,
  placesLoading,
  onSave,
}: DistanceFareDialogProps) {
  // Default origin = Turbanda Terminal (Awang)
  const [originName, setOriginName] = useState(TERMINAL.name);
  const [originPlace, setOriginPlace] = useState<Place | null>(TERMINAL);
  const [destName, setDestName] = useState("");
  const [destPlace, setDestPlace] = useState<Place | null>(null);
  const [originPt, setOriginPt] = useState<LatLng | null>(null);
  const [destPt, setDestPt] = useState<LatLng | null>(null);

  const [baseFare, setBaseFare] = useState(String(DEFAULT_BASE_FARE));
  const [baseKm, setBaseKm] = useState(String(DEFAULT_BASE_KM));
  const [rate, setRate] = useState(String(DEFAULT_RATE));

  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [isEstimate, setIsEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔒 Pins are locked once placed (by "Find on map" or by the 2nd map click).
  const [pinsLocked, setPinsLocked] = useState(false);

  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const originMarker = useRef<L.Marker | null>(null);
  const destMarker = useRef<L.Marker | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);

  // Reset when the dialog closes
  useEffect(() => {
    if (!open) {
      setOriginName(TERMINAL.name);
      setOriginPlace(TERMINAL);
      setDestName("");
      setDestPlace(null);
      setOriginPt(null);
      setDestPt(null);
      setDistanceKm(null);
      setIsEstimate(false);
      setError(null);
      setPinsLocked(false);
    }
  }, [open]);

  // Create the map once the container div is mounted inside the dialog
  useEffect(() => {
    if (!mapEl) return;
    const map = L.map(mapEl, {
      center: [11.65, 124.8],
      zoom: 8,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 250);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      originMarker.current = null;
      destMarker.current = null;
      routeLine.current = null;
    };
  }, [mapEl]);

  // Click on map: first click = Origin, second click = Destination (then locks).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (pinsLocked) return;
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (!originPt) {
        setOriginPt(pt);
      } else {
        setDestPt(pt);
        setPinsLocked(true);
      }
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [mapEl, originPt, pinsLocked]);

  // Keep markers in sync with state (draggable only while NOT locked).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sync = (
      ref: React.MutableRefObject<L.Marker | null>,
      pt: LatLng | null,
      color: string,
      label: string,
      setPt: (p: LatLng) => void
    ) => {
      if (!pt) {
        ref.current?.remove();
        ref.current = null;
        return;
      }
      if (!ref.current) {
        const m = L.marker([pt.lat, pt.lng], {
          icon: mapPin(color, label),
          draggable: !pinsLocked,
        }).addTo(map);
        m.on("dragend", () => {
          const p = m.getLatLng();
          setPt({ lat: p.lat, lng: p.lng });
        });
        ref.current = m;
      } else {
        ref.current.setLatLng([pt.lat, pt.lng]);
      }

      const marker = ref.current;
      if (marker?.dragging) {
        if (pinsLocked) marker.dragging.disable();
        else marker.dragging.enable();
      }
    };

    sync(originMarker, originPt, "#2563eb", "Origin", setOriginPt);
    sync(destMarker, destPt, "#059669", "Destination", setDestPt);
  }, [originPt, destPt, mapEl, pinsLocked]);

  // Any point change invalidates the previous calculation
  useEffect(() => {
    setDistanceKm(null);
    routeLine.current?.remove();
    routeLine.current = null;
  }, [originPt, destPt]);

  const fare = useMemo(() => {
    if (distanceKm == null) return null;
    const bf = parseFloat(baseFare);
    const bk = parseFloat(baseKm);
    const r = parseFloat(rate);
    if ([bf, bk, r].some((n) => Number.isNaN(n) || n < 0)) return null;
    return computeLtfrbFare(distanceKm, bf, bk, r);
  }, [distanceKm, baseFare, baseKm, rate]);

  const excessKm =
    distanceKm != null ? Math.max(0, distanceKm - (parseFloat(baseKm) || 0)) : 0;

  // Kapag may coordinates ang napiling place → gamitin agad (walang geocode).
  // Kapag wala → geocode gamit ang query ng place, o ang tinype ng user.
  const resolvePlace = async (
    text: string,
    place: Place | null
  ): Promise<{ pt: LatLng | null; usedNetwork: boolean }> => {
    if (place?.lat != null && place?.lng != null) {
      return { pt: { lat: place.lat, lng: place.lng }, usedNetwork: false };
    }
    const pt = await geocode(place?.query ?? `${text}, Philippines`);
    return { pt, usedNetwork: true };
  };

  const findPlaces = async () => {
    setError(null);
    if (!originName.trim() || !destName.trim()) {
      setError("Enter both an origin and a destination.");
      return;
    }
    setBusy(true);
    try {
      const o = await resolvePlace(originName.trim(), originPlace);
      if (o.usedNetwork) await new Promise((r) => setTimeout(r, 1100)); // Nominatim rate limit
      const d = await resolvePlace(destName.trim(), destPlace);
      if (!o.pt || !d.pt) {
        setError(
          "Couldn't find one of the places. Try picking from the list, or click the map to place pins."
        );
        return;
      }
      setOriginPt(o.pt);
      setDestPt(d.pt);
      setPinsLocked(true);
      mapRef.current?.fitBounds(
        [
          [o.pt.lat, o.pt.lng],
          [d.pt.lat, d.pt.lng],
        ],
        { padding: [40, 40] }
      );
    } catch {
      setError("Place lookup failed. Check your connection or click the map to place pins.");
    } finally {
      setBusy(false);
    }
  };

  const calculate = async () => {
    if (!originPt || !destPt) {
      setError("Set both pins first (search places or click the map).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const o = { ...originPt };
      const d = { ...destPt };

      const r = await roadRoute(o, d).catch(() => null);
      const map = mapRef.current;

      routeLine.current?.remove();
      routeLine.current = null;

      if (r) {
        setDistanceKm(r.km);
        setIsEstimate(false);
        if (map) {
          routeLine.current = L.polyline(r.coords, {
            color: "#2563eb",
            weight: 5,
            interactive: false,
          }).addTo(map);
        }
      } else {
        setDistanceKm(haversineKm(o, d));
        setIsEstimate(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const canSave = fare != null && fare > 0 && originName.trim() && destName.trim();

  const submit = () => {
    if (!canSave || fare == null) return;
    onSave({
      origin: originName.trim(),
      destination: destName.trim(),
      fareAmount: fare,
    });
  };

  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const inputCls = isDark
    ? "bg-slate-950 border-slate-800 text-slate-200"
    : "bg-white border-slate-200 text-slate-800";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-w-2xl max-h-[92vh] overflow-y-auto [&>button]:cursor-pointer ${
          isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"
        }`}
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-500">
            <RouteIcon size={18} /> Distance-Based Fare (LTFRB)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className={`text-xs font-semibold ${muted}`}>Origin</Label>
              <PlacePicker
                isDark={isDark}
                places={places}
                loading={placesLoading}
                value={originName}
                onChange={(t) => {
                  setOriginName(t);
                  setOriginPlace(null);
                }}
                onSelect={(p) => {
                  setOriginName(p.name);
                  setOriginPlace(p);
                }}
                placeholder="Search origin..."
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={`text-xs font-semibold ${muted}`}>Destination</Label>
              <PlacePicker
                isDark={isDark}
                places={places}
                loading={placesLoading}
                value={destName}
                onChange={(t) => {
                  setDestName(t);
                  setDestPlace(null);
                }}
                onSelect={(p) => {
                  setDestName(p.name);
                  setDestPlace(p);
                }}
                placeholder="Search destination (e.g. Tacloban)"
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={findPlaces}
              disabled={busy}
              className="cursor-pointer disabled:cursor-not-allowed"
            >
              <Search className="w-3.5 h-3.5 mr-1" /> Find on map
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={calculate}
              disabled={busy || !originPt || !destPt}
              className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:cursor-not-allowed"
            >
              {busy ? "Working..." : "Calculate distance & fare"}
            </Button>
          </div>

          <div
            ref={setMapEl}
            className="w-full h-64 rounded-lg border overflow-hidden z-0"
            style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className={`text-xs font-semibold ${muted}`}>Base fare (₱)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={baseFare}
                onChange={(e) => setBaseFare(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={`text-xs font-semibold ${muted}`}>Base distance (km)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={baseKm}
                onChange={(e) => setBaseKm(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={`text-xs font-semibold ${muted}`}>Rate / extra km (₱)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          {distanceKm != null && fare != null && (
            <div
              className={`rounded-lg border p-3 text-sm space-y-1 ${
                isDark ? "bg-blue-950/30 border-blue-900" : "bg-blue-50 border-blue-100"
              }`}
            >
              <p className="font-semibold">
                {originName} → {destName}: {distanceKm.toFixed(1)} km {isEstimate && "(straight-line estimate)"}
              </p>
              <p className={muted}>
                ₱{parseFloat(baseFare).toFixed(2)} + ({excessKm.toFixed(1)} km × ₱{parseFloat(rate).toFixed(2)}) ={" "}
                <span className="font-bold text-emerald-500 text-base">₱{fare.toFixed(2)}</span>
              </p>
              {isEstimate && (
                <p className="text-xs text-amber-500">
                  Road routing was unavailable, so this uses straight-line distance and may be lower than the real fare.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className={`cursor-pointer bg-transparent hover:bg-transparent ${muted}`}
          >
            Cancel
          </Button>
          <Button
            disabled={!canSave || saving}
            onClick={submit}
            className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save route"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FareMatrixPage() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const actorUsername = user?.username ?? "unknown";

  const { canManage, loaded } = useAdminAccess();

  // 📍 PSGC places (towns + barangays) — shared by Distance dialog & Edit dialog
  const { places, loading: placesLoading } = usePsgcPlaces();

  const [searchTerm, setSearchTerm] = useState("");
  const [editRoute, setEditRoute] = useState<any>(null);
  const [deleteRoute, setDeleteRoute] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    origin: "",
    destination: "",
    fareAmount: "",
  });
  const [originalEditForm, setOriginalEditForm] = useState(editForm);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [showDistance, setShowDistance] = useState(false);
  const [savingDistance, setSavingDistance] = useState(false);

  const [activateRoute, setActivateRoute] = useState<any>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [activeDeviceMap, setActiveDeviceMap] = useState<Record<string, Device | null>>({});
  const [loadingActiveDevices, setLoadingActiveDevices] = useState(false);

  const [isTogglePending, setIsTogglePending] = useState(false);
  const [pendingRouteId, setPendingRouteId] = useState<string | number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const activeRoutes = Array.isArray(routes) ? routes.filter((r) => r.isActive) : [];

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

  const activeDeviceRouteIdsRef = useRef<string>("");

  const fetchActiveRoutesDevices = async (routeIds: (string | number)[]) => {
    if (routeIds.length === 0) {
      activeDeviceRouteIdsRef.current = "";
      setActiveDeviceMap({});
      return;
    }

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

  useRealtimeRefetch(["devices"], () => {
    if (activateRoute) {
      fetchActiveDevices(activateRoute.id);
    }
    fetchActiveRoutesDevices(activeRoutes.map((r) => r.id));
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

  const openEdit = (route: any) => {
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

  const hasRouteChanges =
    editForm.origin.trim() !== originalEditForm.origin.trim() ||
    editForm.destination.trim() !== originalEditForm.destination.trim() ||
    editForm.fareAmount.trim() !== originalEditForm.fareAmount.trim();

  const fetchActiveDevices = async (excludeRouteId?: string | number) => {
    setLoadingDevices(true);

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
      .eq("status", "ONLINE")
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
    if (blockIfViewOnly()) return;

    setActivateRoute(route);
    setSelectedDeviceId("");
    fetchActiveDevices(route.id);
  };

  const handleDistanceSave = async (p: DistanceFareSavePayload) => {
    if (blockIfViewOnly()) return;

    setSavingDistance(true);
    try {
      const existing = Array.isArray(routes)
        ? routes.find((r) => r.origin === p.origin && r.destination === p.destination)
        : null;

      if (existing) {
        await updateMutation.mutateAsync({
          id: existing.id,
          data: { origin: p.origin, destination: p.destination, fareAmount: p.fareAmount },
        });
      } else {
        await createMutation.mutateAsync({
          data: { origin: p.origin, destination: p.destination, fareAmount: p.fareAmount },
        });
      }

      queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });

      setShowDistance(false);
      toast({
        title: <SuccessTitle text={`Route Saved — ₱${p.fareAmount.toFixed(2)}`} />,
      });
    } catch {
      toast({ title: "Failed to save route", variant: "destructive" });
    } finally {
      setSavingDistance(false);
    }
  };

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
      p_actor: actorUsername,
    });

    if (error) {
      console.error("activate_route error:", error);
      toast({ title: "Failed to activate route", variant: "destructive" });
      setIsTogglePending(false);
      setPendingRouteId(null);
      return;
    }

    if (reverseRoute) {
      const { error: reverseError } = await supabase.rpc("activate_route", {
        p_route_id: reverseRoute.id,
        p_device_id: selectedDeviceId,
        p_actor: actorUsername,
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

    setSelectedActiveRouteId(activateRoute.id);

    setActivateRoute(null);
    setSelectedDeviceId("");
    setIsTogglePending(false);
    setPendingRouteId(null);
  };

  const handleDeactivate = async (routeId: string | number) => {
    if (blockIfViewOnly()) return;

    setIsTogglePending(true);
    setPendingRouteId(routeId);

    const route = Array.isArray(routes) ? routes.find((r) => r.id === routeId) : null;
    const reverseRoute = route ? findReverseRoute(route) : null;

    const { error } = await supabase.rpc("deactivate_route", {
      p_route_id: routeId,
      p_actor: actorUsername,
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
        p_actor: actorUsername,
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

  const confirmDelete = () => {
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

            {loaded && canManage && (
              <Button
                variant="outline"
                onClick={() => setShowDistance(true)}
                data-testid="button-distance-fare"
                className="font-semibold cursor-pointer shrink-0 whitespace-nowrap"
              >
                <RouteIcon className="w-4 h-4 mr-2" />
                Distance Fare
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
                                  handleDeactivate(route.id);
                                } else {
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
      </Card>

      {/* 🗺️ Distance-based fare dialog (PSGC places + Leaflet + OSRM + LTFRB formula) */}
      <DistanceFareDialog
        open={canManage && showDistance}
        onOpenChange={setShowDistance}
        isDark={isDark}
        saving={savingDistance}
        places={places}
        placesLoading={placesLoading}
        onSave={handleDistanceSave}
      />

      {/* Edit Route Dialog — Origin/Destination now use the PSGC place picker */}
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
              <PlacePicker
                testId="input-edit-origin"
                isDark={isDark}
                places={places}
                loading={placesLoading}
                placeholder="Search origin..."
                value={editForm.origin}
                onChange={(t) => setEditForm({ ...editForm, origin: t })}
                onSelect={(p) => setEditForm({ ...editForm, origin: p.name })}
                className={`text-sm font-medium ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200"}`}
              />
            </div>
            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Destination</Label>
              <PlacePicker
                testId="input-edit-destination"
                isDark={isDark}
                places={places}
                loading={placesLoading}
                placeholder="Search destination..."
                value={editForm.destination}
                onChange={(t) => setEditForm({ ...editForm, destination: t })}
                onSelect={(p) => setEditForm({ ...editForm, destination: p.name })}
                className={`text-sm font-medium ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200"}`}
              />
            </div>
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

      {/* Activate Route Dialog — device selection */}
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

      {/* Delete Confirm */}
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