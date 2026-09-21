import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  useCreateUser,
  useListRecentUsers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";
import { motion } from "framer-motion";

import {
  CreditCard,
  Plus,
  CheckCircle2,
  UserRound,
  MapPin,
  IdCard,
  Upload,
  X,
  Loader2,
  CalendarDays,
  ChevronsUpDown,
  Check,
  Search,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ✅ FIX: use the SAME theme hook/path as TransactionsPage so both pages
// stay in sync with dark/light mode using identical logic.
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/hooks/use-toast";

// 🔒 ADMIN ACCESS: nagbibigay ng `canManage` (false kapag view_only ang admin)
// at `loaded` (true kapag tapos na ma-fetch ang access info).
import { useAdminAccess } from "@/hooks/use-admin-access";

const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

const ID_IMAGE_BUCKET = "id-verifications";
const MAX_ID_IMAGE_SIZE = 5 * 1024 * 1024;

interface PsgcOption {
  code: string;
  name: string;
}

function normalizePsgc(rows: any[]): PsgcOption[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      code: String(row?.code ?? ""),
      name: String(row?.name ?? ""),
    }))
    .filter((row) => row.code && row.name);
}

async function fetchPsgc(path: string): Promise<PsgcOption[]> {
  const response = await fetch(`${PSGC_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Failed to load PSGC data: ${response.status}`);
  }

  const data = await response.json();

  return normalizePsgc(data);
}

// 🧩 Builds the human-readable full address string from the individual
// street / region / province / city / barangay / zip fields. Used both to
// auto-fill the "Full Address" textarea, and as a fallback when submitting
// in case the textarea was somehow left empty.
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
    streetAddress.trim(),
    barangayName,
    cityName,
    provinceName,
    regionName && zipCode
      ? `${regionName} ${zipCode}`
      : regionName || zipCode,
  ]
    .filter(Boolean)
    .join(", ");
}

const INITIAL_FORM = {
  cardUid: "",
  fullName: "",
  dob: "",
  contactNumber: "",
  type: "Regular",

  streetAddress: "",
  zipCode: "",

  regionCode: "",
  regionName: "",

  provinceCode: "",
  provinceName: "",

  cityCode: "",
  cityName: "",

  barangayCode: "",
  barangayName: "",

  // 📝 Auto-generated (but user-editable) full address textarea value.
  fullAddress: "",
};

function SuccessTitle({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2.5} />
      {text}
    </span>
  );
}

// ✳️ Red asterisk shown next to every REQUIRED field label (e.g. "Full Name *").
// aria-hidden keeps screen readers from reading out "star" on every label.
function RequiredMark() {
  return (
    <span className="ml-0.5 font-bold text-red-500" aria-hidden="true">
      *
    </span>
  );
}

// 📐 COMPACT MODAL STYLES — shared by every field in the registration modal
// so the whole form stays small, aligned, and consistent.
const MODAL_LABEL_CLASS = "text-xs font-medium leading-none";
const MODAL_INPUT_CLASS = "h-8 px-2.5 text-xs";

// Small section heading (icon + title) used in the modal.
function SectionTitle({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-cyan-500" />
      <h3 className="text-sm font-semibold leading-none">{text}</h3>
    </div>
  );
}

// 🎨 Card type -> color mapping (old table style)
// 🟥 Regular  🟦 Student  🟨 Senior  🟩 PWD
// Card type colors: Regular = red, Student = blue, Senior = orange, PWD = green
function getTypeBadgeStyle(type: string | null | undefined, isDark: boolean) {
  const t = (type || "Regular").toLowerCase();
  switch (t) {
    case "student":
      return isDark
        ? "border-blue-900 text-blue-400 bg-blue-950/40"
        : "border-blue-200 text-blue-600 bg-blue-50";
    case "senior":
      return isDark
        ? "border-orange-900 text-orange-400 bg-orange-950/40"
        : "border-orange-200 text-orange-600 bg-orange-50";
    case "pwd":
      return isDark
        ? "border-green-900 text-green-400 bg-green-950/40"
        : "border-green-200 text-green-600 bg-green-50";
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
      return "bg-orange-500";
    case "pwd":
      return "bg-green-500";
    case "regular":
    default:
      return "bg-red-500";
  }
}

// Text color for the Card Type dropdown options, matching the badge scheme above
function getTypeTextColor(type: string, isDark: boolean) {
  const t = type.toLowerCase();
  switch (t) {
    case "student":
      return isDark ? "text-blue-400" : "text-blue-600";
    case "senior":
      return isDark ? "text-orange-400" : "text-orange-600";
    case "pwd":
      return isDark ? "text-green-400" : "text-green-600";
    case "regular":
    default:
      return isDark ? "text-red-400" : "text-red-600";
  }
}

