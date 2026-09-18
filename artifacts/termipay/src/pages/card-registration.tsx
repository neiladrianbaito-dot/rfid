import { useState, useEffect, useRef, useCallback } from "react";
import {
  useCreateUser,
  useListRecentUsers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import {
  CreditCard,
  Plus,
  Cpu,
  ShieldCheck,
  Zap,
  CheckCircle2,
  UserRound,
  MapPin,
  IdCard,
  Upload,
  X,
  Loader2,
  CalendarDays,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";

// ============================================================================
// 🗺️ PSGC API — community-hosted Philippine Standard Geographic Code API
// Ginagamit ito para sa cascading Region -> Province -> City/Municipality ->
// Barangay dropdowns. Walang API key na kailangan, public read-only endpoint.
// Docs / source: https://psgc.gitlab.io/api/
// ============================================================================
const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

interface PsgcOption {
  code: string;
  name: string;
}

// Normalizes PSGC API rows (fields differ slightly per resource: name / regionName)
function normalizePsgc(rows: any[]): PsgcOption[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ code: r.code, name: r.name ?? r.regionName ?? r.provinceName ?? "" }))
    .filter((r) => r.code && r.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchPsgc(path: string): Promise<PsgcOption[]> {
  const res = await fetch(`${PSGC_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`PSGC request failed (${res.status})`);
  return normalizePsgc(await res.json());
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

// ✅ Small helper so the toast title shows a green check icon next to the text
function SuccessTitle({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2.5} />
      {text}
    </span>
  );
}

function calculateAge(dobString: string): number | null {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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

export default function CardRegistrationPage() {
  const { isDark } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ✅ Modal open state — registration form now lives inside a modal
  const [isModalOpen, setIsModalOpen] = useState(false);

  // ✅ Form fields
  const [form, setForm] = useState(INITIAL_FORM);

  // ✅ Validation error states
  const [contactError, setContactError] = useState("");
  const [cardUidError, setCardUidError] = useState("");
  const [dobError, setDobError] = useState("");
  const [idImageError, setIdImageError] = useState("");
  const [zipCodeError, setZipCodeError] = useState("");

  // ✅ ID image upload (required for Student / Senior / PWD)
  const [idImageFile, setIdImageFile] = useState<File | null>(null);
  const [idImagePreview, setIdImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ✅ PSGC address dropdown data
  const [regions, setRegions] = useState<PsgcOption[]>([]);
  const [provinces, setProvinces] = useState<PsgcOption[]>([]);
  const [cities, setCities] = useState<PsgcOption[]>([]);
  const [barangays, setBarangays] = useState<PsgcOption[]>([]);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingBarangays, setLoadingBarangays] = useState(false);
  // NCR (and a few other regions) skip straight from Region -> City/Municipality
  const [regionHasNoProvinces, setRegionHasNoProvinces] = useState(false);

  // ✅ Realtime pulse state
  const [isPulsing, setIsPulsing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const prevCountRef = useRef<number>(0);

  // Realtime: walang nakatakdang interval na, refetch na lang tuwing
  // may pagbabago sa users table (galing sa useRealtimeRefetch sa baba)
  const { data: recentUsers, isLoading, refetch: refetchRecentUsers } = useListRecentUsers({
    query: {
      refetchOnWindowFocus: true,
    },
  });

  // Mag-subscribe sa Postgres changes ng users table. Tuwing may bagong
  // na-register na card (INSERT) o na-edit (UPDATE), mag-re-refetch.
  useRealtimeRefetch(["users"], () => {
    refetchRecentUsers();
  });

  // ✅ Detect new card registered → pulse animation
  useEffect(() => {
    if (!recentUsers) return;
    const count = Array.isArray(recentUsers) ? recentUsers.length : 0;
    if (prevCountRef.current !== 0 && count !== prevCountRef.current) {
      setIsPulsing(true);
      setTimeout(() => setIsPulsing(false), 800);
    }
    prevCountRef.current = count;
    setLastUpdated(new Date());
  }, [recentUsers]);

  // ✅ Load regions once, the first time the modal opens
  useEffect(() => {
    if (!isModalOpen || regions.length > 0) return;
    setLoadingRegions(true);
    fetchPsgc("/regions/")
      .then(setRegions)
      .catch(() =>
        toast({ title: "Failed to load regions", description: "Check your internet connection.", variant: "destructive" })
      )
      .finally(() => setLoadingRegions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  // ✅ Region -> Province cascade (falls back to cities-municipalities for NCR-like regions)
  const handleRegionChange = useCallback((code: string) => {
    const region = regions.find((r) => r.code === code);
    setForm((f) => ({
      ...f,
      regionCode: code,
      regionName: region?.name ?? "",
      provinceCode: "",
      provinceName: "",
      cityCode: "",
      cityName: "",
      barangayCode: "",
      barangayName: "",
    }));
    setProvinces([]);
    setCities([]);
    setBarangays([]);
    setRegionHasNoProvinces(false);
    if (!code) return;

    setLoadingProvinces(true);
    fetchPsgc(`/regions/${code}/provinces/`)
      .then(async (data) => {
        if (data.length > 0) {
          setProvinces(data);
          return;
        }
        // Walang province (e.g. NCR) → dumeretso sa cities/municipalities
        setRegionHasNoProvinces(true);
        setLoadingCities(true);
        try {
          const cityData = await fetchPsgc(`/regions/${code}/cities-municipalities/`);
          setCities(cityData);
        } finally {
          setLoadingCities(false);
        }
      })
      .catch(() =>
        toast({ title: "Failed to load provinces", variant: "destructive" })
      )
      .finally(() => setLoadingProvinces(false));
  }, [regions, toast]);

  // ✅ Province -> City/Municipality cascade
  const handleProvinceChange = useCallback((code: string) => {
    const province = provinces.find((p) => p.code === code);
    setForm((f) => ({
      ...f,
      provinceCode: code,
      provinceName: province?.name ?? "",
      cityCode: "",
      cityName: "",
      barangayCode: "",
      barangayName: "",
    }));
    setCities([]);
    setBarangays([]);
    if (!code) return;

    setLoadingCities(true);
    fetchPsgc(`/provinces/${code}/cities-municipalities/`)
      .then(setCities)
      .catch(() =>
        toast({ title: "Failed to load cities/municipalities", variant: "destructive" })
      )
      .finally(() => setLoadingCities(false));
  }, [provinces, toast]);

  // ✅ City/Municipality -> Barangay cascade
  const handleCityChange = useCallback((code: string) => {
    const city = cities.find((c) => c.code === code);
    setForm((f) => ({
      ...f,
      cityCode: code,
      cityName: city?.name ?? "",
      barangayCode: "",
      barangayName: "",
    }));
    setBarangays([]);
    if (!code) return;

    setLoadingBarangays(true);
    fetchPsgc(`/cities-municipalities/${code}/barangays/`)
      .then(setBarangays)
      .catch(() =>
        toast({ title: "Failed to load barangays", variant: "destructive" })
      )
      .finally(() => setLoadingBarangays(false));
  }, [cities, toast]);

  const handleBarangayChange = useCallback((code: string) => {
    const barangay = barangays.find((b) => b.code === code);
    setForm((f) => ({ ...f, barangayCode: code, barangayName: barangay?.name ?? "" }));
  }, [barangays]);

  // ✅ Card UID handler — only alphanumeric, max 8 characters
  const handleCardUidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const alphanumeric = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (alphanumeric.length > 8) return; // lock at 8 characters
    setForm((f) => ({ ...f, cardUid: alphanumeric }));
    if (alphanumeric.length === 8) {
      setCardUidError("");
    } else if (alphanumeric.length > 0) {
      setCardUidError(`${8 - alphanumeric.length} character${8 - alphanumeric.length !== 1 ? "s" : ""} remaining`);
    } else {
      setCardUidError("");
    }
  };

  // ✅ Contact number handler — only allow digits, max 11 characters
  const handleContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, ""); // strip non-digits
    if (digits.length > 11) return; // lock at 11 digits
    setForm((f) => ({ ...f, contactNumber: digits }));
    if (digits.length === 11) {
      setContactError("");
    } else if (digits.length > 0) {
      setContactError(`${11 - digits.length} digit${11 - digits.length !== 1 ? "s" : ""} remaining`);
    } else {
      setContactError("");
    }
  };

  // ✅ Date of birth handler — must be a real past date
  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, dob: value }));
    if (!value) {
      setDobError("");
      return;
    }
    const age = calculateAge(value);
    if (age === null || new Date(value) > new Date()) {
      setDobError("Enter a valid birth date");
    } else if (age > 120) {
      setDobError("Please check the birth date");
    } else {
      setDobError("");
    }
  };

  // ✅ Zip code handler — digits only, max 4 (PH zip codes are 4 digits)
  const handleZipCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "");
    if (digits.length > 4) return;
    setForm((f) => ({ ...f, zipCode: digits }));
    setZipCodeError(digits.length > 0 && digits.length < 4 ? `${4 - digits.length} digit${4 - digits.length !== 1 ? "s" : ""} remaining` : "");
  };

  // ✅ ID image handlers (proof for Student / Senior / PWD discount types)
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setIdImageError("Please upload an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setIdImageError("Image must be under 5MB");
      return;
    }
    setIdImageError("");
    setIdImageFile(file);
    setIdImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clearImage = () => {
    setIdImageFile(null);
    setIdImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    return () => {
      if (idImagePreview) URL.revokeObjectURL(idImagePreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setForm(INITIAL_FORM);
    setContactError("");
    setCardUidError("");
    setDobError("");
    setIdImageError("");
    setZipCodeError("");
    clearImage();
    setProvinces([]);
    setCities([]);
    setBarangays([]);
    setRegionHasNoProvinces(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const [isSubmittingImage, setIsSubmittingImage] = useState(false);

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({ title: <SuccessTitle text="Card Registered Successfully" /> });
        closeModal();
      },
      onError: (error: any) => {
        const status = error?.response?.status ?? error?.status;
        const message: string =
          error?.response?.data?.message ??
          error?.response?.data?.error ??
          error?.message ??
          "";

        const isDuplicate =
          status === 409 ||
          message.toLowerCase().includes("already exist") ||
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique") ||
          message.toLowerCase().includes("conflict");

        if (isDuplicate) {
          toast({
            title: "Duplicate Card UID",
            description: `"${form.cardUid}" is already registered. Please use a different card.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Failed to register card", variant: "destructive" });
        }
      },
    },
  });

  const requiresIdImage = form.type !== "Regular";
  const age = calculateAge(form.dob);

  // ✅ Total / complete address — built smallest → largest so it reads naturally
  // (House/Street, Barangay, City/Municipality, Province, Region ZipCode).
  // Ito ang naka-record na buong address string, hiwalay pa rin sa mga individual
  // PSGC fields (para may structured data AND readable address sa isang tingin).
  const fullAddress = [
    form.streetAddress.trim(),
    form.barangayName,
    form.cityName,
    form.provinceName,
    form.regionName && form.zipCode ? `${form.regionName} ${form.zipCode}` : form.regionName || form.zipCode,
  ]
    .filter(Boolean)
    .join(", ");

  // ✅ Disable submit if there are validation errors or required fields are incomplete
  const isFormInvalid =
    !!contactError ||
    !!cardUidError ||
    !!dobError ||
    !!zipCodeError ||
    form.cardUid.length !== 8 ||
    form.contactNumber.length !== 11 ||
    !form.fullName.trim() ||
    !form.dob ||
    !form.regionCode ||
    !form.cityCode ||
    !form.barangayCode ||
    (requiresIdImage && !idImageFile);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.cardUid.length !== 8) {
      setCardUidError("Card UID must be exactly 8 characters");
      return;
    }
    if (form.contactNumber.length !== 11) {
      setContactError("Contact number must be exactly 11 digits");
      return;
    }
    if (!form.dob) {
      setDobError("Date of birth is required");
      return;
    }
    if (requiresIdImage && !idImageFile) {
      setIdImageError(`Upload the ${form.type} ID for verification`);
      return;
    }

    try {
      setIsSubmittingImage(true);
      const idImageBase64 = idImageFile ? await fileToBase64(idImageFile) : null;

      createMutation.mutate({
        data: {
          cardUid: form.cardUid,
          fullName: form.fullName.trim(),
          dateOfBirth: form.dob,
          age,
          contactNumber: form.contactNumber,
          type: form.type,
          address: {
            fullAddress,
            streetAddress: form.streetAddress.trim() || null,
            zipCode: form.zipCode || null,
            region: form.regionName,
            regionCode: form.regionCode,
            province: form.provinceName || null,
            provinceCode: form.provinceCode || null,
            city: form.cityName,
            cityCode: form.cityCode,
            barangay: form.barangayName,
            barangayCode: form.barangayCode,
          },
          idImage: idImageBase64, // base64 data URI — swap for an upload endpoint / presigned URL if your backend expects a file upload instead
          initialBalance: 0, // default value dahil required pa rin ito sa backend
        },
      });
    } catch {
      toast({ title: "Failed to process ID image", variant: "destructive" });
    } finally {
      setIsSubmittingImage(false);
    }
  };

  const isSubmitting = createMutation.isPending || isSubmittingImage;

  return (
    <div className={`space-y-8 ${isDark ? "text-slate-200" : "text-slate-800"}`} data-testid="card-registration-page">
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
      `}</style>

      {/* Header */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div>
          <h2 className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${isDark ? "text-white" : "text-slate-900"}`}>
            <Cpu className="text-blue-500" size={26} />
            Card Registration
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Register new RFID cards for transit
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
            <ShieldCheck className="text-blue-500" size={16} />
            <span className={`text-xs font-semibold ${isDark ? "text-blue-400" : "text-blue-700"}`}>System Link Active</span>
          </div>
          <Button
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New
          </Button>
        </div>
      </div>

      {/* History Table */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className={`shadow-sm ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
          <CardHeader className={`flex flex-row items-center justify-between border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}>
            <div>
              <CardTitle className={`text-sm font-bold flex items-center gap-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                Recently Registered
                {/* ✅ LIVE badge */}
                <span className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ml-2 ${
                  isDark ? "text-emerald-400 bg-emerald-950/40 border-emerald-900" : "text-emerald-600 bg-emerald-50 border-emerald-100"
                }`}>
                  <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                  LIVE
                </span>
              </CardTitle>
              <CardDescription className={`text-xs flex items-center gap-2 mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Last 5 registered cards
                {/* ✅ Last updated time */}
                {lastUpdated && (
                  <span className={isDark ? "text-slate-500" : "text-slate-400"}>· {lastUpdated.toLocaleTimeString()}</span>
                )}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className={`h-14 w-full rounded-lg ${isDark ? "bg-slate-800" : "bg-slate-100"}`} />
                ))}
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
                    {Array.isArray(recentUsers) && recentUsers.length > 0 ? (
                      recentUsers.map((user, index) => (
                        <TableRow
                          key={user.id}
                          className={`transition-colors group ${isDark ? "border-slate-800 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${
                            // ✅ Pulse the newest row when data updates
                            isPulsing && index === 0 ? "row-pulse" : ""
                          }`}
                        >
                          <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                            {user.cardUid}
                          </TableCell>
                          <TableCell className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                            {user.fullName}
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
                          <TableCell className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            {user.contactNumber}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-emerald-500">
                            ₱{Number(user.balance || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={`${
                              user.status === "Active"
                                ? isDark
                                  ? "bg-emerald-950/40 text-emerald-400 border-emerald-900"
                                  : "bg-emerald-50 text-emerald-600 border-emerald-200"
                                : isDark
                                  ? "bg-red-950/40 text-red-400 border-red-900"
                                  : "bg-red-50 text-red-600 border-red-200"
                            } text-[10px] font-semibold px-2 py-0.5 border`}>
                              {user.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-20">
                          <div className={`flex flex-col items-center ${isDark ? "text-slate-700" : "text-slate-300"}`}>
                            <Plus size={48} className="mb-2" />
                            <p className="text-xs font-semibold uppercase tracking-widest">No cards registered yet</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ============================================================== */}
      {/* Add New Card — Registration Modal                              */}
      {/* ============================================================== */}
      <Dialog open={isModalOpen} onOpenChange={(open) => (open ? setIsModalOpen(true) : closeModal())}>
        <DialogContent
          className={`max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 ${
            isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
          }`}
        >
          {/* Gradient accent header */}
          <div className="relative shrink-0">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className={`text-lg font-bold flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
                <CreditCard className="text-blue-500" size={20} />
                Register New Card
              </DialogTitle>
              <DialogDescription className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Fill in the cardholder's personal details, address, and ID verification.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-6 py-2 space-y-8">

              {/* ---------------- Card details ---------------- */}
              <section className="space-y-4">
                <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <IdCard size={14} className="text-blue-500" />
                  Card Details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cardUid" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      Card UID
                      <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>(8 characters)</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="cardUid"
                        className={`font-mono pr-14 ${isDark ? "bg-slate-950 text-white" : "bg-white text-slate-900"} ${
                          cardUidError
                            ? "border-red-400 focus-visible:ring-red-400"
                            : form.cardUid.length === 8
                            ? "border-emerald-400 focus-visible:ring-emerald-400"
                            : isDark
                            ? "border-slate-800 focus-visible:ring-blue-500"
                            : "border-slate-200 focus-visible:ring-blue-500"
                        }`}
                        placeholder="e.g. A1B2C3D4"
                        value={form.cardUid}
                        onChange={handleCardUidChange}
                        required
                      />
                      <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums ${
                        form.cardUid.length === 8 ? "text-emerald-500" : isDark ? "text-slate-500" : "text-slate-400"
                      }`}>
                        {form.cardUid.length}/8
                      </span>
                    </div>
                    {cardUidError && <p className="text-xs font-medium text-red-500">{cardUidError}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="type" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>User Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                      <SelectTrigger className={`font-medium text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full inline-block ${getTypeDotColor(form.type)}`} />
                          <SelectValue placeholder="Select type" />
                        </span>
                      </SelectTrigger>
                      <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
                        <SelectItem value="Regular" className="cursor-pointer">
                          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Regular</span>
                        </SelectItem>
                        <SelectItem value="Student" className="cursor-pointer">
                          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Student</span>
                        </SelectItem>
                        <SelectItem value="Senior" className="cursor-pointer">
                          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Senior</span>
                        </SelectItem>
                        <SelectItem value="PWD" className="cursor-pointer">
                          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> PWD</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* ID image upload — only for discounted types */}
                <AnimatePresence>
                  {requiresIdImage && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-2 pt-1">
                        <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                          {form.type} ID
                          <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>(upload for verification)</span>
                        </Label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageSelect}
                          className="hidden"
                          id="idImage"
                        />
                        {!idImagePreview ? (
                          <label
                            htmlFor="idImage"
                            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 cursor-pointer transition-colors ${
                              idImageError
                                ? "border-red-400"
                                : isDark
                                ? "border-slate-800 hover:border-blue-800 hover:bg-slate-950/60"
                                : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/40"
                            }`}
                          >
                            <Upload size={20} className="text-blue-500" />
                            <span className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                              Click to upload {form.type} ID
                            </span>
                            <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>PNG or JPG, up to 5MB</span>
                          </label>
                        ) : (
                          <div className={`relative flex items-center gap-3 p-3 border rounded-xl ${isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200"}`}>
                            <img src={idImagePreview} alt="ID preview" className="h-16 w-24 object-cover rounded-lg border border-slate-200/30" />
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold truncate ${isDark ? "text-slate-200" : "text-slate-700"}`}>{idImageFile?.name}</p>
                              <p className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                                {idImageFile ? `${(idImageFile.size / 1024).toFixed(0)} KB` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={clearImage}
                              className={`p-1.5 rounded-full cursor-pointer transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"}`}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                        {idImageError && <p className="text-xs font-medium text-red-500">{idImageError}</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* ---------------- Personal info ---------------- */}
              <section className="space-y-4">
                <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <UserRound size={14} className="text-blue-500" />
                  Personal Information
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Full Name</Label>
                  <Input
                    id="fullName"
                    className={`focus-visible:ring-blue-500 ${
                      isDark ? "bg-slate-950 border-slate-800 text-white placeholder:text-slate-600" : "bg-white border-slate-200 text-slate-900 placeholder:text-slate-400"
                    }`}
                    placeholder="Enter full name"
                    value={form.fullName}
                    onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dob" className={`text-xs font-semibold flex items-center gap-1.5 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      <CalendarDays size={12} />
                      Date of Birth
                    </Label>
                    <Input
                      id="dob"
                      type="date"
                      max={new Date().toISOString().split("T")[0]}
                      className={`${dobError ? "border-red-400 focus-visible:ring-red-400" : isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"}`}
                      value={form.dob}
                      onChange={handleDobChange}
                      required
                    />
                    {dobError && <p className="text-xs font-medium text-red-500">{dobError}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Age</Label>
                    <div className={`flex items-center h-10 px-3 rounded-md border text-sm font-semibold ${
                      isDark ? "bg-slate-950/60 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
                    }`}>
                      {age !== null ? `${age} years old` : "— select date of birth"}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactNumber" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    Contact Number
                    <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>(11 digits)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="contactNumber"
                      inputMode="numeric"
                      className={`font-mono pr-14 ${isDark ? "bg-slate-950 text-white" : "bg-white text-slate-900"} ${
                        contactError
                          ? "border-red-400 focus-visible:ring-red-400"
                          : form.contactNumber.length === 11
                          ? "border-emerald-400 focus-visible:ring-emerald-400"
                          : isDark
                          ? "border-slate-800 focus-visible:ring-blue-500"
                          : "border-slate-200 focus-visible:ring-blue-500"
                      }`}
                      placeholder="09XXXXXXXXX"
                      value={form.contactNumber}
                      onChange={handleContactChange}
                      required
                    />
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums ${
                      form.contactNumber.length === 11 ? "text-emerald-500" : isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {form.contactNumber.length}/11
                    </span>
                  </div>
                  {contactError && <p className="text-xs font-medium text-red-500">{contactError}</p>}
                </div>
              </section>

              {/* ---------------- Address (PSGC cascading dropdowns) ---------------- */}
              <section className="space-y-4 pb-2">
                <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <MapPin size={14} className="text-blue-500" />
                  Address
                </div>

                {/* Detailed address — house no. / street / purok / subdivision */}
                <div className="space-y-2">
                  <Label htmlFor="streetAddress" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    House No. / Street / Purok / Subdivision
                    <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>(optional)</span>
                  </Label>
                  <Textarea
                    id="streetAddress"
                    rows={2}
                    className={`resize-none focus-visible:ring-blue-500 ${
                      isDark
                        ? "bg-slate-950 border-slate-800 text-white placeholder:text-slate-600"
                        : "bg-white border-slate-200 text-slate-900 placeholder:text-slate-400"
                    }`}
                    placeholder="e.g. House No. 123, Rizal Street, Purok 2"
                    value={form.streetAddress}
                    onChange={(e) => setForm((f) => ({ ...f, streetAddress: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Region */}
                  <div className="space-y-2">
                    <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Region</Label>
                    <Select value={form.regionCode} onValueChange={handleRegionChange} disabled={loadingRegions}>
                      <SelectTrigger className={`text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        <SelectValue placeholder={loadingRegions ? "Loading regions..." : "Select region"} />
                      </SelectTrigger>
                      <SelectContent className={`max-h-64 ${isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        {regions.map((r) => (
                          <SelectItem key={r.code} value={r.code} className="cursor-pointer">{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Province */}
                  <div className="space-y-2">
                    <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Province</Label>
                    <Select
                      value={form.provinceCode}
                      onValueChange={handleProvinceChange}
                      disabled={!form.regionCode || loadingProvinces || regionHasNoProvinces}
                    >
                      <SelectTrigger className={`text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        <SelectValue
                          placeholder={
                            regionHasNoProvinces
                              ? "N/A for this region"
                              : loadingProvinces
                              ? "Loading provinces..."
                              : !form.regionCode
                              ? "Select region first"
                              : "Select province"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className={`max-h-64 ${isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        {provinces.map((p) => (
                          <SelectItem key={p.code} value={p.code} className="cursor-pointer">{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* City / Municipality */}
                  <div className="space-y-2">
                    <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>City / Municipality</Label>
                    <Select
                      value={form.cityCode}
                      onValueChange={handleCityChange}
                      disabled={loadingCities || (!regionHasNoProvinces && !form.provinceCode) || (regionHasNoProvinces && !form.regionCode)}
                    >
                      <SelectTrigger className={`text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        <SelectValue placeholder={loadingCities ? "Loading cities..." : "Select city/municipality"} />
                      </SelectTrigger>
                      <SelectContent className={`max-h-64 ${isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        {cities.map((c) => (
                          <SelectItem key={c.code} value={c.code} className="cursor-pointer">{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Barangay */}
                  <div className="space-y-2">
                    <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Barangay</Label>
                    <Select value={form.barangayCode} onValueChange={handleBarangayChange} disabled={!form.cityCode || loadingBarangays}>
                      <SelectTrigger className={`text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        <SelectValue placeholder={loadingBarangays ? "Loading barangays..." : "Select barangay"} />
                      </SelectTrigger>
                      <SelectContent className={`max-h-64 ${isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                        {barangays.map((b) => (
                          <SelectItem key={b.code} value={b.code} className="cursor-pointer">{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Zip Code */}
                  <div className="space-y-2">
                    <Label htmlFor="zipCode" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      Zip Code
                      <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>(optional)</span>
                    </Label>
                    <Input
                      id="zipCode"
                      inputMode="numeric"
                      className={`font-mono ${isDark ? "bg-slate-950 text-white" : "bg-white text-slate-900"} ${
                        zipCodeError
                          ? "border-red-400 focus-visible:ring-red-400"
                          : isDark
                          ? "border-slate-800 focus-visible:ring-blue-500"
                          : "border-slate-200 focus-visible:ring-blue-500"
                      }`}
                      placeholder="e.g. 6710"
                      value={form.zipCode}
                      onChange={handleZipCodeChange}
                    />
                    {zipCodeError && <p className="text-xs font-medium text-red-500">{zipCodeError}</p>}
                  </div>
                </div>

                {/* Complete address preview — this is the full string that gets recorded */}
                {fullAddress && (
                  <div className={`space-y-1.5 pt-1`}>
                    <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Complete Address</Label>
                    <div className={`text-sm px-3 py-2.5 rounded-lg border leading-relaxed ${
                      isDark ? "bg-slate-950/60 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
                    }`}>
                      {fullAddress}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Footer */}
            <DialogFooter className={`px-6 py-4 border-t shrink-0 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <Button
                type="button"
                variant="outline"
                onClick={closeModal}
                className={`cursor-pointer ${isDark ? "border-slate-800 text-slate-300 hover:bg-slate-800" : ""}`}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={isSubmitting || isFormInvalid}
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CreditCard className="w-4 h-4 mr-2" />
                )}
                {isSubmitting ? "Registering..." : "Register Card"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}