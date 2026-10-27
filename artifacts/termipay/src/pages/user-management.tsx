import { useState, useEffect, useRef, useMemo } from "react";
import {
  useListUsers,
  useUpdateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { Search, Pencil, Trash2, Wallet, Users, Zap, ShieldAlert, Mail, LinkIcon, ChevronLeft, ChevronRight, Phone, CheckCircle2, Eye, CreditCard, RotateCw, RefreshCw, CalendarClock, ArrowRightLeft, Upload, X, Loader2, ChevronsUpDown, Check, MapPin, UserRound, IdCard, Download, FileText, Bus, AlertTriangle, Cpu, Unlink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { supabase } from "@/lib/supabase"; // 👈 direct Supabase client para sa renew_card() / balance transfer RPC calls

// ⬇️ card image / PDF export
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

// 🔒 ADMIN ACCESS: nagbibigay ng `canManage` (false kapag view_only ang admin)
// at `loaded` (true kapag tapos na ma-fetch ang access info).
import { useAdminAccess } from "@/hooks/use-admin-access";

const PAGE_SIZE = 10;

const TYPE_FILTERS = ["All", "Regular", "Student", "Senior", "PWD"] as const;

// ➕ Status filter options. "Expired" is NOT a raw DB status — it's derived
// from the card's expirationDate via isCardExpired(), so it can catch cards
// that are technically still "Active" in the status column but past their date.
const STATUS_FILTERS = ["All", "Active", "Inactive", "Blocked", "Expired"] as const;

// 🧑‍🤝‍🧑 ROLE TABS — DALAWA NA LANG (walang "All")
//   Driver   = card na naka-link (card_uid = linked_card_uid) sa auth_users na role = 'driver'
//   Commuter = lahat ng ibang card sa public.users
const ROLE_TABS = ["Commuter", "Driver"] as const;
type RoleTab = (typeof ROLE_TABS)[number];
type AuthRole = "commuter" | "driver";

// 🚌 Driver account (public.auth_users, role = 'driver')
interface DriverAccountRow {
  id: string | null;
  supabase_auth_id: string | null;
  full_name: string | null;
  email: string | null;
  linked_card_uid: string | null;
  device_id?: string | null; // 📟 naka-link na device ng driver
}

// 💸 Isang transaction row na may driver_id (para sa total fare collected)
interface DriverFareRow {
  id: number | string | null;
  driver_id: string | null;
  amount: number | string | null;
  type: string | null;
  status: string | null;
}

// 📟 Device row (public.devices) — driver_id ang nagsasabi kung sino ang nag-activate
interface DeviceRow {
  device_id: string | null;
  name: string | null;
  status: string | null;
  driver_id: string | null;
  last_ping: string | null;
}

// 💸 Mga transaction type na HINDI fare (hindi kasama sa total fare collected).
// Kung iba ang tawag mo sa fare type, ayusin dito.
const NON_FARE_TYPE_REGEX = /top.?up|refund|reversal|cash.?in/i;

// ✅ Mga status na itinuturing na successful na transaction
const SUCCESS_STATUSES = ["success", "successful", "completed", "complete", "paid"];

// 🔑 Normalizes a card UID so "04:A3:1F", "04a31f", "04-A3-1F" all match.
function normalizeCardUid(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

// 🔑 Normalizes any ID / email / UID para laging magtugma ang driver_id sa
// transactions at ang id/supabase_auth_id/linked_card_uid/email ng driver
// ("ABC-123" == "abc123", UUID na may dash o wala, etc.)
function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@.]/g, "");
}

// 📅 Range ng "ngayong araw" sa oras ng Pilipinas (Asia/Manila, UTC+8):
// 12:00 AM ngayon hanggang 12:00 AM bukas. Ginagamit para ang nakukuha lang
// na fare ay ang nakolekta TODAY.
function getManilaDayRange() {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
  const start = new Date(`${ymd}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { key: ymd, startISO: start.toISOString(), endISO: end.toISOString() };
}

// ➕ Reasons a card would need a balance transfer (lost/stolen/damaged replacement)
const TRANSFER_REASONS = ["Lost Card", "Stolen Card", "Damaged Card", "Other"] as const;

const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

const ID_IMAGE_BUCKET = "id-verifications";
const MAX_ID_IMAGE_SIZE = 5 * 1024 * 1024;

// ⏱️ Max na hihintayin sa ZIP lookup bago ituloy ang address nang walang ZIP.
const ZIP_LOOKUP_TIMEOUT_MS = 6000;

// 📞 PH country code para sa contact number.
const PH_COUNTRY_CODE = "+63";

// 📞 Kinukuha lang ang 10 digits pagkatapos ng +63 (hal. 9XXXXXXXXX).
// Tumatanggap ng "09XXXXXXXXX", "639XXXXXXXXX", o "+639XXXXXXXXX"
// (pati ang mga lumang record na naka-09...) at ginagawang 10-digit local number.
function normalizePhContactDigits(raw: string): string {
  let digits = String(raw || "").replace(/\D/g, "");

  if (digits.startsWith("63")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════
// PAGE STYLES — same folder-tab master container as the Reports page
// (single-file build, copied from REPORTS_CSS). Only the rules this page
// actually uses are included.
// ══════════════════════════════════════════════════════════════════════
const USERS_PANEL_CSS = `
/* 1. TOKENS */
.rp {
  --rp-bg: #ffffff;
  --rp-strip: #ffffff;
  --rp-tile: #ffffff;
  --rp-border: #e4e4e7;
  --rp-divider: #ececee;
  --rp-text: #27272a;
  --rp-muted: #71717a;
  --rp-accent: #2563eb;
  --rp-radius: 18px;
  --rp-shadow:
    0 1px 2px rgba(24, 24, 27, 0.06),
    0 10px 24px -6px rgba(24, 24, 27, 0.14),
    0 28px 56px -16px rgba(24, 24, 27, 0.16);
}

.rp[data-theme="dark"] {
  --rp-bg: #18181b;
  --rp-strip: #101012;
  --rp-tile: #202024;
  --rp-border: #2c2c31;
  --rp-divider: #26262b;
  --rp-text: #e4e4e7;
  --rp-muted: #a1a1aa;
  --rp-accent: #60a5fa;
  --rp-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 12px 28px -8px rgba(0, 0, 0, 0.55),
    0 32px 64px -20px rgba(0, 0, 0, 0.6);
}

/* 2. PAGE-LEVEL (scoped with :has so it only applies while this page is mounted) */
html:has(.rp-page) {
  overflow-x: hidden !important;
  overflow-y: scroll !important;
  scrollbar-gutter: stable;
  scrollbar-width: none;
}
html:has(.rp-page)::-webkit-scrollbar,
body:has(.rp-page)::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
body:has(.rp-page) {
  overflow-x: hidden !important;
  overflow-y: scroll !important;
  scrollbar-width: none;
  scrollbar-gutter: stable;
}
#root:has(.rp-page) {
  min-width: 0 !important;
  max-width: 100% !important;
  overflow-x: hidden !important;
}
.rp-page {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: visible;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.rp-page::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* 3. MASTER CONTAINER */
.rp {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  background: transparent;
}

/* 4. TAB STRIP */
.rp-tabs {
  position: relative;
  z-index: 2;
  display: flex;
  flex: none;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: 0;
}

.rp-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
  padding: 10px 14px;
  margin: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--rp-muted);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  box-shadow: none;
  outline: none;
  cursor: pointer;
  transition: color 0.15s ease;
}

.rp-tab:hover {
  color: var(--rp-text);
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.rp-tab[aria-selected="true"],
.rp-tab[aria-selected="true"]:hover {
  color: var(--rp-accent);
  background: var(--rp-bg);
  border-color: var(--rp-border);
  box-shadow: none;
  margin-bottom: -1px;
  padding-bottom: 11px;
  z-index: 3;
}

.rp-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 3px;
  background: var(--rp-bg);
  pointer-events: none;
}

.rp-tab svg { width: 14px; height: 14px; flex: none; }
.rp-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* count pill inside each tab */
.rp-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
  color: var(--rp-muted);
  background: var(--rp-divider);
  border-radius: 9999px;
}
.rp-tab[aria-selected="true"] .rp-count {
  color: var(--rp-accent);
  background: color-mix(in srgb, var(--rp-accent) 14%, transparent);
}

/* 5. CONTENT AREA */
.rp-body {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  padding: 24px;
  background: var(--rp-bg);
  border: 1px solid var(--rp-border);
  border-radius: 0 var(--rp-radius) var(--rp-radius) var(--rp-radius);
  box-shadow: var(--rp-shadow);
}

.rp-section { min-width: 0; }

.rp-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--rp-divider);
}
.rp-section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--rp-text);
}
.rp-section-title small {
  font-size: 12px;
  font-weight: 500;
  color: var(--rp-muted);
}
.rp-section-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--rp-muted);
}
.rp-section-lead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* 6. INNER ELEMENTS */
.rp-well {
  padding: 16px;
  background: var(--rp-tile);
  border: 1px solid var(--rp-border);
  border-radius: 12px;
}

/* sticky table header that matches the panel background */
.rp .rp-sticky-head,
.rp .rp-sticky-head tr {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--rp-bg);
}

