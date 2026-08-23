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
import { Search, Pencil, Trash2, Wallet, Users, Zap, ShieldAlert, Mail, LinkIcon, ChevronLeft, ChevronRight, Phone } from "lucide-react";
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

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

export default function UserManagementPage() {
  const [search, setSearch] = useState("");
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);
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
  }, [search]);

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

  const totalPages = Math.max(1, Math.ceil(userList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = userList.slice(startIndex, startIndex + PAGE_SIZE);

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
        toast({ title: "User Updated Successfully" });
      },
    },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "User Deleted Successfully" });
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
    <div className="space-y-8 h-full min-h-0 flex flex-col" data-testid="users-page">
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Users className="text-blue-600" size={26} />
            User Management
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Manage cardholder credentials and wallet balances
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-lg">
            <Zap className="text-blue-600" size={16} />
            <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Live Telemetry Active</span>
          </div>
          {lastUpdated && (
            <span className="text-[10px] text-slate-400 font-mono pr-1">
              Last sync: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Table Card */}
      <Card className="bg-white border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />

        <CardHeader className="flex-none pb-4 bg-slate-50/60 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5 shrink-0">
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                LIVE
              </span>
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Authorized Card Holders
              </CardTitle>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search UID or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-white border-slate-200 focus-visible:ring-blue-500 text-slate-800 font-medium placeholder:text-slate-400 text-sm h-10"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 mt-6 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-4">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full bg-slate-100 rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10 border-b border-slate-200">
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Card UID</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Full Name</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <span className="flex items-center gap-1">
                          <Phone size={10} /> Contact No.
                        </span>
                      </TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                        <span className="flex items-center gap-1"><LinkIcon size={10} /> Linked Account</span>
                      </TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Type</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Balance</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length > 0 ? (
                      paginatedList.map((user) => {
                        const linkedEmail = normalizeEmail(user.email);
                        return (
                          <TableRow
                            key={user.id}
                            className={`border-slate-100 transition-colors hover:bg-slate-50 ${
                              newRowId === user.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className="font-mono text-xs text-blue-600 font-semibold">
                              {user.cardUid}
                            </TableCell>

                            <TableCell>
                              <span className="text-sm font-medium text-slate-800">
                                {user.fullName}
                              </span>
                            </TableCell>

                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-500">
                                <Phone className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                {user.contactNumber || (
                                  <span className="text-slate-300 italic text-[11px]">—</span>
                                )}
                              </span>
                            </TableCell>

                            <TableCell>
                              {linkedEmail ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded w-fit">
                                    <LinkIcon size={8} /> Linked
                                  </span>
                                  <span className="flex items-center gap-1 text-xs text-blue-600 font-mono">
                                    <Mail className="w-3 h-3 flex-shrink-0" />
                                    {linkedEmail}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded w-fit">
                                    <LinkIcon size={8} /> Not Linked
                                  </span>
                                  <span className="text-[11px] text-slate-400 italic font-mono">
                                    No account registered
                                  </span>
                                </div>
                              )}
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-[10px] font-semibold border-blue-200 text-blue-600 bg-blue-50"
                              >
                                {user.type || "Regular"}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 text-xs">
                                <Wallet className="w-3 h-3" />
                                {formatPeso(user.balance || 0)}
                              </span>
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold ${
                                  user.status === "Active"
                                    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
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
                                  onClick={() => openEdit(user)}
                                  className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer"
                                  title="Edit user"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteUser(user)}
                                  className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
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
                          className="text-center py-20 text-slate-300 uppercase font-semibold tracking-widest text-xs"
                        >
                          No users found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-2">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wide">
                  Showing{" "}
                  <span className="text-slate-600 font-semibold">
                    {userList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, userList.length)}
                  </span>{" "}
                  of{" "}
                  <span className="text-slate-600 font-semibold">{userList.length}</span>{" "}
                  users
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8 px-3 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 border border-slate-200 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" />
                    Prev
                  </Button>

                  <span className="text-xs font-semibold text-slate-500 px-2 tabular-nums">
                    <span className="text-blue-600">{safePage}</span>
                    <span className="text-slate-300"> / {totalPages}</span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-8 px-3 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 border border-slate-200 cursor-pointer disabled:cursor-not-allowed"
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

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-lg [&>button]:cursor-pointer">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-blue-600">
              <Pencil size={18} /> Update User
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">

            <div className="space-y-2 col-span-2">
              <Label className="text-xs font-semibold text-slate-500">Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                className="bg-white border-slate-200 text-sm font-medium"
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label
                className="text-xs font-semibold flex items-center gap-1"
                style={{ color: normalizeEmail(editUser?.email) ? "#2563eb" : "#94a3b8" }}
              >
                <LinkIcon size={10} />
                {normalizeEmail(editUser?.email) ? "Linked Account Email (read-only)" : "Linked Account (read-only)"}
              </Label>
              <Input
                disabled
                value={normalizeEmail(editUser?.email) ?? "No account linked to this card"}
                className={`bg-slate-50 border-slate-200 font-mono text-xs cursor-not-allowed ${
                  normalizeEmail(editUser?.email) ? "text-blue-600" : "text-slate-400 italic"
                }`}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-500">Class Type</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm({ ...editForm, type: v })}
              >
                <SelectTrigger className="bg-white border-slate-200 text-sm font-medium cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-700">
                  <SelectItem value="Regular" className="cursor-pointer">Regular</SelectItem>
                  <SelectItem value="Student" className="cursor-pointer">Student</SelectItem>
                  <SelectItem value="Senior" className="cursor-pointer">Senior</SelectItem>
                  <SelectItem value="PWD" className="cursor-pointer">PWD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-500">Account Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger className="bg-white border-slate-200 text-sm font-medium cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-700">
                  <SelectItem value="Active" className="cursor-pointer">Active</SelectItem>
                  <SelectItem value="Inactive" className="cursor-pointer">Inactive</SelectItem>
                  <SelectItem value="Blocked" className="cursor-pointer">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2">
              <Label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                <Phone size={10} /> Contact Number
              </Label>
              <Input
                value={editForm.contactNumber}
                onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })}
                className="bg-white border-slate-200 text-sm font-mono"
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                <Wallet size={10} /> Balance (read-only)
              </Label>
              <Input
                disabled
                value={formatPeso(parseFloat(editForm.balance) || 0)}
                className="bg-slate-50 border-slate-200 text-emerald-600 font-semibold text-sm font-mono cursor-not-allowed"
              />
            </div>

          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditUser(null)}
              className="text-slate-500 text-xs font-medium cursor-pointer"
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
        <AlertDialogContent className="bg-white border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900 font-bold tracking-tight flex items-center gap-2">
              <ShieldAlert className="text-red-500" size={18} /> Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 text-sm leading-relaxed">
              This will permanently remove the user and all associated transaction history from the database.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending}
              className="bg-white border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed"
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