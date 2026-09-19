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

import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";

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
};

function SuccessTitle({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2.5} />
      {text}
    </span>
  );
}

// 🎨 Card type -> color mapping (old table style)
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
const COMBOBOX_ITEM_HEIGHT = 36;
const COMBOBOX_LIST_HEIGHT = 260;
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
          className={`flex h-9 w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isDark
              ? "border-slate-800 bg-slate-950 text-slate-200"
              : "border-slate-200 bg-white text-slate-900"
          }`}
        >
          <span className={`truncate ${!selected ? "opacity-50" : ""}`}>
            {selected?.name ??
              (loading ? loadingPlaceholder ?? "Loading..." : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={`w-[--radix-popover-trigger-width] p-0 ${
          isDark ? "border-slate-800 bg-slate-950" : "bg-white"
        }`}
      >
        <div
          className={`flex items-center gap-2 border-b px-3 py-2 ${
            isDark ? "border-slate-800" : "border-slate-100"
          }`}
        >
          <Search className="h-4 w-4 shrink-0 opacity-50" />
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
            <div
              className={`px-3 py-6 text-center text-sm ${
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
                      className={`flex w-full items-center gap-2 px-3 text-left text-sm transition-colors ${
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
                        className={`h-4 w-4 shrink-0 ${
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
  const { theme } = useTheme();

  const isDark = theme === "dark";

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

  // ✅ Realtime pulse state (old table behavior)
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
  // na-register na card (INSERT) o na-edit (UPDATE), mag-re-refetch.
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
   * OPEN MODAL
   */
  const openModal = useCallback(() => {
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
  }, []);

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

      const fullAddress = [
        form.streetAddress.trim(),
        form.barangayName,
        form.cityName,
        form.provinceName,
        form.regionName &&
        form.zipCode
          ? `${form.regionName} ${form.zipCode}`
          : form.regionName ||
            form.zipCode,
      ]
        .filter(Boolean)
        .join(", ");

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

      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                isDark
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "bg-cyan-50 text-cyan-600"
              }`}
            >
              <CreditCard className="h-6 w-6" />
            </div>

            <div>
              <h1
                className={`text-2xl font-bold tracking-tight ${
                  isDark
                    ? "text-white"
                    : "text-slate-900"
                }`}
              >
                Card Registration
              </h1>

              <p
                className={`text-sm ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Register RFID cards and card holder information
              </p>
            </div>
          </div>
        </div>

        <Button
          onClick={openModal}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Register New Card
        </Button>
      </div>

      {/* RECENT USERS — old styled table (badges, dot colors, LIVE indicator, row pulse) */}
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

      {/* REGISTRATION MODAL */}
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            closeModal();
          }
        }}
      >
        <DialogContent
          className={`max-h-[92vh] overflow-y-auto sm:max-w-4xl ${
            isDark
              ? "border-slate-800 bg-slate-950"
              : "bg-white"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-cyan-500" />

              Register New RFID Card
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={handleSubmit}
            className="space-y-6"
          >
            {/* CARD INFORMATION */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-cyan-500" />

                <h3 className="font-semibold">
                  Card Information
                </h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    RFID Card UID
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
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Card Type
                  </label>

                  <Select
                    value={form.type}
                    onValueChange={(value) =>
                      updateForm(
                        "type",
                        value
                      )
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="Regular">
                        Regular
                      </SelectItem>

                      <SelectItem value="Student">
                        Student
                      </SelectItem>

                      <SelectItem value="Senior">
                        Senior
                      </SelectItem>

                      <SelectItem value="PWD">
                        PWD
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* ID IMAGE */}
            {requiresIdImage && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <IdCard className="h-4 w-4 text-cyan-500" />

                  <h3 className="font-semibold">
                    ID Verification
                  </h3>
                </div>

                <div
                  className={`rounded-xl border p-4 ${
                    isDark
                      ? "border-slate-800 bg-slate-900/40"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row">
                    {idImagePreview ? (
                      <div className="relative">
                        <img
                          src={idImagePreview}
                          alt="ID preview"
                          className="h-40 w-64 rounded-lg border object-cover"
                        />

                        <button
                          type="button"
                          onClick={clearImage}
                          disabled={isSubmitting}
                          className={`absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm ${
                            isDark
                              ? "border-slate-700 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          fileInputRef.current?.click()
                        }
                        disabled={isSubmitting}
                        className={`flex h-40 w-full max-w-md flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                          isDark
                            ? "border-slate-700 hover:border-cyan-500 hover:bg-slate-900"
                            : "border-slate-300 hover:border-cyan-500 hover:bg-white"
                        }`}
                      >
                        <Upload className="mb-2 h-8 w-8 opacity-50" />

                        <span className="text-sm font-medium">
                          Upload ID Image
                        </span>

                        <span className="mt-1 text-xs opacity-60">
                          JPG, PNG, WEBP up to 5 MB
                        </span>
                      </button>
                    )}

                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium">
                        {form.type} ID
                      </p>

                      <p
                        className={`text-sm ${
                          isDark
                            ? "text-slate-400"
                            : "text-slate-500"
                        }`}
                      >
                        Upload a clear image of the valid
                        identification document for the
                        selected card type.
                      </p>

                      <p
                        className={`text-xs ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        The image will be uploaded directly
                        to Supabase Storage. It will not be
                        sent as Base64 to the API server.
                      </p>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={
                          handleImageSelect
                        }
                        disabled={isSubmitting}
                      />

                      {idImageFile && (
                        <div
                          className={`rounded-md px-3 py-2 text-xs ${
                            isDark
                              ? "bg-slate-800 text-slate-300"
                              : "bg-white text-slate-600"
                          }`}
                        >
                          {idImageFile.name}
                          {" • "}
                          {(
                            idImageFile.size /
                            1024 /
                            1024
                          ).toFixed(2)}
                          {" MB"}
                        </div>
                      )}

                      {idImageFile && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            fileInputRef.current?.click()
                          }
                          disabled={isSubmitting}
                          className="gap-2"
                        >
                          <Upload className="h-4 w-4" />
                          Change Image
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PERSONAL INFORMATION */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-cyan-500" />

                <h3 className="font-semibold">
                  Personal Information
                </h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">
                    Full Name
                  </label>

                  <Input
                    value={form.fullName}
                    onChange={(event) =>
                      updateForm(
                        "fullName",
                        event.target.value
                      )
                    }
                    placeholder="Enter full name"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Date of Birth
                  </label>

                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />

                    <Input
                      type="date"
                      value={form.dob}
                      onChange={(event) =>
                        updateForm(
                          "dob",
                          event.target.value
                        )
                      }
                      className="pl-10"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Contact Number
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
                  />
                </div>
              </div>
            </div>

            {/* ADDRESS */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-500" />

                <h3 className="font-semibold">
                  Address
                </h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">
                    Street Address
                  </label>

                  <Input
                    value={form.streetAddress}
                    onChange={(event) =>
                      updateForm(
                        "streetAddress",
                        event.target.value
                      )
                    }
                    placeholder="House number, street, sitio"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Region
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Province
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    City / Municipality
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Barangay
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    ZIP Code
                  </label>

                  <Input
                    value={form.zipCode}
                    onChange={(event) =>
                      updateForm(
                        "zipCode",
                        event.target.value.replace(
                          /\D/g,
                          ""
                        )
                      )
                    }
                    placeholder="6710"
                    maxLength={10}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

            {/* BUTTONS */}
            <div
              className={`flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end ${
                isDark
                  ? "border-slate-800"
                  : "border-slate-200"
              }`}
            >
              <Button
                type="button"
                variant="outline"
                onClick={closeModal}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />

                    {isSubmittingImage
                      ? "Uploading ID..."
                      : "Registering..."}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Register Card
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}