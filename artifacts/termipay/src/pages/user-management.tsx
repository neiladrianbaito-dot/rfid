import { useState, useEffect, useRef, useMemo } from "react";
import {
  useListUsers,
  useUpdateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { Search, Pencil, Trash2, Wallet, Users, Zap, ShieldAlert, Mail, LinkIcon, ChevronLeft, ChevronRight, Phone, CheckCircle2, Eye, CreditCard, Radio, RotateCw, RefreshCw, CalendarClock, ArrowRightLeft, Upload, X, Loader2, ChevronsUpDown, Check, MapPin, UserRound, IdCard } from "lucide-react";
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
import { supabase } from "@/lib/supabase"; // 👈 BAGO: direct Supabase client para sa renew_card() / balance transfer RPC calls

// 🔒 ADMIN ACCESS: nagbibigay ng `canManage` (false kapag view_only ang admin)
// at `loaded` (true kapag tapos na ma-fetch ang access info).
import { useAdminAccess } from "@/hooks/use-admin-access";

const PAGE_SIZE = 10;

const TYPE_FILTERS = ["All", "Regular", "Student", "Senior", "PWD"] as const;

// ➕ Status filter options. "Expired" is NOT a raw DB status — it's derived
// from the card's expirationDate via isCardExpired(), so it can catch cards
// that are technically still "Active" in the status column but past their date.
const STATUS_FILTERS = ["All", "Active", "Inactive", "Blocked", "Expired"] as const;

// ➕ Reasons a card would need a balance transfer (lost/stolen/damaged replacement)
const TRANSFER_REASONS = ["Lost Card", "Stolen Card", "Damaged Card", "Other"] as const;

const PSGC_API = "https://psgc.gitlab.io/api";

const ID_IMAGE_BUCKET = "id-verifications";
const MAX_ID_IMAGE_SIZE = 5 * 1024 * 1024;

const REGION_OPTIONS = [
  { code: "010000000", name: "Ilocos Region" },
  { code: "020000000", name: "Cagayan Valley" },
  { code: "030000000", name: "Central Luzon" },
  { code: "040000000", name: "CALABARZON" },
  { code: "170000000", name: "MIMAROPA Region" },
  { code: "050000000", name: "Bicol Region" },
  { code: "060000000", name: "Western Visayas" },
  { code: "070000000", name: "Central Visayas" },
  { code: "080000000", name: "Eastern Visayas" },
  { code: "090000000", name: "Zamboanga Peninsula" },
  { code: "100000000", name: "Northern Mindanao" },
  { code: "110000000", name: "Davao Region" },
  { code: "120000000", name: "SOCCSKSARGEN" },
  { code: "130000000", name: "NCR" },
  { code: "140000000", name: "CAR" },
  { code: "160000000", name: "Caraga" },
  { code: "150000000", name: "BARMM" },
] as const;

// ═══════════════════════════════════════════════════════════════════════
// LOCATION COMBOBOX — same component used in Card Registration.
// Only ~15 rows are ever in the DOM (windowed list), plus type-to-search,
// so long PSGC lists (e.g. ~900 barangays) scroll smoothly.
// ═══════════════════════════════════════════════════════════════════════
interface PsgcOption {
  code: string;
  name: string;
}

const REGION_COMBO_OPTIONS: PsgcOption[] = REGION_OPTIONS.map((r) => ({ code: r.code, name: r.name }));

const COMBOBOX_ITEM_HEIGHT = 36;
const COMBOBOX_LIST_HEIGHT = 260;
const COMBOBOX_OVERSCAN = 6;

interface LocationComboboxProps {
  options: PsgcOption[];
  value: string;
  // Fallback label shown when the saved value isn't in `options` (yet)
  selectedName?: string;
  onChange: (code: string, name: string) => void;
  placeholder: string;
  loadingPlaceholder?: string;
  loading?: boolean;
  disabled?: boolean;
  isDark: boolean;
}

function LocationCombobox({
  options,
  value,
  selectedName,
  onChange,
  placeholder,
  loadingPlaceholder,
  loading,
  disabled,
  isDark,
}: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const query = search.trim().toLowerCase();
    return options.filter((option) => option.name.toLowerCase().includes(query));
  }, [options, search]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
    }
  }, [open]);

  const selected = options.find((option) => option.code === value);
  const label = selected?.name ?? (value ? selectedName : undefined);

  const visibleCount = Math.ceil(COMBOBOX_LIST_HEIGHT / COMBOBOX_ITEM_HEIGHT) + COMBOBOX_OVERSCAN * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / COMBOBOX_ITEM_HEIGHT) - COMBOBOX_OVERSCAN);
  const endIndex = Math.min(filtered.length, startIndex + visibleCount);
  const visibleItems = filtered.slice(startIndex, endIndex);
  const totalHeight = filtered.length * COMBOBOX_ITEM_HEIGHT;
  const offsetY = startIndex * COMBOBOX_ITEM_HEIGHT;

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`flex h-9 w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            isDark ? "border-slate-800 bg-slate-950 text-slate-200" : "border-slate-200 bg-white text-slate-900"
          }`}
        >
          <span className={`truncate ${!label ? "opacity-50" : ""}`}>
            {label ?? (loading ? loadingPlaceholder ?? "Loading..." : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={`w-[--radix-popover-trigger-width] p-0 ${isDark ? "border-slate-800 bg-slate-950" : "bg-white"}`}
      >
        <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setScrollTop(0);
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            placeholder="Search..."
            className={`w-full bg-transparent text-sm outline-none placeholder:opacity-50 ${
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
          {filtered.length === 0 ? (
            <div className={`px-3 py-6 text-center text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {loading ? "Loading..." : "No results found"}
            </div>
          ) : (
            <div style={{ height: totalHeight, position: "relative" }}>
              <div style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}>
                {visibleItems.map((option) => {
                  const isSelected = option.code === value;
                  return (
                    <button
                      type="button"
                      key={option.code}
                      onClick={() => {
                        onChange(option.code, option.name);
                        setOpen(false);
                      }}
                      style={{ height: COMBOBOX_ITEM_HEIGHT }}
                      className={`flex w-full items-center gap-2 px-3 text-left text-sm transition-colors cursor-pointer ${
                        isSelected
                          ? isDark
                            ? "bg-cyan-950/40 text-cyan-400"
                            : "bg-cyan-50 text-cyan-700"
                          : isDark
                            ? "text-slate-200 hover:bg-slate-800"
                            : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <Check className={`h-4 w-4 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{option.name}</span>
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
// This means renewing a card that's still valid adds a full year on top of
// its remaining validity, while renewing an already-expired card starts the
// new 1-year period from today instead of stacking onto a past date.
// NOTE: this is now only used to render the "New Expiration" PREVIEW in the
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
// The problem before: the card front/back used Tailwind responsive classes
// (p-5 sm:p-7, text-2xl sm:text-3xl, etc). At certain widths the browser
// jumps between breakpoints, so text, padding, and the logo each resize at
// DIFFERENT moments — the design visibly "reflows" instead of scaling as
// one unit, and things can drift out of position.
//
// The fix: author the card ONCE at a fixed pixel canvas
// (CARD_DESIGN_WIDTH x CARD_DESIGN_HEIGHT). Every element inside uses
// fixed px values only — no breakpoints, no "sm:"/"md:" classes. That
// canvas is then dropped into a responsive-width container and scaled
// down/up with a single CSS `transform: scale(ratio)`, where ratio is
// measured live (via ResizeObserver) from how much space is actually
// available. Because it's one transform on one wrapper, every child
// (logo, UID, name, "Valid Until" label) shrinks or grows by the exact
// same amount, in the exact same relative position — nothing reflows,
// nothing repositions independently, no matter how far you stretch or
// shrink the container. It behaves exactly like scaling a locked image.
// ═══════════════════════════════════════════════════════════════════════

const CARD_DESIGN_WIDTH = 700;
// Keeps the real 1376:774 physical-card aspect ratio, just authored at a
// smaller, easier-to-design canvas size.
const CARD_DESIGN_HEIGHT = Math.round((CARD_DESIGN_WIDTH * 774) / 1376); // 394

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

export default function UserManagementPage() {
  const { isDark } = useTheme();

  // 🔒 ADMIN ACCESS: `canManage` = false kapag view_only.
  // `loaded` = true kapag tapos na ma-load ang access info.
  const { canManage, loaded } = useAdminAccess();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All");
  // ➕ Status filter state (Active / Inactive / Blocked / Expired)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [previewUser, setPreviewUser] = useState<any>(null);
  const [previewFlipped, setPreviewFlipped] = useState(false);

  // ✅ Renew confirmation modal state — holds the user pending renewal
  const [renewUser, setRenewUser] = useState<any>(null);
  // 👈 BAGO: loading state para sa direct RPC call (kapalit ng renewMutation.isPending)
  const [isRenewing, setIsRenewing] = useState(false);

  // ✅ Transfer-balance state — lost/stolen card: move full balance to a replacement card
  const [transferUser, setTransferUser] = useState<any>(null); // source (lost/stolen) card
  const [transferQuery, setTransferQuery] = useState("");
  const [transferTarget, setTransferTarget] = useState<any>(null); // replacement card
  const [transferReason, setTransferReason] = useState<(typeof TRANSFER_REASONS)[number]>("Lost Card");
  const [isTransferring, setIsTransferring] = useState(false);

  const [editForm, setEditForm] = useState({
    fullName: "",
    dateOfBirth: "",
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
    balance: "",
    status: "",
    type: "",
  });
  // Snapshot of the form's values at the moment Edit was opened — used to
  // detect whether the user has actually changed anything before allowing Save.
  const [originalForm, setOriginalForm] = useState(editForm);
  const [provinceOptions, setProvinceOptions] = useState<any[]>([]);
  const [cityOptions, setCityOptions] = useState<any[]>([]);
  const [barangayOptions, setBarangayOptions] = useState<any[]>([]);
  const [isLoadingAddressOptions, setIsLoadingAddressOptions] = useState(false);
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

  const editLabelCls = `text-[11px] font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`;
  const editHeadingCls = `text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`;
  const editInputCls = `h-9 text-sm ${isDark ? "bg-slate-950 border-slate-800 text-white placeholder:text-slate-600" : "bg-white border-slate-200"}`;
  const editTriggerCls = `h-9 w-full text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"}`;
  const editContentCls = isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700";


  useEffect(() => {
    let cancelled = false;

    const loadProvinces = async () => {
      if (!editUser || !editForm.regionCode) {
        setProvinceOptions([]);
        return;
      }

      setIsLoadingAddressOptions(true);
      try {
        const response = await fetch(`${PSGC_API}/regions/${editForm.regionCode}/provinces/`);
        if (!response.ok) throw new Error("Failed to load provinces");
        const data = await response.json();
        if (!cancelled) setProvinceOptions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Load provinces error:", error);
        if (!cancelled) setProvinceOptions([]);
      } finally {
        if (!cancelled) setIsLoadingAddressOptions(false);
      }
    };

    loadProvinces();
    return () => { cancelled = true; };
  }, [editUser, editForm.regionCode]);

  useEffect(() => {
    let cancelled = false;

    const loadCities = async () => {
      if (!editUser || !editForm.provinceCode) {
        setCityOptions([]);
        return;
      }

      setIsLoadingAddressOptions(true);
      try {
        const response = await fetch(`${PSGC_API}/provinces/${editForm.provinceCode}/cities-municipalities/`);
        if (!response.ok) throw new Error("Failed to load cities/municipalities");
        const data = await response.json();
        if (!cancelled) setCityOptions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Load cities/municipalities error:", error);
        if (!cancelled) setCityOptions([]);
      } finally {
        if (!cancelled) setIsLoadingAddressOptions(false);
      }
    };

    loadCities();
    return () => { cancelled = true; };
  }, [editUser, editForm.provinceCode]);

  useEffect(() => {
    let cancelled = false;

    const loadBarangays = async () => {
      if (!editUser || !editForm.cityCode) {
        setBarangayOptions([]);
        return;
      }

      setIsLoadingAddressOptions(true);
      try {
        const response = await fetch(`${PSGC_API}/cities-municipalities/${editForm.cityCode}/barangays/`);
        if (!response.ok) throw new Error("Failed to load barangays");
        const data = await response.json();
        if (!cancelled) setBarangayOptions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Load barangays error:", error);
        if (!cancelled) setBarangayOptions([]);
      } finally {
        if (!cancelled) setIsLoadingAddressOptions(false);
      }
    };

    loadBarangays();
    return () => { cancelled = true; };
  }, [editUser, editForm.cityCode]);

  useEffect(() => {
    if (!editUser) {
      setProvinceOptions([]);
      setCityOptions([]);
      setBarangayOptions([]);
      return;
    }

    const currentProvince = editForm.provinceCode || editForm.provinceName;
    const currentCity = editForm.cityCode || editForm.cityName;
    const currentBarangay = editForm.barangayCode || editForm.barangayName;

    setProvinceOptions((items) => {
      if (!currentProvince || items.some((item) => item.code === editForm.provinceCode)) return items;
      return [{ code: editForm.provinceCode || editForm.provinceName, name: editForm.provinceName || editForm.provinceCode }, ...items];
    });
    setCityOptions((items) => {
      if (!currentCity || items.some((item) => item.code === editForm.cityCode)) return items;
      return [{ code: editForm.cityCode || editForm.cityName, name: editForm.cityName || editForm.cityCode }, ...items];
    });
    setBarangayOptions((items) => {
      if (!currentBarangay || items.some((item) => item.code === editForm.barangayCode)) return items;
      return [{ code: editForm.barangayCode || editForm.barangayName, name: editForm.barangayName || editForm.barangayCode }, ...items];
    });
  }, [editUser]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter]);

  const {
    data: users,
    isLoading,
    isFetching,
    refetch: refetchUsers,
  } = useListUsers(
    search ? { search } : undefined,
    {
      query: {
        refetchOnWindowFocus: true,
        // ✅ Keep the last good page of data on screen while a refetch is
        // in flight (initial mount, realtime update, window refocus) rather
        // than clearing back to an empty/loading state in between. This is
        // the TanStack Query v5 replacement for the old `keepPreviousData`
        // option and is the main fix for the "blink" on refresh.
        placeholderData: keepPreviousData,
      },
    }
  );

  // ✅ Debounce realtime-triggered refetches. Realtime channels can emit
  // several change events in quick succession (e.g. an insert followed by
  // an update), and each one used to call refetchUsers() immediately,
  // stacking multiple overlapping refetches and making the table visibly
  // reset more than once. Collapsing bursts into a single refetch after a
  // short quiet period gives one smooth update instead of repeated blinks.
  const realtimeRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (realtimeRefetchTimeoutRef.current) {
        clearTimeout(realtimeRefetchTimeoutRef.current);
      }
    };
  }, []);

  useRealtimeRefetch(["users"], () => {
    if (realtimeRefetchTimeoutRef.current) {
      clearTimeout(realtimeRefetchTimeoutRef.current);
    }
    realtimeRefetchTimeoutRef.current = setTimeout(() => {
      realtimeRefetchTimeoutRef.current = null;
      refetchUsers();
    }, 350);
  });

  // ✅ Memoized off `users` (the query's actual data reference) instead of
  // being rebuilt as a brand-new array literal on every render. Before this
  // fix, `userList` was a new array every render regardless of whether the
  // data had changed, which made the "sync tracking" effect below fire on
  // every unrelated re-render (opening a dialog, typing in search, etc.) —
  // that's what was causing "Last sync" (and the perceived blink) to update
  // constantly even with no real data change.
  const userList = useMemo(() => (Array.isArray(users) ? users : []), [users]);

  // Apply the type filter on top of whatever the search endpoint returned
  const typeFilteredList =
    typeFilter === "All"
      ? userList
      : userList.filter(
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

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = filteredList.slice(startIndex, startIndex + PAGE_SIZE);

  // ✅ Fires strictly when the underlying query data reference changes
  // (a real fetch actually resolved with new/unchanged data from the
  // server), not on every component re-render. This is what keeps
  // "Last sync" and the new-row pulse from updating spuriously.
  useEffect(() => {
    if (!users || userList.length === 0) return;
    const topId = userList[0]?.id;

    if (prevTopIdRef.current !== null && topId !== prevTopIdRef.current) {
      setNewRowId(topId);
      setTimeout(() => setNewRowId(null), 800);
    }

    prevTopIdRef.current = topId;
    setLastUpdated(new Date());
  }, [users]);

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditUser(null);
        toast({ title: <SuccessTitle text="User Updated Successfully" /> });
      },
    },
  });

  // ❌ TINANGGAL: yung dating "renewMutation" (useUpdateUser instance para sa
  // renewal) — hindi na kailangan dahil direct Supabase RPC call na ang
  // ginagamit ng confirmRenew() sa baba, hindi na dumadaan sa generated
  // API client na siyang dahilan kung bakit hindi umaabot sa DB ang renewal.

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: <SuccessTitle text="User Deleted Successfully" /> });
      },
    },
  });

  const openEdit = (user: any) => {
    // 🔒 Guard: bawal mag-edit kapag view_only
    if (blockIfViewOnly()) return;

    setEditUser(user);

    const initial = {
      fullName: user.fullName || "",
      dateOfBirth: user.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : "",
      // Keep the edit field strictly numeric and capped at 11 digits.
      contactNumber: String(user.contactNumber || "").replace(/\D/g, "").slice(0, 11),
      streetAddress: user.streetAddress || "",
      regionCode: user.regionCode || "",
      regionName: user.regionName || "",
      provinceCode: user.provinceCode || "",
      provinceName: user.provinceName || "",
      cityCode: user.cityCode || "",
      cityName: user.cityName || "",
      barangayCode: user.barangayCode || "",
      barangayName: user.barangayName || "",
      zipCode: user.zipCode || "",
      balance: String(user.balance || 0),
      status: user.status || "",
      type: user.type || "Regular",
    };

    setEditForm(initial);
    setOriginalForm(initial);
    setProvinceOptions([]);
    setCityOptions([]);
    setBarangayOptions([]);
    if (editIdImagePreview) URL.revokeObjectURL(editIdImagePreview);
    setEditIdImageFile(null);
    setEditIdImagePreview(null);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
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

    if (!editUser || !hasChanges) return;

    const normalizedContactNumber = String(editForm.contactNumber || "")
      .replace(/\D/g, "")
      .slice(0, 11);

    if (normalizedContactNumber.length !== 11) {
      toast({
        title: "Invalid Contact Number",
        description: "Contact number must contain exactly 11 digits.",
        variant: "destructive",
      });
      return;
    }

    // Keep the state normalized before saving.
    if (editForm.contactNumber !== normalizedContactNumber) {
      setEditForm((current) => ({ ...current, contactNumber: normalizedContactNumber }));
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

      const fullAddress = [
        editForm.streetAddress,
        editForm.barangayName,
        editForm.cityName,
        editForm.provinceName,
        editForm.regionName,
        editForm.zipCode,
      ].map((value) => value.trim()).filter(Boolean).join(", ");

      // 2. WAIT for the database update to finish successfully.
      // mutateAsync makes sure we only clear local state after the DB write.
      await updateMutation.mutateAsync({
        id: editUser.id,
        data: {
          fullName: editForm.fullName.trim(),
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
      // ✅ Old ID image cleanup is now handled SERVER-SIDE by the
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

  // ✅ BAGONG confirmRenew — direktang tumatawag sa renew_card() Postgres
  // function sa pamamagitan ng Supabase RPC, hindi na sa generated
  // useUpdateUser hook. Ang function mismo (sa DB) ang gumagawa ng +1 year
  // math at nag-eextend mula sa GREATEST(current_expiration, now()).
  // 🚫➕ GUARD: final safety check right before the RPC call — even if
  // something upstream let a non-expired card slip through, we refuse to
  // fire the renewal here.
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

  return (
    <div className={`space-y-8 h-full min-h-0 flex flex-col ${isDark ? "text-slate-200" : "text-slate-800"}`} data-testid="users-page">
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

        /* Windowed location list (same as Card Registration) */
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

        /* ✅ Smooth, contained scrolling for the Edit dialog body */
        .edit-scroll {
          overflow-y: auto;
          overscroll-behavior: contain;        /* scroll doesn't leak to the page behind */
          scroll-behavior: smooth;             /* glides when tabbing/focusing fields */
          -webkit-overflow-scrolling: touch;   /* momentum scrolling on iOS */
          scrollbar-width: thin;
          scrollbar-color: rgba(100,116,139,0.5) transparent;
          scrollbar-gutter: stable;            /* no layout jump when scrollbar appears */
        }
        .edit-scroll::-webkit-scrollbar { width: 8px; }
        .edit-scroll::-webkit-scrollbar-track { background: transparent; }
        .edit-scroll::-webkit-scrollbar-thumb {
          background: rgba(100,116,139,0.45);
          border-radius: 9999px;
          border: 2px solid transparent;
          background-clip: content-box;
        }
        .edit-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(100,116,139,0.75);
          background-clip: content-box;
        }
        @media (prefers-reduced-motion: reduce) {
          .edit-scroll { scroll-behavior: auto; }
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
          {/* ✅ Subtle "Syncing..." replaces the old behavior where a
              realtime update flashed the whole table back to the skeleton.
              While a background refetch is happening (isFetching) with
              data already on screen (!isLoading), we just show a small
              pulsing dot + label here — the table itself never unmounts. */}
          {(lastUpdated || (isFetching && !isLoading)) && (
            <span className={`text-[10px] font-mono pr-1 flex items-center gap-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {isFetching && !isLoading && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 realtime-dot inline-block" />
              )}
              {isFetching && !isLoading
                ? "Syncing..."
                : lastUpdated
                ? `Last sync: ${lastUpdated.toLocaleTimeString()}`
                : ""}
            </span>
          )}
        </div>
      </div>

      {/* Table Card */}
      <Card className={`shadow-sm flex flex-col overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />

        <CardHeader className={`flex-none pb-4 border-b ${isDark ? "bg-slate-950/40 border-slate-800" : "bg-slate-50/60 border-slate-100"}`}>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${
                isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
              }`}>
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                LIVE
              </span>
              <CardTitle className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Authorized Card Holders
              </CardTitle>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto items-stretch sm:items-center">
              <div className="relative w-full sm:w-80">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                <Input
                  placeholder="Search UID or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`pl-10 font-medium text-sm h-10 focus-visible:ring-blue-500 ${
                    isDark
                      ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                      : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                  }`}
                />
              </div>

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
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 mt-6 flex flex-col overflow-hidden">
          {/* ✅ Only show the full skeleton on a genuine first load (no data
              cached yet). Any subsequent refetch — realtime update, window
              refocus, search/filter change — keeps the existing table on
              screen (thanks to placeholderData above) instead of tearing it
              down, which is what was causing the "blink/reload" feeling. */}
          {isLoading && userList.length === 0 ? (
            <div className="space-y-4 pt-4">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className={`h-16 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
              ))}
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className={`sticky top-0 z-10 border-b ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
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
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${
                                    isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                                  }`}>
                                    <LinkIcon size={8} /> Linked
                                  </span>
                                  <span className="flex items-center gap-1 text-xs text-blue-500 font-mono">
                                    <Mail className="w-3 h-3 flex-shrink-0" />
                                    {linkedEmail}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${
                                    isDark ? "text-slate-500 bg-slate-800 border-slate-700" : "text-slate-400 bg-slate-100 border-slate-200"
                                  }`}>
                                    <LinkIcon size={8} /> Not Linked
                                  </span>
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
                          No users found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Footer */}
              <div className={`flex items-center justify-between pt-4 border-t mt-2 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                <span className={`text-xs font-mono uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Showing{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                    {filteredList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, filteredList.length)}
                  </span>{" "}
                  of{" "}
                  <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>{filteredList.length}</span>{" "}
                  users
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
        </CardContent>
      </Card>

      {/* Card Preview Dialog — flippable front/back, styled to match the printed card */}
      <Dialog open={!!previewUser} onOpenChange={(open) => !open && setPreviewUser(null)}>
        <DialogContent className={`sm:max-w-lg [&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center justify-between gap-2 text-blue-500 pr-6">
              <span className="flex items-center gap-2">
                <CreditCard size={18} /> Card Preview
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewFlipped((f) => !f)}
                className={`h-7 px-2.5 text-[11px] font-semibold normal-case cursor-pointer ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"}`}
              >
                <RotateCw className="w-3 h-3 mr-1" />
                Flip to {previewFlipped ? "front" : "back"}
              </Button>
            </DialogTitle>
          </DialogHeader>

          {previewUser && (() => {
            const theme = getCardTheme(previewUser.type);
            return (
              <div className="py-2">
                {/* 🔒 Locked-scale card mockup — fixed-pixel design, scales as
                    one unit, never reflows internally. Click to flip. */}
                <LockedFlipCard
                  flipped={previewFlipped}
                  onFlip={() => setPreviewFlipped((f) => !f)}
                  front={
                    <div
                      className="rounded-2xl overflow-hidden border h-full w-full relative"
                      style={{
                        backgroundColor: theme.cardBg,
                        borderColor: theme.isLight ? "#cbd5e1" : "transparent",
                        boxShadow: theme.isLight
                          ? "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)"
                          : "0 10px 25px -5px rgba(0,0,0,0.4), 0 4px 6px -2px rgba(0,0,0,0.2)",
                      }}
                    >
                      <ChevronStaircase color={theme.pattern} />

                      <div
                        className="relative h-full w-full flex flex-col justify-between"
                        style={{ padding: 30 }}
                      >
                        {/* Header / logo badge — ENLARGED: 44px -> 62px, gap bumped for balance */}
                        <div className="flex items-center" style={{ gap: 16 }}>
                          <div
                            className="rounded-full border-2 flex items-center justify-center flex-shrink-0 overflow-hidden"
                            style={{
                              width: 62,
                              height: 62,
                              backgroundColor: theme.isLight ? "#f1f5f9" : "rgba(255,255,255,0.10)",
                              borderColor: theme.isLight ? "#cbd5e1" : "rgba(255,255,255,0.30)",
                            }}
                          >
                            <img src="/calbayog.png" alt="Calbayog" className="w-full h-full object-cover" />
                          </div>
                          {/* ENLARGED: 17px -> 22px */}
                          <span
                            className="font-bold tracking-wide uppercase"
                            style={{ color: theme.textColor, fontSize: 22, lineHeight: 1.15 }}
                          >
                            Fare Collection System
                          </span>
                        </div>

                        {/* Body — ENLARGED: UID 38px -> 44px, name 20px -> 25px */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div
                            className="font-mono font-extrabold tracking-wide"
                            style={{ color: theme.uidColor, fontSize: 44, lineHeight: 1.1 }}
                          >
                            {previewUser.cardUid}
                          </div>
                          <div
                            className="font-semibold"
                            style={{ color: theme.textColor, fontSize: 25, lineHeight: 1.2 }}
                          >
                            {previewUser.fullName}
                          </div>
                        </div>

                        {/* Footer row: type label (left) + valid until (right) — fixed px, position locked */}
                        <div className="flex items-end justify-between">
                          <div
                            className="font-extrabold tracking-wide"
                            style={{ color: theme.accent, fontSize: 24, lineHeight: 1.1 }}
                          >
                            {theme.label}
                          </div>
                          {/* ✅ FIX: "Valid Until" label + date now follow theme.textColor
                              instead of being hardcoded to white. That means:
                              - Regular card (navy bg)      -> white text (theme.textColor = "#ffffff")
                              - Student/Senior/PWD (white bg) -> dark navy text (theme.textColor = "#0f172a")
                              so it's always legible regardless of card background. */}
                          <div className="text-right">
                            <div
                              className="uppercase tracking-wide font-semibold"
                              style={{ color: theme.subTextColor, fontSize: 11, lineHeight: 1.3 }}
                            >
                              Valid Until
                            </div>
                            <div
                              className="font-mono font-bold"
                              style={{ color: theme.textColor, fontSize: 15, lineHeight: 1.3 }}
                            >
                              {formatDate(previewUser.expirationDate)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  }
                  back={
                    <div
                      className="rounded-2xl overflow-hidden bg-[#eceae4] flex flex-col border border-slate-300 h-full w-full"
                      style={{ boxShadow: "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)" }}
                    >
                      <div style={{ height: "18%" }} className="bg-[#221f20] flex-shrink-0" />
                      <div className="flex-1 min-h-0 flex flex-col" style={{ padding: "12px 28px" }}>
                        <div
                          className="bg-white border-y border-slate-300"
                          style={{ padding: "8px 14px", marginBottom: 14 }}
                        >
                          <span className="font-extrabold text-slate-900" style={{ fontSize: 19 }}>
                            Terms and Condition
                          </span>
                        </div>
                        <ul
                          className="text-slate-800 flex-1 min-h-0 overflow-hidden"
                          style={{ fontSize: 13, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 3 }}
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
                            style={{ width: 38, height: 38 }}
                          >
                            <img src="/calbayog.png" alt="Calbayog" className="w-full h-full object-cover" />
                          </div>
                          <span
                            className="font-extrabold tracking-wide text-slate-900 uppercase"
                            style={{ fontSize: 15 }}
                          >
                            Fare Collection System
                          </span>
                        </div>
                      </div>
                    </div>
                  }
                />
                <p className={`text-center text-[10px] mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  Tap the card to flip
                </p>

                {/* Quick facts below the card */}
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div className={`rounded-lg border px-3 py-2 ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Balance</span>
                    <div className={`text-sm font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                      {formatPeso(previewUser.balance || 0)}
                    </div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</span>
                    <div className={`text-sm font-semibold ${previewUser.status === "Active" ? (isDark ? "text-emerald-400" : "text-emerald-600") : (isDark ? "text-red-400" : "text-red-600")}`}>
                      {previewUser.status}
                    </div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card Valid Until</span>
                    <div className={`text-sm font-semibold font-mono ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                      {formatDate(previewUser.expirationDate)}
                    </div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      <LinkIcon size={10} /> Linked Account
                    </span>
                    <div className={`text-sm font-mono ${normalizeEmail(previewUser.email) ? (isDark ? "text-blue-400" : "text-blue-600") : (isDark ? "text-slate-500 italic" : "text-slate-400 italic")}`}>
                      {normalizeEmail(previewUser.email) ?? "No account linked"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setPreviewUser(null)}
              className={`text-xs font-medium cursor-pointer ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500"}`}
            >
              Close
            </Button>
            {/* 🔒 Renew Card button — makikita lang kapag may permission (hindi view_only) */}
            {canManage && previewUser && (
              <Button
                onClick={() => {
                  const user = previewUser;
                  setPreviewUser(null);
                  openRenew(user);
                }}
                disabled={!isCardExpired(previewUser.expirationDate)}
                title={!isCardExpired(previewUser.expirationDate) ? `Not yet expired — valid until ${formatDate(previewUser.expirationDate)}` : undefined}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Renew Card
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog — same layout/scroll pattern as Card Registration:
          the whole modal scrolls (max-h-[92vh] + overflow-y-auto) and the
          Region / Province / City / Barangay fields use the virtualized,
          searchable LocationCombobox instead of Radix <Select>, which is what
          made long lists (barangays) laggy.
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">Contact Number</label>
                  <Input
                    value={editForm.contactNumber}
                    onChange={(e) =>
                      setEditForm((c) => ({ ...c, contactNumber: e.target.value.replace(/\D/g, "").slice(0, 11) }))
                    }
                    placeholder="09XXXXXXXXX"
                    inputMode="numeric"
                    maxLength={11}
                    disabled={isSavingEdit}
                    className={`${editInputCls} font-mono`}
                  />
                </div>
              </div>
            </div>

            {/* ADDRESS */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-500" />
                <h3 className="font-semibold">Address</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Street Address</label>
                  <Input
                    value={editForm.streetAddress}
                    onChange={(e) => setEditForm((c) => ({ ...c, streetAddress: e.target.value }))}
                    placeholder="House number, street, sitio"
                    disabled={isSavingEdit}
                    className={editInputCls}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Region</label>
                  <LocationCombobox
                    options={REGION_COMBO_OPTIONS}
                    value={editForm.regionCode}
                    selectedName={editForm.regionName}
                    onChange={(code, name) => {
                      setEditForm((c) => ({
                        ...c,
                        regionCode: code,
                        regionName: name,
                        provinceCode: "",
                        provinceName: "",
                        cityCode: "",
                        cityName: "",
                        barangayCode: "",
                        barangayName: "",
                      }));
                      setProvinceOptions([]);
                      setCityOptions([]);
                      setBarangayOptions([]);
                    }}
                    placeholder="Select region"
                    disabled={isSavingEdit}
                    isDark={isDark}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Province</label>
                  <LocationCombobox
                    options={provinceOptions}
                    value={editForm.provinceCode}
                    selectedName={editForm.provinceName}
                    onChange={(code, name) => {
                      setEditForm((c) => ({
                        ...c,
                        provinceCode: code,
                        provinceName: name,
                        cityCode: "",
                        cityName: "",
                        barangayCode: "",
                        barangayName: "",
                      }));
                      setCityOptions([]);
                      setBarangayOptions([]);
                    }}
                    placeholder="Select province"
                    loadingPlaceholder="Loading provinces..."
                    loading={isLoadingAddressOptions}
                    disabled={isSavingEdit || !editForm.regionCode}
                    isDark={isDark}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">City / Municipality</label>
                  <LocationCombobox
                    options={cityOptions}
                    value={editForm.cityCode}
                    selectedName={editForm.cityName}
                    onChange={(code, name) => {
                      setEditForm((c) => ({
                        ...c,
                        cityCode: code,
                        cityName: name,
                        barangayCode: "",
                        barangayName: "",
                      }));
                      setBarangayOptions([]);
                    }}
                    placeholder="Select city / municipality"
                    loadingPlaceholder="Loading cities..."
                    loading={isLoadingAddressOptions}
                    disabled={isSavingEdit || !editForm.provinceCode}
                    isDark={isDark}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Barangay</label>
                  <LocationCombobox
                    options={barangayOptions}
                    value={editForm.barangayCode}
                    selectedName={editForm.barangayName}
                    onChange={(code, name) =>
                      setEditForm((c) => ({ ...c, barangayCode: code, barangayName: name }))
                    }
                    placeholder="Select barangay"
                    loadingPlaceholder="Loading barangays..."
                    loading={isLoadingAddressOptions}
                    disabled={isSavingEdit || !editForm.cityCode}
                    isDark={isDark}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">ZIP Code</label>
                  <Input
                    value={editForm.zipCode}
                    onChange={(e) =>
                      setEditForm((c) => ({ ...c, zipCode: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                    }
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="6710"
                    disabled={isSavingEdit}
                    className={`${editInputCls} font-mono`}
                  />
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
                disabled={!hasChanges || isSavingEdit}
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
    </div>
  );
}