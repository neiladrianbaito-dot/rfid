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
import { Search, Pencil, Trash2, Wallet, Users, Zap, ShieldAlert, Mail, LinkIcon, ChevronLeft, ChevronRight, Phone, CheckCircle2, Eye, CreditCard, Radio, RotateCw, Bus } from "lucide-react";
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

const PAGE_SIZE = 10;

const TYPE_FILTERS = ["All", "Regular", "Student", "Senior", "PWD"] as const;

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
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

// 🪪 Card preview theming — accent color + label color per type, matching the physical card design
function getCardTheme(type: string | null | undefined) {
  const t = (type || "Regular").toLowerCase();
  switch (t) {
    case "student":
      return { accent: "#60a5fa", pattern: "#3b82f6", label: "STUDENT" };
    case "senior":
      return { accent: "#facc15", pattern: "#eab308", label: "SENIOR" };
    case "pwd":
      return { accent: "#34d399", pattern: "#10b981", label: "PWD" };
    case "regular":
    default:
      return { accent: "#f87171", pattern: "#f97316", label: "REGULAR" };
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

export default function UserManagementPage() {
  const { isDark } = useTheme();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All");
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [previewUser, setPreviewUser] = useState<any>(null);
  const [previewFlipped, setPreviewFlipped] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    contactNumber: "",
    balance: "",
    status: "",
    type: "",
  });
  const [page, setPage] = useState(1);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter]);

  const { data: users, isLoading, refetch: refetchUsers } = useListUsers(
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

  const userList = Array.isArray(users) ? users : [];

  // Apply the type filter on top of whatever the search endpoint returned
  const filteredList =
    typeFilter === "All"
      ? userList
      : userList.filter(
          (u: any) => (u.type || "Regular").toLowerCase() === typeFilter.toLowerCase()
        );

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = filteredList.slice(startIndex, startIndex + PAGE_SIZE);

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
        toast({ title: <SuccessTitle text="User Deleted Successfully" /> });
      },
    },
  });

  const openEdit = (user: any) => {
    setEditUser(user);
    setEditForm({
      fullName: user.fullName,
      contactNumber: user.contactNumber,
      balance: String(user.balance || 0),
      status: user.status,
      type: user.type || "Regular",
    });
  };

  const handleUpdate = () => {
    if (!editUser) return;
    updateMutation.mutate({
      id: editUser.id,
      data: {
        fullName: editForm.fullName,
        contactNumber: editForm.contactNumber,
        balance: parseFloat(editForm.balance),
        status: editForm.status,
        type: editForm.type,
      },
    });
  };

  const confirmDelete = () => {
    if (!deleteUser) return;
    deleteMutation.mutate(
      { id: deleteUser.id },
      { onSettled: () => setDeleteUser(null) },
    );
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

        .card-flip-scene { perspective: 1600px; }
        .card-flip-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1);
          transform-style: preserve-3d;
        }
        .card-flip-inner.is-flipped { transform: rotateY(180deg); }
        .card-face {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .card-face-back { transform: rotateY(180deg); }
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
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 mt-6 flex flex-col overflow-hidden">
          {isLoading ? (
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
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-slate-400"}`}>Status</TableHead>
                      <TableHead className={`text-[11px] font-semibold uppercase tracking-wide text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length > 0 ? (
                      paginatedList.map((user) => {
                        const linkedEmail = normalizeEmail(user.email);
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
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => { setPreviewFlipped(false); setPreviewUser(user); }}
                                  className={`h-8 w-8 cursor-pointer ${isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}
                                  title="Preview card"
                                >
                                  <Eye className="w-3.5 h-3.5" />
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
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={8}
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
                {/* Physical card mockup — click to flip, same as the "Flip" button */}
                <div
                  className="card-flip-scene relative w-full aspect-[1376/774] cursor-pointer"
                  onClick={() => setPreviewFlipped((f) => !f)}
                >
                  <div className={`card-flip-inner ${previewFlipped ? "is-flipped" : ""}`}>
                    {/* ---- FRONT FACE ---- */}
                    <div
                      className="card-face rounded-2xl overflow-hidden shadow-lg"
                      style={{ backgroundColor: "#1b1f5c" }}
                    >
                      <ChevronStaircase color={theme.pattern} />

                      <div className="relative h-full w-full flex flex-col justify-between p-5 sm:p-7">
                        {/* Header / logo badge */}
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
                            <Bus className="w-4 h-4 text-white/90" strokeWidth={2.5} />
                          </div>
                          <span className="text-white font-bold tracking-wide text-sm sm:text-base uppercase">
                            Fare Collection System
                          </span>
                        </div>

                        {/* Body */}
                        <div className="space-y-1">
                          <div
                            className="font-mono font-extrabold text-2xl sm:text-3xl tracking-wide"
                            style={{ color: "#5eead4" }}
                          >
                            {previewUser.cardUid}
                          </div>
                          <div className="text-white font-semibold text-base sm:text-lg">
                            {previewUser.fullName}
                          </div>
                        </div>

                        {/* Footer label */}
                        <div
                          className="font-extrabold text-lg sm:text-xl tracking-wide"
                          style={{ color: theme.accent }}
                        >
                          {theme.label}
                        </div>
                      </div>
                    </div>

                    {/* ---- BACK FACE ---- */}
                    <div className="card-face card-face-back rounded-2xl overflow-hidden shadow-lg bg-[#eceae4] flex flex-col">
                      <div className="h-[18%] bg-[#221f20] flex-shrink-0" />
                      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-2 sm:py-3">
                        <div className="bg-white border-y border-slate-300 py-1.5 px-3 mb-2 sm:mb-3">
                          <span className="text-[13px] sm:text-base font-extrabold text-slate-900">Terms and Condition</span>
                        </div>
                        <ul className="space-y-0.5 sm:space-y-1 text-[9px] sm:text-[11px] leading-tight text-slate-800 flex-1 min-h-0 overflow-hidden">
                          <li>• Property of the Fare Collection System Operator.</li>
                          <li>• Non-transferable and subject to transit system rules.</li>
                          <li>• Positive balance required to pass through.</li>
                          <li>• Non-refundable card issuance fee applies.</li>
                          <li>• Operator is not responsible for lost or stolen cards.</li>
                          <li>• Unused balances on unregistered cards are non-refundable.</li>
                          <li>• Tampering or unauthorized duplication is strictly prohibited.</li>
                        </ul>
                        <div className={`flex items-center gap-2 border-t pt-1.5 sm:pt-2 mt-1 ${isDark ? "border-slate-400/40" : "border-slate-300"}`}>
                          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#1b1f5c] flex items-center justify-center flex-shrink-0">
                            <Bus className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" strokeWidth={2.5} />
                          </div>
                          <span className="text-[9px] sm:text-[11px] font-extrabold tracking-wide text-slate-900 uppercase">
                            Fare Collection System
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
                  <div className={`rounded-lg border px-3 py-2 col-span-2 ${isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
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

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPreviewUser(null)}
              className={`text-xs font-medium cursor-pointer ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500"}`}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className={`sm:max-w-lg [&>button]:cursor-pointer ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-500">
              <Pencil size={18} /> Update User
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">

            <div className="space-y-2 col-span-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                className={`text-sm font-medium ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200"}`}
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label
                className="text-xs font-semibold flex items-center gap-1"
                style={{ color: normalizeEmail(editUser?.email) ? (isDark ? "#60a5fa" : "#2563eb") : (isDark ? "#64748b" : "#94a3b8") }}
              >
                <LinkIcon size={10} />
                {normalizeEmail(editUser?.email) ? "Linked Account Email (read-only)" : "Linked Account (read-only)"}
              </Label>
              <Input
                disabled
                value={normalizeEmail(editUser?.email) ?? "No account linked to this card"}
                className={`font-mono text-xs cursor-not-allowed ${
                  isDark ? "bg-slate-950/60 border-slate-800" : "bg-slate-50 border-slate-200"
                } ${
                  normalizeEmail(editUser?.email)
                    ? isDark ? "text-blue-400" : "text-blue-600"
                    : isDark ? "text-slate-500 italic" : "text-slate-400 italic"
                }`}
              />
            </div>

            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Class Type</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm({ ...editForm, type: v })}
              >
                <SelectTrigger
                  className={`text-sm font-medium cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full inline-block ${getTypeDotColor(editForm.type)}`} />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
                  <SelectItem value="Regular" className="cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Regular
                    </span>
                  </SelectItem>
                  <SelectItem value="Student" className="cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Student
                    </span>
                  </SelectItem>
                  <SelectItem value="Senior" className="cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Senior
                    </span>
                  </SelectItem>
                  <SelectItem value="PWD" className="cursor-pointer">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> PWD
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Account Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger className={`text-sm font-medium cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-200"}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
                  <SelectItem value="Active" className="cursor-pointer">Active</SelectItem>
                  <SelectItem value="Inactive" className="cursor-pointer">Inactive</SelectItem>
                  <SelectItem value="Blocked" className="cursor-pointer">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2">
              <Label className={`text-xs font-semibold flex items-center gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <Phone size={10} /> Contact Number
              </Label>
              <Input
                value={editForm.contactNumber}
                onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })}
                className={`text-sm font-mono ${isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200"}`}
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label className={`text-xs font-semibold flex items-center gap-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                <Wallet size={10} /> Balance (read-only)
              </Label>
              <Input
                disabled
                value={formatPeso(parseFloat(editForm.balance) || 0)}
                className={`font-semibold text-sm font-mono cursor-not-allowed ${
                  isDark ? "bg-slate-950/60 border-slate-800 text-emerald-400" : "bg-slate-50 border-slate-200 text-emerald-600"
                }`}
              />
            </div>

          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditUser(null)}
              className={`text-xs font-medium cursor-pointer ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500"}`}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-6 cursor-pointer disabled:cursor-not-allowed"
            >
              {updateMutation.isPending ? "Updating..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
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
              className="bg-red-600 text-white hover:bg-red-700 font-semibold text-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {deleteMutation.isPending ? "Deleting..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}