import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  useListRoutes,
  useCreateRoute,
  useUpdateRoute,
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
  RotateCcw,
  Lock,
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
  Loader2,
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
  status: string;
  ip_address: string | null;
  firmware_version: string | null;
  last_ping: string | null;
  created_at: string;
};

/* ═══════════════════════════════════════════════════════════════════════
   🙈 UI-ONLY SOFT DELETE ("Reset")
   Reset hides a route from this page only. The row stays in the database.
   Hidden route IDs are remembered in this browser's localStorage.
   ═══════════════════════════════════════════════════════════════════════ */

const HIDDEN_KEY = "fare_matrix_hidden_routes";

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — hiding just won't persist across reloads */
  }
}

function useHiddenRoutes() {
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => readHidden());

  const hide = useCallback((ids: (string | number)[]) => {
    setHiddenIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids.map(String)]));
      writeHidden(next);
      return next;
    });
  }, []);

  const unhide = useCallback((ids: (string | number)[]) => {
    setHiddenIds((prev) => {
      const remove = new Set(ids.map(String));
      const next = prev.filter((id) => !remove.has(id));
      writeHidden(next);
      return next;
    });
  }, []);

  return { hiddenIds, hide, unhide };
}

/* ═══════════════════════════════════════════════════════════════════════
   📍 PSGC PLACES — Samar Island + Leyte Island
   Source: PSGC API  https://psgc.gitlab.io/api
   ═══════════════════════════════════════════════════════════════════════ */

const PSGC = "https://psgc.gitlab.io/api";

type Place = {
  code: string;
  label: string; // what gets typed/saved: "Bugtong, Calbayog City" or "Calbayog City"
  kind: "barangay" | "city" | "municipality";
  barangay?: string; // barangay name only (for barangay kind)
  municipality: string; // city/municipality name
  province: string;
};

async function getJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`PSGC request failed: ${res.status}`);
  return res.json();
}

const isCityName = (name: string) => /^city of\s+/i.test(name) || /\scity$/i.test(name);

// "City of Calbayog" -> "Calbayog City"
const cleanMuniName = (name: string) =>
  /^city of\s+/i.test(name) ? `${name.replace(/^city of\s+/i, "").trim()} City` : name.trim();

