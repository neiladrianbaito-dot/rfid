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

const POLL_INTERVAL_MS = 500;
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

  const { data: users, isLoading } = useListUsers(
    search ? { search } : undefined,
    {
      query: {
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: true,
      },
    }
  );

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
          50% { background-color: rgba(59,130,246,0.15); }
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic flex items-center gap-3">
            <Users className="text-blue-500" />
            User <span className="text-blue-500">Management</span>
          </h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
            Manage cardholder credentials and wallet balances
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <Zap className="text-blue-400 animate-pulse" size={16} />
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">Live Telemetry Active</span>
          </div>
          {lastUpdated && (
            <span className="text-[10px] text-slate-600 font-mono pr-1">
              Last sync: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Table Card */}
      <Card className="bg-slate-900/40 border-slate-800 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-transparent" />

        <CardHeader className="flex-none pb-4 bg-slate-900/20 border-b border-slate-800/50">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 shrink-0">
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                LIVE
              </span>
              <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400">
                Authorized Card Holders
              </CardTitle>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="SEARCH UID OR IDENTITY..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-slate-950 border-slate-800 focus:border-blue-500 text-white font-bold placeholder:text-slate-700 text-xs tracking-wider h-10"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 mt-6 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-4">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-[#0a0f1c] z-10 border-b border-slate-800">
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Card UID</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Full Name</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <span className="flex items-center gap-1">
                          <Phone size={10} /> Contact No.
                        </span>
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-sky-400">
                        <span className="flex items-center gap-1"><LinkIcon size={10} /> Linked Account</span>
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Type</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Balance</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length > 0 ? (
                      paginatedList.map((user) => {
                        const linkedEmail = normalizeEmail(user.email);
                        return (
                          <TableRow
                            key={user.id}
                            className={`border-slate-800/50 transition-colors hover:bg-white/5 group ${
                              newRowId === user.id ? "row-pulse" : ""
                            }`}
                          >
                            <TableCell className="font-mono text-[11px] text-blue-400 font-bold">
                              {user.cardUid}
                            </TableCell>

                            <TableCell>
                              <span className="text-xs font-black text-white uppercase tracking-tight">
                                {user.fullName}
                              </span>
                            </TableCell>

                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
                                <Phone className="w-3 h-3 text-slate-500 flex-shrink-0" />
                                {user.contactNumber || (
                                  <span className="text-slate-600 italic text-[10px]">—</span>
                                )}
                              </span>
                            </TableCell>

                            <TableCell>
                              {linkedEmail ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded w-fit">
                                    <LinkIcon size={8} /> Linked
                                  </span>
                                  <span className="flex items-center gap-1 text-[11px] text-sky-400 font-mono">
                                    <Mail className="w-3 h-3 flex-shrink-0" />
                                    {linkedEmail}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-slate-500 bg-slate-800/50 border border-slate-700/40 px-1.5 py-0.5 rounded w-fit">
                                    <LinkIcon size={8} /> Not Linked
                                  </span>
                                  <span className="text-[10px] text-slate-600 italic font-mono">
                                    No account registered
                                  </span>
                                </div>
                              )}
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-[9px] font-black uppercase border-blue-500/30 text-blue-400 bg-blue-500/5"
                              >
                                {user.type || "Regular"}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              <span className="inline-flex items-center gap-1 font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-[11px]">
                                <Wallet className="w-3 h-3" />
                                {formatPeso(user.balance || 0)}
                              </span>
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[9px] font-black uppercase ${
                                  user.status === "Active"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/50"
                                    : "bg-red-500/10 text-red-400 border-red-500/50"
                                }`}
                              >
                                {user.status}
                              </Badge>
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEdit(user)}
                                  className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteUser(user)}
                                  className="h-8 w-8 text-red-500/50 hover:text-red-400 hover:bg-red-500/10"
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
                          className="text-center py-20 opacity-20 uppercase font-black tracking-widest text-xs"
                        >
                          No Identities Found In Registry
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-2">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                  Showing{" "}
                  <span className="text-slate-300 font-black">
                    {userList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, userList.length)}
                  </span>{" "}
                  of{" "}
                  <span className="text-slate-300 font-black">{userList.length}</span>{" "}
                  users
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8 px-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 border border-slate-800"
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" />
                    Prev
                  </Button>

                  <span className="text-[10px] font-black text-slate-400 px-2 tabular-nums">
                    <span className="text-blue-400">{safePage}</span>
                    <span className="text-slate-600"> / {totalPages}</span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-8 px-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 border border-slate-800"
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
        <DialogContent className="bg-slate-950 border-slate-800 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-blue-500">
              <Pencil size={18} /> Update User Identity
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">

            <div className="space-y-2 col-span-2">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                className="bg-slate-900 border-slate-800 text-xs font-bold"
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label
                className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1"
                style={{ color: normalizeEmail(editUser?.email) ? "#38bdf8" : "#64748b" }}
              >
                <LinkIcon size={10} />
                {normalizeEmail(editUser?.email) ? "Linked Account Email (read-only)" : "Linked Account (read-only)"}
              </Label>
              <Input
                disabled
                value={normalizeEmail(editUser?.email) ?? "No account linked to this card"}
                className={`bg-slate-900/50 border-slate-800 font-mono text-xs opacity-70 cursor-not-allowed ${
                  normalizeEmail(editUser?.email) ? "text-sky-400" : "text-slate-500 italic"
                }`}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Class Type</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm({ ...editForm, type: v })}
              >
                <SelectTrigger className="bg-slate-900 border-slate-800 text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-slate-800 text-white">
                  <SelectItem value="Regular">REGULAR</SelectItem>
                  <SelectItem value="Student">STUDENT</SelectItem>
                  <SelectItem value="Senior">SENIOR</SelectItem>
                  <SelectItem value="PWD">PWD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Account Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger className="bg-slate-900 border-slate-800 text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-slate-800 text-white">
                  <SelectItem value="Active">ACTIVE</SelectItem>
                  <SelectItem value="Inactive">INACTIVE</SelectItem>
                  <SelectItem value="Blocked">BLOCKED</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-1">
                <Phone size={10} /> Contact Number
              </Label>
              <Input
                value={editForm.contactNumber}
                onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })}
                className="bg-slate-900 border-slate-800 text-xs font-mono"
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                <Wallet size={10} /> Balance (read-only)
              </Label>
              <Input
                disabled
                value={formatPeso(parseFloat(editForm.balance) || 0)}
                className="bg-slate-900/50 border-slate-800 text-emerald-400 font-bold text-xs font-mono opacity-70 cursor-not-allowed"
              />
            </div>

          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditUser(null)}
              className="text-slate-400 uppercase text-[10px] font-black"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-500 text-white uppercase text-[10px] font-black px-6"
            >
              {updateMutation.isPending ? "Updating..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <AlertDialogContent className="bg-slate-950 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white uppercase font-black tracking-tighter flex items-center gap-2">
              <ShieldAlert className="text-red-500" /> Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs uppercase font-bold leading-relaxed">
              This will permanently remove the user and all associated transaction history from the database.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending}
              className="bg-slate-900 border-slate-800 text-white text-[10px] uppercase font-black tracking-widest"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-500 font-black uppercase text-[10px] tracking-widest"
            >
              {deleteMutation.isPending ? "Deleting..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}