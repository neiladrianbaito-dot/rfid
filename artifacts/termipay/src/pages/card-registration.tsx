import { useState, useEffect, useRef, useCallback } from "react";
import {
  useCreateUser,
  useListRecentUsers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-5 w-5" />
      <span>{text}</span>
    </div>
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

  const {
    data: recentUsersData,
    isLoading: isLoadingRecentUsers,
  } = useListRecentUsers({
    query: {
      staleTime: 30_000,
    },
  });

  const recentUsers =
    (recentUsersData as any)?.users ??
    (recentUsersData as any)?.data ??
    [];

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
  function handleRegionChange(value: string) {
    const selected = regions.find(
      (region) => region.code === value
    );

    setForm((current) => ({
      ...current,

      regionCode: value,
      regionName: selected?.name ?? "",

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
  function handleProvinceChange(value: string) {
    const selected = provinces.find(
      (province) => province.code === value
    );

    setForm((current) => ({
      ...current,

      provinceCode: value,
      provinceName: selected?.name ?? "",

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
  function handleCityChange(value: string) {
    const selected = cities.find(
      (city) => city.code === value
    );

    setForm((current) => ({
      ...current,

      cityCode: value,
      cityName: selected?.name ?? "",

      barangayCode: "",
      barangayName: "",
    }));
  }

  /*
   * BARANGAY CHANGE
   */
  function handleBarangayChange(value: string) {
    const selected = barangays.find(
      (barangay) => barangay.code === value
    );

    setForm((current) => ({
      ...current,

      barangayCode: value,
      barangayName: selected?.name ?? "",
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
    if (!form.cardUid.trim()) {
      toast({
        title: "Card UID Required",
        description:
          "Please enter the RFID card UID.",
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
          cardUid:
            form.cardUid
              .trim()
              .toUpperCase(),

          fullName:
            form.fullName.trim(),

          dateOfBirth:
            form.dob,

          contactNumber:
            form.contactNumber.trim(),

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

      {/* INFO CARDS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  isDark
                    ? "bg-cyan-500/10 text-cyan-400"
                    : "bg-cyan-50 text-cyan-600"
                }`}
              >
                <Cpu className="h-5 w-5" />
              </div>

              <div>
                <p
                  className={`text-xs ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  RFID
                </p>

                <p className="font-semibold">
                  Contactless
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  isDark
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                <ShieldCheck className="h-5 w-5" />
              </div>

              <div>
                <p
                  className={`text-xs ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  Security
                </p>

                <p className="font-semibold">
                  Verified Cards
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  isDark
                    ? "bg-violet-500/10 text-violet-400"
                    : "bg-violet-50 text-violet-600"
                }`}
              >
                <Zap className="h-5 w-5" />
              </div>

              <div>
                <p
                  className={`text-xs ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  Processing
                </p>

                <p className="font-semibold">
                  Fast Registration
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  isDark
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-amber-50 text-amber-600"
                }`}
              >
                <IdCard className="h-5 w-5" />
              </div>

              <div>
                <p
                  className={`text-xs ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  ID Verification
                </p>

                <p className="font-semibold">
                  Student / Senior / PWD
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* RECENT USERS */}
      <Card>
        <CardHeader>
          <CardTitle>
            Recently Registered Cards
          </CardTitle>
        </CardHeader>

        <CardContent>
          {isLoadingRecentUsers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : recentUsers.length === 0 ? (
            <div
              className={`py-12 text-center ${
                isDark
                  ? "text-slate-400"
                  : "text-slate-500"
              }`}
            >
              No registered cards yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr
                    className={`border-b text-left text-xs uppercase tracking-wider ${
                      isDark
                        ? "border-slate-800 text-slate-400"
                        : "border-slate-200 text-slate-500"
                    }`}
                  >
                    <th className="px-4 py-3">
                      Card
                    </th>

                    <th className="px-4 py-3">
                      Full Name
                    </th>

                    <th className="px-4 py-3">
                      Contact
                    </th>

                    <th className="px-4 py-3">
                      Type
                    </th>

                    <th className="px-4 py-3">
                      Balance
                    </th>

                    <th className="px-4 py-3">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {recentUsers.map(
                    (user: any) => (
                      <tr
                        key={user.id}
                        className={`border-b last:border-0 ${
                          isDark
                            ? "border-slate-800"
                            : "border-slate-100"
                        }`}
                      >
                        {/* CARD */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-cyan-500" />

                            <span className="font-mono text-sm font-medium">
                              {user.cardUid ||
                                user.card_uid ||
                                "N/A"}
                            </span>
                          </div>
                        </td>

                        {/* FULL NAME */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 opacity-50" />

                            <span className="font-medium">
                              {user.fullName ||
                                user.full_name ||
                                "N/A"}
                            </span>
                          </div>
                        </td>

                        {/* CONTACT */}
                        <td className="px-4 py-4 text-sm">
                          {user.contactNumber ||
                            user.contact_number ||
                            "N/A"}
                        </td>

                        {/* TYPE */}
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                              (
                                user.type ||
                                "Regular"
                              ) === "Student"
                                ? isDark
                                  ? "bg-blue-500/10 text-blue-400"
                                  : "bg-blue-50 text-blue-700"
                                : (
                                    user.type ||
                                    "Regular"
                                  ) === "Senior"
                                ? isDark
                                  ? "bg-yellow-500/10 text-yellow-400"
                                  : "bg-yellow-50 text-yellow-700"
                                : (
                                    user.type ||
                                    "Regular"
                                  ) === "PWD"
                                ? isDark
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-emerald-50 text-emerald-700"
                                : isDark
                                ? "bg-slate-500/10 text-slate-300"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {user.type ||
                              "Regular"}
                          </span>
                        </td>

                        {/* BALANCE */}
                        <td className="px-4 py-4 font-semibold">
                          ₱
                          {Number(
                            user.balance ?? 0
                          ).toFixed(2)}
                        </td>

                        {/* STATUS */}
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                              (
                                user.status ||
                                "Active"
                              ) === "Active"
                                ? isDark
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-emerald-50 text-emerald-700"
                                : isDark
                                ? "bg-red-500/10 text-red-400"
                                : "bg-red-50 text-red-700"
                            }`}
                          >
                            {user.status ||
                              "Active"}
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

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
                          .replace(
                            /[^A-Z0-9_-]/g,
                            ""
                          )
                      )
                    }
                    placeholder="e.g. 99B603A6"
                    disabled={isSubmitting}
                    maxLength={32}
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
                      )
                    }
                    placeholder="09XXXXXXXXX"
                    disabled={isSubmitting}
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

                  <Select
                    value={form.regionCode}
                    onValueChange={
                      handleRegionChange
                    }
                    disabled={
                      isSubmitting ||
                      loadingRegions
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          loadingRegions
                            ? "Loading regions..."
                            : "Select region"
                        }
                      />
                    </SelectTrigger>

                    <SelectContent>
                      {regions.map(
                        (region) => (
                          <SelectItem
                            key={region.code}
                            value={region.code}
                          >
                            {region.name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Province
                  </label>

                  <Select
                    value={form.provinceCode}
                    onValueChange={
                      handleProvinceChange
                    }
                    disabled={
                      isSubmitting ||
                      !form.regionCode ||
                      loadingProvinces
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          loadingProvinces
                            ? "Loading provinces..."
                            : "Select province"
                        }
                      />
                    </SelectTrigger>

                    <SelectContent>
                      {provinces.map(
                        (province) => (
                          <SelectItem
                            key={province.code}
                            value={province.code}
                          >
                            {province.name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    City / Municipality
                  </label>

                  <Select
                    value={form.cityCode}
                    onValueChange={
                      handleCityChange
                    }
                    disabled={
                      isSubmitting ||
                      !form.provinceCode ||
                      loadingCities
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          loadingCities
                            ? "Loading cities..."
                            : "Select city / municipality"
                        }
                      />
                    </SelectTrigger>

                    <SelectContent>
                      {cities.map(
                        (city) => (
                          <SelectItem
                            key={city.code}
                            value={city.code}
                          >
                            {city.name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Barangay
                  </label>

                  <Select
                    value={form.barangayCode}
                    onValueChange={
                      handleBarangayChange
                    }
                    disabled={
                      isSubmitting ||
                      !form.cityCode ||
                      loadingBarangays
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          loadingBarangays
                            ? "Loading barangays..."
                            : "Select barangay"
                        }
                      />
                    </SelectTrigger>

                    <SelectContent>
                      {barangays.map(
                        (barangay) => (
                          <SelectItem
                            key={barangay.code}
                            value={barangay.code}
                          >
                            {barangay.name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
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

                      {!idImageFile && (
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
                          Choose Image
                        </Button>
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