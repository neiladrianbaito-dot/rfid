import { useEffect, useState, useMemo, useRef, useCallback, useDeferredValue } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useAuthTheme } from "@/lib/auth-theme";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import {
  Bus,
  LogOut,
  Sun,
  Moon,
  Wallet,
  Route as RouteIcon,
  Home,
  History,
  UserRound,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Lock,
  RotateCcw,
  Power,
  PowerOff,
  ArrowLeftRight,
  ArrowRight,
  Clock,
  Cpu,
  Wifi,
  WifiOff,
  Loader2,
  Fingerprint,
  TrendingUp,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  ShieldCheck,
  Satellite,
  Map as MapIcon, // renamed so it never clashes with the JS built-in Map
  Layers,
  X,
} from "lucide-react";

const DRIVER_TOKEN_KEY = "termipay_driver_auth_token";
const AUTH_ROLE_KEY = "termipay_auth_role";
const DRIVER_NAME_KEY = "termipay_driver_username"; // optional, used as "actor" in activate/deactivate
const DRIVER_PROFILE_KEY = "termipay_driver_profile_v1"; // saved copy of the profile so it shows instantly

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
   👤 DRIVER PROFILE — real name, email and profile picture
   Same idea as the user dashboard (authProfile.fullName / email / avatarUrl).

   Where the data comes from (best source wins, empty values never overwrite):
     1. saved copy on this device       → instant, no blinking
     2. the driver token (JWT claims)   → email / name / picture, if the token has them
     3. Supabase Auth session (Google)  → only used to FILL what is still missing
     4. your backend                    → the real source of truth (tries a few common routes)

   👉 If your backend profile route has a different name, add it to PROFILE_ENDPOINTS below.
   ═══════════════════════════════════════════════════════════════════════ */

type DriverProfile = {
  fullName: string;
  email: string;
  avatarUrl: string | null;
  username: string;
};

const EMPTY_PROFILE: DriverProfile = { fullName: "", email: "", avatarUrl: null, username: "" };

// 👈 Add / reorder your real "who am I" route here. The first one that answers OK is used.
const PROFILE_ENDPOINTS = [
  "/api/auth/user-me", // ✅ real route in your backend (returns fullName, email, avatarUrl)
];

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// "juan.delacruz23@gmail.com" → "Juan Delacruz23" (only used when no real name exists)
function deriveNameFromEmail(email?: string | null): string {
  if (!email) return "";
  const localPart = email.split("@")[0] || "";
  if (!localPart.trim()) return "";
  return localPart
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
}

function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Accepts many possible shapes: {user:{...}}, {profile:{...}}, {data:{...}}, or a flat object
function pickProfile(raw: any): Partial<DriverProfile> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw.user ?? raw.profile ?? raw.data ?? raw;
  const meta = o?.user_metadata ?? o?.userMetadata ?? {};

  const fullName =
    clean(o.fullName) ||
    clean(o.full_name) ||
    clean(o.displayName) ||
    clean(o.display_name) ||
    clean(o.name) ||
    clean(meta.full_name) ||
    clean(meta.name);

  const email = clean(o.email) || clean(meta.email);

  const avatar =
    clean(o.avatarUrl) ||
    clean(o.avatar_url) ||
    clean(o.picture) ||
    clean(o.photoUrl) ||
    clean(o.photo_url) ||
    clean(o.profilePicture) ||
    clean(o.image) ||
    clean(meta.avatar_url) ||
    clean(meta.picture);

  const username = clean(o.username) || clean(o.userName) || clean(o.user_name);

  const out: Partial<DriverProfile> = {};
  if (fullName) out.fullName = fullName;
  if (email) out.email = email;
  if (avatar) out.avatarUrl = avatar;
  if (username) out.username = username;
  return out;
}

// merge: later arguments only fill what is still empty (earlier = higher priority)
function mergeProfiles(...parts: Partial<DriverProfile>[]): DriverProfile {
  const out: DriverProfile = { ...EMPTY_PROFILE };
  for (const p of parts) {
    if (!out.fullName && p.fullName) out.fullName = p.fullName;
    if (!out.email && p.email) out.email = p.email;
    if (!out.avatarUrl && p.avatarUrl) out.avatarUrl = p.avatarUrl;
    if (!out.username && p.username) out.username = p.username;
  }
  return out;
}