async function fetchSamarPlaces(): Promise<Place[]> {
  const allProvinces = await getJson<any[]>(`${PSGC}/provinces.json`);
  // Samar Island: Samar, Northern Samar, Eastern Samar
  // Leyte Island: Leyte, Southern Leyte
  // (Biliran is a separate province → excluded)
  const provinces = allProvinces.filter((p) => /samar|leyte/i.test(p.name));

  const out: Place[] = [];

  await Promise.all(
    provinces.map(async (prov) => {
      const provName: string = prov.name;
      const munis = await getJson<any[]>(`${PSGC}/provinces/${prov.code}/cities-municipalities.json`);

      const muniMap = new Map<string, string>(); // code -> clean name
      munis.forEach((m) => {
        const name = cleanMuniName(m.name);
        muniMap.set(m.code, name);
        out.push({
          code: m.code,
          label: name,
          kind: isCityName(m.name) ? "city" : "municipality",
          municipality: name,
          province: provName,
        });
      });

      const pushBarangays = (brgys: any[], forcedMuniCode?: string) => {
        brgys.forEach((b) => {
          const muniCode: string =
            forcedMuniCode ||
            b.cityCode ||
            b.municipalityCode ||
            `${String(b.code).slice(0, 7)}000`;
          const muniName = muniMap.get(muniCode);
          if (!muniName) return;
          out.push({
            code: b.code,
            label: `${b.name}, ${muniName}`,
            kind: "barangay",
            barangay: b.name,
            municipality: muniName,
            province: provName,
          });
        });
      };

      try {
        // One request per province
        const brgys = await getJson<any[]>(`${PSGC}/provinces/${prov.code}/barangays.json`);
        pushBarangays(brgys);
      } catch {
        // Fallback: one request per city/municipality
        await Promise.all(
          munis.map(async (m) => {
            try {
              const brgys = await getJson<any[]>(`${PSGC}/cities-municipalities/${m.code}/barangays.json`);
              pushBarangays(brgys, m.code);
            } catch {
              /* skip this municipality */
            }
          })
        );
      }
    })
  );

  // If the same label exists in more than one province (e.g. "San Isidro"),
  // append the province so the driver can tell them apart.
  const counts = new Map<string, number>();
  out.forEach((p) => counts.set(p.label, (counts.get(p.label) ?? 0) + 1));
  out.forEach((p) => {
    if ((counts.get(p.label) ?? 0) > 1) p.label = `${p.label}, ${p.province}`;
  });

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// Module-level cache so the list is only downloaded once per page load.
let placesPromise: Promise<Place[]> | null = null;
function loadSamarPlaces() {
  if (!placesPromise) {
    placesPromise = fetchSamarPlaces().catch((e) => {
      placesPromise = null; // allow retry next time
      throw e;
    });
  }
  return placesPromise;
}

function useSamarPlaces() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSamarPlaces()
      .then((p) => {
        if (!cancelled) {
          setPlaces(p);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the Samar & Leyte places list. Check your connection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { places, loading, error };
}

/* ═══════════════════════════════════════════════════════════════════════
   🔎 PlaceCombobox — type to search, pick from the dropdown list
   ═══════════════════════════════════════════════════════════════════════ */

type PlaceComboboxProps = {
  value: string;
  onChange: (text: string, place: Place | null) => void;
  places: Place[];
  loading: boolean;
  placeholder?: string;
  isDark: boolean;
  className?: string;
  testId?: string;
};

function PlaceCombobox({
  value,
  onChange,
  places,
  loading,
  placeholder,
  isDark,
  className,
  testId,
}: PlaceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) {
      // No text yet → show cities & municipalities first
      return places.filter((p) => p.kind !== "barangay").slice(0, 60);
    }
    const matches = places.filter((p) => `${p.label} ${p.province}`.toLowerCase().includes(q));
    matches.sort((a, b) => {
      const as = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.label.localeCompare(b.label);
    });
    return matches.slice(0, 60);
  }, [value, places]);

  useEffect(() => {
    setActive(0);
  }, [value]);

  // keep the highlighted item in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (p: Place) => {
    onChange(p.label, p);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const kindLabel = (k: Place["kind"]) =>
    k === "barangay" ? "Barangay" : k === "city" ? "City" : "Municipality";

  return (
    <div className="relative">
      <Input
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={className}
      />

      {open && (
        <div
          ref={listRef}
          className={`absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border shadow-lg ${
            isDark ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Samar & Leyte places...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">No matching place in Samar or Leyte</div>
          ) : (
            results.map((p, i) => (
              <div
                key={p.code}
                data-idx={i}
                // onMouseDown fires before the input's onBlur, so the click isn't lost
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer ${
                  i === active ? (isDark ? "bg-slate-800" : "bg-blue-50") : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.label}</p>
                  <p className={`text-[11px] truncate ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    {p.kind === "barangay" ? `${p.municipality}, ` : ""}
                    {p.province}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-semibold uppercase shrink-0 px-1.5 py-0.5 rounded ${
                    p.kind === "barangay"
                      ? isDark
                        ? "bg-slate-800 text-slate-400"
                        : "bg-slate-100 text-slate-500"
                      : isDark
                        ? "bg-blue-950/60 text-blue-400"
                        : "bg-blue-50 text-blue-600"
                  }`}
                >
                  {kindLabel(p.kind)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Geocode a PSGC place. For barangays: try "Barangay, Municipality, Province"
// first, then fall back to the municipality itself.
async function geocodePlace(p: Place): Promise<LatLng | null> {
  if (p.kind === "barangay" && p.barangay) {
    const hit = await geocode(`${p.barangay}, ${p.municipality}, ${p.province}, Philippines`);
    if (hit) return hit;
    await sleep(1100);
  }
  return geocode(`${p.municipality}, ${p.province}, Philippines`);
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
  onSave: (payload: DistanceFareSavePayload) => Promise<void>;
  places: Place[];
  placesLoading: boolean;
  placesError: string | null;
};

function DistanceFareDialog({
  open,
  onOpenChange,
  isDark,
  saving,
  onSave,
  places,
  placesLoading,
  placesError,
}: DistanceFareDialogProps) {
  // Text in the inputs + the PSGC place actually picked from the list.
  const [originName, setOriginName] = useState("");
  const [destName, setDestName] = useState("");
  const [originPlace, setOriginPlace] = useState<Place | null>(null);
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

  // 🔒 Pins lock once "OK" places them (or both pins are clicked).
  const [pinsLocked, setPinsLocked] = useState(false);

  // Leaflet map plumbing
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const originMarker = useRef<L.Marker | null>(null);
  const destMarker = useRef<L.Marker | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);

  // Default origin = Calbayog City (set once, after the places list loads)
  const defaultedOrigin = useRef(false);
  useEffect(() => {
    if (!open || defaultedOrigin.current || places.length === 0) return;
    const calbayog = places.find((p) => p.kind === "city" && /^calbayog/i.test(p.label));
    if (calbayog) {
      setOriginName(calbayog.label);
      setOriginPlace(calbayog);
      defaultedOrigin.current = true;
    }
  }, [open, places]);

  // Reset when the dialog closes
  useEffect(() => {
    if (!open) {
      setOriginName("");
      setDestName("");
      setOriginPlace(null);
      setDestPlace(null);
      setOriginPt(null);
      setDestPt(null);
      setDistanceKm(null);
      setIsEstimate(false);
      setError(null);
      setPinsLocked(false);
      setBusy(false);
      defaultedOrigin.current = false;
    }
  }, [open]);

  // Create the map once the container div is mounted inside the dialog
  useEffect(() => {
    if (!mapEl) return;
    const map = L.map(mapEl, {
      center: [11.2, 124.9], // Samar + Leyte
      zoom: 7,
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

  // Keep markers in sync with state.
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

  // Changing the picked origin/destination also invalidates the previous fare,
  // so an old fare can never be saved under a new place. Press OK again.
  useEffect(() => {
    setDistanceKm(null);
    routeLine.current?.remove();
    routeLine.current = null;
  }, [originPlace, destPlace]);

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

  // ✅ ONE BUTTON: OK
  // 1) Finds both places on the map (geocode) and drops the pins
  // 2) Immediately calculates the road distance + fare
  // If no places were picked but both pins were clicked on the map by hand,
  // it skips step 1 and just calculates.
  // While running, ONLY the OK button shows a circular spinner (no extra text).
  const findAndCalculate = async () => {
    setError(null);

    const hasPlaces = !!originPlace && !!destPlace;
    const hasPins = !!originPt && !!destPt;

    if (!hasPlaces && !hasPins) {
      setError("Pick both the origin and the destination from the list (Samar & Leyte only).");
      return;
    }

    setBusy(true);
    try {
      let o: LatLng;
      let d: LatLng;

      if (hasPlaces) {
        // ── Step 1: find the places on the map ──
        const oHit = await geocodePlace(originPlace!);
        await sleep(1100); // respect Nominatim rate limit
        const dHit = await geocodePlace(destPlace!);

        if (!oHit || !dHit) {
          setError(
            "Couldn't locate one of the places on the map. Click the map to place the pins manually."
          );
          return;
        }
        o = oHit;
        d = dHit;
        setOriginPt(o);
        setDestPt(d);
        setPinsLocked(true);
      } else {
        o = { ...originPt! };
        d = { ...destPt! };
      }

      // ── Step 2: calculate the road distance + fare ──
      const r = await roadRoute(o, d).catch(() => null);
      const map = mapRef.current;

      routeLine.current?.remove();
      routeLine.current = null;

      if (r) {
        setDistanceKm(r.km);
        setIsEstimate(false);
        if (map) {
          const line = L.polyline(r.coords, {
            color: "#2563eb",
            weight: 5,
            interactive: false,
          }).addTo(map);
          routeLine.current = line;
          map.fitBounds(line.getBounds(), { padding: [40, 40] });
        }
      } else {
        setDistanceKm(haversineKm(o, d));
        setIsEstimate(true);
        map?.fitBounds(
          [
            [o.lat, o.lng],
            [d.lat, d.lng],
          ],
          { padding: [40, 40] }
        );
      }
    } catch {
      setError("Lookup failed. Check your connection or click the map to place pins.");
    } finally {
      setBusy(false);
    }
  };

  // Must pick both places from the PSGC list before saving.
  const canSave = fare != null && fare > 0 && !!originPlace && !!destPlace && !busy;

  const submit = () => {
    if (!canSave || fare == null || !originPlace || !destPlace) return;
    onSave({
      origin: originPlace.label,
      destination: destPlace.label,
      fareAmount: fare,
    });
  };

  const canPressOk = (!!originPlace && !!destPlace) || (!!originPt && !!destPt);

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
              <PlaceCombobox
                value={originName}
                places={places}
                loading={placesLoading}
                isDark={isDark}
                placeholder="Search barangay / city / municipality..."
                className={inputCls}
                testId="input-distance-origin"
                onChange={(text, place) => {
                  setOriginName(text);
                  setOriginPlace(place);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={`text-xs font-semibold ${muted}`}>Destination</Label>
              <PlaceCombobox
                value={destName}
                places={places}
                loading={placesLoading}
                isDark={isDark}
                placeholder="Search barangay / city / municipality..."
                className={inputCls}
                testId="input-distance-destination"
                onChange={(text, place) => {
                  setDestName(text);
                  setDestPlace(place);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              onClick={findAndCalculate}
              disabled={busy || !canPressOk}
              aria-busy={busy}
              aria-label={busy ? "Loading" : "OK"}
              data-testid="button-distance-ok"
              className="w-[96px] h-9 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "OK"}
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

  // 📍 Samar & Leyte places (PSGC) — used by the Distance Fare dialog
  const {
    places: samarPlaces,
    loading: placesLoading,
    error: placesError,
  } = useSamarPlaces();

  // 🙈 UI-only soft delete (Reset) — DB rows are never removed
  const { hiddenIds, hide: hideRoutes, unhide: unhideRoutes } = useHiddenRoutes();

  const [searchTerm, setSearchTerm] = useState("");
  const [resetRoute, setResetRoute] = useState<any>(null);
  const [isResetting, setIsResetting] = useState(false);

  // 🔓 Distance Fare unlocks after a Reset (and locks again after a successful save)
  const [resetUnlocked, setResetUnlocked] = useState(false);

  // 🔌 The reader device that the reset route was using.
  // Reset clears device_id in the DB, so we remember it here and
  // automatically re-use it when the next route is saved.
  const [resetDeviceId, setResetDeviceId] = useState<string | null>(null);

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

  // ✅ Everything on this page works off the VISIBLE routes only
  const visibleRoutes = useMemo(() => {
    if (!Array.isArray(routes)) return [];
    const hidden = new Set(hiddenIds);
    return routes.filter((r) => !hidden.has(String(r.id)));
  }, [routes, hiddenIds]);

  // 🔒 Distance Fare is only usable when:
  //   • there are no visible routes left in the frontend, OR
  //   • the user just clicked Reset (resetUnlocked)
  const noVisibleRoutes = !isLoading && visibleRoutes.length === 0;
  const distanceFareEnabled = noVisibleRoutes || resetUnlocked;

  const activeRoutes = visibleRoutes.filter((r) => r.isActive);

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
  }, [activeRouteIdsKey]);

  useRealtimeRefetch(["devices"], () => {
    if (activateRoute) {
      fetchActiveDevices(activateRoute.id);
    }
    fetchActiveRoutesDevices(activeRoutes.map((r) => r.id));
  });

  const sortOrderRef = useRef<(string | number)[]>([]);

  const filteredRoutes = useMemo(() => {
    const filtered = visibleRoutes.filter(
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
  }, [visibleRoutes, searchTerm]);

  const createMutation = useCreateRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      },
    },
  });

  // Only used when "Distance Fare" saves a route that already exists
  const updateMutation = useUpdateRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      },
    },
  });

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

  // Looks through ALL routes (including hidden ones) so both directions stay in sync
  const findReverseRoute = (route: any) =>
    Array.isArray(routes)
      ? routes.find(
          (r) =>
            r.id !== route.id &&
            r.origin === route.destination &&
            r.destination === route.origin
        ) ?? null
      : null;

  // ⚡ Activates a route (found by origin/destination in the DB) + its return
  // direction using the given reader device.
  // Returns "ok" | "failed" | "not-found".
  const activateSavedRoute = async (
    origin: string,
    destination: string,
    deviceId: string
  ): Promise<"ok" | "failed" | "not-found"> => {
    // Look up straight from the DB so we never depend on stale React state
    const { data: main } = await supabase
      .from("fare_routes") // 👈 adjust table name if different
      .select("id")
      .eq("origin", origin)
      .eq("destination", destination)
      .limit(1)
      .maybeSingle();

    if (!main?.id) return "not-found";

    const { data: reverse } = await supabase
      .from("fare_routes")
      .select("id")
      .eq("origin", destination)
      .eq("destination", origin)
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.rpc("activate_route", {
      p_route_id: main.id,
      p_device_id: deviceId,
      p_actor: actorUsername,
    });

    if (error) {
      console.error("activate_route (after save) error:", error);
      return "failed";
    }

    if (reverse?.id) {
      const { error: reverseError } = await supabase.rpc("activate_route", {
        p_route_id: reverse.id,
        p_device_id: deviceId,
        p_actor: actorUsername,
      });
      if (reverseError) {
        console.error("activate_route (after save, reverse) error:", reverseError);
        return "failed";
      }
    }

    return "ok";
  };

  const handleDistanceSave = async (p: DistanceFareSavePayload) => {
    if (blockIfViewOnly()) return;

    // 🔒 Safety guard — Distance Fare is locked until Reset / no routes
    if (!distanceFareEnabled) {
      toast({
        title: "Distance Fare is locked",
        description: "Click Reset on the current route first.",
        variant: "destructive",
      });
      return;
    }

    setSavingDistance(true);
    try {
      const existing = Array.isArray(routes)
        ? routes.find((r) => r.origin === p.origin && r.destination === p.destination)
        : null;

      if (existing) {
        // Same origin/destination was saved (and maybe reset) before →
        // refresh its fare and bring it back into the UI.
        await updateMutation.mutateAsync({
          id: existing.id,
          data: { origin: p.origin, destination: p.destination, fareAmount: p.fareAmount },
        });
        const reverse = findReverseRoute(existing);
        unhideRoutes([existing.id, ...(reverse ? [reverse.id] : [])]);
      } else {
        await createMutation.mutateAsync({
          data: { origin: p.origin, destination: p.destination, fareAmount: p.fareAmount },
        });
      }

      // ⚡ AUTO-ACTIVATE: re-use the reader device from the route that was reset
      let activateResult: "ok" | "failed" | "not-found" | "no-device" = "no-device";
      if (resetDeviceId) {
        activateResult = await activateSavedRoute(p.origin, p.destination, resetDeviceId);
      }

      queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      refetchRoutes();

      setShowDistance(false);
      setResetUnlocked(false); // 🔒 lock again — Reset is needed before adding another
      setResetDeviceId(null);

      if (activateResult === "ok") {
        toast({
          title: <SuccessTitle text={`Route Saved & Activated — ₱${p.fareAmount.toFixed(2)}`} />,
        });
      } else if (activateResult === "no-device") {
        toast({
          title: <SuccessTitle text={`Route Saved — ₱${p.fareAmount.toFixed(2)}`} />,
          description: "No reader device to re-use. Activate the route manually.",
        });
      } else {
        toast({
          title: "Route saved, but couldn't activate it",
          description: "Please activate it manually and pick a reader device.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Failed to save route", variant: "destructive" });
    } finally {
      setSavingDistance(false);
    }
  };

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
    await fetchActiveRoutesDevices([
      ...visibleRoutes
        .filter((r) => r.isActive && r.id !== activateRoute.id && r.id !== reverseRoute?.id)
        .map((r) => r.id),
      activateRoute.id,
      ...(reverseRoute ? [reverseRoute.id] : []),
    ]);

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

  // 🔄 RESET = soft delete in the UI only.
  // - Remembers which reader device the route was using (deactivate clears it
  //   in the DB), so the NEXT saved route can be auto-activated on that reader.
  // - If the route is active, it is deactivated first so the reader stops
  //   using a route that is no longer visible.
  // - The route (and its return direction) is then hidden from this page.
  // - NOTHING is deleted from the database.
  // - Unlocks the Distance Fare button.
  const confirmReset = async () => {
    if (blockIfViewOnly()) {
      setResetRoute(null);
      return;
    }
    if (!resetRoute) return;

    setIsResetting(true);

    const reverseRoute = findReverseRoute(resetRoute);
    const targets = [resetRoute, ...(reverseRoute ? [reverseRoute] : [])];

    // 🔌 Grab the device BEFORE deactivating (deactivate_route sets device_id = null)
    let deviceToReuse: string | null = null;
    try {
      const { data: devRows } = await supabase
        .from("fare_routes") // 👈 adjust table name if different
        .select("id, device_id")
        .in(
          "id",
          targets.map((r) => r.id)
        );
      deviceToReuse = devRows?.find((r: any) => r.device_id)?.device_id ?? null;
    } catch {
      deviceToReuse = null;
    }

    let deactivateFailed = false;
    for (const r of targets) {
      if (!r.isActive) continue;
      const { error } = await supabase.rpc("deactivate_route", {
        p_route_id: r.id,
        p_actor: actorUsername,
      });
      if (error) {
        console.error("deactivate_route (reset) error:", error);
        deactivateFailed = true;
      }
    }

    if (deactivateFailed) {
      toast({
        title: "Couldn't deactivate the route, so it was not reset",
        variant: "destructive",
      });
      setIsResetting(false);
      return;
    }

    if (deviceToReuse) setResetDeviceId(deviceToReuse); // 🔌 remembered for the next Save route

    hideRoutes(targets.map((r) => r.id));
    setResetUnlocked(true); // 🔓 Distance Fare is now usable
    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
    toast({ title: <SuccessTitle text="Route Reset — add a new origin & destination" /> });

    setResetRoute(null);
    setIsResetting(false);
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
                onClick={() => {
                  if (!distanceFareEnabled) return;
                  setShowDistance(true);
                }}
                disabled={!distanceFareEnabled}
                title={
                  distanceFareEnabled
                    ? "Add a new route using distance-based fare"
                    : "Click Reset on the current route first to add a new one"
                }
                data-testid="button-distance-fare"
                className="font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 shrink-0 whitespace-nowrap"
              >
                {distanceFareEnabled ? (
                  <RouteIcon className="w-4 h-4 mr-2" />
                ) : (
                  <Lock className="w-4 h-4 mr-2" />
                )}
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
                  One active route per reader device. Use Reset to clear a route from this list, then add a new origin and destination with Distance Fare.
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
                          {!searchTerm && canManage && (
                            <p className="text-[11px] mt-1 normal-case tracking-normal">
                              Click "Distance Fare" to add a new origin and destination.
                            </p>
                          )}
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
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-8 px-2 text-xs font-semibold cursor-pointer ${isDark ? "text-amber-400 hover:text-amber-300 hover:bg-amber-950/40" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"}`}
                                onClick={() => {
                                  if (blockIfViewOnly()) return;
                                  setResetRoute(route);
                                }}
                                data-testid={`button-reset-route-${route.id}`}
                                title="Reset — clear this route from the list"
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                Reset
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

      {/* 🗺️ Distance-based fare dialog (Leaflet + OSRM + LTFRB formula + PSGC places) */}
      <DistanceFareDialog
        open={canManage && distanceFareEnabled && showDistance}
        onOpenChange={setShowDistance}
        isDark={isDark}
        saving={savingDistance}
        onSave={handleDistanceSave}
        places={samarPlaces}
        placesLoading={placesLoading}
        placesError={placesError}
      />

      {/* Activate Route Dialog */}
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

      {/* Reset Confirm (UI-only soft delete — database is untouched) */}
      <AlertDialog open={canManage && !!resetRoute} onOpenChange={(open) => !open && !isResetting && setResetRoute(null)}>
        <AlertDialogContent className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <AlertDialogHeader>
            <AlertDialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <ShieldAlert className="text-amber-500" size={18} /> Reset this route?
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {resetRoute && (
                <span className="block font-semibold mb-2">
                  {resetRoute.origin} → {resetRoute.destination}
                </span>
              )}
              This clears the route (and its return direction) from the Fare Matrix list so you can
              set a new origin and destination. If it is currently active, it will be deactivated
              first, and the next route you save will be activated automatically on the same
              reader. The route is only hidden from this page — it is not deleted from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isResetting}
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed border-0 shadow-none bg-transparent hover:bg-transparent ${
                isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmReset();
              }}
              disabled={isResetting}
              data-testid="button-confirm-reset"
              className="bg-amber-600 text-white hover:bg-amber-700 font-semibold text-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {isResetting ? "Resetting..." : "Confirm Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}