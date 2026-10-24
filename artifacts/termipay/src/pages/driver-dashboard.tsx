import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useListRoutes,
  useCreateRoute,
  useUpdateRoute,
  useGetDashboardStats,
  getListRoutesQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet"; // npm i leaflet && npm i -D @types/leaflet
import "leaflet/dist/leaflet.css";
import { supabase } from "@/lib/supabase"; // 👈 adjust to your actual supabase client path
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { useAuthTheme } from "@/lib/auth-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import {
  Bus,
  LogOut,
  Sun,
  Moon,
  Wallet,
  Users,
  Route as RouteIcon,
  Home,
  History,
  UserRound,
  CheckCircle2,
  AlertCircle,
  Map as MapIcon,
  MapPin,
  Lock,
  RotateCcw,
  Power,
  PowerOff,
  ArrowLeftRight,
  ArrowRight,
  Clock,
  Search,
  Zap,
  ShieldAlert,
  Cpu,
  Wifi,
  WifiOff,
  Loader2,
  Eraser,
  Fingerprint,
  TrendingUp,
  ChevronRight,
} from "lucide-react";

const DRIVER_TOKEN_KEY = "termipay_driver_auth_token";
const AUTH_ROLE_KEY = "termipay_auth_role";
const DRIVER_NAME_KEY = "termipay_driver_username"; // optional, used as "actor" in activate/deactivate

// Same base URL as your api-client. If the frontend and API share one domain, leave it empty.
// If they are on different domains, set VITE_API_URL=https://rfid-exfz.onrender.com in the frontend env.
// Normalized: trailing "/" and a trailing "/api" are removed, so it never becomes /api/api/...
const API_BASE = String((import.meta as any).env?.VITE_API_URL ?? "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");

function driverAuthHeaders(): Record<string, string> {
  const token = window.localStorage.getItem(DRIVER_TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// 🔗 Takes ownership of a reader device for the logged-in driver. ONE device = ONE driver.
//   "ok"    -> device is now yours (taps are counted in YOUR revenue)
//   "taken" -> another driver is using it with an active route
//   "error" -> network / server problem
async function claimDevice(deviceId: string): Promise<"ok" | "taken" | "error"> {
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/claim-device`, {
      method: "POST",
      headers: driverAuthHeaders(),
      body: JSON.stringify({ deviceId }),
    });
    if (res.ok) return "ok";
    if (res.status === 409) return "taken";
    return "error";
  } catch (e) {
    console.error("claimDevice failed:", e);
    return "error";
  }
}

// 🔎 IDs of the ACTIVE routes that belong to this driver (null = couldn't load)
async function fetchMyActiveRouteIds(): Promise<string[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/my-routes`, {
      headers: driverAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.routeIds) ? data.routeIds.map(String) : null;
  } catch {
    return null;
  }
}

type Tab = "home" | "map" | "trips" | "profile";

/* ═══════════════════════════════════════════════════════════════════════
   🧾 REAL TRIPS — built on the server from the `transactions` table
   (GET /api/dashboard/my-trips). One trip = consecutive Fare taps on the
   same route (origin → destination) with no pause longer than 30 minutes.
   ═══════════════════════════════════════════════════════════════════════ */

type Trip = {
  key: string;
  origin: string | null;
  destination: string | null;
  startedAt: string; // ISO
  endedAt: string; // ISO
  taps: number;
  fare: number;
};

const MANILA_TZ = "Asia/Manila";

const fmtTripTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: MANILA_TZ,
  });

const fmtTripDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: MANILA_TZ,
  });