function readSavedProfile(): Partial<DriverProfile> {
  try {
    const raw = localStorage.getItem(DRIVER_PROFILE_KEY);
    return raw ? pickProfile(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveProfile(p: DriverProfile) {
  try {
    localStorage.setItem(DRIVER_PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

async function fetchProfileFromBackend(): Promise<Partial<DriverProfile>> {
  for (const path of PROFILE_ENDPOINTS) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: driverAuthHeaders() });
      if (!res.ok) continue;
      const data = await res.json();
      const picked = pickProfile(data);
      if (picked.fullName || picked.email || picked.avatarUrl) return picked;
    } catch {
      /* try the next route */
    }
  }
  return {};
}

async function fetchProfileFromSupabase(): Promise<Partial<DriverProfile>> {
  try {
    const { data } = await supabase.auth.getUser();
    const u: any = data?.user;
    if (!u) return {};
    return pickProfile({
      email: u.email,
      user_metadata: u.user_metadata,
    });
  } catch {
    return {};
  }
}

function useDriverProfile(enabled: boolean) {
  const [profile, setProfile] = useState<DriverProfile>(() =>
    mergeProfiles(readSavedProfile(), {
      username: window.localStorage.getItem(DRIVER_NAME_KEY) ?? "",
    })
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = window.localStorage.getItem(DRIVER_TOKEN_KEY);
    const claims = decodeJwtPayload(token);
    const fromToken = pickProfile(claims ?? {});
    const storedUsername = clean(window.localStorage.getItem(DRIVER_NAME_KEY));

    // show what we already know right away (saved copy + token), then upgrade with the server answer
    setProfile((prev) =>
      mergeProfiles(prev, fromToken, storedUsername ? { username: storedUsername } : {})
    );

    const [backend, google] = await Promise.all([
      fetchProfileFromBackend(),
      fetchProfileFromSupabase(),
    ]);

    // backend = truth. Token next. Google session only fills what is still missing.
    const next = mergeProfiles(
      backend,
      fromToken,
      readSavedProfile(),
      google,
      storedUsername ? { username: storedUsername } : {}
    );

    setProfile((prev) => {
      const same =
        prev.fullName === next.fullName &&
        prev.email === next.email &&
        prev.avatarUrl === next.avatarUrl &&
        prev.username === next.username;
      return same ? prev : next;
    });
    saveProfile(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  return { profile, loading, reload: load };
}

// Real photo when there is one, otherwise the fallback (initials / icon). Also falls back if the image fails to load.
function DriverAvatar({
  url,
  name,
  fallback,
}: {
  url: string | null;
  name: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    if (fallback) return <>{fallback}</>;
    return <span className="text-base font-black tracking-tight">{getInitials(name || "?")}</span>;
  }

  return (
    <img
      src={url}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full rounded-full object-cover"
    />
  );
}

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

/* 🧩 ONE ROUTE = ONE TRIP (per day).
   The server may return several trips for the same origin → destination
   (e.g. after a pause, Reset, or re-adding the same route). Here they are
   merged by route name, so the old trip is reused and only its taps and fare
   go up. Nothing stacks up, and nothing in the database is changed. */
function mergeTripsByRoute(list: Trip[]): Trip[] {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const map = new Map<string, Trip>();

  for (const t of list) {
    const key = `${fmtTripDay(t.startedAt)}|${norm(t.origin)}|${norm(t.destination)}`;
    const prev = map.get(key);

    if (!prev) {
      map.set(key, { ...t, key });
      continue;
    }

    map.set(key, {
      ...prev,
      startedAt: new Date(t.startedAt) < new Date(prev.startedAt) ? t.startedAt : prev.startedAt,
      endedAt: new Date(t.endedAt) > new Date(prev.endedAt) ? t.endedAt : prev.endedAt,
      taps: prev.taps + t.taps,
      fare: prev.fare + t.fare,
    });
  }

  // newest activity first
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
  );
}

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
      return Array.isArray(data?.trips) ? mergeTripsByRoute(data.trips as Trip[]) : [];
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

// 📏 "≈ 175 km" — whole km for long distances, one decimal under 10 km
const formatApproxKm = (km: number) =>
  ` ${km >= 10 ? Math.round(km).toLocaleString("en-US") : km.toFixed(1)} km`;

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
   ⚡ The list is saved on the device, so it opens instantly (no download
   on every app start). It is refreshed in the background once a month.
   ═══════════════════════════════════════════════════════════════════════ */

const PSGC = "https://psgc.gitlab.io/api";

type Place = {
  code: string;
  label: string;
  kind: "barangay" | "city" | "municipality";
  barangay?: string;
  municipality: string;
  province: string;
  muniCode: string; // code of the city/municipality (used as the reference point of a barangay)
  s?: string; // lower-cased search text, prepared once
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
          muniCode: m.code,
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
            muniCode,
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
  out.forEach((p) => {
    p.s = `${p.label} ${p.province}`.toLowerCase();
  });

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/* ----- saved copy of the places list (compact, so it stays small) ----- */

const PLACES_CACHE_KEY = "termipay_places_v2";
const PLACES_TTL_MS = 30 * 24 * 60 * 60 * 1000; // refresh once a month

// [code, label, kind(b/c/m), barangay, muniCode, municipality, province]
type PlaceTuple = [string, string, string, string, string, string, string];

function encodePlace(p: Place): PlaceTuple {
  return [
    p.code,
    p.label,
    p.kind === "barangay" ? "b" : p.kind === "city" ? "c" : "m",
    p.barangay ?? "",
    p.muniCode,
    p.municipality,
    p.province,
  ];
}

function decodePlace(t: PlaceTuple): Place {
  const p: Place = {
    code: t[0],
    label: t[1],
    kind: t[2] === "b" ? "barangay" : t[2] === "c" ? "city" : "municipality",
    municipality: t[5],
    province: t[6],
    muniCode: t[4],
  };
  if (t[3]) p.barangay = t[3];
  p.s = `${p.label} ${p.province}`.toLowerCase();
  return p;
}

function readPlacesCache(): { places: Place[]; fresh: boolean } | null {
  try {
    const raw = localStorage.getItem(PLACES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    const places = (parsed.items as PlaceTuple[]).map(decodePlace);
    const fresh = Date.now() - Number(parsed.savedAt || 0) < PLACES_TTL_MS;
    return { places, fresh };
  } catch {
    return null;
  }
}

function savePlacesCache(list: Place[]) {
  try {
    localStorage.setItem(
      PLACES_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), items: list.map(encodePlace) })
    );
  } catch {
    /* storage full or unavailable — app still works, just downloads again next time */
  }
}

// label → place (instant lookup instead of scanning thousands of items)
let labelIndex = new Map<string, Place>();
function indexPlaces(list: Place[]) {
  const m = new Map<string, Place>();
  for (const p of list) m.set(p.label, p);
  labelIndex = m;
}

let placesMemo: Place[] | null = null;
let placesPromise: Promise<Place[]> | null = null;

// Synchronous: whatever is already known (memory, then saved copy). Lets the UI open with data at once.
function peekPlaces(): Place[] {
  if (placesMemo) return placesMemo;
  const c = readPlacesCache();
  if (c) {
    placesMemo = c.places;
    indexPlaces(c.places);
  }
  return placesMemo ?? [];
}

function loadSamarPlaces(): Promise<Place[]> {
  if (!placesPromise) {
    const cached = readPlacesCache();
    if (cached && cached.fresh) {
      placesMemo = cached.places;
      indexPlaces(cached.places);
      placesPromise = Promise.resolve(cached.places);
    } else {
      placesPromise = fetchSamarPlaces()
        .then((list) => {
          placesMemo = list;
          indexPlaces(list);
          savePlacesCache(list);
          return list;
        })
        .catch((e) => {
          // offline / PSGC down → keep using the old saved copy if there is one
          if (cached) {
            placesMemo = cached.places;
            indexPlaces(cached.places);
            return cached.places;
          }
          placesPromise = null;
          throw e;
        });
    }
  }
  return placesPromise;
}

function useSamarPlaces() {
  const [places, setPlaces] = useState<Place[]>(() => peekPlaces());
  const [loading, setLoading] = useState(() => peekPlaces().length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (peekPlaces().length === 0) setLoading(true);
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

  // typing stays smooth: the big list is filtered a moment later, never blocking the keyboard
  const deferredValue = useDeferredValue(value);

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
    const q = deferredValue.trim().toLowerCase();
    if (!q) return places.filter((p) => p.kind !== "barangay").slice(0, 60);

    const matches: Place[] = [];
    for (const p of places) {
      const text = p.s ?? `${p.label} ${p.province}`.toLowerCase();
      if (text.includes(q)) matches.push(p);
    }
    matches.sort((a, b) => {
      const as = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.label.localeCompare(b.label);
    });
    return matches.slice(0, 60);
  }, [deferredValue, places]);

  useEffect(() => {
    setActive(0);
  }, [deferredValue]);

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

   🎯 ACCURATE + ⚡ INSTANT + 🛠️ FIXED BARANGAY LOOKUP

   ⚡ WHAT MAKES "SET ROUTE" INSTANT NOW (v5):
   1. Everything is PARALLEL. Before, lookups ran one after another and the
      geocoder (1 request/second) was a queue: Nominatim attempt 1 → 2 → 3 →
      Photon → … Now Photon (no rate limit) and Nominatim are RACED together
      and the first valid answer wins (raceFirst).
   2. Shared Supabase cache is asked for the distance AND the coordinates at the
      same time, so a route that ANY driver used before is answered in ~100 ms.
   3. The work starts the moment a place is picked (while the driver is still
      typing the destination), so when Set route is tapped the answer is
      already in memory. handleOk now reads it SYNCHRONOUSLY (peekKm) → no
      await, no spinner, no waiting.
   4. After the fare is known, the device claim runs IN PARALLEL with saving the
      route (they don't depend on each other), and the route + reverse-route
      lookups run in parallel with the claim.
   5. The shared cache upsert now uses onConflict, so results are really saved
      (run supabase_fare_cache.sql once) → every route is computed only ONCE
      for ALL drivers. Second driver = instant.
   6. OSRM timeout lowered (4.5 s) with a quick retry.

   WHY SOME BARANGAYS (e.g. Oquendo, Calbayog City) COULD NOT BE FOUND BEFORE:
   1. PSGC names come with extras like "Oquendo (Pob.)" or "Sta. Rosa" — the old
      search sent that text as-is, and OpenStreetMap could not match it.
      → Now the name is cleaned and several spellings are tried
        (without "(Pob.)", "Sta." → "Santa", without ñ/accents).
   2. The long query "Barangay, Municipality, Province, Philippines" is too strict
      for OpenStreetMap, which stores many barangays under a different parent.
      → Now it first tries the short "Barangay, Municipality", then searches the
        plain name inside a box around the municipality, then a second geocoder
        (Photon), and only then falls back to the municipality center.
   3. The old limit of 35 km from the city center rejected real barangays of
      big cities (Calbayog City is huge).
      → Now up to 80 km if the result text mentions the municipality, 20 km if not.
   4. Poblacion barangays ("Poblacion", "Barangay 1", "Zone 2"...) cannot be found by
      name on any map. They sit at the town center, so the center is used and the
      distance is NOT marked approximate.
   5. If the road service (OSRM) is down, a straight-line estimate × 1.35 is used
      (marked approximate) instead of failing.
   6. Caches were bumped (v4 / v3), so earlier WRONG matches are ignored.

   LOOKUP ORDER (stops at the first hit):
     1. this device (localStorage)  → 0 ms
     2. shared Supabase cache        → ~100 ms
     3. Photon + Nominatim (raced) / OSRM → only for places/routes nobody used yet
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_BASE_FARE = 15;
const DEFAULT_BASE_KM = 4;
const DEFAULT_RATE = 2.2;

type LatLng = { lat: number; lng: number };
type GeoHit = LatLng & { text: string }; // text = display name returned by the geocoder
type Box = { west: number; south: number; east: number; north: number };

function computeLtfrbFare(distanceKm: number, baseFare: number, baseKm: number, ratePerKm: number) {
  const excess = Math.max(0, distanceKm - baseKm);
  return Math.round((baseFare + excess * ratePerKm) * 100) / 100;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ⚡ Runs several lookups AT THE SAME TIME and returns the first one that is not null.
// If all of them come back empty (or fail) → null. Never throws.
function raceFirst<T>(tasks: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let left = tasks.length;
    if (left === 0) {
      resolve(null);
      return;
    }
    tasks.forEach((t) => {
      t.then((v) => {
        if (v != null) resolve(v);
      })
        .catch(() => {})
        .finally(() => {
          left -= 1;
          if (left === 0) resolve(null);
        });
    });
  });
}

// Samar + Leyte islands (west, south, east, north) — anything outside is rejected
const AREA: Box = { west: 124.0, south: 9.8, east: 126.3, north: 12.8 };

// how far a barangay result may be from its own city/municipality center
const BARANGAY_MAX_KM_MATCHED = 80; // result text mentions the municipality → trusted
const BARANGAY_MAX_KM_UNMATCHED = 20; // result text does NOT mention it → must be close
const LOCAL_BOX_DEG = 0.5; // ±0.5° (~55 km) search box around the municipality center

const insideArea = (p: LatLng) =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  p.lat >= AREA.south &&
  p.lat <= AREA.north &&
  p.lng >= AREA.west &&
  p.lng <= AREA.east;

// straight-line distance between two points (km)
function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// "Samar (Western Samar)" → "Samar"
const cleanProvince = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").trim();

// remove accents / ñ
const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// lower-case, no accents, single spaces — used only to COMPARE texts
const norm = (s: string) => stripAccents(s).toLowerCase().replace(/\s+/g, " ").trim();

// fetch + JSON with a timeout, never throws (returns null on any problem)
async function fetchJsonSafe(url: string, timeoutMs = 8000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Nominatim (OpenStreetMap) geocoder — free, max 1 request/second.
// All requests go through ONE queue that only waits for the time that is really left.
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

// Up to 8 candidates inside the given box (default: whole Samar + Leyte), with their display text
async function nominatimSearch(query: string, box: Box = AREA): Promise<GeoHit[]> {
  return throttledGeo(async () => {
    const viewbox = `${box.west},${box.north},${box.east},${box.south}`;
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=ph` +
      `&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(query)}`;
    const data = await fetchJsonSafe(url, 8000);
    if (!Array.isArray(data)) return [];
    return data
      .map((d: any) => ({
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        text: String(d.display_name ?? ""),
      }))
      .filter(insideArea);
  });
}

// Photon (komoot) — NO 1-per-second queue, so it is the fast one. Free, CORS-enabled.
async function photonSearch(query: string, near?: LatLng): Promise<GeoHit[]> {
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "";
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8` +
    `&bbox=${AREA.west},${AREA.south},${AREA.east},${AREA.north}${bias}`;
  const data = await fetchJsonSafe(url, 6000);
  const feats: any[] = Array.isArray(data?.features) ? data.features : [];
  return feats
    .map((f: any) => {
      const c = f?.geometry?.coordinates;
      const p = f?.properties ?? {};
      return {
        lat: Number(c?.[1]),
        lng: Number(c?.[0]),
        text: [p.name, p.district, p.locality, p.city, p.county, p.state].filter(Boolean).join(", "),
      } as GeoHit;
    })
    .filter(insideArea);
}

async function geocode(query: string): Promise<LatLng | null> {
  const list = await nominatimSearch(query);
  return list[0] ? { lat: list[0].lat, lng: list[0].lng } : null;
}

// City / municipality center — Photon and Nominatim are raced, the first good answer wins
async function geocodeMuni(p: Place): Promise<LatLng | null> {
  const prov = cleanProvince(p.province);
  const plain = p.municipality.replace(/\s+city$/i, "").trim();
  const plainN = norm(plain);

  const viaNominatim = async (q: string): Promise<LatLng | null> => {
    const list = await nominatimSearch(q);
    const hit = list.find((h) => norm(h.text).includes(plainN)) ?? list[0];
    return hit ? { lat: hit.lat, lng: hit.lng } : null;
  };

  // strict Photon: the result text must really mention the municipality
  const viaPhotonStrict = async (): Promise<LatLng | null> => {
    const list = await photonSearch(`${plain} ${prov}`);
    const hit = list.find((h) => norm(h.text).includes(plainN));
    return hit ? { lat: hit.lat, lng: hit.lng } : null;
  };

  // ⚡ both at once
  const fast = await raceFirst<LatLng>([
    viaPhotonStrict(),
    viaNominatim(`${p.municipality}, ${prov}, Philippines`),
  ]);
  if (fast) return fast;

  // slower fallbacks (only when the fast pair found nothing)
  for (const q of [`${plain}, ${prov}, Philippines`, `${plain}, Philippines`]) {
    const hit = await viaNominatim(q);
    if (hit) return hit;
  }

  // last chance: Photon without the strict text check
  const ph = await photonSearch(`${plain} ${prov}`);
  const phHit = ph.find((h) => norm(h.text).includes(plainN)) ?? ph[0];
  return phHit ? { lat: phHit.lat, lng: phHit.lng } : null;
}

/* ----- barangay name cleaning ----- */

// "Oquendo (Pob.)" → "Oquendo", "Barangay Sta. Rosa" → "Sta. Rosa"
function barangayCore(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(pob|poblacion|población)\b\.?/gi, " ")
    .replace(/\b(barangay|brgy)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Poblacion / numbered / zone barangays have no real name on any map — they sit at the town center
function isCenterLike(raw: string): boolean {
  const core = barangayCore(raw);
  if (!core) return true; // e.g. just "Poblacion"
  if (/^(no\.?\s*)?\d+\s*[a-z]?$/i.test(core)) return true; // "1", "2-A", "No. 3"
  if (/^(zone|purok|district)\s*(no\.?\s*)?\d+\s*[a-z]?$/i.test(core)) return true;
  if (/^[ivxlc]+$/i.test(core)) return true; // roman numerals
  return false;
}

// Several spellings of the same barangay (max 3, no duplicates)
function barangayVariants(raw: string): string[] {
  const core = barangayCore(raw);
  if (!core) return [];
  const expanded = core
    .replace(/\bsta\.?\s+/gi, "Santa ")
    .replace(/\bsto\.?\s+/gi, "Santo ")
    .replace(/\bsn\.?\s+/gi, "San ");
  const list = [core, expanded, stripAccents(core), stripAccents(expanded)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const k = v.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.slice(0, 3);
}

// Picks the best candidate: its text must contain the barangay name, and it must be near the municipality
function pickBarangayHit(
  hits: GeoHit[],
  variants: string[],
  center: LatLng,
  muniPlain: string
): LatLng | null {
  const vN = variants.map(norm);
  const mN = norm(muniPlain);
  let best: { pt: GeoHit; km: number; matched: boolean } | null = null;

  for (const h of hits) {
    const t = norm(h.text);
    if (!vN.some((v) => t.includes(v))) continue; // not about this barangay

    const km = haversineKm(h, center);
    const matched = t.includes(mN);
    if (km > (matched ? BARANGAY_MAX_KM_MATCHED : BARANGAY_MAX_KM_UNMATCHED)) continue;

    if (
      !best ||
      (matched && !best.matched) ||
      (matched === best.matched && km < best.km)
    ) {
      best = { pt: h, km, matched };
    }
  }
  return best ? { lat: best.pt.lat, lng: best.pt.lng } : null;
}

// The barangay itself — Photon + short query + local box run AT THE SAME TIME (first valid hit wins),
// then the old long query only if all of them found nothing.
async function geocodeBarangay(p: Place, center: LatLng): Promise<LatLng | null> {
  const prov = cleanProvince(p.province);
  const plain = p.municipality.replace(/\s+city$/i, "").trim();
  const variants = barangayVariants(p.barangay ?? "");
  if (variants.length === 0) return null;

  const local: Box = {
    west: center.lng - LOCAL_BOX_DEG,
    east: center.lng + LOCAL_BOX_DEG,
    south: center.lat - LOCAL_BOX_DEG,
    north: center.lat + LOCAL_BOX_DEG,
  };

  const v0 = variants[0];

  const fast = await raceFirst<LatLng>([
    // Photon: not rate-limited → usually the first one to answer
    photonSearch(`${v0} ${plain}`, center).then((h) => pickBarangayHit(h, variants, center, plain)),
    // Nominatim short query: "Oquendo, Calbayog"
    nominatimSearch(`${v0}, ${plain}`).then((h) => pickBarangayHit(h, variants, center, plain)),
    // Nominatim plain name inside a box around the municipality
    nominatimSearch(v0, local).then((h) => pickBarangayHit(h, variants, center, plain)),
  ]);
  if (fast) return fast;

  // other spellings (e.g. "Sta." → "Santa") — only when the first spelling found nothing
  if (variants[1]) {
    const v1 = variants[1];
    const second = await raceFirst<LatLng>([
      photonSearch(`${v1} ${plain}`, center).then((h) => pickBarangayHit(h, variants, center, plain)),
      nominatimSearch(`${v1}, ${plain}`).then((h) => pickBarangayHit(h, variants, center, plain)),
    ]);
    if (second) return second;
  }

  // the old long query, as a last try
  const hits = await nominatimSearch(`Barangay ${v0}, ${p.municipality}, ${prov}, Philippines`);
  return pickBarangayHit(hits, variants, center, plain);
}

/* ----- this device: coordinates (v4 = improved barangay lookup) ----- */
const GEO_CACHE_KEY = "termipay_geo_cache_v4";

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

// places whose own location couldn't be found → the city/municipality center was used instead
const approxCodes = new Set<string>();

function saveGeoCache() {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache));
  } catch {
    /* storage unavailable */
  }
}

/* ----- this device: distances (v3 = improved lookup) ----- */
const KM_CACHE_KEY = "termipay_km_cache_v3";

function loadKmCache(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KM_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const kmCache: Record<string, number> = loadKmCache();

function saveKmCache() {
  try {
    localStorage.setItem(KM_CACHE_KEY, JSON.stringify(kmCache));
  } catch {
    /* storage unavailable */
  }
}

/* ----- shared cache in Supabase (optional: if the tables don't exist, it is silently skipped) -----
   Tables: place_coords(code, label, lat, lng)  and  route_distances(key, km).
   ⚠️ Run supabase_fare_cache.sql ONCE — the tables need a PRIMARY KEY / UNIQUE on code / key,
   otherwise the upsert below fails silently and nothing is ever shared.
   Keys start with "v3:" so the old, less accurate entries are ignored. */

const SHARED_PREFIX = "v3:";

async function sharedGetCoord(code: string): Promise<LatLng | null> {
  try {
    const { data, error } = await supabase
      .from("place_coords")
      .select("lat, lng")
      .eq("code", SHARED_PREFIX + code)
      .maybeSingle();
    if (error || !data) return null;
    const pt = { lat: Number((data as any).lat), lng: Number((data as any).lng) };
    return insideArea(pt) ? pt : null;
  } catch {
    return null;
  }
}

function sharedSaveCoord(code: string, label: string, pt: LatLng) {
  try {
    Promise.resolve(
      supabase
        .from("place_coords")
        .upsert({ code: SHARED_PREFIX + code, label, lat: pt.lat, lng: pt.lng }, { onConflict: "code" })
    ).catch(() => {});
  } catch {
    /* ignore */
  }
}

async function sharedGetKm(key: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("route_distances")
      .select("km")
      .eq("key", SHARED_PREFIX + key)
      .maybeSingle();
    if (error || !data) return null;
    const km = Number((data as any).km);
    return Number.isFinite(km) ? km : null;
  } catch {
    return null;
  }
}

function sharedSaveKm(key: string, km: number) {
  try {
    Promise.resolve(
      supabase.from("route_distances").upsert({ key: SHARED_PREFIX + key, km }, { onConflict: "key" })
    ).catch(() => {});
  } catch {
    /* ignore */
  }
}

/* ----- city / municipality center (also the reference point of its barangays) ----- */
const muniInflight = new Map<string, Promise<LatLng | null>>();

function getMuniCoord(p: Place): Promise<LatLng | null> {
  const key = p.muniCode;
  const hit = geoCache[key];
  if (hit) return Promise.resolve(hit);

  let pending = muniInflight.get(key);
  if (!pending) {
    pending = (async () => {
      const shared = await sharedGetCoord(key);
      if (shared) {
        geoCache[key] = shared;
        saveGeoCache();
        return shared;
      }
      const found = await geocodeMuni(p);
      if (found) {
        geoCache[key] = found;
        saveGeoCache();
        sharedSaveCoord(key, p.municipality, found);
      }
      return found;
    })().finally(() => {
      muniInflight.delete(key);
    });
    muniInflight.set(key, pending);
  }
  return pending;
}

/* ----- coordinates of ANY place (barangay-level when possible) ----- */
function geocodePlaceCached(p: Place): Promise<LatLng | null> {
  // cities and municipalities ARE their own center.
  // Poblacion / numbered barangays also sit at the town center (they can't be found by name on a map).
  if (p.kind !== "barangay" || isCenterLike(p.barangay ?? "")) return getMuniCoord(p);

  const key = p.code;
  const hit = geoCache[key];
  if (hit) return Promise.resolve(hit);

  let pending = geoInflight.get(key);
  if (!pending) {
    pending = (async () => {
      // ⚡ shared cache AND municipality center are asked at the same time
      const [shared, center] = await Promise.all([sharedGetCoord(key), getMuniCoord(p)]);

      // 2) shared cache (another driver may have looked this barangay up already)
      if (shared) {
        geoCache[key] = shared;
        saveGeoCache();
        return shared;
      }

      // 3) really look it up, using the municipality center to validate the result
      if (!center) return null;

      const found = await geocodeBarangay(p, center);
      if (found) {
        approxCodes.delete(key);
        geoCache[key] = found;
        saveGeoCache();
        sharedSaveCoord(key, p.label, found);
        return found;
      }

      // not on the map → use the municipality center, flag it, and do NOT save it
      approxCodes.add(key);
      return center;
    })().finally(() => {
      geoInflight.delete(key);
    });
    geoInflight.set(key, pending);
  }
  return pending;
}

// 📌 Turns a SAVED route label ("Calbayog City") into map coordinates.
// Uses the PSGC place when it exists, otherwise looks the plain text up (and remembers it).
async function resolveLabelPoint(label: string, places: Place[]): Promise<LatLng | null> {
  const place = labelIndex.get(label) ?? places.find((p) => p.label === label);
  if (place) return geocodePlaceCached(place);

  const key = `label:${label}`;
  if (geoCache[key]) return geoCache[key];
  const hit = await geocode(`${label}, Philippines`);
  if (hit) {
    geoCache[key] = hit;
    saveGeoCache();
  }
  return hit;
}

// OSRM public demo server — real road distance + route geometry (only used by the map).
async function roadRoute(
  a: LatLng,
  b: LatLng
): Promise<{ km: number; coords: [number, number][] } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const data = await fetchJsonSafe(url, 12000);
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
    const data = await fetchJsonSafe(url, 4500);
    const meters = data?.routes?.[0]?.distance;
    if (typeof meters === "number") return meters / 1000;
    if (attempt === 0) await sleep(150);
  }
  return null;
}

type KmResult =
  | { ok: true; km: number; approx?: boolean }
  | { ok: false; reason: "locate" | "route" | "network" };

// same pair in either direction shares ONE saved distance (place level, so barangays are exact)
const pairKey = (a: Place, b: Place) =>
  a.code <= b.code ? `${a.code}|${b.code}` : `${b.code}|${a.code}`;

// ⚡ SYNCHRONOUS answer — no await, no network. Returns the distance only when it is already
// known on this device (exact result). Used by "Set route" so a prepared route needs ZERO waiting.
function peekKm(a: Place, b: Place): KmResult | null {
  if (a.code === b.code) return { ok: true, km: 0 };
  const v = kmCache[pairKey(a, b)];
  return typeof v === "number" ? { ok: true, km: v } : null;
}

async function computeKm(a: Place, b: Place): Promise<KmResult> {
  // exactly the same place → no distance
  if (a.code === b.code) return { ok: true, km: 0 };

  const key = pairKey(a, b);

  // 1) this device
  const local = kmCache[key];
  if (typeof local === "number") return { ok: true, km: local };

  // ⚡ start locating BOTH places right now (in parallel with the shared-cache question below)
  const coordsPromise = Promise.all([geocodePlaceCached(a), geocodePlaceCached(b)]);
  coordsPromise.catch(() => {});

  // 2) shared cache — if any driver already computed this route, we're done in ~100 ms
  const shared = await sharedGetKm(key);
  if (shared != null) {
    kmCache[key] = shared;
    saveKmCache();
    return { ok: true, km: shared };
  }

  // 3) look it up once, then save for everybody
  try {
    const [o, d] = await coordsPromise;
    if (!o || !d) return { ok: false, reason: "locate" };

    let km = await roadKm(o, d);
    let estimated = false;
    if (km == null) {
      // road service is down → straight line × 1.35 (typical road winding), marked approximate
      km = haversineKm(o, d) * 1.35;
      estimated = true;
    }

    const rounded = Math.round(km * 100) / 100;
    const approx = estimated || approxCodes.has(a.code) || approxCodes.has(b.code);

    // only EXACT answers are saved; approximate ones are tried again next time
    if (!approx) {
      kmCache[key] = rounded;
      saveKmCache();
      sharedSaveKm(key, rounded);
    }
    return { ok: true, km: rounded, approx };
  } catch {
    return { ok: false, reason: "network" };
  }
}

// Same origin → destination is calculated ONCE. It starts as soon as both places are picked
// (in the background), so by the time Set route is tapped the answer is usually already there.
const roadKmCache = new Map<string, Promise<KmResult>>();

function getRoadKm(a: Place, b: Place): Promise<KmResult> {
  const key = pairKey(a, b);
  let pending = roadKmCache.get(key);
  if (!pending) {
    pending = computeKm(a, b).then((r) => {
      // failed or approximate → allow a fresh try next time
      if (!r.ok || r.approx) roadKmCache.delete(key);
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
   🛰️ MAP TYPES — Default (Leaflet / OpenStreetMap) or Satellite (Esri imagery)
   • The driver picks the type in the legend on the map (top-right).
   • The legend is CLOSED by default — the driver opens / closes it with the
     small layers button (top-right) whenever they want.
   • The choice is saved on this device, so it is remembered next time.
   • Satellite also draws a transparent place-names layer on top, so towns and
     roads can still be read. The route line turns yellow on satellite so it
     stays visible on dark imagery.
   ═══════════════════════════════════════════════════════════════════════ */

type MapStyle = "standard" | "satellite";

const MAP_STYLE_KEY = "termipay_map_style_v1";

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SAT_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_LABEL_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const ROUTE_COLOR_STANDARD = "#2563eb";
const ROUTE_COLOR_SATELLITE = "#facc15";

function readMapStyle(): MapStyle {
  try {
    return localStorage.getItem(MAP_STYLE_KEY) === "satellite" ? "satellite" : "standard";
  } catch {
    return "standard";
  }
}

function writeMapStyle(s: MapStyle) {
  try {
    localStorage.setItem(MAP_STYLE_KEY, s);
  } catch {
    /* storage unavailable */
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   🎛️ MODERN MAP ZOOM CONTROL (+ / −)
   • Leaflet's default white square buttons are removed.
   • Small, transparent "glass" pill (blurred background) like a mobile map app.
   • Icons are drawn with CSS (no text glyphs), so they stay crisp and centered.
   • Light + dark theme (.tp-map-dark), disabled state at min/max zoom,
     press feedback, and visible keyboard focus.
   • Everything is scoped to .tp-map, so no other map/control is affected.
   ═══════════════════════════════════════════════════════════════════════ */

const MAP_ZOOM_CSS = `
/* container: the glass pill */
.tp-map .leaflet-control-zoom.leaflet-bar {
  display: flex;
  flex-direction: column;
  margin: 0 10px 10px 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.55) !important;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.5);
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.2), 0 1px 2px rgba(15, 23, 42, 0.12) !important;
}

/* buttons: no default white square, no text glyph */
.tp-map .leaflet-control-zoom.leaflet-bar a {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px !important;
  height: 30px !important;
  line-height: 1;
  font-size: 0 !important;
  color: #0f172a;
  background-color: transparent !important;
  background-repeat: no-repeat;
  background-position: center;
  border: none !important;
  border-radius: 0 !important;
  outline: none;
  text-indent: 0;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease, transform 0.1s ease, opacity 0.15s ease;
}

/* "+" icon: two crossing lines */
.tp-map .leaflet-control-zoom.leaflet-bar a.leaflet-control-zoom-in {
  background-image:
    linear-gradient(currentColor, currentColor),
    linear-gradient(currentColor, currentColor);
  background-size: 12px 2px, 2px 12px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.12) !important;
}

/* "−" icon: one line */
.tp-map .leaflet-control-zoom.leaflet-bar a.leaflet-control-zoom-out {
  background-image: linear-gradient(currentColor, currentColor);
  background-size: 12px 2px;
}

/* hover only on devices that really hover (no sticky hover on phones) */
@media (hover: hover) {
  .tp-map .leaflet-control-zoom.leaflet-bar a:hover {
    background-color: rgba(37, 99, 235, 0.16) !important;
  }
}

/* press feedback */
.tp-map .leaflet-control-zoom.leaflet-bar a:active {
  background-color: rgba(37, 99, 235, 0.28) !important;
  transform: scale(0.9);
}

/* keyboard focus */
.tp-map .leaflet-control-zoom.leaflet-bar a:focus-visible {
  box-shadow: inset 0 0 0 2px #3b82f6;
}

/* min / max zoom reached */
.tp-map .leaflet-control-zoom.leaflet-bar a.leaflet-disabled {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
  color: #0f172a;
  background-color: transparent !important;
}

/* dark theme */
.tp-map-dark .leaflet-control-zoom.leaflet-bar {
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  background: rgba(15, 23, 42, 0.5);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4) !important;
}
.tp-map-dark .leaflet-control-zoom.leaflet-bar a,
.tp-map-dark .leaflet-control-zoom.leaflet-bar a.leaflet-disabled {
  color: #e2e8f0;
}
.tp-map-dark .leaflet-control-zoom.leaflet-bar a.leaflet-control-zoom-in {
  border-bottom: 1px solid rgba(255, 255, 255, 0.14) !important;
}
@media (hover: hover) {
  .tp-map-dark .leaflet-control-zoom.leaflet-bar a:hover {
    background-color: rgba(96, 165, 250, 0.22) !important;
  }
}
.tp-map-dark .leaflet-control-zoom.leaflet-bar a:active {
  background-color: rgba(96, 165, 250, 0.34) !important;
}

/* fallback when the browser can't blur the background: slightly more solid */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tp-map .leaflet-control-zoom.leaflet-bar { background: rgba(255, 255, 255, 0.85); }
  .tp-map-dark .leaflet-control-zoom.leaflet-bar { background: rgba(15, 23, 42, 0.85); }
}

/* on satellite the zoom pill sits on dark imagery → keep it light and readable */
.tp-map-sat .leaflet-control-zoom.leaflet-bar {
  background: rgba(255, 255, 255, 0.78);
}
.tp-map-sat .leaflet-control-zoom.leaflet-bar a,
.tp-map-sat .leaflet-control-zoom.leaflet-bar a.leaflet-disabled {
  color: #0f172a;
}
.tp-map-sat .leaflet-control-zoom.leaflet-bar a.leaflet-control-zoom-in {
  border-bottom: 1px solid rgba(15, 23, 42, 0.12) !important;
}

/* map layer legend: smooth press feedback, no tap highlight on phones */
.tp-legend button {
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
}
.tp-legend button:active { transform: scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  .tp-map .leaflet-control-zoom.leaflet-bar a { transition: none; }
  .tp-legend button { transition: none; }
}
`;

/* ═══════════════════════════════════════════════════════════════════════
   🔑 Driver API auth — the generated api-client only knows the admin token,
   so every request to our own /api/ gets the DRIVER token instead.
   Restored automatically when the driver leaves this page.

   ✅ FIXED: the token is now sent ONLY to our own origin (this site, or the
   VITE_API_URL host). Before, a blocklist was used, so any new third-party
   host with an /api/ path (like the Photon geocoder, photon.komoot.io/api/)
   would have received the Authorization header and failed with CORS.
   ═══════════════════════════════════════════════════════════════════════ */

function useDriverApiAuth() {
  useEffect(() => {
    const original = window.fetch;

    const ownOrigins = new Set<string>([window.location.origin]);
    try {
      if (API_BASE) ownOrigins.add(new URL(API_BASE).origin);
    } catch {
      /* invalid VITE_API_URL — only same-origin requests get the token */
    }

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

      // Only OUR API (our origin AND path starts with /api/). Third-party hosts must never get
      // the Authorization header — it triggers a CORS preflight that they reject.
      if (!ownOrigins.has(parsed.origin) || !parsed.pathname.startsWith("/api/")) {
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
   🧭 FareMapPanel — the "Route" tab
   • Map is HIDDEN until a route is set. It slides DOWN when the route is saved
     and slides UP (and is fully removed) on Reset.
   • Pins + road line follow the SAVED route, so they stay for as long as the
     route exists and go back to zero on Reset.
   • 🛰️ A legend on the map lets the driver switch between Default and Satellite.
     It is CLOSED by default; the driver opens/closes it with the layers button.
   • 📏 The label at the top-left of the map shows the approximate distance of
     the saved route (example: ≈ 175 km).
   ═══════════════════════════════════════════════════════════════════════ */

type PanelProps = { isDark: boolean; visible: boolean };

function FareMapPanel({ isDark, visible }: PanelProps) {
  const { toast: baseToast } = useToast();
  // every toast on this page stays on screen for only 500 ms (unless a toast sets its own duration)
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

  // 🔒 The form is usable only when no route is shown OR right after a Reset
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

    // hide the reset route + its return AND every other route.
    // → currentRoute becomes null → the map slides up and is removed (back to zero).
    hideRoutes([...targets.map((r: any) => r.id), ...visibleRoutes.map((r: any) => r.id)]);
    setResetUnlocked(true);
    resetForm(); // default origin comes back, destination is empty
    goToForm(); // scroll + highlight the form
    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
    toast({ title: <SuccessTitle text="Route Reset — set a new origin & destination" /> });

    setIsResetting(false);
  };

  /* ---------- list (single route only) ---------- */
  const filteredRoutes = shownRoutes;

  /* ═════════ Set-route form (origin / destination) ═════════ */

  const [originName, setOriginName] = useState("");
  const [destName, setDestName] = useState("");
  const [originPlace, setOriginPlace] = useState<Place | null>(null);
  const [destPlace, setDestPlace] = useState<Place | null>(null);

  const [baseFare] = useState(String(DEFAULT_BASE_FARE));
  const [baseKm] = useState(String(DEFAULT_BASE_KM));
  const [rate] = useState(String(DEFAULT_RATE));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const formSectionRef = useRef<HTMLElement | null>(null);
  const [flashForm, setFlashForm] = useState(false);

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

  // NOTE: the map pins are NOT touched here — they belong to the saved route (see map effect below)
  const resetForm = () => {
    setOriginName("");
    setDestName("");
    setOriginPlace(null);
    setDestPlace(null);
    setError(null);
    setBusy(false);
    setFormKey((k) => k + 1);
  };

  // After Reset: scroll the form into view and highlight it briefly
  const goToForm = () => {
    setFlashForm(true);
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 450); // wait for the map to finish sliding up
    setTimeout(() => setFlashForm(false), 2200);
  };

  /* ═════════ 🗺️ Map: only exists while a route is set ═════════ */

  const hasRoute = !!currentRoute;
  const savedOrigin: string | null = currentRoute?.origin ?? null;
  const savedDest: string | null = currentRoute?.destination ?? null;

  // mapMounted = Leaflet container exists in the DOM, mapOpen = expanded (drives the slide animation)
  const [mapMounted, setMapMounted] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    if (hasRoute) {
      setMapMounted(true);
      let id2 = 0;
      const id1 = requestAnimationFrame(() => {
        id2 = requestAnimationFrame(() => setMapOpen(true)); // next frame → CSS transition runs
      });
      return () => {
        cancelAnimationFrame(id1);
        cancelAnimationFrame(id2);
      };
    }
    setMapOpen(false); // slide up…
    const t = setTimeout(() => setMapMounted(false), 520); // …then remove the map completely
    return () => clearTimeout(t);
  }, [hasRoute]);

  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const originMarker = useRef<L.Marker | null>(null);
  const destMarker = useRef<L.Marker | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);
  const [originPt, setOriginPt] = useState<LatLng | null>(null);
  const [destPt, setDestPt] = useState<LatLng | null>(null);

  // 📏 Approximate distance of the saved route (km) — shown in the label at the top-left of the map.
  // Starts as a quick straight-line estimate, then is replaced by the real road distance.
  const [routeKm, setRouteKm] = useState<number | null>(null);

  // 🛰️ Map type chosen by the driver (Default / Satellite) — remembered on this device
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => readMapStyle());
  const mapStyleRef = useRef<MapStyle>(mapStyle);
  mapStyleRef.current = mapStyle; // always the latest value, for use inside async map code
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);

  const changeMapStyle = useCallback((next: MapStyle) => {
    setMapStyle(next);
    writeMapStyle(next);
  }, []);

  // 🗺️ Legend is CLOSED by default. The driver opens it with the small layers button
  // and closes it again with the X — it never opens by itself.
  const [legendOpen, setLegendOpen] = useState(false);

  // Create the Leaflet map when its container mounts, destroy it when the container is removed
  useEffect(() => {
    if (!mapEl) return;
    const map = L.map(mapEl, {
      center: [11.2, 124.9], // Samar + Leyte
      zoom: 7,
      attributionControl: false,
      zoomControl: false, // 👈 default white +/- is removed; the modern glass control is added below
    });
    // NOTE: the tile layers are added by the "map type" effect below (Default or Satellite)

    // 🎛️ Modern, small, transparent zoom control (styled by MAP_ZOOM_CSS)
    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 250);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      labelLayerRef.current = null;
      originMarker.current = null;
      destMarker.current = null;
      routeLine.current = null;
    };
  }, [mapEl]);

  // 🛰️ Swap the tiles whenever the driver picks Default or Satellite (also runs once when the map is created)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    baseLayerRef.current?.remove();
    labelLayerRef.current?.remove();
    baseLayerRef.current = null;
    labelLayerRef.current = null;

    if (mapStyle === "satellite") {
      // maxNativeZoom 17: where imagery is not available closer up, tiles are scaled instead of going blank
      const base = L.tileLayer(SAT_TILES, { maxZoom: 19, maxNativeZoom: 17 }).addTo(map);
      base.bringToBack();
      const labels = L.tileLayer(SAT_LABEL_TILES, {
        maxZoom: 19,
        maxNativeZoom: 17,
        pane: "overlayPane", // above the imagery, below the route line and pins
      }).addTo(map);
      baseLayerRef.current = base;
      labelLayerRef.current = labels;
    } else {
      const base = L.tileLayer(OSM_TILES, { maxZoom: 19 }).addTo(map);
      base.bringToBack();
      baseLayerRef.current = base;
    }

    // the route line stays visible on both: blue on the default map, yellow on dark satellite imagery
    routeLine.current?.setStyle({
      color: mapStyle === "satellite" ? ROUTE_COLOR_SATELLITE : ROUTE_COLOR_STANDARD,
    });
  }, [mapStyle, mapEl]);

  // After the slide-down finishes (or the tab becomes visible) → fix tile sizing and re-fit the route
  useEffect(() => {
    if (!visible || !mapOpen) return;
    const t = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      if (routeLine.current) map.fitBounds(routeLine.current.getBounds(), { padding: [40, 40] });
    }, 540);
    return () => clearTimeout(t);
  }, [visible, mapOpen]);

  // Keep the two pins in sync with the saved route's coordinates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sync = (
      ref: React.MutableRefObject<L.Marker | null>,
      pt: LatLng | null,
      color: string,
      label: string
    ) => {
      if (!pt) {
        ref.current?.remove();
        ref.current = null;
        return;
      }
      if (!ref.current) {
        ref.current = L.marker([pt.lat, pt.lng], {
          icon: mapPin(color, label),
          draggable: false,
          interactive: false,
        }).addTo(map);
      } else {
        ref.current.setLatLng([pt.lat, pt.lng]);
      }
    };

    sync(originMarker, originPt, "#2563eb", "Origin");
    sync(destMarker, destPt, "#059669", "Destination");
  }, [originPt, destPt, mapEl]);

  // 📌 Pins + road line come from the SAVED route. They stay while the route exists
  // and go back to zero as soon as it is reset (savedOrigin/savedDest become null).
  useEffect(() => {
    let cancelled = false;
    routeLine.current?.remove();
    routeLine.current = null;

    if (!savedOrigin || !savedDest) {
      setOriginPt(null);
      setDestPt(null);
      setRouteKm(null);
      return;
    }
    if (!mapEl) return;
    if (places.length === 0 && placesLoading) return; // wait for the places list

    (async () => {
      try {
        const [o, d] = await Promise.all([
          resolveLabelPoint(savedOrigin, places),
          resolveLabelPoint(savedDest, places),
        ]);
        if (cancelled) return;
        setOriginPt(o);
        setDestPt(d);

        // 📏 quick estimate first (straight line × 1.35), replaced below by the real road distance
        setRouteKm(o && d ? haversineKm(o, d) * 1.35 : null);

        const map = mapRef.current;
        if (!map || !o || !d) {
          if (map && (o || d)) {
            const p = (o ?? d)!;
            map.setView([p.lat, p.lng], 11);
          }
          return;
        }

        const r = await roadRoute(o, d).catch(() => null);
        if (cancelled || !mapRef.current) return;
        map.invalidateSize();
        if (r) {
          setRouteKm(r.km); // 📏 real road distance
          routeLine.current = L.polyline(r.coords, {
            color: mapStyleRef.current === "satellite" ? ROUTE_COLOR_SATELLITE : ROUTE_COLOR_STANDARD,
            weight: 5,
            opacity: 0.9,
          }).addTo(map);
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

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOrigin, savedDest, mapEl, places.length, placesLoading]);

  // ⚡ Start finding the places + road distance in the background as soon as they are picked.
  // (The default origin — Calbayog City — starts warming up the moment the form opens.)
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

  // ✅ ONE BUTTON: Set route — get the road distance (usually ALREADY known), compute the fare,
  // SAVE the route and AUTO-ACTIVATE it (on the reader of the route that was reset).
  const canPressOk = distanceFareEnabled && !!originPlace && !!destPlace && !busy && !saving;

  // ⚡ Activates a saved route (+ its return direction) on the given reader device.
  // The device claim was already STARTED earlier (in parallel with saving), so here it is only awaited.
  const activateSavedRoute = async (
    origin: string,
    destination: string,
    deviceId: string,
    claimPromise: Promise<"ok" | "taken" | "error">
  ): Promise<"ok" | "failed" | "not-found" | "taken"> => {
    // main + return direction + device claim are all done at the same time
    const [{ data: main }, { data: reverse }, claim] = await Promise.all([
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
      claimPromise,
    ]);

    if (!main?.id) return "not-found";

    // 🔗 reader ownership (one device = one driver)
    if (claim === "taken") return "taken";
    if (claim !== "ok") return "failed";

    // ...and both routes are activated at the same time
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
        title: "Route form is locked",
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

    /* 1️⃣ distance → fare.
       ⚡ INSTANT PATH: when the distance was already prepared (device cache / shared cache /
       background lookup that finished while the driver was typing), it is read synchronously —
       no await, no spinner. Only a brand-new, never-used route has to wait for the lookup. */
    let fareAmount: number;
    let approxUsed = false;
    try {
      let res: KmResult | null = peekKm(originPlace, destPlace);

      if (!res) {
        setBusy(true); // only now — the answer was not ready yet
        res = await getRoadKm(originPlace, destPlace);
      }

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

      approxUsed = !!res.approx;
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

    const approxNote = approxUsed
      ? "A barangay isn't on the map (its city/municipality center was used) or the road service was unavailable. The distance is approximate."
      : undefined;

    /* 2️⃣ save (create or update) + 3️⃣ auto-activate */
    setSaving(true);
    const p = { origin: originPlace.label, destination: destPlace.label, fareAmount };

    // ⚡ the reader claim does NOT depend on the route being saved → start it NOW, in parallel
    const claimPromise: Promise<"ok" | "taken" | "error"> | null = resetDeviceId
      ? claimDevice(resetDeviceId)
      : null;

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
      if (resetDeviceId && claimPromise) {
        activateResult = await activateSavedRoute(p.origin, p.destination, resetDeviceId, claimPromise);
      }

      queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      loadMyRoutes();

      resetForm();
      setResetUnlocked(false); // 🔒 lock again — Reset is needed before adding another
      setResetDeviceId(null);

      if (activateResult === "ok") {
        toast({
          title: <SuccessTitle text={`Route Saved & Activated — ₱${p.fareAmount.toFixed(2)}`} />,
          description: approxNote,
          ...(approxNote ? { duration: 5000 } : {}),
        });
      } else if (activateResult === "no-device") {
        toast({
          title: <SuccessTitle text={`Route Saved — ₱${p.fareAmount.toFixed(2)}`} />,
          description: approxNote
            ? `No reader device to re-use. Activate the route manually. ${approxNote}`
            : "No reader device to re-use. Activate the route manually.",
          ...(approxNote ? { duration: 5000 } : {}),
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

  const isSat = mapStyle === "satellite";

  // Legend styling: light glass on default map, dark glass when the app is dark, always readable on satellite
  const legendPanel = isSat
    ? "border-white/20 bg-slate-900/75 text-slate-100"
    : isDark
      ? "border-white/10 bg-slate-900/80 text-slate-100"
      : "border-white/70 bg-white/85 text-slate-800";
  const legendDivider = isSat || isDark ? "border-white/15" : "border-slate-200";

  const mapTypeOptions = [
    { id: "standard" as const, label: "Default", Icon: MapIcon },
    { id: "satellite" as const, label: "Satellite", Icon: Satellite },
  ];

  return (
    <div className="space-y-0">
      {/* Modern glass zoom control + legend styles (scoped to .tp-map / .tp-legend) */}
      <style>{MAP_ZOOM_CSS}</style>

      {/* Map — slides DOWN once a route is set, slides UP and disappears on Reset */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          mapOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        aria-hidden={!mapOpen}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pb-3">
            {mapMounted && (
              <div
                className={`tp-map ${isDark ? "tp-map-dark" : ""} ${isSat ? "tp-map-sat" : ""} relative isolate z-0 h-72 sm:h-80 overflow-hidden rounded-3xl border ${
                  isDark ? "border-slate-800" : "border-slate-200"
                }`}
              >
                <div ref={setMapEl} className="h-full w-full" />

                {/* 📏 Approximate distance of the route */}
               <span
           className="absolute left-3 top-3 z-[500] flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur"
             aria-live="polite"
              >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
             <span className="font-medium text-white/70">Approximate distance:</span>
                <span>{routeKm != null ? formatApproxKm(routeKm) : "Calculating…"}</span>
              </span>

                {/* 🗺️ LEGEND — closed by default; driver opens/closes it with the layers button / X */}
                {legendOpen ? (
                <div
                  className={`tp-legend absolute right-3 top-3 z-[500] w-[138px] rounded-2xl border p-1.5 shadow-lg backdrop-blur-md ${legendPanel}`}
                  role="group"
                  aria-label="Map legend"
                >
                  <div className="flex items-center justify-between pb-1 pl-1.5 pt-0.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest opacity-60">Map type</p>
                    <button
                      type="button"
                      onClick={() => setLegendOpen(false)}
                      aria-label="Hide map legend"
                      className={`flex h-5 w-5 items-center justify-center rounded-full ${
                        isSat || isDark ? "hover:bg-white/15" : "hover:bg-slate-900/10"
                      }`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1">
                    {mapTypeOptions.map(({ id, label, Icon }) => {
                      const selected = mapStyle === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => changeMapStyle(id)}
                          aria-pressed={selected}
                          className={`flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left text-[11px] font-semibold ${
                            selected
                              ? "bg-blue-600 text-white shadow"
                              : isSat || isDark
                                ? "hover:bg-white/10"
                                : "hover:bg-slate-900/5"
                          }`}
                        >
                          {/* little preview swatch of the map type */}
                          <span
                            aria-hidden="true"
                            className={`relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border ${
                              selected ? "border-white/60" : "border-black/10"
                            }`}
                            style={{
                              background:
                                id === "satellite"
                                  ? "linear-gradient(135deg,#14532d 0%,#365314 45%,#1e3a5f 100%)"
                                  : "linear-gradient(135deg,#e8efe0 0%,#f7f3e8 55%,#bcd7f0 100%)",
                            }}
                          >
                            <Icon
                              className={`h-3.5 w-3.5 ${id === "satellite" ? "text-white" : "text-slate-700"}`}
                            />
                          </span>
                          <span className="flex-1 leading-none">{label}</span>
                          {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className={`mt-1.5 space-y-1 border-t px-1.5 pb-0.5 pt-1.5 text-[10px] font-semibold ${legendDivider}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-600 shadow" />
                      Origin
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-600 shadow" />
                      Destination
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1 w-2.5 rounded-full"
                        style={{ background: isSat ? ROUTE_COLOR_SATELLITE : ROUTE_COLOR_STANDARD }}
                      />
                      Route
                    </div>
                  </div>
                </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLegendOpen(true)}
                    aria-label="Show map legend"
                    className={`tp-legend absolute right-3 top-3 z-[500] flex h-9 w-9 items-center justify-center rounded-full border shadow-lg backdrop-blur-md ${legendPanel}`}
                  >
                    <Layers className="h-4 w-4" />
                  </button>
                )}

                {/* attribution for the tile providers (small, bottom-left) */}
                <span
                  className={`pointer-events-none absolute bottom-1.5 left-2 z-[500] rounded px-1.5 py-0.5 text-[8px] font-medium backdrop-blur ${
                    isSat ? "bg-black/50 text-white/80" : "bg-white/70 text-slate-600"
                  }`}
                >
                  {isSat ? "Imagery © Esri" : "© OpenStreetMap"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Set route form */}
      <section
        ref={formSectionRef}
        className={`relative z-10 scroll-mt-20 rounded-3xl border p-4 space-y-3 transition-shadow ${card} ${
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
            <p className="mt-1 px-6 text-center text-[11px]">
              Pick an origin and destination above, then tap Set route. The map appears once your route is set.
            </p>
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
                    {isResetting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="mr-1.5 h-4 w-4" /> Reset
                      </>
                    )}
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
   🔐 ChangePasswordCard — Profile tab
   Uses POST /api/auth/user/change-password. Same auth_users table as the
   commuter account (role-based), so the driver token works as-is.
   Rules enforced by the server: min 8 chars, once every 24 hours.
   ═══════════════════════════════════════════════════════════════════════ */

function ChangePasswordCard({ isDark }: { isDark: boolean }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const inputCls = isDark
    ? "bg-slate-950 border-slate-800 text-slate-200"
    : "bg-white border-slate-200 text-slate-800";

  const canSubmit = !!current && !!next && !!confirm && !saving;

  async function handleSubmit() {
    setError(null);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from the current password.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/user/change-password`, {
        method: "POST",
        headers: driverAuthHeaders(),
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON response */
      }

      if (!res.ok || !data?.success) {
        setError(data?.message ?? "Couldn't change your password. Please try again.");
        return;
      }

      setCurrent("");
      setNext("");
      setConfirm("");
      setShow(false);
      toast({ title: <SuccessTitle text="Password changed" /> });
    } catch (e) {
      console.error("change-password failed:", e);
      setError("Network error. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${
        isDark ? "bg-slate-900/70 border-slate-800" : "bg-white border-slate-200 shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
            <KeyRound size={14} />
          </span>
          Change password
        </h2>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide passwords" : "Show passwords"}
          className={`flex h-8 w-8 items-center justify-center rounded-full ${muted}`}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <div className="space-y-1">
        <Label className={`text-[11px] font-semibold ${muted}`}>Current password</Label>
        <Input
          type={show ? "text" : "password"}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          disabled={saving}
          className={`h-10 rounded-xl text-base sm:text-sm ${inputCls}`}
        />
      </div>

      <div className="space-y-1">
        <Label className={`text-[11px] font-semibold ${muted}`}>New password</Label>
        <Input
          type={show ? "text" : "password"}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          disabled={saving}
          placeholder="At least 8 characters"
          className={`h-10 rounded-xl text-base sm:text-sm ${inputCls}`}
        />
      </div>

      <div className="space-y-1">
        <Label className={`text-[11px] font-semibold ${muted}`}>Confirm new password</Label>
        <Input
          type={show ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) handleSubmit();
          }}
          className={`h-10 rounded-xl text-base sm:text-sm ${inputCls}`}
        />
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
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-busy={saving}
        className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
      </Button>

      <p className={`text-[11px] ${muted}`}>You can change your password once every 24 hours.</p>
    </section>
  );
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
  // Route panel mounts on first visit, then stays mounted (keeps the route/map state when switching tabs)
  const [mapVisited, setMapVisited] = useState(false);

  // 👤 Real name / email / profile picture of the signed-in driver
  const { profile: driverProfile, loading: profileLoading } = useDriverProfile(authorized);
  const profileName =
    driverProfile.fullName ||
    deriveNameFromEmail(driverProfile.email) ||
    driverProfile.username ||
    "Driver account";
  const profileEmail = driverProfile.email;

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

  // ⚡ Warm up the Route tab in the background right after sign-in:
  // the places list is loaded (from the saved copy → instant) so the Route tab opens with data.
  useEffect(() => {
    if (!authorized) return;
    loadSamarPlaces().catch(() => {});
  }, [authorized]);

  function changeTab(next: Tab) {
    setTab(next);
    if (next === "map") setMapVisited(true);
    window.scrollTo({ top: 0 });
  }

  function handleSignOut() {
    const token = window.localStorage.getItem(DRIVER_TOKEN_KEY);
    if (token) {
      // fire-and-forget audit log; never block sign out
      fetch(`${API_BASE}/api/auth/user/logout`, {
        method: "POST",
        headers: driverAuthHeaders(),
      }).catch(() => {});
    }
    window.localStorage.removeItem(DRIVER_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_ROLE_KEY);
    window.localStorage.removeItem(DRIVER_NAME_KEY);
    window.localStorage.removeItem(DRIVER_PROFILE_KEY); // 👈 don't show this driver's profile to the next login
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

        /* smooth tab navigation: new tab glides up from below */
        @keyframes tab-in {
          0%   { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .tab-in { animation: tab-in 0.28s cubic-bezier(0.22, 1, 0.36, 1); }

        @media (prefers-reduced-motion: reduce) {
          .tab-in, .value-pop { animation: none; }
        }
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
          <div key="home" className="tab-in space-y-4">
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
                <div
                  className={`rounded-2xl border border-dashed p-6 text-center text-xs ${muted} ${
                    isDark ? "border-slate-800" : "border-slate-300"
                  }`}
                >
                  No trips yet today. Trips appear here as passengers tap.
                </div>
              ) : (
                trips.slice(0, 3).map((t) => (
                  <TripCard key={t.key} trip={t} isDark={isDark} compact />
                ))
              )}
            </section>
          </div>
        )}

        {mapVisited && (
          <div className={tab === "map" ? "tab-in" : "hidden"}>
            <FareMapPanel isDark={isDark} visible={tab === "map"} />
          </div>
        )}

        {tab === "trips" && (
          <section key="trips" className="tab-in space-y-4">
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
              Each route is one trip per day. New taps on the same route are added to that trip.
            </p>
          </section>
        )}

        {tab === "profile" && (
          <div key="profile" className="tab-in space-y-4">
            <section className={`rounded-2xl border p-4 space-y-4 ${card}`}>
              {/* 👤 Real avatar + name + email (same look as the user dashboard) */}
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 overflow-hidden border-2 border-blue-500/30">
                  {profileLoading && !driverProfile.avatarUrl && !driverProfile.fullName && !driverProfile.email ? (
                    <Skeleton className="h-full w-full rounded-full bg-white/20" />
                  ) : (
                    <DriverAvatar
                      url={driverProfile.avatarUrl}
                      name={profileName}
                      fallback={
                        driverProfile.fullName || driverProfile.email ? (
                          <span className="text-base font-black tracking-tight">
                            {getInitials(profileName)}
                          </span>
                        ) : (
                          <UserRound className="h-6 w-6 text-white" />
                        )
                      }
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {profileLoading && !driverProfile.fullName && !driverProfile.email ? (
                    <div className="space-y-1.5">
                      <Skeleton className={`h-4 w-32 ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
                      <Skeleton className={`h-3 w-44 ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
                    </div>
                  ) : (
                    <>
                      <p className="truncate font-bold leading-tight">{profileName}</p>
                      <p className={`mt-0.5 flex items-center gap-1 truncate text-xs ${muted}`}>
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{profileEmail || "No email on file"}</span>
                      </p>
                    </>
                  )}
                  <span
                    className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      isDark
                        ? "border-emerald-900 bg-emerald-950/40 text-emerald-400"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Role: driver
                  </span>
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

            <ChangePasswordCard isDark={isDark} />
          </div>
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