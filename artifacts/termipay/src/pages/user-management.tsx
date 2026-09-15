import { useState, useEffect, useRef } from "react";
import {
  useListUsers,
  useUpdateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  Search,
  Pencil,
  Trash2,
  Wallet,
  Users,
  Zap,
  ShieldAlert,
  Mail,
  LinkIcon,
  ChevronLeft,
  ChevronRight,
  Phone,
  CheckCircle2,
  Eye,
  CreditCard,
  Radio,
  RotateCw,
  RefreshCw,
  CalendarClock,
  ArrowRightLeft,
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
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 10;

const TYPE_FILTERS = ["All", "Regular", "Student", "Senior", "PWD"] as const;

const STATUS_FILTERS = ["All", "Active", "Inactive", "Blocked", "Expired"] as const;

const TRANSFER_REASONS = ["Lost Card", "Stolen Card", "Damaged Card", "Other"] as const;

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

function isCardExpired(expirationDate: string | null | undefined): boolean {
  if (!expirationDate) return false;

  const expDate = new Date(expirationDate);

  if (isNaN(expDate.getTime())) return false;

  return expDate < new Date();
}

function computeRenewedExpiration(
  currentExpiration: string | null | undefined
): Date {
  const now = new Date();

  const current = currentExpiration
    ? new Date(currentExpiration)
    : null;

  const base =
    current &&
    !isNaN(current.getTime()) &&
    current > now
      ? current
      : now;

  const renewed = new Date(base);

  renewed.setFullYear(renewed.getFullYear() + 1);

  return renewed;
}

function normalizeEmail(
  email: string | null | undefined
): string | null {
  if (!email) return null;

  const trimmed = email.trim();

  if (
    trimmed === "" ||
    trimmed.toLowerCase() === "none"
  ) {
    return null;
  }

  return trimmed;
}

function getTypeBadgeStyle(
  type: string | null | undefined,
  isDark: boolean
) {
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

function SuccessTitle({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2
        className="w-4 h-4 text-emerald-500 flex-shrink-0"
        strokeWidth={2.5}
      />
      {text}
    </span>
  );
}

function ChevronStaircase({ color }: { color: string }) {
  const rows = 6;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: rows }).map((_, i) => {
        const offset = (rows - 1 - i) * 11;

        return (
          <div
            key={i}
            className="absolute right-0 h-[15%] w-full"
            style={{
              top: `${i * (100 / rows)}%`,
              transform: `translateX(${offset}%)`,
            }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 10px, transparent 10px 16px)`,
              }}
            />

            <div
              className="absolute inset-x-0 bottom-0 h-[70%] opacity-80"
              style={{
                backgroundImage: `
                  repeating-linear-gradient(
                    135deg,
                    ${color}55 0px,
                    ${color}55 7px,
                    transparent 7px,
                    transparent 14px
                  ),
                  repeating-linear-gradient(
                    45deg,
                    ${color}55 0px,
                    ${color}55 7px,
                    transparent 7px,
                    transparent 14px
                  )
                `,
                backgroundSize: "28px 100%",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

const CARD_DESIGN_WIDTH = 700;

const CARD_DESIGN_HEIGHT = Math.round(
  (CARD_DESIGN_WIDTH * 774) / 1376
);

function useScaleToFit(designWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;

    if (!el) return;

    const update = () => {
      const w = el.offsetWidth;

      if (w > 0) {
        setScale(w / designWidth);
      }
    };

    update();

    const ro = new ResizeObserver(update);

    ro.observe(el);

    return () => ro.disconnect();
  }, [designWidth]);

  return {
    containerRef,
    scale,
  };
}

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
  const {
    containerRef,
    scale,
  } = useScaleToFit(CARD_DESIGN_WIDTH);

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-pointer select-none"
      style={{
        aspectRatio: `${CARD_DESIGN_WIDTH} / ${CARD_DESIGN_HEIGHT}`,
      }}
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
          <div
            className={`card-flip-inner-locked ${
              flipped ? "is-flipped" : ""
            }`}
          >
            <div className="card-face-locked">
              {front}
            </div>

            <div className="card-face-locked card-face-back-locked">
              {back}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  const { isDark } = useTheme();

  const [search, setSearch] = useState("");

  const [typeFilter, setTypeFilter] =
    useState<(typeof TYPE_FILTERS)[number]>("All");

  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("All");

  const [editUser, setEditUser] = useState<any>(null);

  const [deleteUser, setDeleteUser] = useState<any>(null);

  const [previewUser, setPreviewUser] = useState<any>(null);

  const [previewFlipped, setPreviewFlipped] =
    useState(false);

  const [renewUser, setRenewUser] =
    useState<any>(null);

  const [isRenewing, setIsRenewing] =
    useState(false);

  const [transferUser, setTransferUser] =
    useState<any>(null);

  const [transferQuery, setTransferQuery] =
    useState("");

  const [transferTarget, setTransferTarget] =
    useState<any>(null);

  const [transferReason, setTransferReason] =
    useState<(typeof TRANSFER_REASONS)[number]>(
      "Lost Card"
    );

  const [isTransferring, setIsTransferring] =
    useState(false);

  const [editForm, setEditForm] = useState({
    fullName: "",
    contactNumber: "",
    balance: "",
    status: "",
    type: "",
  });

  const [originalForm, setOriginalForm] =
    useState(editForm);

  const [page, setPage] = useState(1);

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  const [newRowId, setNewRowId] =
    useState<number | null>(null);

  const prevTopIdRef =
    useRef<number | null>(null);

  const { toast } = useToast();

  const queryClient = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter]);

  const {
    data: users,
    isLoading,
    refetch: refetchUsers,
  } = useListUsers(
    search ? { search } : undefined,
    {
      query: {
        refetchOnWindowFocus: true,
      },
    }
  );

  useRealtimeRefetch(["users"], () => {
    refetchUsers();
  });

  const userList =
    Array.isArray(users) ? users : [];

  const typeFilteredList =
    typeFilter === "All"
      ? userList
      : userList.filter(
          (u: any) =>
            (u.type || "Regular")
              .toLowerCase() ===
            typeFilter.toLowerCase()
        );

  const filteredList =
    statusFilter === "All"
      ? typeFilteredList
      : statusFilter === "Expired"
      ? typeFilteredList.filter(
          (u: any) =>
            isCardExpired(u.expirationDate)
        )
      : typeFilteredList.filter(
          (u: any) =>
            u.status === statusFilter
        );

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredList.length / PAGE_SIZE
    )
  );

  const safePage = Math.min(
    page,
    totalPages
  );

  const startIndex =
    (safePage - 1) * PAGE_SIZE;

  const paginatedList =
    filteredList.slice(
      startIndex,
      startIndex + PAGE_SIZE
    );

  useEffect(() => {
    if (userList.length === 0) return;

    const topId = userList[0]?.id;

    if (
      prevTopIdRef.current !== null &&
      topId !== prevTopIdRef.current
    ) {
      setNewRowId(topId);

      setTimeout(
        () => setNewRowId(null),
        800
      );
    }

    prevTopIdRef.current = topId;

    setLastUpdated(new Date());
  }, [userList]);

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListUsersQueryKey(),
        });

        setEditUser(null);

        toast({
          title: (
            <SuccessTitle text="User Updated Successfully" />
          ),
        });
      },
    },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListUsersQueryKey(),
        });

        toast({
          title: (
            <SuccessTitle text="User Deleted Successfully" />
          ),
        });
      },
    },
  });

  const openEdit = (user: any) => {
    setEditUser(user);

    const initial = {
      fullName: user.fullName,
      contactNumber: user.contactNumber,
      balance: String(
        user.balance || 0
      ),
      status: user.status,
      type: user.type || "Regular",
    };

    setEditForm(initial);

    setOriginalForm(initial);
  };

  const hasChanges =
    editForm.fullName !==
      originalForm.fullName ||
    editForm.contactNumber !==
      originalForm.contactNumber;

  const handleUpdate = () => {
    if (
      !editUser ||
      !hasChanges
    ) {
      return;
    }

    updateMutation.mutate({
      id: editUser.id,
      data: {
        fullName:
          editForm.fullName,
        contactNumber:
          editForm.contactNumber,
      },
    });
  };

  const confirmDelete = () => {
    if (!deleteUser) return;

    deleteMutation.mutate(
      { id: deleteUser.id },
      {
        onSettled: () =>
          setDeleteUser(null),
      }
    );
  };

  const openRenew = (user: any) => {
    if (
      !isCardExpired(
        user.expirationDate
      )
    ) {
      toast({
        title: "Card is still valid",
        description: `This card is valid until ${formatDate(
          user.expirationDate
        )}. It can only be renewed after it expires.`,
        variant: "destructive",
      });

      return;
    }

    setRenewUser(user);
  };

  const confirmRenew = async () => {
    if (!renewUser) return;

    if (
      !isCardExpired(
        renewUser.expirationDate
      )
    ) {
      toast({
        title: "Card is still valid",
        description: `This card is valid until ${formatDate(
          renewUser.expirationDate
        )}. It can only be renewed after it expires.`,
        variant: "destructive",
      });

      setRenewUser(null);

      return;
    }

    setIsRenewing(true);

    const { error } =
      await supabase.rpc(
        "renew_card",
        {
          p_card_id:
            renewUser.id,
        }
      );

    setIsRenewing(false);

    if (error) {
      console.error(
        "Renew card error:",
        error
      );

      toast({
        title:
          "Failed to renew card",
        variant:
          "destructive",
      });

      return;
    }

    queryClient.invalidateQueries({
      queryKey:
        getListUsersQueryKey(),
    });

    setRenewUser(null);

    toast({
      title: (
        <SuccessTitle text="Card Renewed Successfully" />
      ),
    });
  };

  const openTransfer = (
    user: any
  ) => {
    if (
      (user.balance || 0) <= 0
    ) {
      toast({
        title:
          "Nothing to transfer",
        description:
          "This card has a zero balance.",
        variant:
          "destructive",
      });

      return;
    }

    setTransferUser(user);
    setTransferQuery("");
    setTransferTarget(null);
    setTransferReason(
      "Lost Card"
    );
  };

  const transferCandidates =
    transferUser
      ? userList
          .filter(
            (u: any) =>
              u.id !==
                transferUser.id &&
              u.status === "Active"
          )
          .filter((u: any) => {
            if (
              !transferQuery.trim()
            ) {
              return true;
            }

            const q =
              transferQuery
                .trim()
                .toLowerCase();

            return (
              u.cardUid
                ?.toLowerCase()
                .includes(q) ||
              u.fullName
                ?.toLowerCase()
                .includes(q)
            );
          })
          .slice(0, 8)
      : [];

  const confirmTransfer =
    async () => {
      if (
        !transferUser ||
        !transferTarget
      ) {
        return;
      }

      setIsTransferring(true);

      const { data, error } =
        await supabase
          .from(
            "card_balance_transfers"
          )
          .insert({
            source_card_id:
              transferUser.id,
            target_card_id:
              transferTarget.id,
            reason:
              transferReason,
          })
          .select()
          .single();

      setIsTransferring(false);

      if (error) {
        console.error(
          "Transfer balance error:",
          error
        );

        toast({
          title:
            "Failed to transfer balance",
          description:
            error.message,
          variant:
            "destructive",
        });

        return;
      }

      queryClient.invalidateQueries({
        queryKey:
          getListUsersQueryKey(),
      });

      setTransferUser(null);

      toast({
        title: (
          <SuccessTitle text="Balance Transferred Successfully" />
        ),
        description: `${formatPeso(
          data?.amount ??
            transferUser.balance ??
            0
        )} moved to ${
          transferTarget.cardUid
        }. Old card is now blocked.`,
      });
    };

  return (
    <div
      className={`space-y-8 h-full min-h-0 flex flex-col ${
        isDark
          ? "text-slate-200"
          : "text-slate-800"
      }`}
      data-testid="users-page"
    >
      <style>{`
        @keyframes row-pulse {
          0% { background-color: transparent; }
          50% { background-color: rgba(37,99,235,0.08); }
          100% { background-color: transparent; }
        }

        .row-pulse {
          animation: row-pulse 0.8s ease-in-out;
        }

        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }

        .realtime-dot {
          animation: realtime-dot 1s ease-in-out infinite;
        }

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

        .card-flip-inner-locked.is-flipped {
          transform: rotateY(180deg);
        }

        .card-face-locked {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        .card-face-back-locked {
          transform: rotateY(180deg);
        }
      `}</style>

      {/* Header */}
      <div
        className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6 ${
          isDark
            ? "border-slate-800"
            : "border-slate-200"
        }`}
      >
        <div>
          <h2
            className={`text-2xl font-bold tracking-tight flex items-center gap-3 ${
              isDark
                ? "text-white"
                : "text-slate-900"
            }`}
          >
            <Users
              className="text-blue-500"
              size={26}
            />
            User Management
          </h2>

          <p
            className={`text-sm mt-1 ${
              isDark
                ? "text-slate-400"
                : "text-slate-500"
            }`}
          >
            Manage cardholder credentials and wallet balances
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${
              isDark
                ? "bg-blue-950/40 border-blue-900"
                : "bg-blue-50 border-blue-100"
            }`}
          >
            <Zap
              className="text-blue-500"
              size={16}
            />

            <span
              className={`text-[10px] font-semibold uppercase tracking-wide ${
                isDark
                  ? "text-blue-400"
                  : "text-blue-700"
              }`}
            >
              Live Telemetry Active
            </span>
          </div>

          {lastUpdated && (
            <span
              className={`text-[10px] font-mono pr-1 ${
                isDark
                  ? "text-slate-500"
                  : "text-slate-400"
              }`}
            >
              Last sync:{" "}
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Table Card */}
      <Card
        className={`shadow-sm flex flex-col overflow-hidden relative ${
          isDark
            ? "bg-slate-900 border-slate-800"
            : "bg-white border-slate-200"
        }`}
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />

        <CardHeader
          className={`flex-none pb-4 border-b ${
            isDark
              ? "bg-slate-950/40 border-slate-800"
              : "bg-slate-50/60 border-slate-100"
          }`}
        >
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${
                  isDark
                    ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
                    : "text-emerald-600 bg-emerald-50 border-emerald-100"
                }`}
              >
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                LIVE
              </span>

              <CardTitle
                className={`text-xs font-semibold uppercase tracking-wide ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Authorized Card Holders
              </CardTitle>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto items-stretch sm:items-center">
              <div className="relative w-full sm:w-80">
                <Search
                  className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                    isDark
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                />

                <Input
                  placeholder="Search UID or name..."
                  value={search}
                  onChange={(e) =>
                    setSearch(
                      e.target.value
                    )
                  }
                  className={`pl-10 font-medium text-sm h-10 focus-visible:ring-blue-500 ${
                    isDark
                      ? "bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600"
                      : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                  }`}
                />
              </div>

              {/* Type filter */}
              <Select
                value={typeFilter}
                onValueChange={(v) =>
                  setTypeFilter(
                    v as (typeof TYPE_FILTERS)[number]
                  )
                }
              >
                <SelectTrigger
                  className={`h-10 w-full sm:w-40 text-sm font-medium cursor-pointer ${
                    isDark
                      ? "bg-slate-950 border-slate-800 text-slate-200"
                      : "bg-white border-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {typeFilter !== "All" && (
                      <span
                        className={`w-2 h-2 rounded-full inline-block ${getTypeDotColor(
                          typeFilter
                        )}`}
                      />
                    )}

                    <SelectValue />
                  </span>
                </SelectTrigger>

                <SelectContent
                  className={
                    isDark
                      ? "bg-slate-900 border-slate-800 text-slate-300"
                      : "bg-white border-slate-200 text-slate-700"
                  }
                >
                  {TYPE_FILTERS.map(
                    (t) => (
                      <SelectItem
                        key={t}
                        value={t}
                        className="cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          {t !== "All" && (
                            <span
                              className={`w-2 h-2 rounded-full inline-block ${getTypeDotColor(
                                t
                              )}`}
                            />
                          )}
                          {t}
                        </span>
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>

              {/* Status filter */}
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(
                    v as (typeof STATUS_FILTERS)[number]
                  )
                }
              >
                <SelectTrigger
                  className={`h-10 w-full sm:w-40 text-sm font-medium cursor-pointer ${
                    isDark
                      ? "bg-slate-950 border-slate-800 text-slate-200"
                      : "bg-white border-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {statusFilter !== "All" && (
                      <span
                        className={`w-2 h-2 rounded-full inline-block ${getStatusDotColor(
                          statusFilter
                        )}`}
                      />
                    )}

                    <SelectValue />
                  </span>
                </SelectTrigger>

                <SelectContent
                  className={
                    isDark
                      ? "bg-slate-900 border-slate-800 text-slate-300"
                      : "bg-white border-slate-200 text-slate-700"
                  }
                >
                  {STATUS_FILTERS.map(
                    (s) => (
                      <SelectItem
                        key={s}
                        value={s}
                        className="cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          {s !== "All" && (
                            <span
                              className={`w-2 h-2 rounded-full inline-block ${getStatusDotColor(
                                s
                              )}`}
                            />
                          )}

                          {s}
                        </span>
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 mt-6 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-4">
              {Array.from({
                length: PAGE_SIZE,
              }).map((_, i) => (
                <Skeleton
                  key={i}
                  className={`h-16 w-full rounded-lg ${
                    isDark
                      ? "bg-slate-800"
                      : "bg-slate-100"
                  }`}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader
                    className={`sticky top-0 z-10 border-b ${
                      isDark
                        ? "bg-slate-900 border-slate-800"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Card UID
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Full Name
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <Phone size={10} />
                          Contact No.
                        </span>
                      </TableHead>

                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                        <span className="flex items-center gap-1">
                          <LinkIcon size={10} />
                          Linked Account
                        </span>
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Type
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-emerald-500"
                            : "text-emerald-600"
                        }`}
                      >
                        Balance
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <CalendarClock size={10} />
                          Valid Until
                        </span>
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Status
                      </TableHead>

                      <TableHead
                        className={`text-[11px] font-semibold uppercase tracking-wide text-right ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {paginatedList.length > 0 ? (
                      paginatedList.map(
                        (user) => {
                          const linkedEmail =
                            normalizeEmail(
                              user.email
                            );

                          const expired =
                            isCardExpired(
                              user.expirationDate
                            );

                          return (
                            <TableRow
                              key={user.id}
                              className={`transition-colors ${
                                isDark
                                  ? "border-slate-800 hover:bg-slate-800/50"
                                  : "border-slate-100 hover:bg-slate-50"
                              } ${
                                newRowId ===
                                user.id
                                  ? "row-pulse"
                                  : ""
                              }`}
                            >
                              <TableCell className="font-mono text-xs text-blue-500 font-semibold">
                                {user.cardUid}
                              </TableCell>

                              <TableCell>
                                <span
                                  className={`text-sm font-medium ${
                                    isDark
                                      ? "text-slate-200"
                                      : "text-slate-800"
                                  }`}
                                >
                                  {user.fullName}
                                </span>
                              </TableCell>

                              <TableCell>
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                                    isDark
                                      ? "text-slate-400"
                                      : "text-slate-500"
                                  }`}
                                >
                                  <Phone
                                    className={`w-3 h-3 flex-shrink-0 ${
                                      isDark
                                        ? "text-slate-500"
                                        : "text-slate-400"
                                    }`}
                                  />

                                  {user.contactNumber || (
                                    <span
                                      className={`italic text-[11px] ${
                                        isDark
                                          ? "text-slate-600"
                                          : "text-slate-300"
                                      }`}
                                    >
                                      —
                                    </span>
                                  )}
                                </span>
                              </TableCell>

                              <TableCell>
                                {linkedEmail ? (
                                  <div className="flex flex-col gap-0.5">
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${
                                        isDark
                                          ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
                                          : "text-emerald-600 bg-emerald-50 border-emerald-100"
                                      }`}
                                    >
                                      <LinkIcon size={8} />
                                      Linked
                                    </span>

                                    <span className="flex items-center gap-1 text-xs text-blue-500 font-mono">
                                      <Mail className="w-3 h-3 flex-shrink-0" />
                                      {linkedEmail}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-0.5">
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded w-fit border ${
                                        isDark
                                          ? "text-slate-500 bg-slate-800 border-slate-700"
                                          : "text-slate-400 bg-slate-100 border-slate-200"
                                      }`}
                                    >
                                      <LinkIcon size={8} />
                                      Not Linked
                                    </span>

                                    <span
                                      className={`text-[11px] italic font-mono ${
                                        isDark
                                          ? "text-slate-600"
                                          : "text-slate-400"
                                      }`}
                                    >
                                      No account registered
                                    </span>
                                  </div>
                                )}
                              </TableCell>

                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-semibold flex items-center gap-1 w-fit ${getTypeBadgeStyle(
                                    user.type,
                                    isDark
                                  )}`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full inline-block ${getTypeDotColor(
                                      user.type
                                    )}`}
                                  />

                                  {user.type ||
                                    "Regular"}
                                </Badge>
                              </TableCell>

                              <TableCell>
                                <span
                                  className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded border text-xs ${
                                    isDark
                                      ? "text-emerald-400 bg-emerald-950/40 border-emerald-900"
                                      : "text-emerald-600 bg-emerald-50 border-emerald-100"
                                  }`}
                                >
                                  <Wallet className="w-3 h-3" />

                                  {formatPeso(
                                    user.balance ||
                                      0
                                  )}
                                </span>
                              </TableCell>

                              <TableCell>
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-mono font-medium ${
                                    expired
                                      ? isDark
                                        ? "text-red-400"
                                        : "text-red-600"
                                      : isDark
                                      ? "text-slate-300"
                                      : "text-slate-600"
                                  }`}
                                >
                                  <CalendarClock className="w-3 h-3 flex-shrink-0" />

                                  {formatDate(
                                    user.expirationDate
                                  )}
                                </span>
                              </TableCell>

                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-semibold ${
                                    user.status ===
                                    "Active"
                                      ? isDark
                                        ? "bg-emerald-950/40 text-emerald-400 border-emerald-900"
                                        : "bg-emerald-50 text-emerald-600 border-emerald-200"
                                      : isDark
                                      ? "bg-red-950/40 text-red-400 border-red-900"
                                      : "bg-red-50 text-red-600 border-red-200"
                                  }`}
                                >
                                  {user.status}
                                </Badge>
                              </TableCell>

                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setPreviewFlipped(
                                        false
                                      );
                                      setPreviewUser(
                                        user
                                      );
                                    }}
                                    className={`h-8 w-8 cursor-pointer ${
                                      isDark
                                        ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                    }`}
                                    title="Preview card"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      openRenew(
                                        user
                                      )
                                    }
                                    disabled={
                                      !expired
                                    }
                                    className={`h-8 w-8 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                                      isDark
                                        ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40"
                                        : "text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50"
                                    }`}
                                    title={
                                      expired
                                        ? "Renew card (extend 1 year)"
                                        : `Not yet expired — valid until ${formatDate(
                                            user.expirationDate
                                          )}`
                                    }
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      openTransfer(
                                        user
                                      )
                                    }
                                    disabled={
                                      (user.balance ||
                                        0) <=
                                      0
                                    }
                                    className={`h-8 w-8 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                                      isDark
                                        ? "text-orange-400 hover:text-orange-300 hover:bg-orange-950/40"
                                        : "text-orange-500 hover:text-orange-700 hover:bg-orange-50"
                                    }`}
                                    title={
                                      (user.balance ||
                                        0) >
                                      0
                                        ? "Transfer balance (lost/stolen card)"
                                        : "No balance to transfer"
                                    }
                                  >
                                    <ArrowRightLeft className="w-3.5 h-3.5" />
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      openEdit(
                                        user
                                      )
                                    }
                                    className={`h-8 w-8 cursor-pointer ${
                                      isDark
                                        ? "text-blue-400 hover:text-blue-300 hover:bg-blue-950/40"
                                        : "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                    }`}
                                    title="Edit user"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      setDeleteUser(
                                        user
                                      )
                                    }
                                    className={`h-8 w-8 cursor-pointer ${
                                      isDark
                                        ? "text-red-400 hover:text-red-300 hover:bg-red-950/40"
                                        : "text-red-500 hover:text-red-700 hover:bg-red-50"
                                    }`}
                                    title="Delete user"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        }
                      )
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className={`text-center py-20 uppercase font-semibold tracking-widest text-xs ${
                            isDark
                              ? "text-slate-700"
                              : "text-slate-300"
                          }`}
                        >
                          No users found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Footer */}
              <div
                className={`flex items-center justify-between pt-4 border-t mt-2 ${
                  isDark
                    ? "border-slate-800"
                    : "border-slate-100"
                }`}
              >
                <span
                  className={`text-xs font-mono uppercase tracking-wide ${
                    isDark
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                >
                  Showing{" "}
                  <span
                    className={`font-semibold ${
                      isDark
                        ? "text-slate-300"
                        : "text-slate-600"
                    }`}
                  >
                    {filteredList.length ===
                    0
                      ? 0
                      : startIndex + 1}
                    –
                    {Math.min(
                      startIndex +
                        PAGE_SIZE,
                      filteredList.length
                    )}
                  </span>{" "}
                  of{" "}
                  <span
                    className={`font-semibold ${
                      isDark
                        ? "text-slate-300"
                        : "text-slate-600"
                    }`}
                  >
                    {filteredList.length}
                  </span>{" "}
                  users
                </span>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      safePage <= 1
                    }
                    onClick={() =>
                      setPage((p) =>
                        Math.max(
                          1,
                          p - 1
                        )
                      )
                    }
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                    }`}
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" />
                    Prev
                  </Button>

                  <span className="text-xs font-semibold px-2 tabular-nums">
                    <span className="text-blue-500">
                      {safePage}
                    </span>

                    <span
                      className={
                        isDark
                          ? "text-slate-700"
                          : "text-slate-300"
                      }
                    >
                      {" "}
                      / {totalPages}
                    </span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      safePage >=
                      totalPages
                    }
                    onClick={() =>
                      setPage((p) =>
                        Math.min(
                          totalPages,
                          p + 1
                        )
                      )
                    }
                    className={`h-8 px-3 text-xs font-medium disabled:opacity-30 border cursor-pointer disabled:cursor-not-allowed ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
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

      {/* ============================================================
          CARD PREVIEW DIALOG
          ============================================================ */}
      <Dialog
        open={!!previewUser}
        onOpenChange={(open) =>
          !open &&
          setPreviewUser(null)
        }
      >
        <DialogContent
          className={`sm:max-w-lg [&>button]:cursor-pointer ${
            isDark
              ? "bg-slate-900 border-slate-800 text-slate-200"
              : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center justify-between gap-2 text-blue-500 pr-6">
              <span className="flex items-center gap-2">
                <CreditCard size={18} />
                Card Preview
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPreviewFlipped(
                    (f) => !f
                  )
                }
                className={`h-7 px-2.5 text-[11px] font-semibold normal-case cursor-pointer ${
                  isDark
                    ? "text-slate-400 hover:text-white hover:bg-slate-800"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <RotateCw className="w-3 h-3 mr-1" />
                Flip to{" "}
                {previewFlipped
                  ? "front"
                  : "back"}
              </Button>
            </DialogTitle>
          </DialogHeader>

          {previewUser &&
            (() => {
              const theme =
                getCardTheme(
                  previewUser.type
                );

              return (
                <div className="py-2">
                  <LockedFlipCard
                    flipped={
                      previewFlipped
                    }
                    onFlip={() =>
                      setPreviewFlipped(
                        (f) => !f
                      )
                    }

                    {/* ==================================================
                        FRONT CARD
                        TEXT + LOGO SLIGHTLY LARGER
                       ================================================== */}
                    front={
                      <div
                        className="rounded-2xl overflow-hidden border h-full w-full relative"
                        style={{
                          backgroundColor:
                            theme.cardBg,

                          borderColor:
                            theme.isLight
                              ? "#cbd5e1"
                              : "transparent",

                          boxShadow:
                            theme.isLight
                              ? "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)"
                              : "0 10px 25px -5px rgba(0,0,0,0.4), 0 4px 6px -2px rgba(0,0,0,0.2)",
                        }}
                      >
                        <ChevronStaircase
                          color={
                            theme.pattern
                          }
                        />

                        <div
                          className="relative h-full w-full flex flex-col justify-between"
                          style={{
                            padding: 34,
                          }}
                        >
                          {/* HEADER + LOGO */}
                          <div
                            className="flex items-center"
                            style={{
                              gap: 16,
                            }}
                          >
                            <div
                              className="rounded-full border-2 flex items-center justify-center flex-shrink-0 overflow-hidden"
                              style={{
                                /* INCREASED LOGO */
                                width: 52,
                                height: 52,

                                backgroundColor:
                                  theme.isLight
                                    ? "#f1f5f9"
                                    : "rgba(255,255,255,0.10)",

                                borderColor:
                                  theme.isLight
                                    ? "#cbd5e1"
                                    : "rgba(255,255,255,0.30)",
                              }}
                            >
                              <img
                                src="/calbayog.png"
                                alt="Calbayog"
                                className="w-full h-full object-cover"
                              />
                            </div>

                            {/* INCREASED SYSTEM TEXT */}
                            <span
                              className="font-bold tracking-wide uppercase"
                              style={{
                                color:
                                  theme.textColor,

                                fontSize: 20,

                                lineHeight: 1.1,
                              }}
                            >
                              Fare Collection System
                            </span>
                          </div>

                          {/* CARD BODY */}
                          <div
                            style={{
                              display:
                                "flex",

                              flexDirection:
                                "column",

                              gap: 5,
                            }}
                          >
                            {/* INCREASED UID */}
                            <div
                              className="font-mono font-extrabold tracking-wide"
                              style={{
                                color:
                                  theme.uidColor,

                                fontSize: 42,

                                lineHeight: 1.1,
                              }}
                            >
                              {
                                previewUser.cardUid
                              }
                            </div>

                            {/* INCREASED NAME */}
                            <div
                              className="font-semibold"
                              style={{
                                color:
                                  theme.textColor,

                                fontSize: 23,

                                lineHeight: 1.2,
                              }}
                            >
                              {
                                previewUser.fullName
                              }
                            </div>
                          </div>

                          {/* FOOTER */}
                          <div className="flex items-end justify-between">
                            {/* INCREASED TYPE */}
                            <div
                              className="font-extrabold tracking-wide"
                              style={{
                                color:
                                  theme.accent,

                                fontSize: 27,

                                lineHeight: 1.1,
                              }}
                            >
                              {
                                theme.label
                              }
                            </div>

                            <div className="text-right">
                              {/* INCREASED LABEL */}
                              <div
                                className="uppercase tracking-wide font-semibold"
                                style={{
                                  color:
                                    theme.subTextColor,

                                  fontSize: 13,

                                  lineHeight: 1.3,
                                }}
                              >
                                Valid Until
                              </div>

                              {/* INCREASED DATE */}
                              <div
                                className="font-mono font-bold"
                                style={{
                                  color:
                                    theme.textColor,

                                  fontSize: 17,

                                  lineHeight: 1.3,
                                }}
                              >
                                {formatDate(
                                  previewUser.expirationDate
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    }

                    {/* ==================================================
                        BACK CARD
                       ================================================== */}
                    back={
                      <div
                        className="rounded-2xl overflow-hidden bg-[#eceae4] flex flex-col border border-slate-300 h-full w-full"
                        style={{
                          boxShadow:
                            "0 10px 25px -5px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)",
                        }}
                      >
                        <div
                          style={{
                            height: "18%",
                          }}
                          className="bg-[#221f20] flex-shrink-0"
                        />

                        <div
                          className="flex-1 min-h-0 flex flex-col"
                          style={{
                            padding:
                              "12px 28px",
                          }}
                        >
                          <div
                            className="bg-white border-y border-slate-300"
                            style={{
                              padding:
                                "8px 14px",

                              marginBottom: 14,
                            }}
                          >
                            <span
                              className="font-extrabold text-slate-900"
                              style={{
                                fontSize: 19,
                              }}
                            >
                              Terms and Condition
                            </span>
                          </div>

                          <ul
                            className="text-slate-800 flex-1 min-h-0 overflow-hidden"
                            style={{
                              fontSize: 13,

                              lineHeight:
                                1.45,

                              display:
                                "flex",

                              flexDirection:
                                "column",

                              gap: 3,
                            }}
                          >
                            <li>
                              • Property of the Fare Collection System Operator.
                            </li>

                            <li>
                              • Non-transferable and subject to transit system rules.
                            </li>

                            <li>
                              • Positive balance required to pass through.
                            </li>

                            <li>
                              • Non-refundable card issuance fee applies.
                            </li>

                            <li>
                              • Operator is not responsible for lost or stolen cards.
                            </li>

                            <li>
                              • Unused balances on unregistered cards are non-refundable.
                            </li>

                            <li>
                              • Tampering or unauthorized duplication is strictly prohibited.
                            </li>
                          </ul>

                          <div
                            className="flex items-center border-t border-slate-300"
                            style={{
                              gap: 10,
                              paddingTop: 10,
                              marginTop: 6,
                            }}
                          >
                            <div
                              className="rounded-full bg-[#1b1f5c] flex items-center justify-center flex-shrink-0 overflow-hidden"
                              style={{
                                width: 30,
                                height: 30,
                              }}
                            >
                              <img
                                src="/calbayog.png"
                                alt="Calbayog"
                                className="w-full h-full object-cover"
                              />
                            </div>

                            <span
                              className="font-extrabold tracking-wide text-slate-900 uppercase"
                              style={{
                                fontSize: 13,
                              }}
                            >
                              Fare Collection System
                            </span>
                          </div>
                        </div>
                      </div>
                    }
                  />

                  <p
                    className={`text-center text-[10px] mt-2 ${
                      isDark
                        ? "text-slate-500"
                        : "text-slate-400"
                    }`}
                  >
                    Tap the card to flip
                  </p>

                  {/* QUICK FACTS */}
                  <div className="grid grid-cols-2 gap-3 mt-5">
                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        isDark
                          ? "bg-slate-950/60 border-slate-800"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Balance
                      </span>

                      <div
                        className={`text-sm font-semibold ${
                          isDark
                            ? "text-emerald-400"
                            : "text-emerald-600"
                        }`}
                      >
                        {formatPeso(
                          previewUser.balance ||
                            0
                        )}
                      </div>
                    </div>

                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        isDark
                          ? "bg-slate-950/60 border-slate-800"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Status
                      </span>

                      <div
                        className={`text-sm font-semibold ${
                          previewUser.status ===
                          "Active"
                            ? isDark
                              ? "text-emerald-400"
                              : "text-emerald-600"
                            : isDark
                            ? "text-red-400"
                            : "text-red-600"
                        }`}
                      >
                        {
                          previewUser.status
                        }
                      </div>
                    </div>

                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        isDark
                          ? "bg-slate-950/60 border-slate-800"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        Card Valid Until
                      </span>

                      <div
                        className={`text-sm font-semibold font-mono ${
                          isDark
                            ? "text-slate-200"
                            : "text-slate-800"
                        }`}
                      >
                        {formatDate(
                          previewUser.expirationDate
                        )}
                      </div>
                    </div>

                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        isDark
                          ? "bg-slate-950/60 border-slate-800"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1 ${
                          isDark
                            ? "text-slate-500"
                            : "text-slate-400"
                        }`}
                      >
                        <LinkIcon size={10} />
                        Linked Account
                      </span>

                      <div
                        className={`text-sm font-mono ${
                          normalizeEmail(
                            previewUser.email
                          )
                            ? isDark
                              ? "text-blue-400"
                              : "text-blue-600"
                            : isDark
                            ? "text-slate-500 italic"
                            : "text-slate-400 italic"
                        }`}
                      >
                        {normalizeEmail(
                          previewUser.email
                        ) ??
                          "No account linked"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setPreviewUser(null)
              }
              className={`text-xs font-medium cursor-pointer ${
                isDark
                  ? "text-slate-400 hover:text-white hover:bg-slate-800"
                  : "text-slate-500"
              }`}
            >
              Close
            </Button>

            {previewUser && (
              <Button
                onClick={() => {
                  const user =
                    previewUser;

                  setPreviewUser(null);

                  openRenew(user);
                }}
                disabled={
                  !isCardExpired(
                    previewUser.expirationDate
                  )
                }
                title={
                  !isCardExpired(
                    previewUser.expirationDate
                  )
                    ? `Not yet expired — valid until ${formatDate(
                        previewUser.expirationDate
                      )}`
                    : undefined
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Renew Card
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================
          EDIT DIALOG
          ============================================================ */}
      <Dialog
        open={!!editUser}
        onOpenChange={(open) =>
          !open &&
          setEditUser(null)
        }
      >
        <DialogContent
          className={`sm:max-w-lg [&>button]:cursor-pointer ${
            isDark
              ? "bg-slate-900 border-slate-800 text-slate-200"
              : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-500">
              <Pencil size={18} />
              Update User
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            {/* Full Name */}
            <div className="space-y-2 col-span-2">
              <Label
                className={`text-xs font-semibold ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Full Name
              </Label>

              <Input
                value={
                  editForm.fullName
                }
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    fullName:
                      e.target.value,
                  })
                }
                className={`text-sm font-medium ${
                  isDark
                    ? "bg-slate-950 border-slate-800 text-white"
                    : "bg-white border-slate-200"
                }`}
              />
            </div>

            {/* Contact Number */}
            <div className="space-y-2 col-span-2">
              <Label
                className={`text-xs font-semibold flex items-center gap-1 ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                <Phone size={10} />
                Contact Number
              </Label>

              <Input
                value={
                  editForm.contactNumber
                }
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    contactNumber:
                      e.target.value,
                  })
                }
                className={`text-sm font-mono ${
                  isDark
                    ? "bg-slate-950 border-slate-800 text-white"
                    : "bg-white border-slate-200"
                }`}
              />
            </div>

            {/* Card Type */}
            <div className="space-y-2">
              <Label
                className={`text-xs font-semibold ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Card Type (read-only)
              </Label>

              <div
                className={`h-10 w-full rounded-md border px-3 flex items-center text-sm font-medium cursor-not-allowed ${
                  isDark
                    ? "bg-slate-950/60 border-slate-800 text-slate-300"
                    : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full inline-block mr-2 ${getTypeDotColor(
                    editUser?.type
                  )}`}
                />

                {editUser?.type ||
                  "Regular"}
              </div>
            </div>

            {/* Account Status */}
            <div className="space-y-2">
              <Label
                className={`text-xs font-semibold ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                Account Status (read-only)
              </Label>

              <div
                className={`h-10 w-full rounded-md border px-3 flex items-center text-sm font-medium cursor-not-allowed ${
                  isDark
                    ? "bg-slate-950/60 border-slate-800 text-slate-300"
                    : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full inline-block mr-2 ${getStatusDotColor(
                    editUser?.status ||
                      ""
                  )}`}
                />

                {editUser?.status ||
                  "Unknown"}
              </div>
            </div>

            {/* Linked Account */}
            <div className="space-y-2 col-span-2">
              <Label
                className="text-xs font-semibold flex items-center gap-1"
                style={{
                  color: normalizeEmail(
                    editUser?.email
                  )
                    ? isDark
                      ? "#60a5fa"
                      : "#2563eb"
                    : isDark
                    ? "#64748b"
                    : "#94a3b8",
                }}
              >
                <LinkIcon size={10} />

                {normalizeEmail(
                  editUser?.email
                )
                  ? "Linked Account Email (read-only)"
                  : "Linked Account (read-only)"}
              </Label>

              <Input
                disabled
                value={
                  normalizeEmail(
                    editUser?.email
                  ) ??
                  "No account linked to this card"
                }
                className={`font-mono text-xs cursor-not-allowed ${
                  isDark
                    ? "bg-slate-950/60 border-slate-800"
                    : "bg-slate-50 border-slate-200"
                } ${
                  normalizeEmail(
                    editUser?.email
                  )
                    ? isDark
                      ? "text-blue-400"
                      : "text-blue-600"
                    : isDark
                    ? "text-slate-500 italic"
                    : "text-slate-400 italic"
                }`}
              />
            </div>

            {/* Balance */}
            <div className="space-y-2 col-span-2">
              <Label
                className={`text-xs font-semibold flex items-center gap-1 ${
                  isDark
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                <Wallet size={10} />
                Balance (read-only)
              </Label>

              <Input
                disabled
                value={formatPeso(
                  parseFloat(
                    editUser?.balance ??
                      editForm.balance
                  ) || 0
                )}
                className={`font-semibold text-sm font-mono cursor-not-allowed ${
                  isDark
                    ? "bg-slate-950/60 border-slate-800 text-emerald-400"
                    : "bg-slate-50 border-slate-200 text-emerald-600"
                }`}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setEditUser(null)
              }
              className={`text-xs font-medium cursor-pointer ${
                isDark
                  ? "text-slate-400 hover:text-white hover:bg-slate-800"
                  : "text-slate-500"
              }`}
            >
              Cancel
            </Button>

            <Button
              onClick={handleUpdate}
              disabled={
                !hasChanges ||
                updateMutation.isPending
              }
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              {updateMutation.isPending
                ? "Saving..."
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================
          RENEW CONFIRMATION
          ============================================================ */}
      <AlertDialog
        open={!!renewUser}
        onOpenChange={(open) =>
          !open &&
          setRenewUser(null)
        }
      >
        <AlertDialogContent
          className={
            isDark
              ? "bg-slate-900 border-slate-800"
              : "bg-white border-slate-200"
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle
              className={`font-bold tracking-tight flex items-center gap-2 ${
                isDark
                  ? "text-white"
                  : "text-slate-900"
              }`}
            >
              <RefreshCw
                className="text-emerald-500"
                size={18}
              />

              Confirm Renewal
            </AlertDialogTitle>

            <AlertDialogDescription
              className={`text-sm leading-relaxed ${
                isDark
                  ? "text-slate-400"
                  : "text-slate-500"
              }`}
            >
              This will extend{" "}
              {renewUser?.fullName ??
                "this user"}
              's card validity by 1 year.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {renewUser && (
            <div
              className={`grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm ${
                isDark
                  ? "bg-slate-950/60 border-slate-800"
                  : "bg-slate-50 border-slate-200"
              }`}
            >
              <div>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide ${
                    isDark
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                >
                  Current Expiration
                </span>

                <div
                  className={`font-mono font-semibold ${
                    isDark
                      ? "text-slate-300"
                      : "text-slate-700"
                  }`}
                >
                  {formatDate(
                    renewUser.expirationDate
                  )}
                </div>
              </div>

              <div>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide ${
                    isDark
                      ? "text-emerald-500"
                      : "text-emerald-600"
                  }`}
                >
                  New Expiration
                </span>

                <div
                  className={`font-mono font-semibold ${
                    isDark
                      ? "text-emerald-400"
                      : "text-emerald-600"
                  }`}
                >
                  {formatDate(
                    computeRenewedExpiration(
                      renewUser.expirationDate
                    ).toISOString()
                  )}
                </div>
              </div>
            </div>
          )}

          {renewUser &&
            !isCardExpired(
              renewUser.expirationDate
            ) && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  isDark
                    ? "bg-red-950/40 border-red-900 text-red-400"
                    : "bg-red-50 border-red-200 text-red-600"
                }`}
              >
                This card is still valid until{" "}
                {formatDate(
                  renewUser.expirationDate
                )}
                . Renewal is only allowed after expiration.
              </div>
            )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isRenewing}
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed border-0 shadow-none bg-transparent hover:bg-transparent ${
                isDark
                  ? "text-slate-400 hover:text-slate-300"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={confirmRenew}
              disabled={
                isRenewing ||
                !!(
                  renewUser &&
                  !isCardExpired(
                    renewUser.expirationDate
                  )
                )
              }
              className="bg-emerald-600 text-white hover:bg-emerald-700 font-semibold text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
            >
              {isRenewing
                ? "Renewing..."
                : "Confirm Renewal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ============================================================
          TRANSFER BALANCE
          ============================================================ */}
      <Dialog
        open={!!transferUser}
        onOpenChange={(open) =>
          !open &&
          setTransferUser(null)
        }
      >
        <DialogContent
          className={`sm:max-w-lg [&>button]:cursor-pointer ${
            isDark
              ? "bg-slate-900 border-slate-800 text-slate-200"
              : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-orange-500">
              <ArrowRightLeft size={18} />
              Transfer Balance
            </DialogTitle>
          </DialogHeader>

          {transferUser && (
            <div className="space-y-4 py-2">
              {/* Source card */}
              <div
                className={`rounded-lg border p-3 text-sm ${
                  isDark
                    ? "bg-slate-950/60 border-slate-800"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide ${
                    isDark
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                >
                  From (will be blocked)
                </span>

                <div className="flex items-center justify-between mt-1">
                  <div>
                    <div className="font-mono text-xs text-blue-500 font-semibold">
                      {
                        transferUser.cardUid
                      }
                    </div>

                    <div
                      className={`text-sm font-medium ${
                        isDark
                          ? "text-slate-200"
                          : "text-slate-800"
                      }`}
                    >
                      {
                        transferUser.fullName
                      }
                    </div>
                  </div>

                  <div
                    className={`font-semibold ${
                      isDark
                        ? "text-emerald-400"
                        : "text-emerald-600"
                    }`}
                  >
                    {formatPeso(
                      transferUser.balance ||
                        0
                    )}
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <Label
                  className={`text-xs font-semibold ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  Reason
                </Label>

                <Select
                  value={
                    transferReason
                  }
                  onValueChange={(v) =>
                    setTransferReason(
                      v as (typeof TRANSFER_REASONS)[number]
                    )
                  }
                >
                  <SelectTrigger
                    className={`text-sm font-medium cursor-pointer ${
                      isDark
                        ? "bg-slate-950 border-slate-800 text-slate-200"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent
                    className={
                      isDark
                        ? "bg-slate-900 border-slate-800 text-slate-300"
                        : "bg-white border-slate-200 text-slate-700"
                    }
                  >
                    {TRANSFER_REASONS.map(
                      (r) => (
                        <SelectItem
                          key={r}
                          value={r}
                          className="cursor-pointer"
                        >
                          {r}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Replacement card */}
              <div className="space-y-2">
                <Label
                  className={`text-xs font-semibold ${
                    isDark
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  Replacement Card
                </Label>

                <div className="relative">
                  <Search
                    className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      isDark
                        ? "text-slate-500"
                        : "text-slate-400"
                    }`}
                  />

                  <Input
                    placeholder="Search by UID or name..."
                    value={
                      transferTarget
                        ? `${transferTarget.cardUid} — ${transferTarget.fullName}`
                        : transferQuery
                    }
                    onChange={(e) => {
                      setTransferTarget(
                        null
                      );

                      setTransferQuery(
                        e.target.value
                      );
                    }}
                    className={`pl-10 text-sm ${
                      isDark
                        ? "bg-slate-950 border-slate-800 text-slate-200"
                        : "bg-white border-slate-200"
                    }`}
                  />
                </div>

                {!transferTarget &&
                  transferQuery.trim() && (
                    <div
                      className={`max-h-40 overflow-auto rounded-lg border divide-y ${
                        isDark
                          ? "border-slate-800 divide-slate-800"
                          : "border-slate-200 divide-slate-100"
                      }`}
                    >
                      {transferCandidates.length >
                      0 ? (
                        transferCandidates.map(
                          (u: any) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                setTransferTarget(
                                  u
                                );

                                setTransferQuery(
                                  ""
                                );
                              }}
                              className={`w-full text-left px-3 py-2 text-sm cursor-pointer ${
                                isDark
                                  ? "hover:bg-slate-800"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <span className="font-mono text-xs text-blue-500 font-semibold mr-2">
                                {
                                  u.cardUid
                                }
                              </span>

                              <span
                                className={
                                  isDark
                                    ? "text-slate-300"
                                    : "text-slate-700"
                                }
                              >
                                {
                                  u.fullName
                                }
                              </span>
                            </button>
                          )
                        )
                      ) : (
                        <div
                          className={`px-3 py-2 text-xs italic ${
                            isDark
                              ? "text-slate-500"
                              : "text-slate-400"
                          }`}
                        >
                          No matching active cards
                        </div>
                      )}
                    </div>
                  )}
              </div>

              {transferTarget && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                    isDark
                      ? "bg-emerald-950/40 border-emerald-900 text-emerald-400"
                      : "bg-emerald-50 border-emerald-200 text-emerald-600"
                  }`}
                >
                  {formatPeso(
                    transferUser.balance ||
                      0
                  )}{" "}
                  will move to{" "}
                  {
                    transferTarget.cardUid
                  }{" "}
                  (
                  {
                    transferTarget.fullName
                  }
                  ).{" "}
                  {
                    transferUser.cardUid
                  }{" "}
                  will be marked Blocked.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setTransferUser(null)
              }
              disabled={
                isTransferring
              }
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed ${
                isDark
                  ? "text-slate-400 hover:text-white hover:bg-slate-800"
                  : "text-slate-500"
              }`}
            >
              Cancel
            </Button>

            <Button
              onClick={
                confirmTransfer
              }
              disabled={
                isTransferring ||
                !transferTarget
              }
              className="bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold px-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-orange-600"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />

              {isTransferring
                ? "Transferring..."
                : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================
          DELETE CONFIRM
          ============================================================ */}
      <AlertDialog
        open={!!deleteUser}
        onOpenChange={(open) =>
          !open &&
          setDeleteUser(null)
        }
      >
        <AlertDialogContent
          className={
            isDark
              ? "bg-slate-900 border-slate-800"
              : "bg-white border-slate-200"
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle
              className={`font-bold tracking-tight flex items-center gap-2 ${
                isDark
                  ? "text-white"
                  : "text-slate-900"
              }`}
            >
              <ShieldAlert
                className="text-red-500"
                size={18}
              />

              Confirm Deletion
            </AlertDialogTitle>

            <AlertDialogDescription
              className={`text-sm leading-relaxed ${
                isDark
                  ? "text-slate-400"
                  : "text-slate-500"
              }`}
            >
              This will permanently remove the user and all associated transaction history from the database.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                deleteMutation.isPending
              }
              className={`text-xs font-medium cursor-pointer disabled:cursor-not-allowed ${
                isDark
                  ? "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={
                confirmDelete
              }
              disabled={
                deleteMutation.isPending
              }
              className="bg-red-600 text-white hover:bg-red-700 font-semibold text-xs cursor-pointer"
            >
              {deleteMutation.isPending
                ? "Deleting..."
                : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}