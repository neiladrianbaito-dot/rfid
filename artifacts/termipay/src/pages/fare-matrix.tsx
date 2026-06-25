import { useState, useMemo, useRef, useEffect } from "react";
import {
  useListRoutes,
  useCreateRoute,
  useUpdateRoute,
  useDeleteRoute,
  useToggleRoute,
  getListRoutesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Power,
  PowerOff,
  ArrowLeftRight,
  CheckCircle2,
  AlertCircle,
  Search,
  Zap,
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

const CALBAYOG_BARANGAYS = [
  "Bugtong",
  "Tinaplacan",
  "Malaga",
  "Cag-Manipis",
  "Malayog",
  "Peña",
  "Cag-Olango",
  "Cagnipa",
  "San Joaquin",
  "Baay",
  "Binaliw",
  "Manginoo",
  "Bantian",
  "Marcatubig",
  "Malajog",
  "Malopalo",
  "Tinambacan",
  "Amampacang",
  "Lonoy",
  "Sabang",
  "Talahid",
];

const DEFAULT_DESTINATION = "Calbayog";

export default function FareMatrixPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [addForm, setAddForm] = useState({
    origin: "",
    destination: DEFAULT_DESTINATION,
    fareAmount: "",
    viceVersa: true,
  });
  const [editRoute, setEditRoute] = useState<any>(null);
  const [deleteRoute, setDeleteRoute] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    origin: "",
    destination: "",
    fareAmount: "",
  });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: routes, isLoading, refetch: refetchRoutes } = useListRoutes(undefined, {
    query: {
      refetchOnWindowFocus: true,
    },
  });

  useRealtimeRefetch(["fare_routes"], () => {
    refetchRoutes();
  });

  useEffect(() => {
    if (Array.isArray(routes) && routes.length >= 0) {
      setLastUpdated(new Date());
    }
  }, [routes]);

  const activeRoute = Array.isArray(routes)
    ? routes.find((r) => r.isActive) ?? null
    : null;

  const sortOrderRef = useRef<(string | number)[]>([]);

  const filteredRoutes = useMemo(() => {
    if (!Array.isArray(routes)) return [];

    const filtered = routes.filter(
      (r) =>
        r.origin.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.destination.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const activeItems = filtered.filter((r) => r.isActive);
    const inactiveItems = filtered.filter((r) => !r.isActive);

    inactiveItems.sort((a, b) => {
      const ai = sortOrderRef.current.indexOf(a.id);
      const bi = sortOrderRef.current.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const sorted = [...activeItems, ...inactiveItems];
    sortOrderRef.current = sorted.map((r) => r.id);
    return sorted;
  }, [routes, searchTerm]);

  const createMutation = useCreateRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      },
    },
  });

  const updateMutation = useUpdateRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
        setEditRoute(null);
        toast({ title: "Route updated" });
      },
    },
  });

  const deleteMutation = useDeleteRoute({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
        toast({ title: "Route deleted" });
      },
    },
  });

  const toggleMutation = useToggleRoute({
    mutation: {
      onMutate: async ({ id }: { id: string | number }) => {
        await queryClient.cancelQueries({ queryKey: getListRoutesQueryKey() });
        const previous = queryClient.getQueryData(getListRoutesQueryKey());
        queryClient.setQueryData(getListRoutesQueryKey(), (old: any) => {
          if (!Array.isArray(old)) return old;
          const clickedIsCurrentlyActive = old.find((r: any) => r.id === id)?.isActive;
          return old.map((r: any) => ({
            ...r,
            isActive: clickedIsCurrentlyActive ? (r.id === id ? false : r.isActive) : r.id === id,
          }));
        });
        return { previous };
      },
      onError: (_err: any, _vars: any, context: any) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(getListRoutesQueryKey(), context.previous);
        }
        toast({ title: "Failed to update route status", variant: "destructive" });
      },
      onSuccess: () => {
        toast({ title: "Route status updated" });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      },
    },
  });

  const openEdit = (route: any) => {
    setEditRoute(route);
    setEditForm({
      origin: route.origin,
      destination: route.destination,
      fareAmount: String(route.fareAmount),
    });
  };

  const handleAdd = async () => {
    const origin = addForm.origin.trim();
    const destination = addForm.destination.trim();
    const fare = parseFloat(addForm.fareAmount) || 0;
    if (!origin || !destination || fare <= 0) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        data: { origin, destination, fareAmount: fare },
      });

      if (addForm.viceVersa && origin !== destination) {
        await createMutation.mutateAsync({
          data: { origin: destination, destination: origin, fareAmount: fare },
        });
      }

      setShowAdd(false);
      setAddForm({
        origin: "",
        destination: DEFAULT_DESTINATION,
        fareAmount: "",
        viceVersa: true,
      });

      toast({
        title: addForm.viceVersa
          ? "Routes added (both directions)"
          : "Route added",
      });
    } catch (error) {
      toast({ title: "Failed to add route", variant: "destructive" });
    }
  };

  const confirmDelete = () => {
    if (!deleteRoute) return;
    deleteMutation.mutate(
      { id: deleteRoute.id },
      { onSettled: () => setDeleteRoute(null) }
    );
  };

  const handleUpdate = () => {
    if (!editRoute) return;
    const origin = editForm.origin.trim();
    const destination = editForm.destination.trim();
    const fare = parseFloat(editForm.fareAmount) || 0;
    if (!origin || !destination || fare <= 0) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: editRoute.id,
      data: { origin, destination, fareAmount: fare },
    });
  };

  return (
    <div className="space-y-8" data-testid="fare-matrix-page">
      <style>{`
        @keyframes realtime-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .realtime-dot { animation: realtime-dot 1s ease-in-out infinite; }
      `}</style>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">
            <span className="inline-flex items-center gap-2">
              <MapPin className="w-7 h-7 text-blue-500" />
              <span className="text-white">Fare </span>
              <span className="text-blue-500">Matrix</span>
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-bold uppercase tracking-widest">
            Manage transit routes and fares for RFID tap deduction
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
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

      <div className="flex justify-end">
        <Button
          onClick={() => setShowAdd(true)}
          data-testid="button-add-route"
          className="bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(37,99,235,0.3)]"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Route
        </Button>
      </div>

      <div
        className={`rounded-xl border p-4 sm:p-5 flex items-center gap-4 backdrop-blur-xl ${
          activeRoute
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-amber-500/40 bg-amber-500/10"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${activeRoute ? "bg-emerald-500/20" : "bg-amber-500/20"}`}>
            {activeRoute ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            ) : (
              <AlertCircle className="w-6 h-6 text-amber-400" />
            )}
          </div>
          <div>
            <p className={`font-semibold text-sm ${activeRoute ? "text-emerald-300" : "text-amber-300"}`}>
              {activeRoute ? "Active Route — RFID Ready" : "No Active Route"}
            </p>
            {activeRoute ? (
              <p className="text-white font-black text-lg tracking-tight">
                {activeRoute.origin} → {activeRoute.destination} &nbsp;·&nbsp; ₱
                {activeRoute.fareAmount.toFixed(2)} per tap
              </p>
            ) : (
              <p className="text-amber-300 text-sm">
                Activate a route below so the ESP32 RFID reader can process fare deductions.
              </p>
            )}
          </div>
        </div>
      </div>

      <Card className="bg-slate-900/40 border-slate-800 backdrop-blur-xl h-full shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
        <CardHeader className="pb-4 bg-slate-900/20 border-b border-slate-800/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 flex items-center gap-3">
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 shrink-0">
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                LIVE
              </span>
              <div>
                <CardTitle className="text-sm font-black text-slate-300 uppercase tracking-[0.3em] flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-400" />
                  Configured Routes
                </CardTitle>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  Only <strong>one route</strong> can be active at a time. Active route is pinned to the top.
                </p>
              </div>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-600" />
              <Input
                placeholder="SEARCH ORIGIN OR DESTINATION..."
                className="pl-9 bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-y-auto p-0 px-6 pb-6">
          {isLoading ? (
            <div className="space-y-4 pt-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-14 w-full bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="relative mt-6 overflow-x-auto max-h-[500px] overflow-y-auto rounded-md border border-slate-800">
              <Table>
                <TableHeader className="sticky top-0 bg-[#0a0f1c] z-10 border-b border-slate-800">
                  <TableRow className="border-none hover:bg-transparent">
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Origin</TableHead>
                    <TableHead />
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Destination</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Fare Amount</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Activate</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoutes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20">
                        <div className="flex flex-col items-center opacity-20">
                          <MapPin size={48} className="mb-2" />
                          <p className="text-[10px] font-black uppercase tracking-[0.4em]">
                            {searchTerm ? "No Routes Matched Query" : "No Routes Configured"}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRoutes.map((route) => (
                      <TableRow
                        key={route.id}
                        data-testid={`row-route-${route.id}`}
                        className={`border-slate-800/50 transition-all duration-300 ease-in-out ${
                          route.isActive
                            ? "bg-emerald-500/5 shadow-[inset_2px_0_0_0_rgb(16,185,129)]"
                            : "hover:bg-slate-800/30"
                        }`}
                      >
                        <TableCell className="font-medium text-slate-200">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-blue-400" />
                            {route.origin}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 text-xs px-1">→</TableCell>
                        <TableCell className="font-medium text-slate-300">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-slate-500" />
                            {route.destination}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`font-black text-white ${route.isActive ? "text-base" : ""}`}>
                            ₱{route.fareAmount.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={route.isActive ? "default" : "secondary"}
                            className={
                              route.isActive
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-slate-800 text-slate-400 border border-slate-700"
                            }
                          >
                            {route.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={route.isActive ? "destructive" : "default"}
                            className={
                              route.isActive
                                ? "bg-red-500 hover:bg-red-600 text-white"
                                : "bg-emerald-600 hover:bg-emerald-500 text-white"
                            }
                            onClick={() => toggleMutation.mutate({ id: route.id })}
                            disabled={toggleMutation.isPending}
                            data-testid={`toggle-route-${route.id}`}
                          >
                            {route.isActive ? (
                              <><PowerOff className="w-3.5 h-3.5 mr-1" /> Deactivate</>
                            ) : (
                              <><Power className="w-3.5 h-3.5 mr-1" /> Activate</>
                            )}
                          </Button>
                        </TableCell>

                        {/* ✅ FIXED: Always visible actions — same as TransactionsPage */}
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-blue-400/70 hover:text-blue-300 hover:bg-blue-500/10"
                              onClick={() => openEdit(route)}
                              data-testid={`button-edit-route-${route.id}`}
                              title="Edit route"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => setDeleteRoute(route)}
                              data-testid={`button-delete-route-${route.id}`}
                              title="Delete route"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Route Dialog */}
      <Dialog
        open={showAdd}
        onOpenChange={(open) => {
          setShowAdd(open);
          if (!open)
            setAddForm({ origin: "", destination: DEFAULT_DESTINATION, fareAmount: "", viceVersa: true });
        }}
      >
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-blue-600/60" />
          <DialogHeader>
            <DialogTitle className="text-white font-black uppercase tracking-tighter italic">
              Add New Route
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400">Origin (Barangay)</Label>
              <Input
                data-testid="input-add-origin"
                list="barangay-suggestions"
                placeholder="Type or select barangay..."
                value={addForm.origin}
                onChange={(e) => setAddForm({ ...addForm, origin: e.target.value })}
                className="bg-slate-900 border-slate-800 text-slate-300"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400">Destination</Label>
              <Input
                data-testid="input-add-destination"
                list="barangay-suggestions"
                placeholder="Type or select destination..."
                value={addForm.destination}
                onChange={(e) => setAddForm({ ...addForm, destination: e.target.value })}
                className="bg-slate-900 border-slate-800 text-slate-300"
              />
            </div>
            <datalist id="barangay-suggestions">
              <option value={DEFAULT_DESTINATION} />
              {CALBAYOG_BARANGAYS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400">Fare Amount (PHP)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="bg-slate-900 border-slate-800 text-emerald-400 font-black focus:border-emerald-500"
                value={addForm.fareAmount}
                onChange={(e) => setAddForm({ ...addForm, fareAmount: e.target.value })}
                data-testid="input-add-fare"
              />
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
              <Checkbox
                id="vice-versa"
                checked={addForm.viceVersa}
                onCheckedChange={(v) => setAddForm({ ...addForm, viceVersa: !!v })}
              />
              <div>
                <Label htmlFor="vice-versa" className="font-medium cursor-pointer flex items-center gap-1 text-slate-200">
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  Add vice versa route
                </Label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Also creates the reverse direction at the same fare
                </p>
              </div>
            </div>
            {addForm.origin && addForm.destination && (
              <div className="text-sm text-slate-300 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 space-y-1">
                <p className="font-medium text-blue-300">Routes to be created:</p>
                <p>• {addForm.origin} → {addForm.destination} @ ₱{addForm.fareAmount || "0.00"}</p>
                {addForm.viceVersa && addForm.origin !== addForm.destination && (
                  <p>• {addForm.destination} → {addForm.origin} @ ₱{addForm.fareAmount || "0.00"}</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setShowAdd(false)}
              className="bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              data-testid="button-save-route"
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {createMutation.isPending ? "Adding..." : "Add Route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Route Dialog */}
      <Dialog open={!!editRoute} onOpenChange={(open) => !open && setEditRoute(null)}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-blue-600/60" />
          <DialogHeader>
            <DialogTitle className="text-white font-black uppercase tracking-tighter italic">
              Edit Route
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400">Origin</Label>
              <Input
                data-testid="input-edit-origin"
                list="barangay-suggestions-edit"
                placeholder="Type or select barangay..."
                value={editForm.origin}
                onChange={(e) => setEditForm({ ...editForm, origin: e.target.value })}
                className="bg-slate-900 border-slate-800 text-slate-300"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400">Destination</Label>
              <Input
                data-testid="input-edit-destination"
                list="barangay-suggestions-edit"
                placeholder="Type or select destination..."
                value={editForm.destination}
                onChange={(e) => setEditForm({ ...editForm, destination: e.target.value })}
                className="bg-slate-900 border-slate-800 text-slate-300"
              />
            </div>
            <datalist id="barangay-suggestions-edit">
              <option value={DEFAULT_DESTINATION} />
              {CALBAYOG_BARANGAYS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-slate-400">Fare Amount (PHP)</Label>
              <Input
                type="number"
                step="0.01"
                className="bg-slate-900 border-slate-800 text-emerald-400 font-black focus:border-emerald-500"
                value={editForm.fareAmount}
                onChange={(e) => setEditForm({ ...editForm, fareAmount: e.target.value })}
                data-testid="input-edit-fare"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setEditRoute(null)}
              className="bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
              data-testid="button-update-route"
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteRoute} onOpenChange={(open) => !open && setDeleteRoute(null)}>
        <AlertDialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black uppercase tracking-tighter">
              Delete route?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This action cannot be undone. The selected route will be permanently removed from the fare matrix.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}