function useMyTrips(days: number, enabled: boolean) {
  const query = useQuery({
    queryKey: ["driver-trips", days],
    enabled,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Trip[]> => {
      const res = await fetch(`${API_BASE}/api/dashboard/my-trips?days=${days}`, {
        headers: driverAuthHeaders(),
      });
      if (!res.ok) throw new Error(`my-trips failed: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.trips) ? (data.trips as Trip[]) : [];
    },
  });

  // Realtime: a new tap changes the current trip → refetch right away
  useRealtimeRefetch(["transactions"], () => {
    if (enabled) query.refetch();
  });

  return query;
}

function TripCard({
  trip,
  isDark,
  showDate,
  compact,
}: {
  trip: Trip;
  isDark: boolean;
  showDate?: boolean;
  compact?: boolean;
}) {
  const card = isDark ? "bg-slate-900/70 border-slate-800" : "bg-white border-slate-200 shadow-sm";
  const sameMinute = fmtTripTime(trip.startedAt) === fmtTripTime(trip.endedAt);
  const timeText = sameMinute
    ? fmtTripTime(trip.startedAt)
    : `${fmtTripTime(trip.startedAt)} – ${fmtTripTime(trip.endedAt)}`;

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${compact ? "p-3.5" : "p-4"} ${card}`}>
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-blue-500 to-emerald-500" />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Bus className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1.5">
            {trip.origin || trip.destination ? (
              <div className="flex items-center gap-1.5 text-sm font-bold min-w-0">
                <span className="truncate">{trip.origin ?? "—"}</span>
                <ArrowRight className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <span className="truncate">{trip.destination ?? "—"}</span>
              </div>
            ) : (
              <p className="text-sm font-bold">Unknown route</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isDark ? "bg-blue-950/60 text-blue-300" : "bg-blue-50 text-blue-600"
                }`}
              >
                <Clock className="h-3 w-3" />
                {showDate ? `${fmtTripDay(trip.startedAt)} · ` : ""}
                {timeText}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isDark ? "bg-purple-950/60 text-purple-300" : "bg-purple-50 text-purple-600"
                }`}
              >
                <Fingerprint className="h-3 w-3" />
                {trip.taps} {trip.taps === 1 ? "tap" : "taps"}
              </span>
            </div>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-xl px-2.5 py-1.5 text-sm font-extrabold ${
            isDark ? "bg-emerald-950/50 text-emerald-400" : "bg-emerald-50 text-emerald-600"
          }`}
        >
          {formatPeso(trip.fare)}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════════════════════ */

// Plain ₱ text character (same approach as the admin dashboard)
const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
   🙈 UI-ONLY SOFT DELETE ("Reset") — row stays in the database
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
    /* storage unavailable */
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
   ═══════════════════════════════════════════════════════════════════════ */

const PSGC = "https://psgc.gitlab.io/api";

type Place = {
  code: string;
  label: string;
  kind: "barangay" | "city" | "municipality";
  barangay?: string;
  municipality: string;
  province: string;
};

async function getJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`PSGC request failed: ${res.status}`);
  return res.json();
}

const isCityName = (name: string) => /^city of\s+/i.test(name) || /\scity$/i.test(name);

const cleanMuniName = (name: string) =>
  /^city of\s+/i.test(name) ? `${name.replace(/^city of\s+/i, "").trim()} City` : name.trim();

async function fetchSamarPlaces(): Promise<Place[]> {
  const allProvinces = await getJson<any[]>(`${PSGC}/provinces.json`);
  const provinces = allProvinces.filter((p) => /samar|leyte/i.test(p.name));
  const out: Place[] = [];

  await Promise.all(
    provinces.map(async (prov) => {
      const provName: string = prov.name;
      const munis = await getJson<any[]>(`${PSGC}/provinces/${prov.code}/cities-municipalities.json`);

      const muniMap = new Map<string, string>();
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
        const brgys = await getJson<any[]>(`${PSGC}/provinces/${prov.code}/barangays.json`);
        pushBarangays(brgys);
      } catch {
        await Promise.all(
          munis.map(async (m) => {
            try {
              const brgys = await getJson<any[]>(`${PSGC}/cities-municipalities/${m.code}/barangays.json`);
              pushBarangays(brgys, m.code);
            } catch {
              /* skip */
            }
          })
        );
      }
    })
  );

  const counts = new Map<string, number>();
  out.forEach((p) => counts.set(p.label, (counts.get(p.label) ?? 0) + 1));
  out.forEach((p) => {
    if ((counts.get(p.label) ?? 0) > 1) p.label = `${p.label}, ${p.province}`;
  });

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

let placesPromise: Promise<Place[]> | null = null;
function loadSamarPlaces() {
  if (!placesPromise) {
    placesPromise = fetchSamarPlaces().catch((e) => {
      placesPromise = null;
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
   🔎 PlaceCombobox — type to search, pick from the list
   ═══════════════════════════════════════════════════════════════════════ */

type PlaceComboboxProps = {
  value: string;
  onChange: (text: string, place: Place | null) => void;
  places: Place[];
  loading: boolean;
  placeholder?: string;
  isDark: boolean;
  className?: string;
  disabled?: boolean;
};

function PlaceCombobox({
  value,
  onChange,
  places,
  loading,
  placeholder,
  isDark,
  className,
  disabled,
}: PlaceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleBlurRef = useRef(false);

  const hideKeyboard = () => {
    containerRef.current?.querySelector("input")?.blur();
  };

  // ⌨️ User stopped typing for 800 ms → close the keyboard (the result list stays open so they can tap one)
  const scheduleIdleBlur = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const input = containerRef.current?.querySelector("input");
      if (input && document.activeElement === input) {
        idleBlurRef.current = true; // blur without closing the list
        input.blur();
        idleBlurRef.current = false;
      }
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // Tap outside → close the list
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const results = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return places.filter((p) => p.kind !== "barangay").slice(0, 60);
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

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (p: Place) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    onChange(p.label, p);
    setOpen(false);
    hideKeyboard();
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
      hideKeyboard();
    }
  };

  const kindLabel = (k: Place["kind"]) =>
    k === "barangay" ? "Barangay" : k === "city" ? "City" : "Municipality";

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
          scheduleIdleBlur();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!idleBlurRef.current) setOpen(false);
        }}
        onKeyDown={onKeyDown}
        // text-base on mobile prevents iOS auto-zoom on focus
        className={`h-10 text-base sm:text-sm ${className ?? ""}`}
      />

      {open && !disabled && (
        <div
          ref={listRef}
          className={`absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border shadow-lg ${
            isDark ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Samar &amp; Leyte places...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">No matching place in Samar or Leyte</div>
          ) : (
            results.map((p, i) => (
              <div
                key={p.code}
                data-idx={i}
                // mousedown preventDefault keeps the input focused so the tap isn't lost to onBlur
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 text-sm cursor-pointer ${
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
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_BASE_FARE = 15;
const DEFAULT_BASE_KM = 4;
const DEFAULT_RATE = 2.2;

type LatLng = { lat: number; lng: number };

function computeLtfrbFare(distanceKm: number, baseFare: number, baseKm: number, ratePerKm: number) {
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

// Nominatim (OpenStreetMap) geocoder — free, max 1 request/second.
// All requests go through ONE queue that only waits for the time that is really left,
// instead of a fixed sleep before every request.
let lastGeoAt = 0;
let geoQueue: Promise<unknown> = Promise.resolve();

function throttledGeo<T>(fn: () => Promise<T>): Promise<T> {
  const run = geoQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeoAt));
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastGeoAt = Date.now();
    }
  });
  geoQueue = run.catch(() => undefined);
  return run;
}

async function geocode(query: string): Promise<LatLng | null> {
  return throttledGeo(async () => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(
      query
    )}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function geocodePlace(p: Place): Promise<LatLng | null> {
  if (p.kind === "barangay" && p.barangay) {
    const hit = await geocode(`${p.barangay}, ${p.municipality}, ${p.province}, Philippines`);
    if (hit) return hit;
  }
  return geocode(`${p.municipality}, ${p.province}, Philippines`);
}

/* ⚡ Coordinates are remembered (also after closing the app), so a place is looked up only ONCE. */
const GEO_CACHE_KEY = "termipay_geo_cache_v1";

function loadGeoCache(): Record<string, LatLng> {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const geoCache: Record<string, LatLng> = loadGeoCache();
const geoInflight = new Map<string, Promise<LatLng | null>>();

function saveGeoCache() {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache));
  } catch {
    /* storage unavailable */
  }
}

function geocodePlaceCached(p: Place): Promise<LatLng | null> {
  const hit = geoCache[p.code];
  if (hit) return Promise.resolve(hit);

  let pending = geoInflight.get(p.code);
  if (!pending) {
    pending = geocodePlace(p)
      .then((r) => {
        if (r) {
          geoCache[p.code] = r;
          saveGeoCache();
        }
        return r;
      })
      .finally(() => {
        geoInflight.delete(p.code);
      });
    geoInflight.set(p.code, pending);
  }
  return pending;
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

// OSRM — distance only (overview=false = tiny response, much faster than full route geometry).
async function roadKm(a: LatLng, b: LatLng): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const meters = data?.routes?.[0]?.distance;
        if (typeof meters === "number") return meters / 1000;
      }
    } catch {
      /* retry once */
    }
    if (attempt === 0) await sleep(300);
  }
  return null;
}

type KmResult = { ok: true; km: number } | { ok: false; reason: "locate" | "route" | "network" };

// Same origin → destination is calculated ONCE. It starts as soon as both places are picked
// (in the background), so by the time OK is tapped the answer is usually already there.
const roadKmCache = new Map<string, Promise<KmResult>>();

function getRoadKm(a: Place, b: Place): Promise<KmResult> {
  const key = `${a.code}|${b.code}`;
  let pending = roadKmCache.get(key);
  if (!pending) {
    pending = (async (): Promise<KmResult> => {
      try {
        const [o, d] = await Promise.all([geocodePlaceCached(a), geocodePlaceCached(b)]);
        if (!o || !d) return { ok: false, reason: "locate" };
        const km = await roadKm(o, d);
        if (km == null) return { ok: false, reason: "route" };
        return { ok: true, km };
      } catch {
        return { ok: false, reason: "network" };
      }
    })().then((r) => {
      if (!r.ok) roadKmCache.delete(key); // failed → allow a fresh try next time
      return r;
    });
    roadKmCache.set(key, pending);
  }
  return pending;
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

/* ═══════════════════════════════════════════════════════════════════════
   🔑 Driver API auth — the generated api-client only knows the admin token,
   so every request to our own /api/ gets the DRIVER token instead.
   Restored automatically when the driver leaves this page.
   ═══════════════════════════════════════════════════════════════════════ */

function useDriverApiAuth() {
  useEffect(() => {
    const original = window.fetch;

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const token = window.localStorage.getItem(DRIVER_TOKEN_KEY);
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (!token) return original(input, init);

      let parsed: URL;
      try {
        parsed = new URL(rawUrl, window.location.href);
      } catch {
        return original(input, init);
      }

      // Only OUR API (path starts with /api/). Third-party hosts must never get
      // the Authorization header — it triggers a CORS preflight that they reject
      // (this is what broke the PSGC places list: psgc.gitlab.io/api/...).
      const host = parsed.hostname;
      const isExternal =
        host === "psgc.gitlab.io" ||
        host.endsWith("openstreetmap.org") ||
        host.endsWith("project-osrm.org") ||
        host.endsWith("supabase.co") ||
        host.endsWith("supabase.in");

      if (isExternal || !parsed.pathname.startsWith("/api/")) {
        return original(input, init);
      }

      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      headers.set("Authorization", `Bearer ${token}`);

      if (input instanceof Request) {
        return original(new Request(input, { ...init, headers }));
      }
      return original(input, { ...init, headers });
    };

    return () => {
      window.fetch = original;
    };
  }, []);
}