/* 7. MOTION + A11Y */
@keyframes rp-swap {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.rp-body-enter { animation: rp-swap 0.16s ease-out; }

.rp-tab:focus-visible {
  outline: 2px solid var(--rp-accent);
  outline-offset: 2px;
}

.rp[data-first="false"] .rp-body {
  border-top-left-radius: var(--rp-radius);
}

@media (max-width: 1100px) {
  .rp-tab { padding: 10px 10px; gap: 6px; }
}

@media (max-width: 760px) {
  .rp-body { padding: 16px; }
  .rp { --rp-radius: 14px; }
  .rp-tabs { gap: 2px; }
  .rp-tab {
    flex: 1 1 0;
    padding: 9px 6px;
    border-radius: 10px 10px 0 0;
  }
  .rp-tab[aria-selected="true"],
  .rp-tab[aria-selected="true"]:hover {
    flex: 0 0 auto;
    padding: 9px 12px 10px;
  }
  .rp-tab[aria-selected="false"] .rp-label { display: none; }
  .rp-tab[aria-selected="false"] .rp-count { display: none; }
  .rp-tab svg { width: 16px; height: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .rp-body-enter { animation: none; }
  .rp-tab { transition: none; }
}
`;

/* ==========================================================================
   ReportsPanel — the single master container (same component structure as
   the Reports page).

   <ReportsPanel>           one bordered, shadowed panel
     tab strip              the top edge of the "folder"
     body                   whichever tab is active renders in here
   </ReportsPanel>
   ========================================================================== */

type PanelTab<K extends string = string> = {
  key: K;
  label: string;
  icon: LucideIcon;
  count?: number;
};

type ReportsPanelProps<K extends string> = {
  tabs: PanelTab<K>[];
  active: K;
  onChange: (key: K) => void;
  isDark: boolean;
  children: React.ReactNode;
};

function ReportsPanel<K extends string>({
  tabs,
  active,
  onChange,
  isDark,
  children,
}: ReportsPanelProps<K>) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Arrow-key / Home / End navigation, per the WAI-ARIA tabs pattern.
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  };

  return (
    <div
      className="rp"
      data-theme={isDark ? "dark" : "light"}
      data-first={active === tabs[0]?.key ? "true" : "false"}
      data-testid="users-panel"
    >
      <div className="rp-tabs" role="tablist" aria-label="Account roles">
        {tabs.map(({ key, label, icon: Icon, count }, i) => (
          <button
            key={key}
            type="button"
            ref={(el) => { tabRefs.current[key] = el; }}
            role="tab"
            id={`rp-tab-${key}`}
            aria-selected={active === key}
            aria-controls={`rp-panel-${key}`}
            aria-label={label}
            title={label}
            tabIndex={active === key ? 0 : -1}
            className="rp-tab"
            data-testid={`button-tab-${key}`}
            onClick={() => onChange(key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            <Icon aria-hidden="true" />
            <span className="rp-label">{label}</span>
            {typeof count === "number" && <span className="rp-count">{count}</span>}
          </button>
        ))}
      </div>

      {/* key={active} replays the short fade when the tab changes. The
          container itself is never remounted. */}
      <div
        key={active}
        className="rp-body rp-body-enter"
        role="tabpanel"
        id={`rp-panel-${active}`}
        aria-labelledby={`rp-tab-${active}`}
      >
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   ReportSection — plain header row (title, filter/search bar, right-side
   meta) with a divider, instead of a nested card.
   -------------------------------------------------------------------------- */
type ReportSectionProps = {
  title: string;
  icon: LucideIcon;
  iconClassName?: string;
  filterLabel?: string;
  filterBar?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
};

function ReportSection({
  title,
  icon: Icon,
  iconClassName = "text-blue-500",
  filterLabel,
  filterBar,
  meta,
  children,
}: ReportSectionProps) {
  return (
    <section className="rp-section">
      <header className="rp-section-head">
        <div className="rp-section-lead">
          <h3 className="rp-section-title">
            <Icon size={14} className={iconClassName} aria-hidden="true" />
            {title}
            {filterLabel ? <small>— {filterLabel}</small> : null}
          </h3>
          {filterBar}
        </div>
        {meta ? <div className="rp-section-meta">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 📍 ADDRESS HELPERS — copied from Card Registration so Update User uses
// the exact same address behaviour (one searchable field + auto ZIP +
// auto Full Address).
// ═══════════════════════════════════════════════════════════════════════

// 🔎 ONE flattened, searchable address record (barangay + its full parent
// chain: city/municipality, province, region) built once.
interface AddressSearchOption {
  code: string; // barangayCode — used as the combobox value
  label: string; // "Barangay, City, Province, Region" — what gets searched/shown

  regionCode: string;
  regionName: string;

  provinceCode: string;
  provinceName: string;

  cityCode: string;
  cityName: string;

  barangayCode: string;
  barangayName: string;
}

async function fetchPsgcRaw(path: string): Promise<any[]> {
  const response = await fetch(`${PSGC_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Failed to load PSGC data: ${response.status}`);
  }

  const data = await response.json();

  return Array.isArray(data) ? data : [];
}

// 📮 ZIP cache — kapag nahanap na ang ZIP ng isang lugar, instant na sa susunod.
const zipCache = new Map<string, string>();

// 📮 Auto ZIP lookup via Nominatim (OpenStreetMap). Walang package na kailangan.
// Nagbabalik ng 4-digit PH ZIP code, o "" kapag walang nahanap.
async function lookupZipCode(
  parts: string[],
  signal: AbortSignal
): Promise<string> {
  const q = [...parts.filter(Boolean), "Philippines"].join(", ");

  if (zipCache.has(q)) {
    return zipCache.get(q) as string;
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ph&q=${encodeURIComponent(
      q
    )}`,
    { signal, headers: { Accept: "application/json" } }
  );

  if (!response.ok) return "";

  const data = await response.json();
  const postcode = String(data?.[0]?.address?.postcode ?? "");

  // PH ZIP codes are 4 digits
  const zip = postcode.match(/\d{4}/)?.[0] ?? "";

  zipCache.set(q, zip);

  return zip;
}

// 🧩 Builds the human-readable full address string from the individual
// street / region / province / city / barangay / zip fields. Always ends
// with "Philippines".
function buildFullAddress(fields: {
  streetAddress: string;
  barangayName: string;
  cityName: string;
  provinceName: string;
  regionName: string;
  zipCode: string;
}): string {
  const {
    streetAddress,
    barangayName,
    cityName,
    provinceName,
    regionName,
    zipCode,
  } = fields;

  return [
    (streetAddress || "").trim(),
    barangayName,
    cityName,
    provinceName,
    regionName && zipCode
      ? `${regionName} ${zipCode}`
      : regionName || zipCode,
    "Philippines",
  ]
    .filter(Boolean)
    .join(", ");
}

/*
 * ADDRESS COMBOBOX (same as Card Registration)
 *
 * ONE searchable field for barangay / city / province / region.
 * Virtualized: only ~15 visible rows (+ overscan) are rendered at a time.
 * May location icon, at buo ang address (nagwa-wrap, hindi pinuputol).
 */
const COMBOBOX_ITEM_HEIGHT = 48; // 👈 mas mataas para kasya ang 2 lines
const COMBOBOX_LIST_HEIGHT = 240;
const COMBOBOX_OVERSCAN = 6;
const COMBOBOX_MAX_RESULTS = 300;
const COMBOBOX_MIN_SEARCH_LENGTH = 2;

interface AddressComboboxProps {
  options: AddressSearchOption[];
  value: string; // selected barangayCode
  // Fallback label shown when the saved barangay isn't in `options` (yet)
  selectedLabel?: string;
  onChange: (option: AddressSearchOption) => void;
  placeholder: string;
  loadingPlaceholder?: string;
  loading?: boolean;
  disabled?: boolean;
  isDark: boolean;
}

function AddressCombobox({
  options,
  value,
  selectedLabel,
  onChange,
  placeholder,
  loadingPlaceholder,
  loading,
  disabled,
  isDark,
}: AddressComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (query.length < COMBOBOX_MIN_SEARCH_LENGTH) return [];

    const tokens = query.split(/\s+/).filter(Boolean);

    const matches: AddressSearchOption[] = [];

    for (const option of options) {
      const haystack = option.label.toLowerCase();

      if (tokens.every((token) => haystack.includes(token))) {
        matches.push(option);

        if (matches.length >= COMBOBOX_MAX_RESULTS) break;
      }
    }

    return matches;
  }, [options, query]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setScrollTop(0);

      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
    }
  }, [open]);

  const selected = options.find((option) => option.code === value);
  const displayLabel = selected?.label ?? (value ? selectedLabel : undefined);

  const visibleCount =
    Math.ceil(COMBOBOX_LIST_HEIGHT / COMBOBOX_ITEM_HEIGHT) +
    COMBOBOX_OVERSCAN * 2;

  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / COMBOBOX_ITEM_HEIGHT) - COMBOBOX_OVERSCAN
  );

  const endIndex = Math.min(filtered.length, startIndex + visibleCount);
  const visibleItems = filtered.slice(startIndex, endIndex);
  const totalHeight = filtered.length * COMBOBOX_ITEM_HEIGHT;
  const offsetY = startIndex * COMBOBOX_ITEM_HEIGHT;

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        {/* 📍 Trigger: may location icon, at buo ang address (nagwa-wrap, hindi na pinuputol) */}
        <button
          type="button"
          disabled={disabled}
          className={`flex min-h-9 w-full items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            isDark
              ? "border-slate-800 bg-slate-950 text-slate-200"
              : "border-slate-200 bg-white text-slate-900"
          }`}
        >
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <MapPin
              className={`mt-px h-3.5 w-3.5 shrink-0 ${
                displayLabel ? "text-cyan-500" : "opacity-50"
              }`}
            />

            <span
              className={`min-w-0 flex-1 whitespace-normal break-words leading-snug ${
                !displayLabel ? "opacity-50" : ""
              }`}
            >
              {displayLabel ??
                (loading ? loadingPlaceholder ?? "Loading..." : placeholder)}
            </span>
          </span>

          <ChevronsUpDown className="mt-px h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={`w-[--radix-popover-trigger-width] min-w-[260px] p-0 ${
          isDark ? "border-slate-800 bg-slate-950" : "bg-white"
        }`}
      >
        <div
          className={`flex items-center gap-2 border-b px-3 py-1.5 ${
            isDark ? "border-slate-800" : "border-slate-100"
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <input
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setScrollTop(0);

              if (listRef.current) {
                listRef.current.scrollTop = 0;
              }
            }}
            placeholder="Search barangay, city, or province..."
            className={`w-full bg-transparent text-xs outline-none placeholder:opacity-50 ${
              isDark ? "text-slate-200" : "text-slate-900"
            }`}
          />
        </div>

        <div
          ref={listRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          style={{
            height: COMBOBOX_LIST_HEIGHT,
            overflowY: "auto",
            overscrollBehavior: "contain",
            contain: "strict",
          }}
          className="location-combobox-list"
        >
          {query.length < COMBOBOX_MIN_SEARCH_LENGTH ? (
            <div
              className={`px-3 py-6 text-center text-xs ${
                isDark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              {loading
                ? loadingPlaceholder ?? "Loading address data..."
                : "Start typing a barangay, city, or province name"}
            </div>
          ) : filtered.length === 0 ? (
            <div
              className={`px-3 py-6 text-center text-xs ${
                isDark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              No results found
            </div>
          ) : (
            <div style={{ height: totalHeight, position: "relative" }}>
              <div
                style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}
              >
                {visibleItems.map((option) => {
                  const isSelected = option.code === value;

                  return (
                    <button
                      type="button"
                      key={option.code}
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                      style={{ height: COMBOBOX_ITEM_HEIGHT }}
                      className={`flex w-full items-center gap-2 px-3 text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? isDark
                            ? "bg-cyan-950/40 text-cyan-400"
                            : "bg-cyan-50 text-cyan-700"
                          : isDark
                            ? "text-slate-200 hover:bg-slate-800"
                            : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <MapPin
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected ? "text-cyan-500" : "opacity-40"
                        }`}
                      />

                      {/* Hanggang 2 lines, wrap ang mahahabang address */}
                      <span
                        className="min-w-0 flex-1 whitespace-normal break-words leading-snug"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {option.label}
                      </span>

                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 📅 Formats a date string into "Mon Day, Year" (e.g. Jan 15, 2026)
const formatDate = (value: string | null | undefined) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// 🚫➕ Single source of truth for "is this card expired?" — used to gate
// renewal everywhere (table row button, preview dialog button, openRenew
// guard, and confirmRenew guard) so a still-valid card can never be renewed.
function isCardExpired(expirationDate: string | null | undefined): boolean {
  if (!expirationDate) return false;
  const expDate = new Date(expirationDate);
  if (isNaN(expDate.getTime())) return false;
  return expDate < new Date();
}

// ➕ Renewal logic: extends from the LATER of (today, current expiration).
// NOTE: only used to render the "New Expiration" PREVIEW in the
// confirmation dialog. The actual DB write is done server-side by the
// renew_card() Postgres function, which is the source of truth.
function computeRenewedExpiration(currentExpiration: string | null | undefined): Date {
  const now = new Date();
  const current = currentExpiration ? new Date(currentExpiration) : null;
  const base = current && !isNaN(current.getTime()) && current > now ? current : now;
  const renewed = new Date(base);
  renewed.setFullYear(renewed.getFullYear() + 1);
  return renewed;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}


// Get the exact Storage object path from an ID image value.
// Supports both a full Supabase public URL and a bucket-relative path.
function getIdImageStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  // Already a bucket-relative object path.
  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "").split("?")[0] || null;
  }

  try {
    const url = new URL(raw);
    const pathname = url.pathname;

    const markers = [
      `/storage/v1/object/public/${ID_IMAGE_BUCKET}/`,
      `/storage/v1/object/sign/${ID_IMAGE_BUCKET}/`,
      `/storage/v1/object/authenticated/${ID_IMAGE_BUCKET}/`,
      `/storage/v1/object/${ID_IMAGE_BUCKET}/`,
    ];

    for (const marker of markers) {
      const index = pathname.indexOf(marker);
      if (index !== -1) {
        const encodedPath = pathname.slice(index + marker.length);
        const decodedPath = decodeURIComponent(encodedPath).replace(/^\/+/, "");
        return decodedPath || null;
      }
    }
  } catch (error) {
    console.warn("Could not parse ID image Storage URL:", error);
  }

  return null;
}

// 🎨 Card type -> color mapping
// 🟥 Regular  🟦 Student  🟨 Senior  🟩 PWD
function getTypeBadgeStyle(type: string | null | undefined, isDark: boolean) {
  const t = (type || "Regular").toLowerCase();
  switch (t) {
    case "student":
      return isDark
        ? "border-blue-900 text-blue-400 bg-blue-950/40"
        : "border-blue-200 text-blue-600 bg-blue-50";
    case "senior":
      return isDark
        ? "border-yellow-900 text-yellow-400 bg-yellow-950/40"
        : "border-yellow-300 text-yellow-700 bg-yellow-50";
    case "pwd":
      return isDark
        ? "border-emerald-900 text-emerald-400 bg-emerald-950/40"
        : "border-emerald-200 text-emerald-600 bg-emerald-50";
    case "regular":
    default:
      return isDark
        ? "border-red-900 text-red-400 bg-red-950/40"
        : "border-red-200 text-red-600 bg-red-50";
  }
}

function getTypeDotColor(type: string | null | undefined) {
  const t = (type || "Regular").toLowerCase();
  switch (t) {
    case "student":
      return "bg-blue-500";
    case "senior":
      return "bg-yellow-500";
    case "pwd":
      return "bg-emerald-500";
    case "regular":
    default:
      return "bg-red-500";
  }
}

// 🎨 Status filter -> dot color mapping (Active/Inactive/Blocked/Expired)
function getStatusDotColor(status: string) {
  switch (status) {
    case "Active":
      return "bg-emerald-500";
    case "Inactive":
      return "bg-slate-400";
    case "Blocked":
      return "bg-red-500";
    case "Expired":
      return "bg-orange-500";
    default:
      return "bg-slate-400";
  }
}

// 🎨 Role badge style (Commuter = cyan, Driver = violet)
function getRoleBadgeStyle(role: AuthRole, isDark: boolean) {
  if (role === "driver") {
    return isDark
      ? "text-violet-400 bg-violet-950/40 border-violet-900"
      : "text-violet-600 bg-violet-50 border-violet-200";
  }
  return isDark
    ? "text-cyan-400 bg-cyan-950/40 border-cyan-900"
    : "text-cyan-600 bg-cyan-50 border-cyan-200";
}

// 🪪 Card preview theming — accent color + label color per type, matching the physical card design
// 🔵 Regular = default navy/blue card (white text)
// ⚪ Discounted types (Student/Senior/PWD) = concessionary-style WHITE card (dark text)
function getCardTheme(type: string | null | undefined) {
  const t = (type || "Regular").toLowerCase();
  switch (t) {
    case "student":
      return {
        accent: "#2563eb",
        pattern: "#3b82f6",
        label: "STUDENT",
        cardBg: "#ffffff",
        textColor: "#0f172a",
        subTextColor: "#475569",
        uidColor: "#1b1f5c",
        isLight: true,
      };
    case "senior":
      return {
        accent: "#ca8a04",
        pattern: "#eab308",
        label: "SENIOR",
        cardBg: "#ffffff",
        textColor: "#0f172a",
        subTextColor: "#475569",
        uidColor: "#1b1f5c",
        isLight: true,
      };
    case "pwd":
      return {
        accent: "#059669",
        pattern: "#10b981",
        label: "PWD",
        cardBg: "#ffffff",
        textColor: "#0f172a",
        subTextColor: "#475569",
        uidColor: "#1b1f5c",
        isLight: true,
      };
    case "regular":
    default:
      return {
        accent: "#f87171",
        pattern: "#f97316",
        label: "REGULAR",
        cardBg: "#1b1f5c",
        textColor: "#ffffff",
        subTextColor: "rgba(255,255,255,0.7)",
        uidColor: "#5eead4",
        isLight: false,
      };
  }
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

// 🪪 Staircase chevron pattern used on the physical card face, built to mirror
// the printed card design (rows of nested arrows, descending left-to-right).
function ChevronStaircase({ color }: { color: string }) {
  const rows = 6;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: rows }).map((_, i) => {
        const offset = (rows - 1 - i) * 11; // % pushed in from the right per row
        return (
          <div
            key={i}
            className="absolute right-0 h-[15%] w-full"
            style={{ top: `${i * (100 / rows)}%`, transform: `translateX(${offset}%)` }}
          >
            {/* dashed accent rule on top of each step */}
            <div
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 10px, transparent 10px 16px)`,
              }}
            />
            {/* the chevron teeth themselves */}
            <div
              className="absolute inset-x-0 bottom-0 h-[70%] opacity-80"
              style={{
                backgroundImage: `repeating-linear-gradient(135deg, ${color}55 0px, ${color}55 7px, transparent 7px, transparent 14px), repeating-linear-gradient(45deg, ${color}55 0px, ${color}55 7px, transparent 7px, transparent 14px)`,
                backgroundSize: "28px 100%",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 🔒 LOCKED-SCALE CARD SYSTEM — same idea as the LTO LTMS Digital ID card.
//
// The card is authored ONCE at a fixed pixel canvas
// (CARD_DESIGN_WIDTH x CARD_DESIGN_HEIGHT). Every element inside uses
// fixed px values only — no breakpoints. That canvas is dropped into a
// responsive-width container and scaled with a single CSS
// `transform: scale(ratio)`, measured live via ResizeObserver.
//
// 📏 TRUE RFID / ID-1 (CR80) SIZE:
// 85.60 mm x 53.98 mm  (aspect ratio ≈ 1.586).
// The design canvas keeps this exact ratio, and the PDF export uses the
// same millimeters, so printing at 100% / "Actual size" gives a card that
// is exactly the size of a real RFID card.
// ═══════════════════════════════════════════════════════════════════════

// 📏 Real-world CR80 card size in millimeters (used for the PDF page size)
const CARD_MM_WIDTH = 85.6;
const CARD_MM_HEIGHT = 53.98;

const CARD_DESIGN_WIDTH = 700;
// Height derived from the real CR80 ratio → 700 x 441
const CARD_DESIGN_HEIGHT = Math.round((CARD_DESIGN_WIDTH * CARD_MM_HEIGHT) / CARD_MM_WIDTH); // 441

function useScaleToFit(designWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const w = el.offsetWidth;
      if (w > 0) setScale(w / designWidth);
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);

  return { containerRef, scale };
}

// 🔒 Renders a fixed-size, flippable card canvas that scales as one locked
// unit to fit whatever width its parent gives it.
function LockedFlipCard({
  flipped,
  onFlip,
  front,
  back,
}: {
  flipped: boolean;
  onFlip: () => void;
  front: React.ReactNode;
  back: React.ReactNode;
}) {
  const { containerRef, scale } = useScaleToFit(CARD_DESIGN_WIDTH);

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-pointer select-none"
      style={{ aspectRatio: `${CARD_DESIGN_WIDTH} / ${CARD_DESIGN_HEIGHT}` }}
      onClick={onFlip}
      role="button"
      tabIndex={0}
      aria-label="Flip card"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFlip();
        }
      }}
    >
      {/* Fixed-size design canvas, scaled as a single locked unit */}
      <div
        className="absolute top-0 left-0"
        style={{
          width: CARD_DESIGN_WIDTH,
          height: CARD_DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="card-flip-scene-locked">
          <div className={`card-flip-inner-locked ${flipped ? "is-flipped" : ""}`}>
            <div className="card-face-locked">{front}</div>
            <div className="card-face-locked card-face-back-locked">{back}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 🪪 CARD FACES — extracted into their own components so the flippable
// preview AND the hidden export layer (PNG / PDF download) render the
// EXACT same design.
//
// `withShadow={false}` → no drop shadow (so it isn't clipped in exports).
// `square={true}`      → square corners + no border. Used for exports so
//                        the PDF/PNG is a clean, full-bleed, print-ready
//                        rectangle (no white/black corners). The physical
//                        card cutter/printer handles the rounded corners.
// ═══════════════════════════════════════════════════════════════════════
function CardFront({
  user,
  withShadow = true,
  square = false,
}: {
  user: any;
  withShadow?: boolean;
  square?: boolean;
}) {
  const theme = getCardTheme(user.type);
  return (
    <div
      className={`${square ? "" : "rounded-2xl border"} overflow-hidden h-full w-full relative`}
      style={{
        backgroundColor: theme.cardBg,
        borderColor: square ? "transparent" : theme.isLight ? "#cbd5e1" : "transparent",
        boxShadow: !withShadow
          ? "none"
          : theme.isLight
          ? "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)"
          : "0 10px 25px -5px rgba(0,0,0,0.4), 0 4px 6px -2px rgba(0,0,0,0.2)",
      }}
    >
      <ChevronStaircase color={theme.pattern} />

      <div className="relative h-full w-full flex flex-col justify-between" style={{ padding: 32 }}>
        {/* ➕ small "Non-transferable" tag for discounted card types
            (Student/Senior/PWD). Absolutely positioned so the header row
            below keeps its exact position/size. */}
        {theme.isLight && (
          <div
            className="absolute uppercase font-bold text-center"
            style={{
              top: 10,
              left: 0,
              right: 0,
              fontSize: 15,
              letterSpacing: 0.5,
              color: theme.accent,
              lineHeight: 1.3,
            }}
          >
            Non-Transferable
          </div>
        )}

        {/* Header / logo badge */}
        <div className="flex items-center" style={{ gap: 16 }}>
          <div
            className="rounded-full border-2 flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{
              width: 66,
              height: 66,
              backgroundColor: theme.isLight ? "#f1f5f9" : "rgba(255,255,255,0.10)",
              borderColor: theme.isLight ? "#cbd5e1" : "rgba(255,255,255,0.30)",
            }}
          >
            <img src="/calbayog.png" alt="Calbayog" className="w-full h-full object-cover" />
          </div>
          <span
            className="font-bold tracking-wide uppercase"
            style={{ color: theme.textColor, fontSize: 23, lineHeight: 1.15 }}
          >
            Fare Collection System
          </span>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            className="font-mono font-extrabold tracking-wide"
            style={{ color: theme.uidColor, fontSize: 46, lineHeight: 1.1 }}
          >
            {user.cardUid}
          </div>
          <div
            className="font-semibold"
            style={{ color: theme.textColor, fontSize: 26, lineHeight: 1.2 }}
          >
            {user.fullName}
          </div>
        </div>

        {/* Footer row: type label (left) + valid until (right) */}
        <div className="flex items-end justify-between">
          <div
            className="font-extrabold tracking-wide"
            style={{ color: theme.accent, fontSize: 25, lineHeight: 1.1 }}
          >
            {theme.label}
          </div>
          <div className="text-right">
            <div
              className="uppercase tracking-wide font-semibold"
              style={{ color: theme.subTextColor, fontSize: 12, lineHeight: 1.3 }}
            >
              Valid Until
            </div>
            <div
              className="font-mono font-bold"
              style={{ color: theme.textColor, fontSize: 16, lineHeight: 1.3 }}
            >
              {formatDate(user.expirationDate)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardBack({
  withShadow = true,
  square = false,
}: {
  withShadow?: boolean;
  square?: boolean;
}) {
  return (
    <div
      className={`${square ? "" : "rounded-2xl border border-slate-300"} overflow-hidden bg-[#eceae4] flex flex-col h-full w-full`}
      style={{
        boxShadow: withShadow
          ? "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)"
          : "none",
      }}
    >
      <div style={{ height: "18%" }} className="bg-[#221f20] flex-shrink-0" />
      <div className="flex-1 min-h-0 flex flex-col" style={{ padding: "14px 30px" }}>
        <div
          className="bg-white border-y border-slate-300"
          style={{ padding: "8px 14px", marginBottom: 14 }}
        >
          <span className="font-extrabold text-slate-900" style={{ fontSize: 20 }}>
            Terms and Condition
          </span>
        </div>
        <ul
          className="text-slate-800 flex-1 min-h-0 overflow-hidden"
          style={{ fontSize: 14, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 4 }}
        >
          <li>• Property of the Fare Collection System Operator.</li>
          <li>• Non-transferable and subject to transit system rules.</li>
          <li>• Positive balance required to pass through.</li>
          <li>• Non-refundable card issuance fee applies.</li>
          <li>• Operator is not responsible for lost or stolen cards.</li>
          <li>• Unused balances on unregistered cards are non-refundable.</li>
          <li>• Tampering or unauthorized duplication is strictly prohibited.</li>
        </ul>
        <div
          className="flex items-center border-t border-slate-300"
          style={{ gap: 10, paddingTop: 10, marginTop: 6 }}
        >
          <div
            className="rounded-full bg-[#1b1f5c] flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ width: 40, height: 40 }}
          >
            <img src="/calbayog.png" alt="Calbayog" className="w-full h-full object-cover" />
          </div>
          <span
            className="font-extrabold tracking-wide text-slate-900 uppercase"
            style={{ fontSize: 16 }}
          >
            Fare Collection System
          </span>
        </div>
      </div>
    </div>
  );
}

// 📝 Initial/empty edit form. Region/province/city/barangay/zip are still
// stored (the API needs them), but they are filled by the single address
// search — there are no separate inputs for them anymore.
const EMPTY_EDIT_FORM = {
  fullName: "",
  dateOfBirth: "",
  // 📞 10 digits lang (pagkatapos ng +63), hal. "9171234567"
  contactNumber: "",
  streetAddress: "",
  regionCode: "",
  regionName: "",
  provinceCode: "",
  provinceName: "",
  cityCode: "",
  cityName: "",
  barangayCode: "",
  barangayName: "",
  zipCode: "",
  fullAddress: "",
  balance: "",
  status: "",
  type: "",
};

export default function UserManagementPage() {
  const { isDark } = useTheme();

  // 🔒 ADMIN ACCESS: `canManage` = false kapag view_only.
  // `loaded` = true kapag tapos na ma-load ang access info.
  const { canManage, loaded } = useAdminAccess();

  const [search, setSearch] = useState("");
  // 🧑‍🤝‍🧑 Role tab state (Commuter / Driver) — default ay Commuter
  const [roleTab, setRoleTab] = useState<RoleTab>("Commuter");
  const isDriverTab = roleTab === "Driver";
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All");
  // ➕ Status filter state (Active / Inactive / Blocked / Expired)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [previewUser, setPreviewUser] = useState<any>(null);
  const [previewFlipped, setPreviewFlipped] = useState(false);

  // ⬇️ card export (PNG / PDF) state + refs
  const [isExporting, setIsExporting] = useState<"png" | "pdf" | null>(null);
  const exportSheetRef = useRef<HTMLDivElement>(null); // front + back stacked (for PNG)
  const exportFrontRef = useRef<HTMLDivElement>(null); // front only (for PDF page 1)
  const exportBackRef = useRef<HTMLDivElement>(null); // back only (for PDF page 2)

  // ✅ Renew confirmation modal state — holds the user pending renewal
  const [renewUser, setRenewUser] = useState<any>(null);
  const [isRenewing, setIsRenewing] = useState(false);

  // ✅ Transfer-balance state — lost/stolen card: move full balance to a replacement card
  const [transferUser, setTransferUser] = useState<any>(null); // source (lost/stolen) card
  const [transferQuery, setTransferQuery] = useState("");
  const [transferTarget, setTransferTarget] = useState<any>(null); // replacement card
  const [transferReason, setTransferReason] = useState<(typeof TRANSFER_REASONS)[number]>("Lost Card");
  const [isTransferring, setIsTransferring] = useState(false);

  // 📟 Link Device ID sa driver
  const [deviceDriver, setDeviceDriver] = useState<{
    accountId: string;
    name: string;
    deviceId: string | null;
  } | null>(null);
  const [deviceInput, setDeviceInput] = useState("");
  const [isSavingDevice, setIsSavingDevice] = useState(false);

  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  // Snapshot of the form's values at the moment Edit was opened — used to
  // detect whether the user has actually changed anything before allowing Save.
  const [originalForm, setOriginalForm] = useState(EMPTY_EDIT_FORM);

  // 🔎 Flattened, searchable nationwide address list (same as Card Registration).
  // Loaded lazily the first time the Edit dialog opens, then reused.
  const [addressOptions, setAddressOptions] = useState<AddressSearchOption[]>([]);
  const [loadingAddressOptions, setLoadingAddressOptions] = useState(false);
  const addressLoadStartedRef = useRef(false);

  // 📮 True habang hinahanap pa ang ZIP pagkapili ng barangay.
  // Habang true, hindi pa lumalabas ang Full Address — para sabay na
  // mag-fill ang ZIP at ang buong address.
  const [resolvingAddress, setResolvingAddress] = useState(false);

  const [editIdImageFile, setEditIdImageFile] = useState<File | null>(null);
  const [editIdImagePreview, setEditIdImagePreview] = useState<string | null>(null);
  const [isUploadingEditImage, setIsUploadingEditImage] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 🔒 Safety guard helper — ginagamit sa lahat ng Edit/Delete/Renew/Transfer
  // handlers. Kapag view_only, magpapakita ng toast at ibabalik ang `true`
  // para mag-early return ang caller. Proteksyon ito kahit ma-bypass ang UI.
  const blockIfViewOnly = (): boolean => {
    if (canManage) return false;
    toast({
      title: "View Only Access",
      description: "You don't have permission to perform this action.",
      variant: "destructive",
    });
    return true;
  };

  const editInputCls = `h-9 text-sm ${isDark ? "bg-slate-950 border-slate-800 text-white placeholder:text-slate-600" : "bg-white border-slate-200"}`;

  /*
   * 🧑‍🤝‍🧑 DRIVER ACCOUNTS FROM public.auth_users
   * Kinukuha ang mga account na role = 'driver' (id, name, email, linked card).
   * Gumagamit ng ilike para tanggapin ang "driver", "Driver", "DRIVER".
   * Ginagamit ito para sa Drivers tab AT para malaman kung aling card sa
   * public.users ay driver (card_uid = linked_card_uid, o tugma ang email).
   */
  const {
    data: driverRows,
    refetch: refetchAuthRoles,
    isError: rolesError,
    isLoading: driversLoading,
  } = useQuery({
    queryKey: ["auth-users-drivers"],
    queryFn: async (): Promise<DriverAccountRow[]> => {
      // ✅ Una: RPC (security definer) — safe, kasi mga driver column lang
      // ang inilalabas at hindi na kailangan ng RLS policy sa auth_users.
      const rpc = await supabase.rpc("get_driver_accounts");

      if (!rpc.error) {
        return (rpc.data ?? []) as DriverAccountRow[];
      }

      console.warn("get_driver_accounts RPC failed, trying direct select:", rpc.error.message);

      // Fallback: direktang select (kailangan ng SELECT policy / RLS off)
      const { data, error } = await supabase
        .from("auth_users")
        .select("id, supabase_auth_id, full_name, email, linked_card_uid, device_id")
        .ilike("role", "driver")
        .order("full_name", { ascending: true });

      if (error) {
        console.error("Failed to load driver accounts from auth_users:", error);
        throw error;
      }

      return (data ?? []) as DriverAccountRow[];
    },
    refetchOnWindowFocus: true,
    retry: false,
  });

  // 📅 Ngayong araw (Asia/Manila) — nire-recompute kada render
  const dayRange = getManilaDayRange();

  /*
   * 💸 FARE TRANSACTIONS NG MGA DRIVER (public.transactions)
   * Kinukuha ang lahat ng transaction na may driver_id (paged by 1000 para
   * hindi maputol ng Supabase row limit). Ang top-up/refund ay hindi
   * isasama sa total — tingnan ang NON_FARE_TYPE_REGEX sa taas.
   */
  const {
    data: fareRows,
    refetch: refetchFares,
    isError: faresError,
    isLoading: faresLoading,
  } = useQuery({
    queryKey: ["driver-fare-transactions", dayRange.key],
    queryFn: async (): Promise<DriverFareRow[]> => {
      const pageSize = 1000;
      const all: DriverFareRow[] = [];

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("transactions")
          .select("id, driver_id, amount, type, status")
          .not("driver_id", "is", null)
          .gte("timestamp", dayRange.startISO)
          .lt("timestamp", dayRange.endISO)
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          console.error("Failed to load driver transactions:", error);
          throw error;
        }

        const batch = (data ?? []) as DriverFareRow[];
        all.push(...batch);

        if (batch.length < pageSize) break;
      }

      return all;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  /*
   * 📟 DEVICES NA MAY driver_id (public.devices)
   * Kapag in-activate ng driver ang device, na-se-set ang devices.driver_id.
   * Dito awtomatikong kinukuha ang Device ID para sa Drivers table —
   * hindi na kailangang mag-link nang manual.
   */
  const { data: deviceRows, refetch: refetchDevices } = useQuery({
    queryKey: ["driver-devices"],
    queryFn: async (): Promise<DeviceRow[]> => {
      const { data, error } = await supabase
        .from("devices")
        .select("device_id, name, status, driver_id, last_ping")
        .not("driver_id", "is", null)
        .order("last_ping", { ascending: false });

      if (error) {
        console.error("Failed to load devices:", error);
        throw error;
      }

      return (data ?? []) as DeviceRow[];
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Lookup sets: normalized card UIDs and lowercase emails ng mga driver
  const driverLookup = useMemo(() => {
    const uids = new Set<string>();
    const emails = new Set<string>();

    (driverRows ?? []).forEach((row) => {
      const uid = normalizeCardUid(row.linked_card_uid);
      if (uid) uids.add(uid);

      const email = String(row.email ?? "").trim().toLowerCase();
      if (email) emails.add(email);
    });

    return { uids, emails };
  }, [driverRows]);

  // Returns "driver" kapag naka-link sa driver account, kung hindi "commuter"
  const getUserRole = (user: any): AuthRole => {
    const uid = normalizeCardUid(user?.cardUid);
    if (uid && driverLookup.uids.has(uid)) return "driver";

    const email = normalizeEmail(user?.email)?.toLowerCase();
    if (email && driverLookup.emails.has(email)) return "driver";

    return "commuter";
  };

  // 💸 Total fare + bilang ng trips kada driver_id (normalized key)
  // ⚠️ Negative ang amount sa transactions (bawas sa commuter), kaya
  // Math.abs() ang ginagamit para positive ang total na nakolekta ng driver.
  const fareTotals = useMemo(() => {
    const totals = new Map<string, { total: number; count: number; rawId: string }>();

    (fareRows ?? []).forEach((row) => {
      const key = normalizeKey(row.driver_id);
      if (!key) return;

      // Tanggapin ang iba't ibang success status (Success / Completed / Paid)
      const status = String(row.status ?? "").trim().toLowerCase();
      if (!SUCCESS_STATUSES.includes(status)) return;

      // Huwag isama ang top-up / refund / cash-in
      if (NON_FARE_TYPE_REGEX.test(String(row.type ?? ""))) return;

      const amount = Math.abs(Number(row.amount));
      if (!Number.isFinite(amount)) return;

      const current = totals.get(key) ?? {
        total: 0,
        count: 0,
        rawId: String(row.driver_id ?? ""),
      };
      current.total += amount;
      current.count += 1;
      totals.set(key, current);
    });

    return totals;
  }, [fareRows]);

  // 🚌 Isang row kada driver: ID, Name, Email, Device ID, Today's Fare Collected
  // Tinatanggap ang driver_id kung tugma sa id, supabase_auth_id,
  // linked_card_uid, o email ng driver.
  // 📟 Ang Device ID ay AUTOMATIC galing sa public.devices (devices.driver_id);
  // fallback lang ang auth_users.device_id kung walang nahanap sa devices.
  // ➕ Kapag may driver_id sa transactions na walang katugmang driver account,
  // lalabas pa rin ito bilang "Unlinked driver" row para hindi mawala ang data.
  const driverSummaries = useMemo(() => {
    const usedKeys = new Set<string>();

    // 📟 key (driver_id) -> pinakabagong device (sorted na by last_ping desc)
    const deviceByKey = new Map<string, DeviceRow>();
    (deviceRows ?? []).forEach((d) => {
      const key = normalizeKey(d.driver_id);
      if (key && !deviceByKey.has(key)) deviceByKey.set(key, d);
    });

    // Lookup ng profile (pangalan/email) kada key — galing sa role=driver rows
    // at sa buong auth_users lookup ng mga driver_id sa transactions.
    const profileByKey = new Map<string, DriverAccountRow>();
    [...(driverRows ?? [])].forEach((row) => {
      [row.id, row.supabase_auth_id, row.linked_card_uid, row.email].forEach((k) => {
        const key = normalizeKey(k);
        if (key && !profileByKey.has(key)) profileByKey.set(key, row);
      });
    });

    const rows = (driverRows ?? []).map((driver) => {
      const keys = new Set(
        [driver.id, driver.supabase_auth_id, driver.linked_card_uid, driver.email]
          .map((k) => normalizeKey(k))
          .filter(Boolean)
      );

      let total = 0;
      let count = 0;
      let autoDevice: DeviceRow | undefined;

      keys.forEach((key) => {
        const entry = fareTotals.get(key);
        if (entry) {
          total += entry.total;
          count += entry.count;
          usedKeys.add(key);
        }

        const dev = deviceByKey.get(key);
        if (
          dev &&
          (!autoDevice ||
            new Date(dev.last_ping ?? 0).getTime() >
              new Date(autoDevice.last_ping ?? 0).getTime())
        ) {
          autoDevice = dev;
        }
      });

      return {
        id: String(driver.id ?? driver.supabase_auth_id ?? ""),
        accountId: driver.id ? String(driver.id) : (null as string | null),
        name: driver.full_name || "—",
        email: driver.email || "—",
        // ✅ Auto galing sa devices table; fallback sa auth_users.device_id
        deviceId: ((autoDevice as DeviceRow | undefined)?.device_id ?? driver.device_id ?? null) as string | null,
        deviceOnline:
          String((autoDevice as DeviceRow | undefined)?.status ?? "").toUpperCase() === "ONLINE",
        deviceAuto: !!autoDevice,
        totalFare: total,
        trips: count,
      };
    });

    // driver_id sa transactions na wala sa role=driver list: hanapin ang
    // pangalan/email sa auth_users; kung wala talaga, "Unlinked driver".
    fareTotals.forEach((entry, key) => {
      if (usedKeys.has(key)) return;

      const profile = profileByKey.get(key);
      const dev = deviceByKey.get(key);

      rows.push({
        id: entry.rawId,
        accountId: null,
        name: profile?.full_name || "Unlinked driver",
        email: profile?.email || "—",
        deviceId: (dev?.device_id ?? profile?.device_id ?? null) as string | null,
        deviceOnline: String(dev?.status ?? "").toUpperCase() === "ONLINE",
        deviceAuto: !!dev,
        totalFare: entry.total,
        trips: entry.count,
      });
    });

    return rows;
  }, [driverRows, fareTotals, deviceRows]);

  // ⚠️ Walang driver account na nabasa pero may fare rows → RLS ang dahilan
  const driversBlockedByRls =
    !driversLoading && !rolesError && (driverRows ?? []).length === 0 && (fareRows ?? []).length > 0;

  // 🧪 DEBUG: tingnan sa browser console (F12) kung ano ang dumarating.
  // Burahin ang useEffect na ito kapag gumana na.
  useEffect(() => {
    if (!driverRows || !fareRows) return;
    console.log("[Drivers] driver accounts:", driverRows);
    console.log("[Drivers] fare rows with driver_id:", fareRows.length, fareRows.slice(0, 5));
    console.log("[Drivers] devices with driver_id:", deviceRows);

    const known = new Set<string>();
    driverRows.forEach((d) =>
      [d.id, d.supabase_auth_id, d.linked_card_uid, d.email].forEach((k) => {
        const n = normalizeKey(k);
        if (n) known.add(n);
      })
    );

    const unmatched = new Set<string>();
    fareRows.forEach((r) => {
      const n = normalizeKey(r.driver_id);
      if (n && !known.has(n)) unmatched.add(String(r.driver_id));
    });

    if (unmatched.size > 0) {
      console.warn(
        "[Drivers] driver_id values that match NO driver account (role = driver) in auth_users:",
        Array.from(unmatched)
      );
    }

    const unmatchedDevices = (deviceRows ?? []).filter(
      (d) => !known.has(normalizeKey(d.driver_id))
    );
    if (unmatchedDevices.length > 0) {
      console.warn(
        "[Drivers] devices.driver_id values that match NO driver account:",
        unmatchedDevices.map((d) => ({ device_id: d.device_id, driver_id: d.driver_id }))
      );
    }
  }, [driverRows, fareRows, deviceRows]);

  // 🔎 Search sa Drivers tab: name / email / driver ID
  const driverFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return driverSummaries;

    return driverSummaries.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.email.toLowerCase().includes(q) ||
        (d.deviceId ?? "").toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
    );
  }, [driverSummaries, search]);

  const driversTotalFare = driverFiltered.reduce((sum, d) => sum + d.totalFare, 0);

  /*
   * LOAD ADDRESS DATA (once, the first time the Edit dialog opens)
   * Same data source as Card Registration: all PSGC regions, provinces,
   * cities/municipalities and barangays, flattened into one searchable list.
   */
  useEffect(() => {
    if (!editUser) return;
    if (addressLoadStartedRef.current) return;

    addressLoadStartedRef.current = true;
    let cancelled = false;

    async function loadAddressData() {
      try {
        setLoadingAddressOptions(true);

        const [regionsRaw, provincesRaw, citiesRaw, barangaysRaw] =
          await Promise.all([
            fetchPsgcRaw("/regions/"),
            fetchPsgcRaw("/provinces/"),
            fetchPsgcRaw("/cities-municipalities/"),
            fetchPsgcRaw("/barangays/"),
          ]);

        const regionsMap = new Map<string, any>();
        regionsRaw.forEach((r) => regionsMap.set(String(r?.code ?? ""), r));

        const provincesMap = new Map<string, any>();
        provincesRaw.forEach((p) =>
          provincesMap.set(String(p?.code ?? ""), p)
        );

        const citiesMap = new Map<string, any>();
        citiesRaw.forEach((c) => citiesMap.set(String(c?.code ?? ""), c));

        const options: AddressSearchOption[] = [];

        for (const b of barangaysRaw) {
          const barangayCode = String(b?.code ?? "");
          const barangayName = String(b?.name ?? "");

          if (!barangayCode || !barangayName) continue;

          const cityCode = String(b?.cityCode || b?.municipalityCode || "");
          const city = citiesMap.get(cityCode);

          const provinceCode = String(
            city?.provinceCode || b?.provinceCode || ""
          );
          const province = provincesMap.get(provinceCode);

          const regionCode = String(
            city?.regionCode || province?.regionCode || b?.regionCode || ""
          );
          const region = regionsMap.get(regionCode);

          const cityName = String(city?.name ?? "");
          const provinceName = String(province?.name ?? "");
          const regionName = String(region?.name ?? "");

          const label = [barangayName, cityName, provinceName, regionName]
            .filter(Boolean)
            .join(", ");

          options.push({
            code: barangayCode,
            label,
            regionCode,
            regionName,
            provinceCode,
            provinceName,
            cityCode,
            cityName,
            barangayCode,
            barangayName,
          });
        }

        if (!cancelled) {
          setAddressOptions(options);
        }
      } catch (error) {
        console.error("Failed to load address data:", error);

        // Allow a retry the next time the Edit dialog is opened.
        addressLoadStartedRef.current = false;

        if (!cancelled) {
          toast({
            title: "Unable to Load Addresses",
            description: "The Philippine address list could not be loaded.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingAddressOptions(false);
        }
      }
    }

    loadAddressData();

    return () => {
      cancelled = true;
      // If the dialog closed mid-load, let the next open start the load again.
      if (addressLoadStartedRef.current) {
        // only reset when the load did not finish
        setLoadingAddressOptions(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editUser]);

  /*
   * AUTO ZIP CODE
   * Tumatakbo LANG kapag may bagong napiling barangay (resolvingAddress = true),
   * kaya hindi ginagalaw ang saved ZIP/address pagkabukas ng Edit dialog.
   * Susubukan muna barangay + city + province, kung wala, city + province lang.
   *
   * Pagkatapos ng lookup (nahanap man o hindi, o nag-timeout), isang beses
   * lang itatakda ang ZIP + Full Address at papatayin ang loading — kaya
   * sabay na lalabas ang ZIP at ang buong Full Address.
   */
  useEffect(() => {
    if (!resolvingAddress) return;

    if (!editForm.barangayCode) {
      setResolvingAddress(false);
      return;
    }

    const controller = new AbortController();
    let cleanedUp = false;

    // ⏱️ Safety timeout: kapag mabagal ang Nominatim, itutuloy ang address
    // nang walang ZIP imbes na maiwang naka-loading.
    const timeoutId = setTimeout(
      () => controller.abort(),
      ZIP_LOOKUP_TIMEOUT_MS
    );

    (async () => {
      let zip = "";

      try {
        zip = await lookupZipCode(
          [editForm.barangayName, editForm.cityName, editForm.provinceName],
          controller.signal
        );

        if (!zip) {
          zip = await lookupZipCode(
            [editForm.cityName, editForm.provinceName],
            controller.signal
          );
        }
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          console.error("ZIP lookup failed:", error);
        }
      } finally {
        clearTimeout(timeoutId);

        // Kapag napalitan na ang napiling address (cleanup), huwag galawin.
        if (!cleanedUp) {
          // Isang batch lang: ZIP + Full Address + patay ang loading nang sabay.
          setEditForm((current) => ({
            ...current,
            zipCode: zip,
            fullAddress: buildFullAddress({
              streetAddress: current.streetAddress,
              barangayName: current.barangayName,
              cityName: current.cityName,
              provinceName: current.provinceName,
              regionName: current.regionName,
              zipCode: zip,
            }),
          }));
          setResolvingAddress(false);
        }
      }
    })();

    return () => {
      cleanedUp = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvingAddress, editForm.barangayCode]);

  // Reset the "resolving" state whenever the Edit dialog closes.
  useEffect(() => {
    if (!editUser) setResolvingAddress(false);
  }, [editUser]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter, roleTab]);

  // 🔎 Sa Drivers tab, client-side ang search (hindi na ipinapasa sa users API)
  const { data: users, isLoading, refetch: refetchUsers } = useListUsers(
    search && !isDriverTab ? { search } : undefined,
    {
      query: {
        refetchOnWindowFocus: true,
      },
    }
  );

  useRealtimeRefetch(["users"], () => {
    refetchUsers();
  });

  // 🧑‍🤝‍🧑 Refresh roles live when auth_users changes (link/unlink/role change)
  useRealtimeRefetch(["auth_users"], () => {
    refetchAuthRoles();
  });

  // 💸 Refresh total fare live kapag may bagong transaction
  useRealtimeRefetch(["transactions"], () => {
    refetchFares();
  });

  // 📟 Live update ng Device ID kapag may nag-activate/nag-deactivate na device
  useRealtimeRefetch(["devices"], () => {
    refetchDevices();
  });

  const userList = Array.isArray(users) ? users : [];

  // 🧑‍🤝‍🧑 Tab counts
  // Commuter = cards na hindi naka-link sa driver, Driver = bilang ng driver rows
  const driverCardCount = userList.filter((u: any) => getUserRole(u) === "driver").length;
  const roleCounts: Record<RoleTab, number> = {
    Commuter: userList.length - driverCardCount,
    Driver: driverSummaries.length,
  };

  // 🧑‍🤝‍🧑 Apply the role tab first — Commuter tab = cards na HINDI driver
  const roleFilteredList = userList.filter((u: any) => getUserRole(u) === "commuter");

  // Apply the type filter on top of the role tab
  const typeFilteredList =
    typeFilter === "All"
      ? roleFilteredList
      : roleFilteredList.filter(
          (u: any) => (u.type || "Regular").toLowerCase() === typeFilter.toLowerCase()
        );

  // ➕ Apply the status filter on top of the type filter.
  // "Expired" is derived from expirationDate rather than the raw status field,
  // so it's checked separately from the Active/Inactive/Blocked DB values.
  const filteredList =
    statusFilter === "All"
      ? typeFilteredList
      : statusFilter === "Expired"
      ? typeFilteredList.filter((u: any) => isCardExpired(u.expirationDate))
      : typeFilteredList.filter((u: any) => u.status === statusFilter);

  // 📄 Pagination — gumagana para sa cards (Commuter) at drivers (Driver tab)
  const activeCount = isDriverTab ? driverFiltered.length : filteredList.length;
  const totalPages = Math.max(1, Math.ceil(activeCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = filteredList.slice(startIndex, startIndex + PAGE_SIZE);
  const paginatedDrivers = driverFiltered.slice(startIndex, startIndex + PAGE_SIZE);

  const tableLoading = isDriverTab ? driversLoading : isLoading;

  // 🗂️ Tab strip definition (dalawang tab lang)
  const USER_TABS: PanelTab<RoleTab>[] = [
    { key: "Commuter", label: "Commuters", icon: UserRound, count: roleCounts.Commuter },
    { key: "Driver", label: "Drivers", icon: Bus, count: roleCounts.Driver },
  ];

  useEffect(() => {
    if (userList.length === 0) return;
    const topId = userList[0]?.id;

    if (prevTopIdRef.current !== null && topId !== prevTopIdRef.current) {
      setNewRowId(topId);
      setTimeout(() => setNewRowId(null), 800);
    }

    prevTopIdRef.current = topId;
    setLastUpdated(new Date());
  }, [userList]);

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditUser(null);
        toast({ title: <SuccessTitle text="User Updated Successfully" /> });
      },
    },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["auth-users-drivers"] });
        toast({ title: <SuccessTitle text="User Deleted Successfully" /> });
      },
    },
  });

  const openEdit = (user: any) => {
    // 🔒 Guard: bawal mag-edit kapag view_only
    if (blockIfViewOnly()) return;

    setEditUser(user);
    setResolvingAddress(false);

    const streetAddress = user.streetAddress || "";
    const regionName = user.regionName || "";
    const provinceName = user.provinceName || "";
    const cityName = user.cityName || "";
    const barangayName = user.barangayName || "";
    const zipCode = user.zipCode || "";

    // Use the saved full address; if the record has none, build it from the
    // saved pieces so the field is never empty for an existing address.
    const fullAddress =
      user.fullAddress ||
      buildFullAddress({
        streetAddress,
        barangayName,
        cityName,
        provinceName,
        regionName,
        zipCode,
      });

    const initial = {
      fullName: user.fullName || "",
      dateOfBirth: user.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : "",
      // 📞 Naka-save man bilang "09XXXXXXXXX" o "+639XXXXXXXXX", ginagawang
      // 10 digits (9XXXXXXXXX) para tumugma sa +63 prefix ng field.
      contactNumber: normalizePhContactDigits(user.contactNumber || ""),
      streetAddress,
      regionCode: user.regionCode || "",
      regionName,
      provinceCode: user.provinceCode || "",
      provinceName,
      cityCode: user.cityCode || "",
      cityName,
      barangayCode: user.barangayCode || "",
      barangayName,
      zipCode,
      fullAddress,
      balance: String(user.balance || 0),
      status: user.status || "",
      type: user.type || "Regular",
    };

    setEditForm(initial);
    setOriginalForm(initial);
    if (editIdImagePreview) URL.revokeObjectURL(editIdImagePreview);
    setEditIdImageFile(null);
    setEditIdImagePreview(null);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
  };

  /*
   * STREET ADDRESS CHANGED
   * Rebuilds the Full Address right away (same result as the auto-fill in
   * Card Registration). Hindi gumagana habang naghahanap pa ng ZIP.
   */
  const handleStreetChange = (value: string) => {
    setEditForm((current) => ({
      ...current,
      streetAddress: value,
      fullAddress: resolvingAddress
        ? current.fullAddress
        : buildFullAddress({
            streetAddress: value,
            barangayName: current.barangayName,
            cityName: current.cityName,
            provinceName: current.provinceName,
            regionName: current.regionName,
            zipCode: current.zipCode,
          }),
    }));
  };

  /*
   * ADDRESS SELECTED FROM THE SEARCHABLE COMBOBOX
   * Fills region/province/city/barangay all at once from a single pick.
   * Nire-reset ang ZIP at Full Address, tapos magsisimula ang loading
   * hanggang makuha ang ZIP.
   */
  const handleAddressSelect = (option: AddressSearchOption) => {
    // Kapag parehong barangay ang pinili ulit, walang gagawin.
    if (option.barangayCode === editForm.barangayCode) return;

    setResolvingAddress(true);

    setEditForm((current) => ({
      ...current,

      zipCode: "",
      fullAddress: "",

      regionCode: option.regionCode,
      regionName: option.regionName,

      provinceCode: option.provinceCode,
      provinceName: option.provinceName,

      cityCode: option.cityCode,
      cityName: option.cityName,

      barangayCode: option.barangayCode,
      barangayName: option.barangayName,
    }));
  };

  // IMPORTANT: selecting a new ID image is itself an edit.
  // This allows "image only" changes to enable Save Changes.
  const hasImageChange = editIdImageFile !== null;

  const hasChanges =
    editForm.fullName !== originalForm.fullName ||
    editForm.dateOfBirth !== originalForm.dateOfBirth ||
    editForm.contactNumber !== originalForm.contactNumber ||
    editForm.streetAddress !== originalForm.streetAddress ||
    editForm.regionCode !== originalForm.regionCode ||
    editForm.regionName !== originalForm.regionName ||
    editForm.provinceCode !== originalForm.provinceCode ||
    editForm.provinceName !== originalForm.provinceName ||
    editForm.cityCode !== originalForm.cityCode ||
    editForm.cityName !== originalForm.cityName ||
    editForm.barangayCode !== originalForm.barangayCode ||
    editForm.barangayName !== originalForm.barangayName ||
    editForm.zipCode !== originalForm.zipCode ||
    editForm.fullAddress !== originalForm.fullAddress ||
    hasImageChange;

  // True while the edit is uploading an image or saving to the API
  const isSavingEdit = isUploadingEditImage || updateMutation.isPending;

  const handleEditImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid File",
        description: "Please select an image file.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    if (file.size > MAX_ID_IMAGE_SIZE) {
      toast({
        title: "Image Too Large",
        description: "The ID image must be 5 MB or smaller.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    // Revoke only the previous local preview. Do NOT touch the current
    // Supabase image. The old Storage object is deleted by the
    // cleanup-id-images Edge Function after the DB row is updated.
    if (editIdImagePreview) URL.revokeObjectURL(editIdImagePreview);

    setEditIdImageFile(file);
    setEditIdImagePreview(URL.createObjectURL(file));

    // Reset the input so selecting the SAME file again still fires onChange.
    event.target.value = "";
  };

  const clearEditImage = () => {
    if (editIdImagePreview) URL.revokeObjectURL(editIdImagePreview);
    setEditIdImageFile(null);
    setEditIdImagePreview(null);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
  };

  const uploadEditedIdImage = async (user: any): Promise<string | null> => {
    if (!editIdImageFile) return null;

    const safeUid = String(user.cardUid || user.card_uid || user.id)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeUid) throw new Error("Invalid card identifier.");

    const extension = editIdImageFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const filePath = `${safeUid}/edited-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;

    const { error } = await supabase.storage.from(ID_IMAGE_BUCKET).upload(filePath, editIdImageFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: editIdImageFile.type,
    });
    if (error) throw new Error(error.message || "Failed to upload ID image.");

    const { data } = supabase.storage.from(ID_IMAGE_BUCKET).getPublicUrl(filePath);
    if (!data?.publicUrl) {
      await supabase.storage.from(ID_IMAGE_BUCKET).remove([filePath]);
      throw new Error("Uploaded image URL could not be generated.");
    }
    return data.publicUrl;
  };

  const handleUpdate = async () => {
    // 🔒 Guard: bawal mag-save ng edit kapag view_only
    if (blockIfViewOnly()) return;

    if (!editUser || !hasChanges || resolvingAddress) return;

    // 📞 10 digits lang ang laman ng field (pagkatapos ng +63)
    const contactDigits = normalizePhContactDigits(editForm.contactNumber);

    // PH mobile: +63 9XX XXX XXXX → 10 digits, nagsisimula sa 9
    if (!/^9\d{9}$/.test(contactDigits)) {
      toast({
        title: "Invalid Contact Number",
        description:
          "Enter a valid PH mobile number: 10 digits starting with 9 (e.g. +63 9123456789).",
        variant: "destructive",
      });
      return;
    }

    // Final na format na ipapadala: +639XXXXXXXXX
    const normalizedContactNumber = `${PH_COUNTRY_CODE}${contactDigits}`;

    // Keep the state normalized before saving.
    if (editForm.contactNumber !== contactDigits) {
      setEditForm((current) => ({ ...current, contactNumber: contactDigits }));
    }

    const replacingImage = !!editIdImageFile;
    let newImageUrl: string | null = null;

    setIsUploadingEditImage(replacingImage);

    try {
      // 1. Upload the replacement first.
      // Keep the OLD image in Storage until the database update succeeds.
      newImageUrl = replacingImage
        ? await uploadEditedIdImage(editUser)
        : null;

      // Uses the (auto-filled, but user-editable) Full Address textarea.
      // Falls back to a freshly built string if the textarea was cleared.
      const fullAddress =
        editForm.fullAddress.trim() ||
        buildFullAddress({
          streetAddress: editForm.streetAddress,
          barangayName: editForm.barangayName,
          cityName: editForm.cityName,
          provinceName: editForm.provinceName,
          regionName: editForm.regionName,
          zipCode: editForm.zipCode,
        });

      // 2. WAIT for the database update to finish successfully.
      // mutateAsync makes sure we only clear local state after the DB write.
      await updateMutation.mutateAsync({
        id: editUser.id,
        data: {
          fullName: editForm.fullName.trim(),
          // 📞 Naka +63 na (hal. +639123456789)
          contactNumber: normalizedContactNumber,
          dateOfBirth: editForm.dateOfBirth || undefined,
          streetAddress: editForm.streetAddress.trim() || undefined,
          regionCode: editForm.regionCode || undefined,
          regionName: editForm.regionName.trim() || undefined,
          provinceCode: editForm.provinceCode || undefined,
          provinceName: editForm.provinceName.trim() || undefined,
          cityCode: editForm.cityCode || undefined,
          cityName: editForm.cityName.trim() || undefined,
          barangayCode: editForm.barangayCode || undefined,
          barangayName: editForm.barangayName.trim() || undefined,
          zipCode: editForm.zipCode.trim() || undefined,
          fullAddress: fullAddress || undefined,

          // Only send idImagePath when a NEW image was actually selected.
          // If no image was selected, the existing DB image is preserved.
          ...(newImageUrl ? { idImagePath: newImageUrl } : {}),
        },
      });

      // 3. DB update succeeded.
      // ✅ Old ID image cleanup is handled SERVER-SIDE by the
      // "cleanup-id-images" Supabase Edge Function (Database Webhook on
      // UPDATE/DELETE). It uses the service role key, so no Storage DELETE
      // policy is needed on the client anymore.

      // Clear the selected local file/preview only after the DB update succeeds.
      if (editIdImagePreview) {
        URL.revokeObjectURL(editIdImagePreview);
      }

      setEditIdImageFile(null);
      setEditIdImagePreview(null);

      if (editFileInputRef.current) {
        editFileInputRef.current.value = "";
      }
    } catch (error: any) {
      console.error("Edit user/image update error:", error);

      // IMPORTANT:
      // If the NEW image was uploaded but the DB update failed,
      // delete the NEW orphaned image instead.
      // The OLD image is intentionally kept because it is still the active one.
      if (newImageUrl) {
        const newImagePath = getIdImageStoragePath(newImageUrl);

        if (newImagePath) {
          const { error: cleanupError } = await supabase
            .storage
            .from(ID_IMAGE_BUCKET)
            .remove([newImagePath]);

          if (cleanupError) {
            console.error(
              "Failed to clean up newly uploaded ID image:",
              cleanupError
            );
          }
        }
      }

      toast({
        title: "Failed to update user",
        description:
          error?.message || "Unable to update the user or ID image.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingEditImage(false);
    }
  };

  // ✅ Deleting the user row is enough — the "cleanup-id-images" Edge Function
  // (Database Webhook on DELETE) removes the card's ID images from the
  // id-verifications bucket automatically.
  const confirmDelete = () => {
    // 🔒 Guard: bawal mag-delete kapag view_only
    if (blockIfViewOnly()) {
      setDeleteUser(null);
      return;
    }

    if (!deleteUser) return;
    deleteMutation.mutate(
      { id: deleteUser.id },
      { onSettled: () => setDeleteUser(null) },
    );
  };

  // 📟 Buksan ang Link Device dialog para sa isang driver
  const openDeviceLink = (driver: { accountId: string | null; name: string; deviceId: string | null }) => {
    if (blockIfViewOnly()) return;
    if (!driver.accountId) return;
    setDeviceDriver({ accountId: driver.accountId, name: driver.name, deviceId: driver.deviceId });
    setDeviceInput(driver.deviceId ?? "");
  };

  // 📟 I-save (link/palitan) o i-unlink (walang laman) ang device ID ng driver
  const saveDeviceLink = async (unlink = false) => {
    if (blockIfViewOnly()) {
      setDeviceDriver(null);
      return;
    }
    if (!deviceDriver) return;

    const value = unlink ? "" : deviceInput.trim();

    if (!unlink && !value) {
      toast({
        title: "Device ID required",
        description: "Enter the device ID to link, or use Unlink to remove it.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingDevice(true);

    const { error } = await supabase.rpc("link_driver_device", {
      p_driver_id: deviceDriver.accountId,
      p_device_id: value,
    });

    setIsSavingDevice(false);

    if (error) {
      console.error("Link device error:", error);
      const duplicate = /duplicate|unique/i.test(error.message || "");
      toast({
        title: unlink ? "Failed to unlink device" : "Failed to link device",
        description: duplicate
          ? "This device ID is already linked to another driver."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    await Promise.all([refetchAuthRoles(), refetchDevices()]);
    setDeviceDriver(null);
    toast({
      title: <SuccessTitle text={unlink ? "Device Unlinked" : "Device Linked Successfully"} />,
    });
  };

  // ✅ Opens the renewal confirmation dialog for a given user.
  // 🚫➕ GUARD: if the card hasn't expired yet, renewal is blocked here too
  // (on top of the disabled buttons) — the dialog simply won't open, and the
  // user gets a toast explaining why.
  const openRenew = (user: any) => {
    // 🔒 Guard: bawal mag-renew kapag view_only
    if (blockIfViewOnly()) return;

    if (!isCardExpired(user.expirationDate)) {
      toast({
        title: "Card is still valid",
        description: `This card is valid until ${formatDate(user.expirationDate)}. It can only be renewed after it expires.`,
        variant: "destructive",
      });
      return;
    }
    setRenewUser(user);
  };

  // ✅ confirmRenew — direktang tumatawag sa renew_card() Postgres function
  // sa pamamagitan ng Supabase RPC. Ang function mismo (sa DB) ang gumagawa
  // ng +1 year math at nag-eextend mula sa GREATEST(current_expiration, now()).
  // 🚫➕ GUARD: final safety check right before the RPC call.
  const confirmRenew = async () => {
    // 🔒 Guard: bawal mag-confirm ng renewal kapag view_only
    if (blockIfViewOnly()) {
      setRenewUser(null);
      return;
    }

    if (!renewUser) return;

    if (!isCardExpired(renewUser.expirationDate)) {
      toast({
        title: "Card is still valid",
        description: `This card is valid until ${formatDate(renewUser.expirationDate)}. It can only be renewed after it expires.`,
        variant: "destructive",
      });
      setRenewUser(null);
      return;
    }

    setIsRenewing(true);

    const { error } = await supabase.rpc("renew_card", {
      p_card_id: renewUser.id,
    });

    setIsRenewing(false);

    if (error) {
      console.error("Renew card error:", error);
      toast({ title: "Failed to renew card", variant: "destructive" });
      return;
    }

    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    setRenewUser(null);
    toast({ title: <SuccessTitle text="Card Renewed Successfully" /> });
  };

  // ✅ Opens the transfer-balance dialog for a given user (the lost/stolen card).
  // 🚫➕ GUARD: a card with zero balance has nothing to transfer.
  const openTransfer = (user: any) => {
    // 🔒 Guard: bawal mag-transfer kapag view_only
    if (blockIfViewOnly()) return;

    if ((user.balance || 0) <= 0) {
      toast({
        title: "Nothing to transfer",
        description: "This card has a zero balance.",
        variant: "destructive",
      });
      return;
    }
    setTransferUser(user);
    setTransferQuery("");
    setTransferTarget(null);
    setTransferReason("Lost Card");
  };

  // ➕ Live search suggestions for the replacement card — Active cards only,
  // excludes the source card itself, matches on UID or full name.
  const transferCandidates = transferUser
    ? userList
        .filter((u: any) => u.id !== transferUser.id && u.status === "Active")
        .filter((u: any) => {
          if (!transferQuery.trim()) return true;
          const q = transferQuery.trim().toLowerCase();
          return (
            u.cardUid?.toLowerCase().includes(q) ||
            u.fullName?.toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];

  // ✅ Inserting a row into card_balance_transfers is enough — the
  // trg_process_balance_transfer BEFORE INSERT trigger (Postgres, source of
  // truth) locks both card rows, moves the full source balance onto the
  // target card, and marks the source card as Blocked. We just read back
  // the completed row for the confirmation toast.
  const confirmTransfer = async () => {
    // 🔒 Guard: bawal mag-confirm ng transfer kapag view_only
    if (blockIfViewOnly()) {
      setTransferUser(null);
      return;
    }

    if (!transferUser || !transferTarget) return;

    setIsTransferring(true);

    const { data, error } = await supabase
      .from("card_balance_transfers")
      .insert({
        source_card_id: transferUser.id,
        target_card_id: transferTarget.id,
        reason: transferReason,
      })
      .select()
      .single();

    setIsTransferring(false);

    if (error) {
      console.error("Transfer balance error:", error);
      toast({
        title: "Failed to transfer balance",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    setTransferUser(null);
    toast({
      title: <SuccessTitle text="Balance Transferred Successfully" />,
      description: `${formatPeso(data?.amount ?? transferUser.balance ?? 0)} moved to ${transferTarget.cardUid}. Old card is now blocked.`,
    });
  };

  // ═══════════════════════════════════════════════════════════════════
  // ⬇️ CARD EXPORT (PNG + PDF)
  //
  // Hindi tayo nagca-capture mula sa mismong preview, kasi may scale()
  // transform at 3D flip (backface-visibility) doon — madalas blangko o
  // salamin ang lalabas. Sa halip, may hidden, unscaled, non-flipped
  // export layer (sa dulo ng page) na 700x441 ang bawat side (CR80 ratio),
  // at iyon ang kina-capture.
  //
  // 📏 PDF: page size = eksaktong 85.6 x 53.98 mm (totoong RFID/ID-1 card).
  // I-print sa 100% / "Actual size" (huwag "Fit to page") para sakto.
  // ═══════════════════════════════════════════════════════════════════
  const capture = (el: HTMLElement, width: number, height: number) =>
    toPng(el, { pixelRatio: 4, cacheBust: true, width, height });

  const triggerDownload = (href: string, filename: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportFileBase = () =>
    `card-${String(previewUser?.cardUid ?? "design").replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // 🖼 PNG — front + back stacked in one image
  const downloadCardImage = async () => {
    if (!previewUser || !exportSheetRef.current) return;
    setIsExporting("png");
    try {
      const el = exportSheetRef.current;
      await capture(el, el.offsetWidth, el.offsetHeight); // warm-up: makes sure images/fonts are loaded
      const dataUrl = await capture(el, el.offsetWidth, el.offsetHeight);
      triggerDownload(dataUrl, `${exportFileBase()}.png`);
    } catch (error) {
      console.error("Card image export error:", error);
      toast({ title: "Failed to export image", variant: "destructive" });
    } finally {
      setIsExporting(null);
    }
  };

  // 📄 PDF — page 1 = front, page 2 = back, each page EXACTLY 85.6 x 53.98 mm
  const downloadCardPdf = async () => {
    if (!previewUser || !exportFrontRef.current || !exportBackRef.current) return;
    setIsExporting("pdf");
    try {
      const W = CARD_DESIGN_WIDTH;
      const H = CARD_DESIGN_HEIGHT;
      await capture(exportFrontRef.current, W, H); // warm-up
      const front = await capture(exportFrontRef.current, W, H);
      const back = await capture(exportBackRef.current, W, H);

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: [CARD_MM_WIDTH, CARD_MM_HEIGHT],
        compress: true,
      });
      pdf.addImage(front, "PNG", 0, 0, CARD_MM_WIDTH, CARD_MM_HEIGHT);
      pdf.addPage([CARD_MM_WIDTH, CARD_MM_HEIGHT], "landscape");
      pdf.addImage(back, "PNG", 0, 0, CARD_MM_WIDTH, CARD_MM_HEIGHT);
      pdf.save(`${exportFileBase()}.pdf`);
    } catch (error) {
      console.error("Card PDF export error:", error);
      toast({ title: "Failed to export PDF", variant: "destructive" });
    } finally {
      setIsExporting(null);
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  // SEARCH + FILTER BAR — rendered inside the section header, next to the
  // title (same spot the Year/Month/Day filter sits on the Reports page).
  // Type + Status filters are for the Commuters tab only.
  // ══════════════════════════════════════════════════════════════════════
  const renderFilterBar = () => (
    <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full sm:w-auto items-stretch sm:items-center">
      <div className="relative w-full sm:w-72">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
        <Input
          placeholder={isDriverTab ? "Search driver name, email, ID or device..." : "Search UID or name..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`pl-10 font-medium text-sm h-10 focus-visible:ring-blue-500 ${
            isDark
              ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
              : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
          }`}
        />
      </div>

      {/* Type + Status filters — para sa cards lang (hindi sa Drivers tab) */}
      {!isDriverTab && (
        <>
          {/* Type filter */}
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as (typeof TYPE_FILTERS)[number])}>
            <SelectTrigger
              className={`h-10 w-full sm:w-40 text-sm font-medium cursor-pointer ${
                isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"
              }`}
            >
              <span className="flex items-center gap-2">
                {typeFilter !== "All" && (
                  <span className={`w-2 h-2 rounded-full inline-block ${getTypeDotColor(typeFilter)}`} />
                )}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
              {TYPE_FILTERS.map((t) => (
                <SelectItem key={t} value={t} className="cursor-pointer">
                  <span className="flex items-center gap-2">
                    {t !== "All" && (
                      <span className={`w-2 h-2 rounded-full inline-block ${getTypeDotColor(t)}`} />
                    )}
                    {t}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* ➕ Status filter — Active / Inactive / Blocked / Expired */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as (typeof STATUS_FILTERS)[number])}>
            <SelectTrigger
              className={`h-10 w-full sm:w-40 text-sm font-medium cursor-pointer ${
                isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"
              }`}
            >
              <span className="flex items-center gap-2">
                {statusFilter !== "All" && (
                  <span className={`w-2 h-2 rounded-full inline-block ${getStatusDotColor(statusFilter)}`} />
                )}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s} className="cursor-pointer">
                  <span className="flex items-center gap-2">
                    {s !== "All" && (
                      <span className={`w-2 h-2 rounded-full inline-block ${getStatusDotColor(s)}`} />
                    )}
                    {s}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );

  return (
    <div className={`rp-page space-y-8 h-full min-w-0 flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`} data-testid="users-page">
      <style>{USERS_PANEL_CSS}</style>
      <style>{`
        @keyframes row-pulse {
          0% { background-color: transparent; }
          50% { background-color: rgba(37,99,235,0.08); }
          100% { background-color: transparent; }
        }
        .row-pulse { animation: row-pulse 0.8s ease-in-out; }

        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }

        /* 🔒 Locked-scale flip card — see LockedFlipCard component above.
           The design canvas itself never reflows; only the outer wrapper's
           transform: scale(...) changes, in a single React inline style. */
        .card-flip-scene-locked {
          position: relative;
          width: 100%;
          height: 100%;
          perspective: 1600px;
        }
        .card-flip-inner-locked {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1);
          transform-style: preserve-3d;
        }
        .card-flip-inner-locked.is-flipped { transform: rotateY(180deg); }
        .card-face-locked {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .card-face-back-locked { transform: rotateY(180deg); }

        /* ✅ Edit form: always-visible, draggable side scrollbar */
        .edit-sidebar-scroll {
          overflow-y: scroll;                  /* scrollbar track is always shown */
          overflow-x: hidden;
          overscroll-behavior: contain;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          padding-right: 10px;
          scrollbar-width: auto;               /* Firefox */
          scrollbar-color: var(--sb-thumb) var(--sb-track);
        }
        .edit-sidebar-scroll::-webkit-scrollbar { width: 12px; }
        .edit-sidebar-scroll::-webkit-scrollbar-track {
          background: var(--sb-track);
          border-radius: 9999px;
        }
        .edit-sidebar-scroll::-webkit-scrollbar-thumb {
          background: var(--sb-thumb);
          border-radius: 9999px;
          border: 3px solid transparent;
          background-clip: padding-box;
        }
        .edit-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--sb-thumb-hover);
          background-clip: padding-box;
        }
        @media (prefers-reduced-motion: reduce) {
          .edit-sidebar-scroll { scroll-behavior: auto; }
        }

        /* Windowed address list (same as Card Registration) */
        .location-combobox-list {
          scrollbar-width: thin;
          will-change: scroll-position;
          transform: translateZ(0);
          -webkit-overflow-scrolling: touch;
        }
        .location-combobox-list::-webkit-scrollbar { width: 6px; }
        .location-combobox-list::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.4);
          border-radius: 9999px;
        }
      `}</style>

      {/* Header */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <Users className="text-blue-500" size={26} />
            User Management
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Manage cardholder credentials and wallet balances
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

      {/* ══ ONE MASTER CONTAINER ══
          Tab strip (Commuters / Drivers) + body live inside a single
          shadowed panel — same structure as the Reports page. Switching
          tabs only swaps what's inside the body. */}
      <ReportsPanel tabs={USER_TABS} active={roleTab} onChange={setRoleTab} isDark={isDark}>

        {/* ⚠️ Shows only if the driver accounts couldn't be read from auth_users (RLS / permissions) */}
        {rolesError && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium ${
              isDark
                ? "bg-orange-950/30 border-orange-900 text-orange-400"
                : "bg-orange-50 border-orange-200 text-orange-700"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Couldn't read driver accounts from auth_users — all cards are shown as Commuters. Run the get_driver_accounts() SQL function (or add a SELECT policy on public.auth_users).
          </div>
        )}

        {/* ⚠️ Walang nabasang driver account (karaniwang RLS — walang error pero walang laman) */}
        {driversBlockedByRls && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium ${
              isDark
                ? "bg-orange-950/30 border-orange-900 text-orange-400"
                : "bg-orange-50 border-orange-200 text-orange-700"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            No driver accounts could be read, so names and emails can't be shown. Create the get_driver_accounts() SQL function.
          </div>
        )}

        {/* ⚠️ Shows only in the Drivers tab if transactions couldn't be read */}
        {isDriverTab && faresError && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium ${
              isDark
                ? "bg-orange-950/30 border-orange-900 text-orange-400"
                : "bg-orange-50 border-orange-200 text-orange-700"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Couldn't read public.transactions — Today's Fare Collected will show ₱0.00. Check the SELECT policy (RLS) on public.transactions.
          </div>
        )}

        <ReportSection
          title={isDriverTab ? "Drivers" : "Commuter Card Holders"}
          icon={isDriverTab ? Bus : UserRound}
          iconClassName={isDriverTab ? "text-violet-500" : "text-cyan-500"}
          filterBar={renderFilterBar()}
          meta={
            <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${
              isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
            }`}>
              <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
              LIVE
            </span>
          }
        >
          {tableLoading ? (
            <div className="space-y-4">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className={`h-16 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 560, overflow: "auto" }}>
                {isDriverTab ? (
                  <>
                    {/* 💸 Summary strip — total fare ng lahat ng drivers na nakikita */}
                    <div className="rp-well mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Bus className="h-4 w-4 text-violet-500" />
                        <span className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {driverFiltered.length} {driverFiltered.length === 1 ? "driver" : "drivers"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          Today's Fare Collected
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded border text-sm ${
                            isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                          }`}
                        >
                          <Wallet className="w-3.5 h-3.5" />
                          {faresLoading ? "Loading..." : formatPeso(driversTotalFare)}
                        </span>
                      </div>
                    </div>

                    {/* 🚌 DRIVERS TABLE — Driver ID, Name, Email, Device ID, Today's Fare Collected */}
                    <Table>
                      <TableHeader className={`rp-sticky-head border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                        <TableRow className="border-none hover:bg-transparent">
                          <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Driver ID</TableHead>
                          <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Driver Name</TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                            <span className="flex items-center gap-1"><Mail size={10} /> Email</span>
                          </TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-cyan-500">
                            <span className="flex items-center gap-1"><Cpu size={10} /> Device ID</span>
                          </TableHead>
                          <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-emerald-500" : "text-emerald-600"}`}>
                            Today's Fare Collected
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedDrivers.length > 0 ? (
                          paginatedDrivers.map((driver) => (
                            <TableRow
                              key={driver.id || driver.email}
                              className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"}`}
                            >
                              <TableCell className="font-mono text-xs text-violet-500 font-semibold">
                                <span className="block max-w-[260px] truncate" title={driver.id}>
                                  {driver.id || "—"}
                                </span>
                              </TableCell>

                              <TableCell>
                                <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                                  {driver.name}
                                </span>
                              </TableCell>

                              <TableCell>
                                <span className="flex items-center gap-1 text-xs text-blue-500 font-mono">
                                  <Mail className="w-3 h-3 flex-shrink-0" />
                                  {driver.email}
                                </span>
                              </TableCell>

                              {/* 📟 Device ID — awtomatiko galing sa devices table kapag na-activate ng driver */}
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {driver.deviceId ? (
                                    <span
                                      className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2 py-0.5 rounded border max-w-[180px] ${
                                        isDark ? "text-cyan-400 bg-cyan-950/40 border-cyan-900" : "text-cyan-700 bg-cyan-50 border-cyan-200"
                                      }`}
                                      title={`${driver.deviceId}${driver.deviceAuto ? (driver.deviceOnline ? " • Online" : " • Offline") : ""}`}
                                    >
                                      {driver.deviceAuto ? (
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                                            driver.deviceOnline ? "bg-emerald-500 realtime-dot" : "bg-slate-400"
                                          }`}
                                        />
                                      ) : (
                                        <Cpu className="w-3 h-3 flex-shrink-0" />
                                      )}
                                      <span className="truncate">{driver.deviceId}</span>
                                    </span>
                                  ) : (
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                                        isDark ? "text-slate-500 bg-slate-800 border-slate-700" : "text-slate-400 bg-slate-100 border-slate-200"
                                      }`}
                                    >
                                      <Cpu size={9} /> Not linked
                                    </span>
                                  )}

                                  {/* Manual link/edit: para lang kung WALANG auto-detected device */}
                                  {canManage && driver.accountId && !driver.deviceAuto && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openDeviceLink(driver)}
                                      className={`h-7 w-7 cursor-pointer ${isDark ? "text-cyan-400 hover:bg-cyan-950/40" : "text-cyan-600 hover:bg-cyan-50"}`}
                                      title={driver.deviceId ? "Change / unlink device" : "Link device"}
                                    >
                                      {driver.deviceId ? <Pencil className="w-3 h-3" /> : <LinkIcon className="w-3 h-3" />}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="text-right">
                                <div className="flex flex-col items-end gap-0.5">
                                  <span
                                    className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded border text-xs ${
                                      isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                                    }`}
                                  >
                                    <Wallet className="w-3 h-3" />
                                    {formatPeso(driver.totalFare)}
                                  </span>
                                  <span className={`text-[10px] font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                                    {driver.trips} {driver.trips === 1 ? "fare" : "fares"} today
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className={`text-center py-20 uppercase font-semibold tracking-widest text-xs ${isDark ? "text-slate-700" : "text-slate-300"}`}
                            >
                              No drivers found
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </>
                ) : (
                <Table>
                  <TableHeader className={`rp-sticky-head border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card UID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Full Name</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        <span className="flex items-center gap-1">
                          <Phone size={10} /> Contact No.
                        </span>
                      </TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                        <span className="flex items-center gap-1"><LinkIcon size={10} /> Linked Account</span>
                      </TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Type</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-emerald-500" : "text-emerald-600"}`}>Balance</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        <span className="flex items-center gap-1">
                          <CalendarClock size={10} /> Valid Until
                        </span>
                      </TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length > 0 ? (
                      paginatedList.map((user) => {
                        const linkedEmail = normalizeEmail(user.email);
                        const expired = isCardExpired(user.expirationDate);
                        const userRole = getUserRole(user);
                        return (
                          <TableRow
                            key={user.id}
                            className={`transition-colors ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                              newRowId === user.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                              {user.cardUid}
                            </TableCell>

                            <TableCell>
                              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                                {user.fullName}
                              </span>
                            </TableCell>

                            <TableCell>
                              <span className={`inline-flex items-center gap-1.5 text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                                <Phone className={`w-3 h-3 flex-shrink-0 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                                {user.contactNumber || (
                                  <span className={`italic text-[11px] ${isDark ? "text-slate-600" : "text-slate-300"}`}>—</span>
                                )}
                              </span>
                            </TableCell>

                            <TableCell>
                              {linkedEmail ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${
                                      isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                                    }`}>
                                      <LinkIcon size={8} /> Linked
                                    </span>
                                    {/* 🧑‍🤝‍🧑 Role badge (Commuter / Driver) */}
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${getRoleBadgeStyle(userRole, isDark)}`}>
                                      {userRole === "driver" ? <Bus size={8} /> : <UserRound size={8} />}
                                      {userRole}
                                    </span>
                                  </div>
                                  <span className="flex items-center gap-1 text-xs text-blue-500 font-mono">
                                    <Mail className="w-3 h-3 flex-shrink-0" />
                                    {linkedEmail}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${
                                      isDark ? "text-slate-500 bg-slate-800 border-slate-700" : "text-slate-400 bg-slate-100 border-slate-200"
                                    }`}>
                                      <LinkIcon size={8} /> Not Linked
                                    </span>
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${getRoleBadgeStyle(userRole, isDark)}`}>
                                      {userRole === "driver" ? <Bus size={8} /> : <UserRound size={8} />}
                                      {userRole}
                                    </span>
                                  </div>
                                  <span className={`text-[11px] italic font-mono ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                                    No account registered
                                  </span>
                                </div>
                              )}
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold flex items-center gap-1 w-fit ${getTypeBadgeStyle(user.type, isDark)}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full inline-block ${getTypeDotColor(user.type)}`} />
                                {user.type || "Regular"}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded border text-xs ${
                                isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                              }`}>
                                <Wallet className="w-3 h-3" />
                                {formatPeso(user.balance || 0)}
                              </span>
                            </TableCell>

                            <TableCell>
                              <span className={`inline-flex items-center gap-1 text-xs font-mono font-medium ${
                                expired
                                  ? isDark ? "text-red-400" : "text-red-600"
                                  : isDark ? "text-slate-300" : "text-slate-600"
                              }`}>
                                <CalendarClock className="w-3 h-3 flex-shrink-0" />
                                {formatDate(user.expirationDate)}
                              </span>
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold ${
                                  user.status === "Active"
                                    ? isDark ? "bg-emerald-950/40 text-emerald-400 border-emerald-900" : "bg-emerald-50 text-emerald-600 border-emerald-200"
                                    : isDark ? "bg-red-950/40 text-red-400 border-red-900" : "bg-red-50 text-red-600 border-red-200"
                                }`}
                              >
                                {user.status}
                              </Badge>
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {/* 👁 Preview — view-only, laging visible sa lahat ng admin */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => { setPreviewFlipped(false); setPreviewUser(user); }}
                                  className={`h-8 w-8 cursor-pointer ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}
                                  title="Preview card"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>

                                {/* 🔒 Renew / Transfer / Edit / Delete — makikita lang kapag may permission (hindi view_only) */}
                                {canManage && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openRenew(user)}
                                      disabled={!expired}
                                      className={`h-8 w-8 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40" : "text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50"}`}
                                      title={expired ? "Renew card (extend 1 year)" : `Not yet expired — valid until ${formatDate(user.expirationDate)}`}
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openTransfer(user)}
                                      disabled={(user.balance || 0) <= 0}
                                      className={`h-8 w-8 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? "text-orange-400 hover:text-orange-300 hover:bg-orange-950/40" : "text-orange-500 hover:text-orange-700 hover:bg-orange-50"}`}
                                      title={(user.balance || 0) > 0 ? "Transfer balance (lost/stolen card)" : "No balance to transfer"}
                                    >
                                      <ArrowRightLeft className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openEdit(user)}
                                      className={`h-8 w-8 cursor-pointer ${isDark ? "text-blue-400 hover:text-blue-300 hover:bg-blue-950/40" : "text-blue-500 hover:text-blue-700 hover:bg-blue-50"}`}
                                      title="Edit user"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => setDeleteUser(user)}
                                      className={`h-8 w-8 cursor-pointer ${isDark ? "text-red-400 hover:text-red-300 hover:bg-red-950/40" : "text-red-500 hover:text-red-700 hover:bg-red-50"}`}
                                      title="Delete user"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className={`text-center py-20 uppercase font-semibold tracking-widest text-xs ${isDark ? "text-slate-700" : "text-slate-300"}`}
                        >
                          No commuters found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                )}
              </div>

              {/* Pagination Footer */}
              <div className={`flex items-center justify-between pt-4 border-t mt-4 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                <span className={`text-xs font-mono uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Showing{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {activeCount === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, activeCount)}
                  </span>{" "}
                  of{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{activeCount}</span>{" "}
                  {isDriverTab ? "drivers" : "users"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" />
                    Prev
                  </Button>

                  <span className="text-xs font-semibold px-2 tabular-nums">
                    <span className="text-blue-500">{safePage}</span>
                    <span className={isDark ? "text-slate-700" : "text-slate-300"}> / {totalPages}</span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}
                  >
                    Next
                    <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </ReportSection>
      </ReportsPanel>

      {/* Card Preview Dialog — responsive, balanced layout.
          Order: header → card → quick facts → [Image | PDF] centered → Renew → Close (bottom) */}
      <Dialog open={!!previewUser} onOpenChange={(open) => !open && setPreviewUser(null)}>
        <DialogContent
          className={`w-[calc(100vw-1.5rem)] max-w-lg max-h-[92dvh] overflow-y-auto p-4 sm:p-6 gap-4 [&>button]:cursor-pointer ${
            isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6 text-blue-500">
              <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
                <CreditCard size={18} /> Card Preview
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewFlipped((f) => !f)}
                className={`h-7 px-2.5 text-[11px] font-semibold normal-case cursor-pointer shrink-0 ${
                  isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <RotateCw className="w-3 h-3 mr-1" />
                {previewFlipped ? "Front" : "Back"}
              </Button>
            </DialogTitle>
          </DialogHeader>

          {previewUser && (
            <div className="space-y-3">
              <LockedFlipCard
                flipped={previewFlipped}
                onFlip={() => setPreviewFlipped((f) => !f)}
                front={<CardFront user={previewUser} />}
                back={<CardBack />}
              />
              <p className={`text-center text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Tap the card to flip
              </p>

              {/* Quick facts — 1 column on very small screens, 2 columns otherwise */}
              <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2.5">
                {[
                  {
                    label: "Balance",
                    value: formatPeso(previewUser.balance || 0),
                    cls: isDark ? "text-emerald-400" : "text-emerald-600",
                  },
                  {
                    label: "Status",
                    value: previewUser.status,
                    cls:
                      previewUser.status === "Active"
                        ? isDark ? "text-emerald-400" : "text-emerald-600"
                        : isDark ? "text-red-400" : "text-red-600",
                  },
                  {
                    label: "Valid Until",
                    value: formatDate(previewUser.expirationDate),
                    cls: `font-mono ${
                      isCardExpired(previewUser.expirationDate)
                        ? isDark ? "text-red-400" : "text-red-600"
                        : isDark ? "text-slate-200" : "text-slate-800"
                    }`,
                  },
                  {
                    label: "Linked Account",
                    value: normalizeEmail(previewUser.email) ?? "No account linked",
                    cls: `font-mono ${
                      normalizeEmail(previewUser.email)
                        ? isDark ? "text-blue-400" : "text-blue-600"
                        : isDark ? "text-slate-500 italic" : "text-slate-400 italic"
                    }`,
                  },
                  {
                    label: "Account Role",
                    value: getUserRole(previewUser) === "driver" ? "Driver" : "Commuter",
                    cls:
                      getUserRole(previewUser) === "driver"
                        ? isDark ? "text-violet-400" : "text-violet-600"
                        : isDark ? "text-cyan-400" : "text-cyan-600",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`min-w-0 rounded-lg border px-3 py-2 ${
                      isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      {item.label}
                    </span>
                    <div className={`text-sm font-semibold truncate ${item.cls}`} title={String(item.value)}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer — stacked & centered. Overrides DialogFooter's default sm:flex-row. */}
          <DialogFooter className="flex flex-col gap-2.5 sm:flex-col sm:justify-center sm:space-x-0">
            {/* Download buttons: equal width, centered, balanced */}
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm mx-auto">
              <Button
                variant="outline"
                onClick={downloadCardImage}
                disabled={!!isExporting}
                className="h-10 w-full justify-center text-xs font-semibold cursor-pointer gap-1.5 disabled:cursor-not-allowed"
              >
                {isExporting === "png" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Image
              </Button>
              <Button
                variant="outline"
                onClick={downloadCardPdf}
                disabled={!!isExporting}
                className="h-10 w-full justify-center text-xs font-semibold cursor-pointer gap-1.5 disabled:cursor-not-allowed"
              >
                {isExporting === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                PDF
              </Button>
            </div>

            {/* Renew (only with permission) */}
            {canManage && previewUser && (
              <Button
                onClick={() => {
                  const user = previewUser;
                  setPreviewUser(null);
                  openRenew(user);
                }}
                disabled={!isCardExpired(previewUser.expirationDate)}
                title={
                  !isCardExpired(previewUser.expirationDate)
                    ? `Not yet expired — valid until ${formatDate(previewUser.expirationDate)}`
                    : undefined
                }
                className="h-10 w-full max-w-sm mx-auto justify-center bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Renew Card
              </Button>
            )}

            {/* Close — always at the very bottom */}
            <Button
              variant="ghost"
              onClick={() => setPreviewUser(null)}
              className={`h-10 w-full max-w-sm mx-auto justify-center text-xs font-medium cursor-pointer border ${
                isDark
                  ? "text-slate-300 hover:text-white hover:bg-slate-800 border-slate-800"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
              }`}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog — ADDRESS now works exactly like Card Registration:
          ONE searchable "Barangay / City / Province" field, ZIP is automatic,
          and the Full Address textarea is auto-filled (but still editable).
          The old separate Region / Province / City / Barangay / ZIP inputs
          were removed.
          🔒 `open` ay naka-gate sa canManage — hindi kailanman magbubukas kapag view_only. */}
      <Dialog open={canManage && !!editUser} onOpenChange={(open) => { if (!open && !isSavingEdit) setEditUser(null); }}>
        <DialogContent
          className={`max-h-[92dvh] overflow-hidden sm:max-w-4xl [&>button]:cursor-pointer ${
            isDark ? "border-slate-800 bg-slate-950 text-slate-200" : "bg-white text-slate-800"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-cyan-500" />
              Update User
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleUpdate();
            }}
            className="flex flex-col gap-4"
          >
            {/* SCROLLABLE AREA — always-visible side scrollbar */}
            <div
              className="edit-sidebar-scroll space-y-6"
              style={{
                maxHeight: "calc(92dvh - 190px)",
                "--sb-thumb": isDark ? "#64748b" : "#94a3b8",
                "--sb-thumb-hover": isDark ? "#94a3b8" : "#64748b",
                "--sb-track": isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.18)",
              } as React.CSSProperties}
            >
            {/* ID VERIFICATION (Student / Senior / PWD only) */}
            {String(editForm.type).toLowerCase() !== "regular" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <IdCard className="h-4 w-4 text-cyan-500" />
                  <h3 className="font-semibold">ID Verification</h3>
                </div>

                <div className={`rounded-xl border p-4 ${isDark ? "border-slate-800 bg-slate-900/40" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex flex-col gap-4 sm:flex-row">
                    {(editIdImagePreview || editUser?.idImagePath || editUser?.id_image_path) ? (
                      <div className="relative shrink-0">
                        <img
                          src={editIdImagePreview || editUser?.idImagePath || editUser?.id_image_path}
                          alt="Current ID"
                          className={`h-40 w-full sm:w-64 rounded-lg border object-contain ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
                        />
                        {editIdImagePreview && (
                          <button
                            type="button"
                            onClick={clearEditImage}
                            disabled={isSavingEdit}
                            aria-label="Remove selected image"
                            className={`absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm cursor-pointer ${isDark ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => editFileInputRef.current?.click()}
                        disabled={isSavingEdit}
                        className={`flex h-40 w-full sm:w-64 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
                          isDark ? "border-slate-700 hover:border-cyan-500 hover:bg-slate-900" : "border-slate-300 hover:border-cyan-500 hover:bg-white"
                        }`}
                      >
                        <Upload className="mb-2 h-8 w-8 opacity-50" />
                        <span className="text-sm font-medium">Upload ID Image</span>
                        <span className="mt-1 text-xs opacity-60">JPG, PNG, WEBP up to 5 MB</span>
                      </button>
                    )}

                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-sm font-medium">{editForm.type} ID</p>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Upload a replacement ID image. JPG, PNG, or WEBP up to 5 MB.
                      </p>

                      <input
                        ref={editFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleEditImageSelect}
                        disabled={isSavingEdit}
                      />

                      {editIdImageFile && (
                        <div className={`rounded-md px-3 py-2 text-xs truncate ${isDark ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600 border border-slate-200"}`}>
                          {editIdImageFile.name} • {(editIdImageFile.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => editFileInputRef.current?.click()}
                        disabled={isSavingEdit}
                        className="gap-2 cursor-pointer"
                      >
                        {isUploadingEditImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {editIdImageFile ? "Change Image" : "Upload / Change ID Image"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PERSONAL INFORMATION */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-cyan-500" />
                <h3 className="font-semibold">Personal Information</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Full Name</label>
                  <Input
                    value={editForm.fullName}
                    onChange={(e) => setEditForm((c) => ({ ...c, fullName: e.target.value }))}
                    placeholder="Enter full name"
                    disabled={isSavingEdit}
                    className={editInputCls}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Date of Birth</label>
                  <Input
                    type="date"
                    value={editForm.dateOfBirth}
                    onChange={(e) => setEditForm((c) => ({ ...c, dateOfBirth: e.target.value }))}
                    disabled={isSavingEdit}
                    className={editInputCls}
                  />
                </div>

                {/* 📞 CONTACT NUMBER — fixed +63 prefix, user types 10 digits */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Contact Number</label>

                  <div className="relative">
                    <span
                      className={`pointer-events-none absolute inset-y-0 left-0 flex items-center gap-1.5 border-r px-3 text-sm font-semibold ${
                        isDark
                          ? "border-slate-800 text-slate-300"
                          : "border-slate-200 text-slate-700"
                      }`}
                    >
                      🇵🇭 {PH_COUNTRY_CODE}
                    </span>

                    <Input
                      value={editForm.contactNumber}
                      onChange={(e) =>
                        setEditForm((c) => ({
                          ...c,
                          contactNumber: normalizePhContactDigits(e.target.value),
                        }))
                      }
                      placeholder="9XXXXXXXXX"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={13}
                      disabled={isSavingEdit}
                      className={`${editInputCls} pl-[5rem] font-mono`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ADDRESS — single searchable field; ZIP code is automatic */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-500" />
                <h3 className="font-semibold">Address</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Row 1: Street Address */}
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">
                    Street Address{" "}
                    <span className="font-normal text-muted-foreground">
                      (Optional)
                    </span>
                  </label>
                  <Input
                    value={editForm.streetAddress}
                    onChange={(e) => handleStreetChange(e.target.value)}
                    placeholder="House number, street, sitio"
                    disabled={isSavingEdit}
                    className={editInputCls}
                  />
                </div>

                {/* Row 2: ONE searchable field for barangay/city/province/region */}
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Barangay / City / Province</label>
                  <AddressCombobox
                    options={addressOptions}
                    value={editForm.barangayCode}
                    selectedLabel={[
                      editForm.barangayName,
                      editForm.cityName,
                      editForm.provinceName,
                      editForm.regionName,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    onChange={handleAddressSelect}
                    placeholder="Search barangay, city, or province..."
                    loadingPlaceholder="Loading address data..."
                    loading={loadingAddressOptions}
                    disabled={isSavingEdit}
                    isDark={isDark}
                  />
                </div>

                {/* Row 3: Full Address — lalabas nang sabay kasama ang ZIP + Philippines */}
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Full Address</label>

                  <div className="relative">
                    <Textarea
                      value={editForm.fullAddress}
                      onChange={(e) =>
                        setEditForm((c) => ({ ...c, fullAddress: e.target.value }))
                      }
                      placeholder={
                        resolvingAddress
                          ? ""
                          : "Auto-filled from the search above — you can still edit it"
                      }
                      disabled={isSavingEdit || resolvingAddress}
                      rows={2}
                      className={`min-h-0 resize-none px-2.5 py-2 text-xs ${
                        isDark ? "bg-slate-950 border-slate-800 text-white placeholder:text-slate-600" : "bg-white border-slate-200"
                      }`}
                    />

                    {/* 🔄 Loading overlay habang hinahanap ang ZIP */}
                    {resolvingAddress && (
                      <div
                        className={`pointer-events-none absolute inset-0 flex items-center gap-2 px-2.5 text-xs ${
                          isDark ? "text-slate-400" : "text-slate-500"
                        }`}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Preparing full address...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            </div>

            {/* BUTTONS */}
            <div
              className={`flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end ${
                isDark ? "border-slate-800" : "border-slate-200"
              }`}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditUser(null)}
                disabled={isSavingEdit}
                className="cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={!hasChanges || isSavingEdit || resolvingAddress}
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingEdit ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isUploadingEditImage ? "Uploading ID..." : "Saving..."}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ✅ Renew Confirmation Dialog — shows current vs. new expiration date
          🔒 `open` naka-gate sa canManage */}
      <AlertDialog open={canManage && !!renewUser} onOpenChange={(open) => !open && setRenewUser(null)}>
        <AlertDialogContent className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <AlertDialogHeader>
            <AlertDialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <RefreshCw className="text-emerald-500" size={18} /> Confirm Renewal
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              This will extend {renewUser?.fullName ?? "this user"}'s card validity by 1 year.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {renewUser && (
            <div className={`grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
              <div>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Current Expiration</span>
                <div className={`font-mono font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                  {formatDate(renewUser.expirationDate)}
                </div>
              </div>
              <div>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-emerald-500" : "text-emerald-600"}`}>New Expiration</span>
                <div className={`font-mono font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                  {formatDate(computeRenewedExpiration(renewUser.expirationDate).toISOString())}
                </div>
              </div>
            </div>
          )}

          {/* 🚫➕ Extra safety net: if this dialog is somehow opened for a card
              that isn't expired, show why it can't proceed and disable the
              confirm button below instead of silently allowing the RPC call. */}
          {renewUser && !isCardExpired(renewUser.expirationDate) && (
            <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${isDark ? "bg-red-950/40 border-red-900 text-red-400" : "bg-red-50 border-red-200 text-red-600"}`}>
              This card is still valid until {formatDate(renewUser.expirationDate)}. Renewal is only allowed after expiration.
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isRenewing}
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed border-0 shadow-none bg-transparent hover:bg-transparent ${
                isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRenew}
              disabled={isRenewing || !!(renewUser && !isCardExpired(renewUser.expirationDate))}
              className="bg-emerald-600 text-white hover:bg-emerald-700 font-semibold text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
            >
              {isRenewing ? "Renewing..." : "Confirm Renewal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ✅ Transfer Balance Dialog — lost/stolen card: move balance to a replacement card
          🔒 `open` naka-gate sa canManage */}
      <Dialog open={canManage && !!transferUser} onOpenChange={(open) => !open && setTransferUser(null)}>
        <DialogContent className={`sm:max-w-lg [&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-orange-500">
              <ArrowRightLeft size={18} /> Transfer Balance
            </DialogTitle>
          </DialogHeader>

          {transferUser && (
            <div className="space-y-4 py-2">
              {/* Source card summary */}
              <div className={`rounded-lg border p-3 text-sm ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  From (will be blocked)
                </span>
                <div className="flex items-center justify-between mt-1">
                  <div>
                    <div className="font-mono text-xs text-blue-500 font-semibold">{transferUser.cardUid}</div>
                    <div className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>{transferUser.fullName}</div>
                  </div>
                  <div className={`font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    {formatPeso(transferUser.balance || 0)}
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Reason</Label>
                <Select value={transferReason} onValueChange={(v) => setTransferReason(v as (typeof TRANSFER_REASONS)[number])}>
                  <SelectTrigger className={`text-sm font-medium cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
                    {TRANSFER_REASONS.map((r) => (
                      <SelectItem key={r} value={r} className="cursor-pointer">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Replacement card search */}
              <div className="space-y-2">
                <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Replacement Card</Label>
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                  <Input
                    placeholder="Search by UID or name..."
                    value={transferTarget ? `${transferTarget.cardUid} — ${transferTarget.fullName}` : transferQuery}
                    onChange={(e) => { setTransferTarget(null); setTransferQuery(e.target.value); }}
                    className={`pl-10 text-sm ${isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"}`}
                  />
                </div>

                {!transferTarget && transferQuery.trim() && (
                  <div className={`max-h-40 overflow-auto rounded-lg border divide-y ${isDark ? "border-slate-800 divide-slate-800" : "border-slate-200 divide-slate-100"}`}>
                    {transferCandidates.length > 0 ? (
                      transferCandidates.map((u: any) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { setTransferTarget(u); setTransferQuery(""); }}
                          className={`w-full text-left px-3 py-2 text-sm cursor-pointer ${isDark ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
                        >
                          <span className="font-mono text-xs text-blue-500 font-semibold mr-2">{u.cardUid}</span>
                          <span className={isDark ? "text-slate-300" : "text-slate-700"}>{u.fullName}</span>
                        </button>
                      ))
                    ) : (
                      <div className={`px-3 py-2 text-xs italic ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        No matching active cards
                      </div>
                    )}
                  </div>
                )}
              </div>

              {transferTarget && (
                <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${isDark ? "bg-emerald-950/40 border-emerald-900 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-600"}`}>
                  {formatPeso(transferUser.balance || 0)} will move to {transferTarget.cardUid} ({transferTarget.fullName}). {transferUser.cardUid} will be marked Blocked.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setTransferUser(null)}
              disabled={isTransferring}
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500"}`}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmTransfer}
              disabled={isTransferring || !transferTarget}
              className="bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold px-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-orange-600"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
              {isTransferring ? "Transferring..." : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 📟 Link Device ID Dialog (Drivers) — manual fallback lang, para sa
          driver na WALANG auto-detected device sa public.devices
          🔒 `open` naka-gate sa canManage */}
      <Dialog open={canManage && !!deviceDriver} onOpenChange={(open) => { if (!open && !isSavingDevice) setDeviceDriver(null); }}>
        <DialogContent className={`sm:max-w-md [&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-cyan-500">
              <Cpu size={18} /> Link Device
            </DialogTitle>
          </DialogHeader>

          {deviceDriver && (
            <form
              onSubmit={(e) => { e.preventDefault(); saveDeviceLink(false); }}
              className="space-y-4 py-2"
            >
              <div className={`rounded-lg border p-3 text-sm ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Driver</span>
                <div className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>{deviceDriver.name}</div>
                <div className="font-mono text-[11px] text-violet-500 truncate">{deviceDriver.accountId}</div>
              </div>

              <div className="space-y-2">
                <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Device ID</Label>
                <Input
                  autoFocus
                  value={deviceInput}
                  onChange={(e) => setDeviceInput(e.target.value)}
                  placeholder="e.g. TERMINAL-001"
                  disabled={isSavingDevice}
                  className={`font-mono text-sm ${isDark ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600" : "bg-white border-slate-200"}`}
                />
                <p className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  One device can be linked to one driver only.
                </p>
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                {deviceDriver.deviceId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => saveDeviceLink(true)}
                    disabled={isSavingDevice}
                    className={`text-xs font-medium cursor-pointer gap-1.5 ${isDark ? "text-red-400 hover:bg-red-950/40" : "text-red-600 hover:bg-red-50"}`}
                  >
                    <Unlink className="w-3.5 h-3.5" /> Unlink
                  </Button>
                ) : <span />}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDeviceDriver(null)}
                    disabled={isSavingDevice}
                    className="text-xs cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSavingDevice || !deviceInput.trim() || deviceInput.trim() === (deviceDriver.deviceId ?? "")}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold cursor-pointer gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSavingDevice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
                    {isSavingDevice ? "Saving..." : "Save"}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm
          🔒 `open` naka-gate sa canManage */}
      <AlertDialog open={canManage && !!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <AlertDialogContent className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <AlertDialogHeader>
            <AlertDialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <ShieldAlert className="text-red-500" size={18} /> Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              This will permanently remove the user and all associated transaction history from the database.
              This action cannot be undone.
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
              className="bg-red-600 text-white hover:bg-red-700 font-semibold text-xs cursor-pointer"
            >
              {deleteMutation.isPending ? "Deleting..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ⬇️ Hidden EXPORT LAYER — unscaled, non-flipped, off-screen (NOT
          display:none, so it can still be rendered and captured). Front and
          back are each exactly 700x441 (CR80 ratio). Uses `square` faces so
          the exported PNG/PDF is a clean full-bleed, print-ready rectangle.
          Sits outside the Dialog so the dialog's transform can't affect its
          fixed positioning. */}
      {previewUser && (
        <div
          aria-hidden
          style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}
        >
          <div
            ref={exportSheetRef}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              padding: 24,
              backgroundColor: "#ffffff",
            }}
          >
            <div ref={exportFrontRef} style={{ width: CARD_DESIGN_WIDTH, height: CARD_DESIGN_HEIGHT }}>
              <CardFront user={previewUser} withShadow={false} square />
            </div>
            <div ref={exportBackRef} style={{ width: CARD_DESIGN_WIDTH, height: CARD_DESIGN_HEIGHT }}>
              <CardBack withShadow={false} square />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}