/*
 * LOCATION COMBOBOX
 *
 * Why this exists: the PSGC address lists (especially barangays — some
 * cities like Manila have ~900 of them) were being rendered as full DOM
 * trees inside Radix's <Select>, which is what caused the scroll lag.
 *
 * This component only ever renders ~15 visible rows (+ a small overscan
 * buffer) no matter how long the underlying list is, and windows the rest
 * off-screen using a spacer div. It also adds type-to-filter search, which
 * makes long lists (barangays especially) much faster to use than scrolling.
 */
const COMBOBOX_ITEM_HEIGHT = 32;
const COMBOBOX_LIST_HEIGHT = 220;
const COMBOBOX_OVERSCAN = 6;

interface LocationComboboxProps {
  options: PsgcOption[];
  value: string;
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

    return options.filter((option) =>
      option.name.toLowerCase().includes(query)
    );
  }, [options, search]);

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
        <button
          type="button"
          disabled={disabled}
          className={`flex h-8 w-full items-center justify-between rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isDark
              ? "border-slate-800 bg-slate-950 text-slate-200"
              : "border-slate-200 bg-white text-slate-900"
          }`}
        >
          <span className={`truncate ${!selected ? "opacity-50" : ""}`}>
            {selected?.name ??
              (loading ? loadingPlaceholder ?? "Loading..." : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={`w-[--radix-popover-trigger-width] min-w-[200px] p-0 ${
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
            placeholder="Search..."
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
          {filtered.length === 0 ? (
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
                        onChange(option.code, option.name);
                        setOpen(false);
                      }}
                      style={{ height: COMBOBOX_ITEM_HEIGHT }}
                      className={`flex w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                        isSelected
                          ? isDark
                            ? "bg-cyan-950/40 text-cyan-400"
                            : "bg-cyan-50 text-cyan-700"
                          : isDark
                            ? "text-slate-200 hover:bg-slate-800"
                            : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected ? "opacity-100" : "opacity-0"
                        }`}
                      />
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

export default function CardRegistrationPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ✅ FIX: same hook signature as TransactionsPage — { isDark } destructured
  // directly instead of deriving it from a separate `theme` string. This
  // keeps both pages reacting identically when the user toggles the theme.
  const { isDark } = useTheme();

  // 🔒 ADMIN ACCESS: `canManage` = false kapag view_only.
  // `loaded` = true kapag tapos na ma-load ang access info (para hindi
  // mag-flash ang button habang naglo-load pa).
  const { canManage, loaded } = useAdminAccess();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmittingImage, setIsSubmittingImage] = useState(false);

  const [form, setForm] = useState(INITIAL_FORM);

  const [idImageFile, setIdImageFile] = useState<File | null>(null);
  const [idImagePreview, setIdImagePreview] = useState<string | null>(null);

  const [regions, setRegions] = useState<PsgcOption[]>([]);
  const [provinces, setProvinces] = useState<PsgcOption[]>([]);
  const [cities, setCities] = useState<PsgcOption[]>([]);
  const [barangays, setBarangays] = useState<PsgcOption[]>([]);

  const [loadingRegions, setLoadingRegions] = useState(false);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingBarangays, setLoadingBarangays] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ✅ Realtime pulse state (same pattern as TransactionsPage)
  const [isPulsing, setIsPulsing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const prevCountRef = useRef<number>(0);

  const {
    data: recentUsersData,
    isLoading: isLoadingRecentUsers,
    refetch: refetchRecentUsers,
  } = useListRecentUsers({
    query: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  // Mag-subscribe sa Postgres changes ng users table. Tuwing may bagong
  // na-register na card (INSERT) o na-edit (UPDATE), mag-re-refetch —
  // parehong pattern gaya ng ginagamit sa TransactionsPage.
  useRealtimeRefetch(["users"], () => {
    refetchRecentUsers();
  });

  const recentUsers =
    (recentUsersData as any)?.users ??
    (recentUsersData as any)?.data ??
    (Array.isArray(recentUsersData) ? recentUsersData : []) ??
    [];

  // ✅ Detect new card registered → pulse animation on the newest row
  useEffect(() => {
    const count = Array.isArray(recentUsers) ? recentUsers.length : 0;

    if (prevCountRef.current !== 0 && count !== prevCountRef.current) {
      setIsPulsing(true);
      setTimeout(() => setIsPulsing(false), 800);
    }

    prevCountRef.current = count;
    setLastUpdated(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentUsers.length]);

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();

        toast({
          title: <SuccessTitle text="Card Registered Successfully" />,
        });

        closeModal();
      },

      onError: (error: any) => {
        const status =
          error?.response?.status ??
          error?.status ??
          error?.response?.data?.status;

        const message: string =
          error?.response?.data?.message ??
          error?.response?.data?.error ??
          error?.message ??
          "";

        if (status === 409) {
          toast({
            title: "Card Already Registered",
            description:
              message ||
              "This RFID card UID is already registered.",
            variant: "destructive",
          });

          return;
        }

        if (status === 400) {
          toast({
            title: "Invalid Registration",
            description:
              message ||
              "Please check the information you entered.",
            variant: "destructive",
          });

          return;
        }

        toast({
          title: "Registration Failed",
          description:
            message ||
            "Unable to register the card. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const isSubmitting =
    createMutation.isPending || isSubmittingImage;

  const requiresIdImage = form.type !== "Regular";

  /*
   * LOAD REGIONS
   */
  useEffect(() => {
    let cancelled = false;

    async function loadRegions() {
      try {
        setLoadingRegions(true);

        const data = await fetchPsgc("/regions/");

        if (!cancelled) {
          setRegions(data);
        }
      } catch (error) {
        console.error("Failed to load regions:", error);

        if (!cancelled) {
          toast({
            title: "Unable to Load Regions",
            description:
              "The Philippine address list could not be loaded.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingRegions(false);
        }
      }
    }

    loadRegions();

    return () => {
      cancelled = true;
    };
  }, [toast]);

  /*
   * LOAD PROVINCES
   */
  useEffect(() => {
    if (!form.regionCode) {
      setProvinces([]);
      return;
    }

    let cancelled = false;

    async function loadProvinces() {
      try {
        setLoadingProvinces(true);

        const data = await fetchPsgc(
          `/regions/${form.regionCode}/provinces/`
        );

        if (!cancelled) {
          setProvinces(data);
        }
      } catch (error) {
        console.error("Failed to load provinces:", error);

        if (!cancelled) {
          setProvinces([]);

          toast({
            title: "Unable to Load Provinces",
            description:
              "Please try selecting the region again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingProvinces(false);
        }
      }
    }

    loadProvinces();

    return () => {
      cancelled = true;
    };
  }, [form.regionCode, toast]);

  /*
   * LOAD CITIES / MUNICIPALITIES
   */
  useEffect(() => {
    if (!form.provinceCode) {
      setCities([]);
      return;
    }

    let cancelled = false;

    async function loadCities() {
      try {
        setLoadingCities(true);

        const data = await fetchPsgc(
          `/provinces/${form.provinceCode}/cities-municipalities/`
        );

        if (!cancelled) {
          setCities(data);
        }
      } catch (error) {
        console.error("Failed to load cities:", error);

        if (!cancelled) {
          setCities([]);

          toast({
            title: "Unable to Load Cities",
            description:
              "Please try selecting the province again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingCities(false);
        }
      }
    }

    loadCities();

    return () => {
      cancelled = true;
    };
  }, [form.provinceCode, toast]);

  /*
   * LOAD BARANGAYS
   */
  useEffect(() => {
    if (!form.cityCode) {
      setBarangays([]);
      return;
    }

    let cancelled = false;

    async function loadBarangays() {
      try {
        setLoadingBarangays(true);

        const data = await fetchPsgc(
          `/cities-municipalities/${form.cityCode}/barangays/`
        );

        if (!cancelled) {
          setBarangays(data);
        }
      } catch (error) {
        console.error("Failed to load barangays:", error);

        if (!cancelled) {
          setBarangays([]);

          toast({
            title: "Unable to Load Barangays",
            description:
              "Please try selecting the city/municipality again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingBarangays(false);
        }
      }
    }

    loadBarangays();

    return () => {
      cancelled = true;
    };
  }, [form.cityCode, toast]);

  /*
   * AUTO-FILL FULL ADDRESS
   *
   * Every time the street address or any of the location dropdowns change,
   * rebuild the "Full Address" textarea value automatically. The textarea
   * itself stays editable (onChange calls updateForm("fullAddress", ...)),
   * but any dropdown change will re-sync it — this matches "auto-fill based
   * on the selected dropdowns" behavior.
   */
  useEffect(() => {
    const computed = buildFullAddress({
      streetAddress: form.streetAddress,
      barangayName: form.barangayName,
      cityName: form.cityName,
      provinceName: form.provinceName,
      regionName: form.regionName,
      zipCode: form.zipCode,
    });

    setForm((current) => ({
      ...current,
      fullAddress: computed,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.streetAddress,
    form.barangayName,
    form.cityName,
    form.provinceName,
    form.regionName,
    form.zipCode,
  ]);

  /*
   * OPEN MODAL
   */
  const openModal = useCallback(() => {
    // 🔒 Safety guard: bawal magbukas ng modal kapag view_only
    if (!canManage) {
      return;
    }

    setForm(INITIAL_FORM);

    setIdImageFile(null);
    setIdImagePreview(null);

    setProvinces([]);
    setCities([]);
    setBarangays([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setIsModalOpen(true);
  }, [canManage]);

  /*
   * CLOSE MODAL
   */
  const closeModal = useCallback(() => {
    if (idImagePreview) {
      URL.revokeObjectURL(idImagePreview);
    }

    setIsModalOpen(false);

    setForm(INITIAL_FORM);

    setIdImageFile(null);
    setIdImagePreview(null);

    setProvinces([]);
    setCities([]);
    setBarangays([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [idImagePreview]);

  /*
   * FORM FIELD UPDATE
   */
  function updateForm(
    field: keyof typeof INITIAL_FORM,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  /*
   * REGION CHANGE
   */
  function handleRegionChange(code: string, name: string) {
    setForm((current) => ({
      ...current,

      regionCode: code,
      regionName: name,

      provinceCode: "",
      provinceName: "",

      cityCode: "",
      cityName: "",

      barangayCode: "",
      barangayName: "",
    }));

    setCities([]);
    setBarangays([]);
  }

  /*
   * PROVINCE CHANGE
   */
  function handleProvinceChange(code: string, name: string) {
    setForm((current) => ({
      ...current,

      provinceCode: code,
      provinceName: name,

      cityCode: "",
      cityName: "",

      barangayCode: "",
      barangayName: "",
    }));

    setBarangays([]);
  }

  /*
   * CITY CHANGE
   */
  function handleCityChange(code: string, name: string) {
    setForm((current) => ({
      ...current,

      cityCode: code,
      cityName: name,

      barangayCode: "",
      barangayName: "",
    }));
  }

  /*
   * BARANGAY CHANGE
   */
  function handleBarangayChange(code: string, name: string) {
    setForm((current) => ({
      ...current,

      barangayCode: code,
      barangayName: name,
    }));
  }

  /*
   * IMAGE SELECT
   */
  function handleImageSelect(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid File",
        description:
          "Please select an image file.",
        variant: "destructive",
      });

      event.target.value = "";
      return;
    }

    if (file.size > MAX_ID_IMAGE_SIZE) {
      toast({
        title: "Image Too Large",
        description:
          "The ID image must be 5 MB or smaller.",
        variant: "destructive",
      });

      event.target.value = "";
      return;
    }

    if (idImagePreview) {
      URL.revokeObjectURL(idImagePreview);
    }

    const previewUrl = URL.createObjectURL(file);

    setIdImageFile(file);
    setIdImagePreview(previewUrl);
  }

  /*
   * CLEAR IMAGE
   */
  function clearImage() {
    if (idImagePreview) {
      URL.revokeObjectURL(idImagePreview);
    }

    setIdImageFile(null);
    setIdImagePreview(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  /*
   * UPLOAD IMAGE DIRECTLY TO SUPABASE STORAGE
   */
  async function uploadIdImage(): Promise<{
    path: string;
    publicUrl: string;
  } | null> {
    if (!idImageFile) {
      return null;
    }

    const safeUid = form.cardUid
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "");

    if (!safeUid) {
      throw new Error(
        "Invalid RFID card UID."
      );
    }

    const extension =
      idImageFile.name
        .split(".")
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "jpg";

    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}.${extension}`;

    const filePath = `${safeUid}/${fileName}`;

    const {
      error: uploadError,
    } = await supabase.storage
      .from(ID_IMAGE_BUCKET)
      .upload(filePath, idImageFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: idImageFile.type,
      });

    if (uploadError) {
      throw new Error(
        uploadError.message ||
          "Failed to upload ID image to Supabase Storage."
      );
    }

    const {
      data: publicUrlData,
    } = supabase.storage
      .from(ID_IMAGE_BUCKET)
      .getPublicUrl(filePath);

    if (!publicUrlData?.publicUrl) {
      await supabase.storage
        .from(ID_IMAGE_BUCKET)
        .remove([filePath]);

      throw new Error(
        "ID image was uploaded, but its public URL could not be generated."
      );
    }

    return {
      path: filePath,
      publicUrl: publicUrlData.publicUrl,
    };
  }

  /*
   * SUBMIT
   */
  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    // 🔒 Safety guard: kahit ma-bypass ang UI, hindi tutuloy ang submit
    // kapag view_only ang admin.
    if (!canManage) {
      toast({
        title: "View Only Access",
        description:
          "You don't have permission to register cards.",
        variant: "destructive",
      });

      return;
    }

    if (isSubmitting) {
      return;
    }

    /*
     * BASIC VALIDATION
     */
    const normalizedCardUid = form.cardUid
      .trim()
      .toUpperCase();
    const normalizedContactNumber = form.contactNumber
      .trim();

    if (!/^[A-Z0-9]{8}$/.test(normalizedCardUid)) {
      toast({
        title: "Invalid Card UID",
        description: "RFID Card UID must be exactly 8 characters (letters and numbers only).",
        variant: "destructive",
      });
      return;
    }

    if (!/^\d{11}$/.test(normalizedContactNumber)) {
      toast({
        title: "Invalid Contact Number",
        description: "Contact number must be exactly 11 digits.",
        variant: "destructive",
      });
      return;
    }

    if (!form.fullName.trim()) {
      toast({
        title: "Full Name Required",
        description:
          "Please enter the card holder's full name.",
        variant: "destructive",
      });

      return;
    }

    if (!form.dob) {
      toast({
        title: "Date of Birth Required",
        description:
          "Please select the date of birth.",
        variant: "destructive",
      });

      return;
    }

    if (!form.contactNumber.trim()) {
      toast({
        title: "Contact Number Required",
        description:
          "Please enter the contact number.",
        variant: "destructive",
      });

      return;
    }

    if (!form.regionCode) {
      toast({
        title: "Region Required",
        description:
          "Please select the region.",
        variant: "destructive",
      });

      return;
    }

    if (!form.cityCode) {
      toast({
        title: "City/Municipality Required",
        description:
          "Please select the city or municipality.",
        variant: "destructive",
      });

      return;
    }

    if (!form.barangayCode) {
      toast({
        title: "Barangay Required",
        description:
          "Please select the barangay.",
        variant: "destructive",
      });

      return;
    }

    if (
      requiresIdImage &&
      !idImageFile
    ) {
      toast({
        title: "ID Image Required",
        description:
          `${form.type} registration requires an ID image.`,
        variant: "destructive",
      });

      return;
    }

    let uploadedImagePath: string | null = null;

    try {
      setIsSubmittingImage(true);

      /*
       * IMAGE IS UPLOADED DIRECTLY TO SUPABASE.
       * IT IS NOT CONVERTED TO BASE64.
       */
      const uploadedImage =
        await uploadIdImage();

      uploadedImagePath =
        uploadedImage?.path ?? null;

      /*
       * ONLY THE SUPABASE URL IS SENT TO RENDER.
       */
      const idImagePath =
        uploadedImage?.publicUrl ?? null;

      /*
       * FULL ADDRESS
       * Uses the (auto-filled, but user-editable) textarea value.
       * Falls back to a freshly computed string in the unlikely case the
       * textarea is empty.
       */
      const fullAddress =
        form.fullAddress.trim() ||
        buildFullAddress({
          streetAddress: form.streetAddress,
          barangayName: form.barangayName,
          cityName: form.cityName,
          provinceName: form.provinceName,
          regionName: form.regionName,
          zipCode: form.zipCode,
        });

      /*
       * REGISTER USER
       */
      await createMutation.mutateAsync({
        data: {
          cardUid: normalizedCardUid,

          fullName:
            form.fullName.trim(),

          dateOfBirth:
            form.dob,

          contactNumber: normalizedContactNumber,

          type:
            form.type,

          streetAddress:
            form.streetAddress.trim() ||
            null,

          zipCode:
            form.zipCode.trim() ||
            null,

          regionCode:
            form.regionCode,

          regionName:
            form.regionName,

          provinceCode:
            form.provinceCode ||
            null,

          provinceName:
            form.provinceName ||
            null,

          cityCode:
            form.cityCode,

          cityName:
            form.cityName,

          barangayCode:
            form.barangayCode,

          barangayName:
            form.barangayName,

          fullAddress,

          /*
           * SUPABASE PUBLIC URL
           * NOT BASE64
           */
          idImagePath,

          initialBalance: 0,
        },
      });
    } catch (error: any) {
      console.error(
        "Card registration error:",
        error
      );

      /*
       * REMOVE ORPHAN IMAGE IF API REGISTRATION FAILS
       */
      if (uploadedImagePath) {
        try {
          await supabase.storage
            .from(ID_IMAGE_BUCKET)
            .remove([
              uploadedImagePath,
            ]);
        } catch (cleanupError) {
          console.error(
            "Failed to remove orphan ID image:",
            cleanupError
          );
        }
      }

      const message =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        error?.message ??
        "Unable to register the card.";

      if (!error?.response) {
        toast({
          title:
            "Registration Failed",
          description: message,
          variant:
            "destructive",
        });
      }
    } finally {
      setIsSubmittingImage(false);
    }
  }

  return (
    <div className="space-y-6">
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

        .location-combobox-list {
          scrollbar-width: thin;
          will-change: scroll-position;
          transform: translateZ(0);
          -webkit-overflow-scrolling: touch;
        }
        .location-combobox-list::-webkit-scrollbar {
          width: 6px;
        }
        .location-combobox-list::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.4);
          border-radius: 9999px;
        }
      `}</style>

      {/* PAGE HEADER — same logo + text positioning/color pattern as TransactionsPage */}
      <div
        className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${
          isDark ? "border-slate-800" : "border-slate-200"
        }`}
      >
        <div>
          <h1
            className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            <CreditCard className="text-blue-500" size={26} />
            Card Registration
          </h1>

          <p
            className={`text-sm mt-1 ${
              isDark ? "text-slate-400" : "text-slate-500"
            }`}
          >
            Register RFID cards and card holder information
          </p>
        </div>

        {/* Register button remains visible; view-only users see it disabled. */}
        {loaded && (
          <div className="flex items-center gap-2">
            <Button
              onClick={openModal}
              disabled={!canManage}
              aria-disabled={!canManage}
              className={`gap-2 ${!canManage ? "cursor-not-allowed opacity-50" : ""}`}
              title={!canManage ? "View Only" : "Register a new card"}
            >
              <Plus className="h-4 w-4" />
              Register New Card
            </Button>
            {!canManage && (
              <Badge variant="secondary" className="text-xs">
                View Only
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* RECENT USERS — realtime table (badges, dot colors, LIVE indicator, row pulse, last sync) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <CardHeader className={`flex flex-row items-center justify-between border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
            <div>
              <CardTitle className={`text-sm font-bold flex items-center gap-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                Recently Registered Cards
                <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ml-2 ${
                  isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                }`}>
                  <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                  LIVE
                </span>
              </CardTitle>
              <CardDescription className={`text-xs flex items-center gap-2 mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Latest registered RFID cards
                {lastUpdated && (
                  <span className={isDark ? "text-slate-500" : "text-slate-400"}>· {lastUpdated.toLocaleTimeString()}</span>
                )}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {isLoadingRecentUsers ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
                ))}
              </div>
            ) : recentUsers.length === 0 ? (
              <div className={`flex flex-col items-center py-16 ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                <Plus size={48} className="mb-2" />
                <p className="text-xs font-semibold uppercase tracking-widest">
                  No cards registered yet
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className={`border-b hover:bg-transparent ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Card UID</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Full Name</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Type</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Contact</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Balance</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {recentUsers.map((user: any, index: number) => {
                      const cardUid = user.cardUid || user.card_uid || "N/A";
                      const fullName = user.fullName || user.full_name || "N/A";
                      const contactNumber = user.contactNumber || user.contact_number || "N/A";
                      const type = user.type || "Regular";
                      const status = user.status || "Active";

                      return (
                        <TableRow
                          key={user.id}
                          className={`transition-colors group ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                            isPulsing && index === 0 ? "row-pulse" : ""
                          }`}
                        >
                          <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                            {cardUid}
                          </TableCell>
                          <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                            {fullName}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-semibold flex items-center gap-1 w-fit ${getTypeBadgeStyle(type, isDark)}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full inline-block ${getTypeDotColor(type)}`} />
                              {type}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            {contactNumber}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-emerald-500">
                            ₱{Number(user.balance ?? 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={`${
                              status === "Active"
                                ? isDark
                                  ? "bg-emerald-950/40 text-emerald-400 border-emerald-900"
                                  : "bg-emerald-50 text-emerald-600 border-emerald-200"
                                : isDark
                                  ? "bg-red-950/40 text-red-400 border-red-900"
                                  : "bg-red-50 text-red-600 border-red-200"
                            } text-[10px] font-semibold px-2 py-0.5 border`}>
                              {status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* REGISTRATION MODAL — 🔒 hindi na-re-render kapag view_only
          Same layout/positions as the original (single column, stacked
          sections, 2-column address grid) — just shrunk so it fits the
          screen without a visible scrollbar. */}
      {canManage && (
        <Dialog
          open={isModalOpen}
          onOpenChange={(open) => {
            if (!open && !isSubmitting) {
              closeModal();
            }
          }}
        >
          <DialogContent
            className={`max-h-[96vh] w-[calc(100vw-1.5rem)] gap-3 overflow-y-auto overflow-x-hidden p-4 sm:max-w-4xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              isDark
                ? "border-slate-800 bg-slate-950"
                : "bg-white"
            }`}
          >
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="flex items-center gap-2 text-base">
                Register New RFID Card
              </DialogTitle>

              {/* Legend for the red asterisks */}
              <p
                className={`text-[11px] ${
                  isDark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                Fields marked with <RequiredMark /> are required.
              </p>
            </DialogHeader>

            <form
              onSubmit={handleSubmit}
              className="space-y-3"
            >
              {/* CARD INFORMATION */}
              <div className="space-y-2">
                <SectionTitle icon={CreditCard} text="Card Information" />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      RFID Card UID
                      <RequiredMark />
                    </label>

                    <Input
                      value={form.cardUid}
                      onChange={(event) =>
                        updateForm(
                          "cardUid",
                          event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, "")
                            .slice(0, 8)
                        )
                      }
                      placeholder="8-character UID"
                      disabled={isSubmitting}
                      maxLength={8}
                      inputMode="text"
                      aria-required="true"
                      className={MODAL_INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Card Type
                      <RequiredMark />
                    </label>

                    <Select
                      value={form.type}
                      onValueChange={(value) =>
                        updateForm("type", value)
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger className={MODAL_INPUT_CLASS}>
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        {["Regular", "Student", "Senior", "PWD"].map(
                          (option) => (
                            <SelectItem
                              key={option}
                              value={option}
                              className="text-xs"
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-2 w-2 rounded-full ${getTypeDotColor(option)}`}
                                />
                                <span
                                  className={getTypeTextColor(option, isDark)}
                                >
                                  {option}
                                </span>
                              </span>
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* ID IMAGE */}
              {requiresIdImage && (
                <div className="space-y-2">
                  <SectionTitle icon={IdCard} text="ID Verification" />

                  <div
                    className={`rounded-lg border p-3 ${
                      isDark
                        ? "border-slate-800 bg-slate-900/40"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {idImagePreview ? (
                        <div className="relative shrink-0">
                          <img
                            src={idImagePreview}
                            alt="ID preview"
                            className="h-20 w-36 rounded-md border object-cover"
                          />

                          <button
                            type="button"
                            onClick={clearImage}
                            disabled={isSubmitting}
                            className={`absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm ${
                              isDark
                                ? "border-slate-700 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700"
                            }`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isSubmitting}
                          className={`flex h-20 w-36 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed transition-colors ${
                            isDark
                              ? "border-slate-700 hover:border-cyan-500 hover:bg-slate-900"
                              : "border-slate-300 hover:border-cyan-500 hover:bg-white"
                          }`}
                        >
                          <Upload className="mb-1 h-5 w-5 opacity-50" />

                          <span className="text-xs font-medium">
                            Upload ID Image
                            <RequiredMark />
                          </span>

                          <span className="text-[10px] opacity-60">
                            JPG, PNG, WEBP up to 5 MB
                          </span>
                        </button>
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs font-medium">
                          {form.type} ID
                          <RequiredMark />
                        </p>

                        <p
                          className={`text-[11px] ${
                            isDark ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          Upload a clear image of the valid identification
                          document for the selected card type.
                        </p>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageSelect}
                          disabled={isSubmitting}
                        />

                        {idImageFile && (
                          <div className="flex items-center gap-2">
                            <span
                              className={`min-w-0 flex-1 truncate text-[11px] ${
                                isDark ? "text-slate-300" : "text-slate-600"
                              }`}
                            >
                              {idImageFile.name}
                              {" • "}
                              {(idImageFile.size / 1024 / 1024).toFixed(2)}
                              {" MB"}
                            </span>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isSubmitting}
                              className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                            >
                              <Upload className="h-3 w-3" />
                              Change Image
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PERSONAL INFORMATION */}
              <div className="space-y-2">
                <SectionTitle icon={UserRound} text="Personal Information" />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <label className={MODAL_LABEL_CLASS}>
                      Full Name
                      <RequiredMark />
                    </label>

                    <Input
                      value={form.fullName}
                      onChange={(event) =>
                        updateForm("fullName", event.target.value)
                      }
                      placeholder="Enter full name"
                      disabled={isSubmitting}
                      aria-required="true"
                      className={MODAL_INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Date of Birth
                      <RequiredMark />
                    </label>

                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />

                      <Input
                        type="date"
                        value={form.dob}
                        onChange={(event) =>
                          updateForm("dob", event.target.value)
                        }
                        className={`${MODAL_INPUT_CLASS} pl-8`}
                        disabled={isSubmitting}
                        aria-required="true"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Contact Number
                      <RequiredMark />
                    </label>

                    <Input
                      value={form.contactNumber}
                      onChange={(event) =>
                        updateForm(
                          "contactNumber",
                          event.target.value
                            .replace(/\D/g, "")
                            .slice(0, 11)
                        )
                      }
                      placeholder="09XXXXXXXXX"
                      disabled={isSubmitting}
                      maxLength={11}
                      inputMode="numeric"
                      aria-required="true"
                      className={MODAL_INPUT_CLASS}
                    />
                  </div>
                </div>
              </div>

              {/* ADDRESS */}
              <div className="space-y-2">
                <SectionTitle icon={MapPin} text="Address" />

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Row 1: Street Address + Region (equal width) */}
                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Street Address{" "}
                      <span className="font-normal text-muted-foreground">
                        (Optional)
                      </span>
                    </label>

                    <Input
                      value={form.streetAddress}
                      onChange={(event) =>
                        updateForm("streetAddress", event.target.value)
                      }
                      placeholder="House number, street, sitio"
                      disabled={isSubmitting}
                      className={MODAL_INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Region
                      <RequiredMark />
                    </label>

                    <LocationCombobox
                      options={regions}
                      value={form.regionCode}
                      onChange={handleRegionChange}
                      placeholder="Select region"
                      loadingPlaceholder="Loading regions..."
                      loading={loadingRegions}
                      disabled={isSubmitting || loadingRegions}
                      isDark={isDark}
                    />
                  </div>

                  {/* Row 2: Province + City / Municipality */}
                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Province
                      <RequiredMark />
                    </label>

                    <LocationCombobox
                      options={provinces}
                      value={form.provinceCode}
                      onChange={handleProvinceChange}
                      placeholder="Select province"
                      loadingPlaceholder="Loading provinces..."
                      loading={loadingProvinces}
                      disabled={
                        isSubmitting ||
                        !form.regionCode ||
                        loadingProvinces
                      }
                      isDark={isDark}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      City / Municipality
                      <RequiredMark />
                    </label>

                    <LocationCombobox
                      options={cities}
                      value={form.cityCode}
                      onChange={handleCityChange}
                      placeholder="Select city / municipality"
                      loadingPlaceholder="Loading cities..."
                      loading={loadingCities}
                      disabled={
                        isSubmitting ||
                        !form.provinceCode ||
                        loadingCities
                      }
                      isDark={isDark}
                    />
                  </div>

                  {/* Row 3: Barangay + ZIP Code */}
                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      Barangay
                      <RequiredMark />
                    </label>

                    <LocationCombobox
                      options={barangays}
                      value={form.barangayCode}
                      onChange={handleBarangayChange}
                      placeholder="Select barangay"
                      loadingPlaceholder="Loading barangays..."
                      loading={loadingBarangays}
                      disabled={
                        isSubmitting ||
                        !form.cityCode ||
                        loadingBarangays
                      }
                      isDark={isDark}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={MODAL_LABEL_CLASS}>
                      ZIP Code
                      <RequiredMark />
                    </label>

                    <Input
                      value={form.zipCode}
                      onChange={(event) =>
                        updateForm(
                          "zipCode",
                          event.target.value.replace(/\D/g, "")
                        )
                      }
                      placeholder="6710"
                      maxLength={10}
                      inputMode="numeric"
                      disabled={isSubmitting}
                      className={MODAL_INPUT_CLASS}
                    />
                  </div>

                  {/* Row 4: Full Address — auto-filled from the fields above, editable */}
                  <div className="space-y-1 sm:col-span-2">
                    <label className={MODAL_LABEL_CLASS}>
                      Full Address
                    </label>

                    <Textarea
                      value={form.fullAddress}
                      onChange={(event) =>
                        updateForm("fullAddress", event.target.value)
                      }
                      placeholder="Auto-filled from the fields above — you can still edit it"
                      disabled={isSubmitting}
                      rows={2}
                      className="min-h-0 resize-none px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* BUTTONS */}
              <div
                className={`flex justify-end gap-2 border-t pt-3 ${
                  isDark ? "border-slate-800" : "border-slate-200"
                }`}
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>

                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />

                      {isSubmittingImage
                        ? "Uploading ID..."
                        : "Registering..."}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Register Card
                    </>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}