/* ═══════════════════════════════════════════════════════════════════════
   🧭 FareMapPanel — the "Route" tab (map + origin/destination + activate/reset)
   ═══════════════════════════════════════════════════════════════════════ */

type PanelProps = { isDark: boolean; visible: boolean };

function FareMapPanel({ isDark, visible }: PanelProps) {
  const { toast: baseToast } = useToast();
  // every toast on this page stays on screen for only 500 ms
  const toast = (opts: Parameters<typeof baseToast>[0]) => baseToast({ duration: 500, ...opts });
  const queryClient = useQueryClient();
  const actorUsername =
    (typeof window !== "undefined" && window.localStorage.getItem(DRIVER_NAME_KEY)) || "driver";

  /* ---------- theme classes ---------- */
  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const card = isDark ? "bg-slate-900/70 border-slate-800" : "bg-white border-slate-200 shadow-sm";
  const inputCls = isDark
    ? "bg-slate-950 border-slate-800 text-slate-200"
    : "bg-white border-slate-200 text-slate-800";
  const rail = isDark ? "border-slate-600" : "border-slate-300";

  /* ---------- places + routes data ---------- */
  const { places, loading: placesLoading, error: placesError } = useSamarPlaces();
  const { hiddenIds, hide: hideRoutes, unhide: unhideRoutes } = useHiddenRoutes();

  const { data: routes, isLoading, refetch: refetchRoutes } = useListRoutes(undefined, {
    query: { refetchOnWindowFocus: true },
  });

  useRealtimeRefetch(["fare_routes"], () => {
    refetchRoutes();
  });

  const createMutation = useCreateRoute({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() }),
    },
  });
  const updateMutation = useUpdateRoute({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() }),
    },
  });

  // 🚌 Active routes that belong to THIS driver. Another driver's active route is never shown here,
  // so two accounts can no longer see/fight over the same device.
  const [myActiveRouteIds, setMyActiveRouteIds] = useState<string[] | null>(null);
  const [myRoutesLoaded, setMyRoutesLoaded] = useState(false);

  const loadMyRoutes = useCallback(async () => {
    const ids = await fetchMyActiveRouteIds();
    setMyActiveRouteIds(ids); // null = request failed → don't filter
    setMyRoutesLoaded(true);
  }, []);

  useEffect(() => {
    loadMyRoutes();
  }, [loadMyRoutes]);

  useRealtimeRefetch(["fare_routes", "devices"], () => {
    loadMyRoutes();
  });

  const visibleRoutes = useMemo(() => {
    if (!Array.isArray(routes)) return [];
    const hidden = new Set(hiddenIds);
    const mine = myActiveRouteIds ? new Set(myActiveRouteIds) : null;
    return routes.filter((r: any) => {
      if (hidden.has(String(r.id))) return false;
      // active route of another driver → not mine, hide it
      if (mine && r.isActive && !mine.has(String(r.id))) return false;
      return true;
    });
  }, [routes, hiddenIds, myActiveRouteIds]);

  // 1️⃣ ONLY ONE ROUTE is displayed: the newest ACTIVE route, otherwise the newest route.
  // Every other route (including its return direction) stays hidden in this view.
  const currentRoute = useMemo(() => {
    if (visibleRoutes.length === 0) return null;
    const byNewest = [...visibleRoutes].sort((a: any, b: any) => Number(b.id) - Number(a.id));
    return byNewest.find((r: any) => r.isActive) ?? byNewest[0];
  }, [visibleRoutes]);
  const shownRoutes = useMemo(() => (currentRoute ? [currentRoute] : []), [currentRoute]);

  // 🔒 Distance Fare is usable only when no route is shown OR right after a Reset
  const [resetUnlocked, setResetUnlocked] = useState(false);
  const noVisibleRoutes = !isLoading && myRoutesLoaded && !currentRoute;
  const distanceFareEnabled = noVisibleRoutes || resetUnlocked;

  // 🔌 reader device of the route that was reset → re-used for the next saved route
  const [resetDeviceId, setResetDeviceId] = useState<string | null>(null);

  const activeRoutes = shownRoutes.filter((r: any) => r.isActive);
  const activeRouteIdsKey = activeRoutes.map((r: any) => r.id).join(",");

  const [selectedActiveRouteId, setSelectedActiveRouteId] = useState<string | number | null>(null);

  useEffect(() => {
    if (activeRoutes.length === 0) {
      setSelectedActiveRouteId(null);
      return;
    }
    const stillActive = activeRoutes.some((r: any) => r.id === selectedActiveRouteId);
    if (!stillActive) setSelectedActiveRouteId(activeRoutes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteIdsKey]);

  const selectedActiveRoute =
    activeRoutes.find((r: any) => r.id === selectedActiveRouteId) ?? activeRoutes[0] ?? null;

  /* ---------- reader devices of active routes ---------- */
  const [activeDeviceMap, setActiveDeviceMap] = useState<Record<string, Device | null>>({});
  const [loadingActiveDevices, setLoadingActiveDevices] = useState(false);
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

    const deviceIds = Array.from(new Set(routeRows.map((r: any) => r.device_id).filter(Boolean)));

    let devicesData: Device[] = [];
    if (deviceIds.length > 0) {
      const { data: devs } = await supabase
        .from("devices")
        .select("device_id, name, status, ip_address, firmware_version, last_ping, created_at")
        .in("device_id", deviceIds);
      devicesData = (devs as Device[]) ?? [];
    }

    const map: Record<string, Device | null> = {};
    routeRows.forEach((r: any) => {
      map[String(r.id)] = devicesData.find((d) => d.device_id === r.device_id) ?? null;
    });

    activeDeviceRouteIdsRef.current = key;
    setActiveDeviceMap(map);
    if (isNewSet) setLoadingActiveDevices(false);
  };

  useEffect(() => {
    fetchActiveRoutesDevices(activeRoutes.map((r: any) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteIdsKey]);

  /* ---------- activate dialog (pick reader device) ---------- */
  const [activateRoute, setActivateRoute] = useState<any>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isTogglePending, setIsTogglePending] = useState(false);
  const [pendingRouteId, setPendingRouteId] = useState<string | number | null>(null);

  const fetchActiveDevices = async (excludeRouteId?: string | number) => {
    setLoadingDevices(true);

    const { data: activeRows, error: activeErr } = await supabase
      .from("fare_routes")
      .select("id, device_id")
      .eq("is_active", true);

    const inUseDeviceIds = (activeRows ?? [])
      .filter((r: any) => r.device_id && r.id !== excludeRouteId)
      .map((r: any) => r.device_id);

    let query = supabase
      .from("devices")
      .select("device_id, name, status, ip_address, firmware_version, last_ping, created_at")
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

  useRealtimeRefetch(["devices"], () => {
    if (activateRoute) fetchActiveDevices(activateRoute.id);
    fetchActiveRoutesDevices(activeRoutes.map((r: any) => r.id));
  });

  const openActivateModal = (route: any) => {
    setActivateRoute(route);
    setSelectedDeviceId("");
    fetchActiveDevices(route.id);
  };

  // Looks through ALL routes (including hidden ones) so both directions stay in sync
  const findReverseRoute = (route: any) =>
    Array.isArray(routes)
      ? routes.find(
          (r: any) =>
            r.id !== route.id && r.origin === route.destination && r.destination === route.origin
        ) ?? null
      : null;

  const confirmActivate = async () => {
    if (!activateRoute || !selectedDeviceId) return;

    setIsTogglePending(true);
    setPendingRouteId(activateRoute.id);

    const reverseRoute = findReverseRoute(activateRoute);

    // 🔗 FIRST take ownership of the reader. One device = one driver.
    const claim = await claimDevice(selectedDeviceId);
    if (claim !== "ok") {
      toast({
        title:
          claim === "taken"
            ? "This device is already in use by another driver"
            : "Couldn't link the device to your account. Try again.",
        variant: "destructive",
      });
      setIsTogglePending(false);
      setPendingRouteId(null);
      fetchActiveDevices(activateRoute.id);
      return;
    }

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
    await loadMyRoutes();
    await fetchActiveRoutesDevices([
      ...shownRoutes
        .filter((r: any) => r.isActive && r.id !== activateRoute.id && r.id !== reverseRoute?.id)
        .map((r: any) => r.id),
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
    setIsTogglePending(true);
    setPendingRouteId(routeId);

    const route = Array.isArray(routes) ? routes.find((r: any) => r.id === routeId) : null;
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

  /* ---------- Reset (UI-only soft delete) ---------- */
  const [isResetting, setIsResetting] = useState(false);

  const confirmReset = async (target: any) => {
    if (!target || isResetting) return;
    setIsResetting(true);

    const reverseRoute = findReverseRoute(target);
    const targets = [target, ...(reverseRoute ? [reverseRoute] : [])];

    // 🔌 Grab the device BEFORE deactivating (deactivate_route sets device_id = null)
    let deviceToReuse: string | null = null;
    try {
      const { data: devRows } = await supabase
        .from("fare_routes")
        .select("id, device_id")
        .in(
          "id",
          targets.map((r: any) => r.id)
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

    if (deviceToReuse) setResetDeviceId(deviceToReuse);

    // hide the reset route + its return AND every other route, so only the NEW route shows next
    hideRoutes([...targets.map((r: any) => r.id), ...visibleRoutes.map((r: any) => r.id)]);
    setResetUnlocked(true);
    resetForm(); // clears pins / route line on the map, default origin comes back
    goToDistanceFare(); // "presses" Distance Fare: unlock + scroll to the form
    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
    toast({ title: <SuccessTitle text="Route Reset — set a new origin & destination" /> });

    setIsResetting(false);
  };

  /* ---------- list (single route only) ---------- */
  const filteredRoutes = shownRoutes;

  /* ═════════ Distance fare form (origin / destination / map) ═════════ */

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
  const [saving, setSaving] = useState(false);
  // Pins are read-only: the map follows the places picked in the form
  const [pinsLocked, setPinsLocked] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const formSectionRef = useRef<HTMLElement | null>(null);
  const [flashForm, setFlashForm] = useState(false);

  // Leaflet plumbing
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const originMarker = useRef<L.Marker | null>(null);
  const destMarker = useRef<L.Marker | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);

  // Default origin = Calbayog City (once the places list is loaded, and again after each form reset)
  const defaultedFor = useRef(-1);
  useEffect(() => {
    if (defaultedFor.current === formKey || places.length === 0) return;
    const calbayog = places.find((p) => p.kind === "city" && /^calbayog/i.test(p.label));
    if (calbayog) {
      setOriginName(calbayog.label);
      setOriginPlace(calbayog);
      defaultedFor.current = formKey;
    }
  }, [places, formKey]);

  const resetForm = () => {
    setOriginName("");
    setDestName("");
    setOriginPlace(null);
    setDestPlace(null);
    setOriginPt(null);
    setDestPt(null);
    setDistanceKm(null);
    setIsEstimate(false);
    setError(null);
    setPinsLocked(true);
    setBusy(false);
    routeLine.current?.remove();
    routeLine.current = null;
    setFormKey((k) => k + 1);
  };

  // Auto "press" Distance Fare after Reset: scroll the form into view and highlight it
  const goToDistanceFare = () => {
    setFlashForm(true);
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      mapRef.current?.invalidateSize();
    }, 200);
    setTimeout(() => setFlashForm(false), 2000);
  };

  // Create the map once the container is mounted
  useEffect(() => {
    if (!mapEl) return;
    const map = L.map(mapEl, {
      center: [11.2, 124.9], // Samar + Leyte
      zoom: 7,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
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

  // Tab is hidden with CSS when not active → fix tile sizing when it becomes visible again
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [visible]);

  // Keep markers in sync with state
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

  // Any point/place change invalidates the previous calculation
  useEffect(() => {
    setDistanceKm(null);
  }, [originPt, destPt, originPlace, destPlace]);

  // 🗺️ Show the picked places (or the current saved route) on the map and draw the real road line
  const mapOrigin =
    originPlace ?? (currentRoute ? places.find((p) => p.label === currentRoute.origin) ?? null : null);
  const mapDest =
    destPlace ?? (currentRoute ? places.find((p) => p.label === currentRoute.destination) ?? null : null);

  useEffect(() => {
    let cancelled = false;
    routeLine.current?.remove();
    routeLine.current = null;

    if (!mapOrigin) setOriginPt(null);
    if (!mapDest) setDestPt(null);

    if (mapOrigin) {
      geocodePlaceCached(mapOrigin)
        .then((pt) => {
          if (cancelled || !pt) return;
          setOriginPt(pt);
          if (!mapDest) mapRef.current?.setView([pt.lat, pt.lng], 11);
        })
        .catch(() => {});
    }
    if (mapDest) {
      geocodePlaceCached(mapDest)
        .then((pt) => {
          if (!cancelled && pt) setDestPt(pt);
        })
        .catch(() => {});
    }

    if (mapOrigin && mapDest) {
      (async () => {
        try {
          const [o, d] = await Promise.all([geocodePlaceCached(mapOrigin), geocodePlaceCached(mapDest)]);
          const map = mapRef.current;
          if (!o || !d || !map || cancelled) return;
          const r = await roadRoute(o, d).catch(() => null);
          if (cancelled || !mapRef.current) return;
          if (r) {
            routeLine.current = L.polyline(r.coords, { color: "#2563eb", weight: 5, opacity: 0.9 }).addTo(map);
            map.fitBounds(routeLine.current.getBounds(), { padding: [40, 40] });
          } else {
            map.fitBounds(
              [
                [o.lat, o.lng],
                [d.lat, d.lng],
              ],
              { padding: [40, 40] }
            );
          }
        } catch {
          /* ignore */
        }
      })();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapOrigin?.code, mapDest?.code, mapEl]);

  const fare = useMemo(() => {
    if (distanceKm == null) return null;
    const bf = parseFloat(baseFare);
    const bk = parseFloat(baseKm);
    const r = parseFloat(rate);
    if ([bf, bk, r].some((n) => Number.isNaN(n) || n < 0)) return null;
    return computeLtfrbFare(distanceKm, bf, bk, r);
  }, [distanceKm, baseFare, baseKm, rate]);

  const excessKm = distanceKm != null ? Math.max(0, distanceKm - (parseFloat(baseKm) || 0)) : 0;

  // ⚡ Start finding the places + road distance in the background as soon as they are picked
  useEffect(() => {
    if (!distanceFareEnabled) return;
    if (originPlace && destPlace) {
      getRoadKm(originPlace, destPlace);
    } else if (originPlace) {
      geocodePlaceCached(originPlace).catch(() => {});
    } else if (destPlace) {
      geocodePlaceCached(destPlace).catch(() => {});
    }
  }, [originPlace, destPlace, distanceFareEnabled]);

  // ✅ ONE BUTTON: Set route — find both places, get the road distance, compute the fare,
  // SAVE the route and AUTO-ACTIVATE it (on the reader of the route that was reset).
  const canPressOk = distanceFareEnabled && !!originPlace && !!destPlace && !busy && !saving;

  // ⚡ Activates a saved route (+ its return direction) on the given reader device
  const activateSavedRoute = async (
    origin: string,
    destination: string,
    deviceId: string
  ): Promise<"ok" | "failed" | "not-found" | "taken"> => {
    // main + return direction are looked up at the same time
    const [{ data: main }, { data: reverse }] = await Promise.all([
      supabase
        .from("fare_routes")
        .select("id")
        .eq("origin", origin)
        .eq("destination", destination)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("fare_routes")
        .select("id")
        .eq("origin", destination)
        .eq("destination", origin)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!main?.id) return "not-found";

    // 🔗 take ownership of the reader first (one device = one driver)
    const claim = await claimDevice(deviceId);
    if (claim === "taken") return "taken";
    if (claim !== "ok") return "failed";

    // ...and both are activated at the same time
    const calls = [main.id, ...(reverse?.id ? [reverse.id] : [])].map((id) =>
      supabase.rpc("activate_route", {
        p_route_id: id,
        p_device_id: deviceId,
        p_actor: actorUsername,
      })
    );
    const results = await Promise.all(calls);
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error("activate_route (after save) error:", failed.error);
      return "failed";
    }
    return "ok";
  };

  const handleOk = async () => {
    setError(null);

    if (!distanceFareEnabled) {
      toast({
        title: "Distance Fare is locked",
        description: "Tap Reset on the current route first.",
        variant: "destructive",
      });
      return;
    }

    if (!originPlace || !destPlace) {
      setError("Pick both the origin and the destination from the list (Samar & Leyte only).");
      return;
    }

    const bf = parseFloat(baseFare);
    const bk = parseFloat(baseKm);
    const rt = parseFloat(rate);
    if ([bf, bk, rt].some((n) => Number.isNaN(n) || n < 0)) {
      setError("Fare settings are invalid.");
      return;
    }

    setBusy(true);

    /* 1️⃣ distance → fare (usually already prepared in the background) */
    let fareAmount: number;
    try {
      const res = await getRoadKm(originPlace, destPlace);

      if (!res.ok) {
        setError(
          res.reason === "locate"
            ? "Couldn't locate one of the places. Try a nearby city or municipality."
            : res.reason === "route"
              ? "Couldn't get the road distance. Check your connection and tap Set route again."
              : "Lookup failed. Check your connection and tap Set route again."
        );
        setBusy(false);
        return;
      }

      fareAmount = computeLtfrbFare(res.km, bf, bk, rt);
      if (!(fareAmount > 0)) {
        setError("The computed fare is invalid.");
        setBusy(false);
        return;
      }
    } catch {
      setError("Lookup failed. Check your connection and tap Set route again.");
      setBusy(false);
      return;
    }

    /* 2️⃣ save (create or update) + 3️⃣ auto-activate */
    setSaving(true);
    const p = { origin: originPlace.label, destination: destPlace.label, fareAmount };

    try {
      const existing = Array.isArray(routes)
        ? routes.find((r: any) => r.origin === p.origin && r.destination === p.destination)
        : null;

      if (existing) {
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

      let activateResult: "ok" | "failed" | "not-found" | "taken" | "no-device" = "no-device";
      if (resetDeviceId) {
        activateResult = await activateSavedRoute(p.origin, p.destination, resetDeviceId);
      }

      queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      loadMyRoutes();

      resetForm();
      setResetUnlocked(false); // 🔒 lock again — Reset is needed before adding another
      setResetDeviceId(null);

      if (activateResult === "ok") {
        toast({ title: <SuccessTitle text={`Route Saved & Activated — ₱${p.fareAmount.toFixed(2)}`} /> });
      } else if (activateResult === "no-device") {
        toast({
          title: <SuccessTitle text={`Route Saved — ₱${p.fareAmount.toFixed(2)}`} />,
          description: "No reader device to re-use. Activate the route manually.",
        });
      } else {
        toast({
          title: "Route saved, but couldn't activate it",
          description:
            activateResult === "taken"
              ? "That reader is now used by another driver. Pick another device."
              : "Please activate it manually and pick a reader device.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Failed to save route", variant: "destructive" });
    } finally {
      setSaving(false);
      setBusy(false);
    }
  };

  /* ═════════ render ═════════ */

  return (
    <div className="space-y-0">
      {/* Map (isolate keeps Leaflet's z-index panes under the header and bottom bar) */}
      <div
        className={`relative isolate z-0 h-64 overflow-hidden rounded-3xl border ${
          isDark ? "border-slate-800" : "border-slate-200"
        }`}
      >
        <div ref={setMapEl} className="h-full w-full" />
        <span className="absolute left-3 top-3 z-[500] flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Samar &amp; Leyte
        </span>
      </div>

      {/* Bottom-sheet: origin / destination */}
      <section
        ref={formSectionRef}
        className={`relative z-10 -mt-6 scroll-mt-20 rounded-3xl border p-4 space-y-3 transition-shadow ${card} ${
          flashForm ? "ring-2 ring-blue-500" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
              <RouteIcon size={14} />
            </span>
            Where to?
          </h2>
          {!distanceFareEnabled && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
              }`}
            >
              <Lock className="h-3 w-3" /> Reset to edit
            </span>
          )}
        </div>

        {placesError && <p className="text-[11px] text-red-500">{placesError}</p>}

        <div className="flex gap-3">
          <div className="flex flex-col items-center pb-2 pt-6">
            <span className="h-3 w-3 rounded-full border-[3px] border-blue-500 bg-transparent" />
            <span className={`my-1 w-px flex-1 border-l-2 border-dashed ${rail}`} />
            <span className="h-3 w-3 rounded-[3px] bg-emerald-500" />
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="space-y-1">
              <Label className={`text-[11px] font-semibold ${muted}`}>Origin</Label>
              <PlaceCombobox
                value={originName}
                places={places}
                loading={placesLoading}
                isDark={isDark}
                disabled={!distanceFareEnabled || busy || saving}
                placeholder="Barangay / city / municipality"
                className={`${inputCls} rounded-xl`}
                onChange={(text, place) => {
                  setOriginName(text);
                  setOriginPlace(place);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className={`text-[11px] font-semibold ${muted}`}>Destination</Label>
              <PlaceCombobox
                value={destName}
                places={places}
                loading={placesLoading}
                isDark={isDark}
                disabled={!distanceFareEnabled || busy || saving}
                placeholder="Barangay / city / municipality"
                className={`${inputCls} rounded-xl`}
                onChange={(text, place) => {
                  setDestName(text);
                  setDestPlace(place);
                }}
              />
            </div>
          </div>
        </div>

        {error && (
          <p
            className={`rounded-lg px-3 py-2 text-[11px] font-medium ${
              isDark ? "bg-red-950/40 text-red-400" : "bg-red-50 text-red-600"
            }`}
          >
            {error}
          </p>
        )}

        <Button
          type="button"
          onClick={handleOk}
          disabled={!canPressOk}
          aria-busy={busy || saving}
          aria-label={busy || saving ? "Loading" : "Set route"}
          className="h-12 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set route"}
        </Button>
      </section>

      {/* Current route */}
      <section className="space-y-3 pt-4">
        <div className="flex items-center justify-between px-1">
          <h2 className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>Your route</h2>
          <span
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              isDark
                ? "border-emerald-900 bg-emerald-950/40 text-emerald-400"
                : "border-emerald-100 bg-emerald-50 text-emerald-600"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            LIVE
          </span>
        </div>

        {isLoading || !myRoutesLoaded ? (
          <Skeleton className={`h-44 w-full rounded-2xl ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
        ) : filteredRoutes.length === 0 ? (
          <div
            className={`flex flex-col items-center rounded-2xl border border-dashed py-10 ${
              isDark ? "border-slate-800 text-slate-600" : "border-slate-300 text-slate-400"
            }`}
          >
            <MapPin size={36} className="mb-2" />
            <p className="text-sm font-bold">No route yet</p>
            <p className="mt-1 text-center text-[11px]">Pick an origin and destination above, then tap Set route.</p>
          </div>
        ) : (
          filteredRoutes.map((route: any) => (
            <div
              key={route.id}
              className={`overflow-hidden rounded-2xl border ${
                route.isActive
                  ? isDark
                    ? "border-emerald-900 bg-emerald-950/20"
                    : "border-emerald-200 bg-emerald-50/60"
                  : card
              }`}
            >
              <div
                className={`h-1.5 w-full ${
                  route.isActive
                    ? "bg-gradient-to-r from-emerald-400 to-teal-500"
                    : isDark
                      ? "bg-slate-800"
                      : "bg-slate-200"
                }`}
              />
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex flex-col items-center pb-1 pt-1.5">
                      <span className="h-3 w-3 rounded-full border-[3px] border-blue-500" />
                      <span className={`my-1 w-px flex-1 border-l-2 border-dashed ${rail}`} />
                      <span className="h-3 w-3 rounded-[3px] bg-emerald-500" />
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div>
                        <p className={`text-[10px] font-semibold ${muted}`}>From</p>
                        <p className="break-words text-sm font-bold">{route.origin}</p>
                      </div>
                      <div>
                        <p className={`text-[10px] font-semibold ${muted}`}>To</p>
                        <p className="break-words text-sm font-bold">{route.destination}</p>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 space-y-1.5 text-right">
                    <p className="text-2xl font-extrabold leading-none">₱{Number(route.fareAmount).toFixed(2)}</p>
                    <Badge
                      className={
                        route.isActive
                          ? isDark
                            ? "border border-emerald-900 bg-emerald-950/40 text-emerald-400"
                            : "border border-emerald-200 bg-emerald-100 text-emerald-700"
                          : isDark
                            ? "border border-slate-700 bg-slate-800 text-slate-400"
                            : "border border-slate-200 bg-slate-100 text-slate-500"
                      }
                    >
                      {route.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    onClick={() => (route.isActive ? handleDeactivate(route.id) : openActivateModal(route))}
                    disabled={isTogglePending && pendingRouteId === route.id}
                    className={`h-11 rounded-xl font-bold text-white shadow-sm disabled:cursor-not-allowed ${
                      route.isActive
                        ? "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700"
                        : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                    }`}
                  >
                    {isTogglePending && pendingRouteId === route.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : route.isActive ? (
                      <>
                        <PowerOff className="mr-1.5 h-4 w-4" /> Deactivate
                      </>
                    ) : (
                      <>
                        <Power className="mr-1.5 h-4 w-4" /> Activate
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => confirmReset(route)}
                    disabled={isResetting}
                    className={`h-11 rounded-xl font-bold ${
                      isDark
                        ? "border-amber-900 bg-amber-950/30 text-amber-400 hover:bg-amber-950/60"
                        : "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100"
                    }`}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Reset
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Activate Route dialog */}
      <Dialog
        open={!!activateRoute}
        onOpenChange={(open) => {
          if (!open) {
            setActivateRoute(null);
            setSelectedDeviceId("");
          }
        }}
      >
        <DialogContent
          className={`w-[calc(100%-2rem)] max-w-md rounded-2xl ${
            isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-500">
              <Power size={18} /> Activate Route
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {activateRoute && (
              <div
                className={`text-sm border rounded-xl p-3 ${
                  isDark ? "text-slate-300 bg-slate-950/60 border-slate-800" : "text-slate-700 bg-slate-50 border-slate-200"
                }`}
              >
                <p className="font-semibold flex items-center gap-2 flex-wrap">
                  <MapPin className="w-3.5 h-3.5 text-blue-500" />
                  {activateRoute.origin}
                  <ArrowLeftRight className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                  {activateRoute.destination}
                </p>
                <p className={`mt-1 font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                  ₱{Number(activateRoute.fareAmount).toFixed(2)} per tap
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label className={`text-xs font-semibold flex items-center gap-1 ${muted}`}>
                <Cpu className="w-3.5 h-3.5" />
                Select Active Device (RFID Reader)
              </Label>
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId} disabled={loadingDevices}>
                <SelectTrigger className={`h-11 rounded-xl ${inputCls}`}>
                  <SelectValue placeholder={loadingDevices ? "Loading devices..." : "Choose a device"} />
                </SelectTrigger>
                <SelectContent>
                  {!loadingDevices && devices.length === 0 && (
                    <div className={`px-3 py-4 text-xs text-center ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      No active devices found
                    </div>
                  )}
                  {devices.map((d) => (
                    <SelectItem key={d.device_id} value={d.device_id}>
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

          <DialogFooter className="gap-2 sm:gap-2 flex-row justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setActivateRoute(null);
                setSelectedDeviceId("");
              }}
              className={`bg-transparent hover:bg-transparent ${muted}`}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmActivate}
              disabled={!selectedDeviceId || isTogglePending}
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 disabled:cursor-not-allowed"
            >
              {isTogglePending ? "Activating..." : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ⌨️ Keyboard handling — keep the bottom nav locked at the bottom
   1) tell Chrome the keyboard should only overlay the page (not resize it)
   2) fallback: if the page still shrinks, report "keyboard open" so the nav can tuck away
   ═══════════════════════════════════════════════════════════════════════ */

function useKeyboardLock() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const original = meta?.getAttribute("content") ?? null;
    if (meta && original && !/interactive-widget/.test(original)) {
      meta.setAttribute("content", `${original}, interactive-widget=resizes-visual`);
    }

    const vv = window.visualViewport;
    let fullHeight = Math.max(window.innerHeight, vv?.height ?? 0);
    let lastWidth = window.innerWidth;

    const check = () => {
      if (window.innerWidth !== lastWidth) {
        // rotation / real resize → recalibrate
        lastWidth = window.innerWidth;
        fullHeight = Math.max(window.innerHeight, vv?.height ?? 0);
      }
      fullHeight = Math.max(fullHeight, window.innerHeight);
      const current = vv?.height ?? window.innerHeight;
      setKeyboardOpen(current < fullHeight - 150);
    };

    vv?.addEventListener("resize", check);
    window.addEventListener("resize", check);
    return () => {
      vv?.removeEventListener("resize", check);
      window.removeEventListener("resize", check);
      if (meta && original !== null) meta.setAttribute("content", original);
    };
  }, []);

  return keyboardOpen;
}

/* ═══════════════════════════════════════════════════════════════════════
   📊 Realtime today stats (Earned today + Total taps today)
   Same endpoint as the admin dashboard (useGetDashboardStats). For a driver,
   the server returns ONLY the taps/revenue of that driver's own reader device.
   Refetched instantly whenever "transactions" changes — no polling interval.
   ═══════════════════════════════════════════════════════════════════════ */

function useTodayStats() {
  const {
    data: stats,
    isLoading,
    isError,
    refetch,
  } = useGetDashboardStats({
    query: { refetchOnWindowFocus: true },
  });

  // Realtime: every new tap/transaction → refetch right away
  useRealtimeRefetch(["transactions"], () => {
    refetch();
  });

  const revenueToday = Math.abs(Number((stats as any)?.totalRevenueToday) || 0);
  const tapsToday = Math.abs(Number((stats as any)?.totalTapsToday) || 0);

  const prevRevenue = useRef<number | null>(null);
  const prevTaps = useRef<number | null>(null);
  const [revenueFlash, setRevenueFlash] = useState(false);
  const [tapsFlash, setTapsFlash] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!stats) return;

    if (prevRevenue.current !== null && prevRevenue.current !== revenueToday) {
      setRevenueFlash(true);
      setTimeout(() => setRevenueFlash(false), 900);
    }
    if (prevTaps.current !== null && prevTaps.current !== tapsToday) {
      setTapsFlash(true);
      setTimeout(() => setTapsFlash(false), 900);
    }

    prevRevenue.current = revenueToday;
    prevTaps.current = tapsToday;
    setLastUpdated(new Date());
  }, [stats, revenueToday, tapsToday]);

  return { isLoading, isError, revenueToday, tapsToday, revenueFlash, tapsFlash, lastUpdated, refetch };
}

/* ═══════════════════════════════════════════════════════════════════════
   🚌 Driver Dashboard page
   ═══════════════════════════════════════════════════════════════════════ */

export default function DriverDashboardPage() {
  const [, setLocation] = useLocation();
  const { isDark, toggleTheme } = useAuthTheme();
  useDriverApiAuth(); // 👈 sends the driver token on /api/ requests (must stay ABOVE useTodayStats)
  const keyboardOpen = useKeyboardLock(); // 👈 bottom nav stays at the bottom when the keyboard opens
  const {
    isLoading: statsLoading,
    isError: statsError,
    revenueToday,
    tapsToday,
    revenueFlash,
    tapsFlash,
    lastUpdated,
    refetch: refetchStats,
  } = useTodayStats(); // 👈 realtime Earned today + Total taps today

  const [authorized, setAuthorized] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  // Route panel mounts on first visit, then stays mounted (keeps pins/inputs when switching tabs)
  const [mapVisited, setMapVisited] = useState(false);

  // 🧾 Real trips from the database (today on Home, today / last 7 days on the Trips tab)
  const [tripRange, setTripRange] = useState<"today" | "week">("today");
  const tripDays = tab === "trips" && tripRange === "week" ? 7 : 1;
  const tripsQuery = useMyTrips(tripDays, authorized);
  const trips: Trip[] = tripsQuery.data ?? [];
  const tripsTotalTaps = trips.reduce((sum, t) => sum + t.taps, 0);
  const tripsTotalFare = trips.reduce((sum, t) => sum + t.fare, 0);

  // Trips grouped by day (used by the 7-day view)
  const tripGroups = (() => {
    const m = new Map<string, Trip[]>();
    trips.forEach((t) => {
      const k = fmtTripDay(t.startedAt);
      m.set(k, [...(m.get(k) ?? []), t]);
    });
    return Array.from(m.entries());
  })();

  /* Guard: kung walang driver token, balik sa signin */
  useEffect(() => {
    const token = window.localStorage.getItem(DRIVER_TOKEN_KEY);
    if (!token) {
      setLocation("/signin");
      return;
    }
    setAuthorized(true);
  }, [setLocation]);

  function changeTab(next: Tab) {
    setTab(next);
    if (next === "map") setMapVisited(true);
    window.scrollTo({ top: 0 });
  }

  function handleSignOut() {
    window.localStorage.removeItem(DRIVER_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_ROLE_KEY);
    setLocation("/signin");
  }

  if (!authorized) return null;

  const page = isDark ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-900";
  const card = isDark ? "bg-slate-900/70 border-slate-800" : "bg-white border-slate-200 shadow-sm";
  const muted = isDark ? "text-slate-400" : "text-slate-500";

  const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "map", label: "Route", icon: RouteIcon },
    { id: "trips", label: "Trips", icon: History },
    { id: "profile", label: "Profile", icon: UserRound },
  ];

  return (
    <div className={`min-h-[100dvh] flex flex-col ${page}`}>
      <style>{`
        @keyframes stat-flash {
          0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.0); transform: scale(1); }
          40%  { box-shadow: 0 0 0 6px rgba(16,185,129,0.25); transform: scale(1.015); }
          100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.0); transform: scale(1); }
        }
        .stat-flash { animation: stat-flash 0.9s ease-out; }

        @keyframes stat-flash-blue {
          0%   { box-shadow: 0 0 0 0 rgba(59,130,246,0.0); transform: scale(1); }
          40%  { box-shadow: 0 0 0 6px rgba(59,130,246,0.25); transform: scale(1.015); }
          100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.0); transform: scale(1); }
        }
        .stat-flash-blue { animation: stat-flash-blue 0.9s ease-out; }

        @keyframes live-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.25; transform: scale(0.8); }
        }
        .live-dot { animation: live-dot 1.2s ease-in-out infinite; }

        @keyframes value-pop {
          0%   { transform: translateY(4px); opacity: 0.4; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .value-pop { animation: value-pop 0.35s ease-out; }
      `}</style>

      {/* Top bar */}
      <header
        className={`sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b backdrop-blur-md ${
          isDark ? "bg-slate-950/80 border-slate-800" : "bg-white/80 border-slate-200"
        }`}
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Bus className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">Driver Console</p>
            <p className={`text-[11px] ${muted}`}>Digital Transit Network</p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className={`w-9 h-9 rounded-full border-2 flex items-center justify-center ${
            isDark ? "border-slate-700 text-blue-300" : "border-slate-200 text-blue-600"
          }`}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main
        className={`flex-1 w-full mx-auto px-4 py-5 pb-28 space-y-4 ${
          tab === "map" ? "max-w-2xl" : "max-w-md"
        }`}
      >
        {tab === "home" && (
          <>
            {/* ═════ Today header ═════ */}
            <div className="flex items-end justify-between px-1">
              <div>
                <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>Today</p>
                <h1 className="text-xl font-extrabold leading-tight">
                  {new Date().toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </h1>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span
                  className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${
                    statsError
                      ? isDark
                        ? "text-red-400 bg-red-950/40 border-red-900"
                        : "text-red-600 bg-red-50 border-red-100"
                      : isDark
                        ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
                        : "text-emerald-600 bg-emerald-50 border-emerald-100"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full inline-block ${
                      statsError ? "bg-red-500" : "bg-emerald-500 live-dot"
                    }`}
                  />
                  {statsError ? "OFFLINE" : "LIVE"}
                </span>
                {lastUpdated && (
                  <span className={`text-[10px] font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>

            {/* ═════ Earned today — hero card ═════ */}
            <div
              className={`relative overflow-hidden rounded-2xl p-5 text-white shadow-lg bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 ${
                revenueFlash ? "stat-flash" : ""
              }`}
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -right-2 bottom-[-3rem] h-28 w-28 rounded-full bg-white/10" />

              <div className="relative flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-100/90">
                    Earned today
                  </p>
                  {statsLoading ? (
                    <Skeleton className="mt-2 h-10 w-44 bg-white/20" />
                  ) : (
                    <p
                      key={revenueToday}
                      className="value-pop mt-1 text-4xl font-extrabold tracking-tight leading-none truncate"
                      data-testid="text-earned-today"
                    >
                      {formatPeso(revenueToday)}
                    </p>
                  )}
                </div>
                <div className="h-11 w-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
                  <Wallet className="h-5 w-5" />
                </div>
              </div>

              <div className="relative mt-4 flex items-center gap-1.5 text-[11px] text-emerald-50/90">
                <TrendingUp className="h-3.5 w-3.5" />
                Updates instantly on every tap
              </div>
            </div>

            {/* ═════ Total taps + Trips ═════ */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className={`relative overflow-hidden rounded-2xl border p-4 ${card} ${
                  tapsFlash ? "stat-flash-blue" : ""
                }`}
              >
                <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-500/10" />
                <div className="relative">
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center mb-3 ${
                      isDark ? "bg-blue-950/50 text-blue-400" : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    <Fingerprint className="h-5 w-5" />
                  </div>
                  {statsLoading ? (
                    <Skeleton className={`h-8 w-16 ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
                  ) : (
                    <p
                      key={tapsToday}
                      className="value-pop text-3xl font-extrabold leading-none tracking-tight"
                      data-testid="text-taps-today"
                    >
                      {tapsToday.toLocaleString("en-US")}
                    </p>
                  )}
                  <p className={`text-[11px] font-semibold uppercase tracking-wide mt-2 ${muted}`}>
                    Total taps today
                  </p>
                </div>
                <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-blue-500 to-indigo-500" />
              </div>

              <div className={`relative overflow-hidden rounded-2xl border p-4 ${card}`}>
                <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-purple-500/10" />
                <div className="relative">
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center mb-3 ${
                      isDark ? "bg-purple-950/50 text-purple-400" : "bg-purple-50 text-purple-600"
                    }`}
                  >
                    <RouteIcon className="h-5 w-5" />
                  </div>
                  {tripsQuery.isLoading ? (
                    <Skeleton className={`h-8 w-12 ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
                  ) : (
                    <p
                      key={trips.length}
                      className="value-pop text-3xl font-extrabold leading-none tracking-tight"
                      data-testid="text-trips-today"
                    >
                      {trips.length}
                    </p>
                  )}
                  <p className={`text-[11px] font-semibold uppercase tracking-wide mt-2 ${muted}`}>Trips</p>
                </div>
                <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-purple-500 to-fuchsia-500" />
              </div>
            </div>

            {statsError && (
              <button
                type="button"
                onClick={() => refetchStats()}
                className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  isDark
                    ? "border-red-900 text-red-400 bg-red-950/30"
                    : "border-red-200 text-red-600 bg-red-50"
                }`}
              >
                <AlertCircle className="h-3.5 w-3.5" />
                Couldn't load today's stats — tap to retry
              </button>
            )}

            {/* ═════ Recent trips preview ═════ */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>Recent trips</h2>
                <button
                  type="button"
                  onClick={() => changeTab("trips")}
                  className="flex items-center gap-0.5 text-xs font-semibold text-blue-500"
                >
                  See all <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {tripsQuery.isLoading ? (
                <>
                  {[1, 2].map((i) => (
                    <Skeleton
                      key={i}
                      className={`h-[70px] w-full rounded-2xl ${isDark ? "bg-slate-800" : "bg-slate-100"}`}
                    />
                  ))}
                </>
              ) : tripsQuery.isError ? (
                <button
                  type="button"
                  onClick={() => tripsQuery.refetch()}
                  className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    isDark
                      ? "border-red-900 text-red-400 bg-red-950/30"
                      : "border-red-200 text-red-600 bg-red-50"
                  }`}
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  Couldn't load trips — tap to retry
                </button>
              ) : trips.length === 0 ? (
                <div className={`rounded-2xl border border-dashed p-6 text-center text-xs ${muted} ${
                  isDark ? "border-slate-800" : "border-slate-300"
                }`}>
                  No trips yet today. Trips appear here as passengers tap.
                </div>
              ) : (
                trips.slice(0, 3).map((t) => (
                  <TripCard key={t.key} trip={t} isDark={isDark} compact />
                ))
              )}
            </section>
          </>
        )}

        {mapVisited && (
          <div className={tab === "map" ? "" : "hidden"}>
            <FareMapPanel isDark={isDark} visible={tab === "map"} />
          </div>
        )}

        {tab === "trips" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold">Trips</h2>
              <div
                className={`inline-flex rounded-full border p-0.5 text-[11px] font-semibold ${
                  isDark ? "border-slate-800 bg-slate-900/70" : "border-slate-200 bg-white"
                }`}
              >
                {(
                  [
                    { id: "today", label: "Today" },
                    { id: "week", label: "7 days" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTripRange(opt.id)}
                    className={`rounded-full px-3.5 py-1.5 transition-colors ${
                      tripRange === opt.id ? "bg-blue-600 text-white shadow" : muted
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary hero */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 p-5 text-white shadow-lg">
              <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -right-2 bottom-[-3rem] h-28 w-28 rounded-full bg-white/10" />
              <p className="relative text-[11px] font-semibold uppercase tracking-widest text-blue-100/90">
                {tripRange === "week" ? "Fare · last 7 days" : "Fare · today"}
              </p>
              <p className="relative mt-1 text-3xl font-extrabold tracking-tight">
                {tripsQuery.isLoading ? "…" : formatPeso(tripsTotalFare)}
              </p>
              <div className="relative mt-4 grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 backdrop-blur">
                  <RouteIcon className="h-4 w-4" />
                  <div className="leading-tight">
                    <p className="text-sm font-extrabold">{tripsQuery.isLoading ? "…" : trips.length}</p>
                    <p className="text-[10px] text-blue-100">Trips</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 backdrop-blur">
                  <Fingerprint className="h-4 w-4" />
                  <div className="leading-tight">
                    <p className="text-sm font-extrabold">
                      {tripsQuery.isLoading ? "…" : tripsTotalTaps.toLocaleString("en-US")}
                    </p>
                    <p className="text-[10px] text-blue-100">Taps</p>
                  </div>
                </div>
              </div>
            </div>

            {tripsQuery.isLoading ? (
              [1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  className={`h-[78px] w-full rounded-2xl ${isDark ? "bg-slate-800" : "bg-slate-100"}`}
                />
              ))
            ) : tripsQuery.isError ? (
              <button
                type="button"
                onClick={() => tripsQuery.refetch()}
                className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  isDark
                    ? "border-red-900 text-red-400 bg-red-950/30"
                    : "border-red-200 text-red-600 bg-red-50"
                }`}
              >
                <AlertCircle className="h-3.5 w-3.5" />
                Couldn't load trips — tap to retry
              </button>
            ) : trips.length === 0 ? (
              <div
                className={`rounded-2xl border border-dashed p-8 text-center text-xs ${muted} ${
                  isDark ? "border-slate-800" : "border-slate-300"
                }`}
              >
                {tripRange === "week" ? "No trips in the last 7 days." : "No trips yet today."}
              </div>
            ) : (
              tripGroups.map(([day, list]) => (
                <div key={day} className="space-y-2.5">
                  {tripRange === "week" && (
                    <div className="flex items-center justify-between px-1">
                      <p className="text-xs font-bold text-blue-500">{day}</p>
                      <p className="text-xs font-bold text-emerald-500">
                        {formatPeso(list.reduce((s, t) => s + t.fare, 0))}
                      </p>
                    </div>
                  )}
                  {list.map((t) => (
                    <TripCard key={t.key} trip={t} isDark={isDark} />
                  ))}
                </div>
              ))
            )}

            <p className={`text-[11px] ${muted}`}>
              A trip is a group of fare taps on the same route with no pause longer than 30 minutes.
            </p>
          </section>
        )}

        {tab === "profile" && (
          <section className={`rounded-2xl border p-4 space-y-4 ${card}`}>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
                <UserRound className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="font-bold">Driver account</p>
                <p className={`text-xs ${muted}`}>Role: driver</p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleSignOut}
              className={`w-full h-11 gap-2 rounded-xl ${
                isDark
                  ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                  : "border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </section>
        )}
      </main>

      {/* Bottom nav (app-style) */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-30 border-t backdrop-blur-md transition-transform duration-150 ${
          keyboardOpen ? "translate-y-full pointer-events-none" : ""
        } ${isDark ? "bg-slate-950/90 border-slate-800" : "bg-white/90 border-slate-200"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => changeTab(id)}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold"
              >
                <span
                  className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
                    active ? (isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-50 text-blue-600") : muted
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className={active ? "text-blue-500" : muted}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}