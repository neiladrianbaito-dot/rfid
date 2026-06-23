import { useState, useEffect, useRef } from "react";
import {
  useListTransactions,
  useDeleteTransaction,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Search, Trash2, Zap, History, ChevronLeft, ChevronRight } from "lucide-react";
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

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteTx, setDeleteTx] = useState<any>(null);
  const [page, setPage] = useState(1);

  // Realtime state
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newRowId, setNewRowId] = useState<number | null>(null);
  const prevTopIdRef = useRef<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params: any = {};
  if (search) params.search = search;
  if (typeFilter && typeFilter !== "all") params.type = typeFilter;
  if (statusFilter && statusFilter !== "all") params.status = statusFilter;

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter]);

  const { data: transactions, isLoading, refetch: refetchTransactions } = useListTransactions(params, {
    query: {
      refetchOnWindowFocus: true,
    },
  });

  // Realtime: mag-refetch tuwing may pagbabago sa transactions table
  // (bagong fare/top-up, o pag-delete) — walang nakatakdang interval na
  useRealtimeRefetch(["transactions"], () => {
    refetchTransactions();
  });

  const transactionList = Array.isArray(transactions) ? transactions : [];

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(transactionList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedList = transactionList.slice(startIndex, startIndex + PAGE_SIZE);

  // Detect new transactions → pulse newest row
  useEffect(() => {
    if (transactionList.length === 0) return;
    const topId = transactionList[0]?.id;

    if (prevTopIdRef.current !== null && topId !== prevTopIdRef.current) {
      setNewRowId(topId);
      setTimeout(() => setNewRowId(null), 800);
    }

    prevTopIdRef.current = topId;
    setLastUpdated(new Date());
  }, [transactionList]);

  const deleteMutation = useDeleteTransaction({
    mutation: {
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
        setDeleteTx(null);
        toast({ title: "Transaction deleted successfully" });
      },
    },
  });

  const confirmDelete = () => {
    if (!deleteTx) return;
    deleteMutation.mutate({ id: deleteTx.id });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "Success": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/50";
      case "Failed": return "bg-red-500/20 text-red-400 border-red-500/50";
      case "Pending": return "bg-amber-500/20 text-amber-400 border-amber-500/50";
      default: return "bg-slate-800 text-slate-400 border-slate-700";
    }
  };

  // ✅ UPDATED: Format number with commas (1000 → 1,000)
  const formatAmount = (amount: number) => {
    return Math.abs(amount).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="space-y-8 h-full min-h-0 flex flex-col">
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
            <History className="text-blue-500" />
            Transaction <span className="text-blue-500">Logs</span>
          </h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
            Monitor all Fare deductions and Top-ups in real-time
          </p>
        </div>
        {/* Live indicator */}
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

      <Card className="bg-slate-900/40 border-slate-800 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />

        <CardHeader className="flex-none pb-4 bg-slate-900/20 border-b border-slate-800/50">
          <div className="flex flex-col lg:flex-row gap-4 items-center">
            {/* LIVE badge */}
            <div className="flex items-center gap-2 mr-2 shrink-0">
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                LIVE
              </span>
            </div>
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="SEARCH CARD UID OR NAME..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-slate-950 border-slate-800 focus:border-blue-500 text-white font-bold placeholder:text-slate-700 text-xs"
              />
            </div>
            <div className="flex gap-3 w-full lg:w-auto">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full lg:w-[150px] bg-slate-950 border-slate-800 text-slate-300 font-bold uppercase text-[10px] tracking-widest">
                  <SelectValue placeholder="TYPE" />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                  <SelectItem value="all">ALL TYPES</SelectItem>
                  <SelectItem value="Fare">FARE</SelectItem>
                  <SelectItem value="Top-up">TOP-UP</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full lg:w-[150px] bg-slate-950 border-slate-800 text-slate-300 font-bold uppercase text-[10px] tracking-widest">
                  <SelectValue placeholder="STATUS" />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                  <SelectItem value="all">ALL STATUS</SelectItem>
                  <SelectItem value="Success">SUCCESS</SelectItem>
                  <SelectItem value="Failed">FAILED</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0 px-6 pb-4 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="space-y-4 pt-6">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <div className="relative mt-6 flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-[#0a0f1c] z-10 border-b border-slate-800">
                    <TableRow className="border-none hover:bg-transparent">
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Timestamp</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Card UID</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Full Name</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Type</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Amount</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-32">
                          <div className="flex flex-col items-center opacity-20">
                            <History size={48} className="mb-2" />
                            <p className="text-[10px] font-black uppercase tracking-[0.4em]">Zero Encrypted Records Found</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedList.map((tx: any) => (
                        <TableRow
                          key={tx.id}
                          className={`border-slate-800/50 transition-colors hover:bg-white/5 group ${
                            newRowId === tx.id ? "row-pulse" : ""
                          }`}
                        >
                          <TableCell className="text-[10px] font-mono text-slate-400">
                            {new Date(tx.timestamp || tx.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-blue-400 font-bold">
                            {tx.card_uid || tx.cardUid}
                          </TableCell>
                          <TableCell className="text-xs font-black text-white uppercase tracking-tight">
                            {tx.full_name || tx.fullName}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[9px] font-black uppercase ${
                                tx.type === "Fare"
                                  ? "border-red-500/30 text-red-400 bg-red-500/5"
                                  : "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                              }`}
                            >
                              {tx.type}
                            </Badge>
                          </TableCell>
                          {/* ✅ UPDATED: With comma formatting */}
                          <TableCell className={`text-xs font-black ${tx.type === "Fare" ? "text-red-500" : "text-emerald-500"}`}>
                            {tx.type === "Fare" ? "-" : "+"}₱{formatAmount(Number(tx.amount))}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[9px] font-black uppercase ${statusColor(tx.status)}`}>
                              {tx.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500/50 hover:text-red-400 hover:bg-red-500/10"
                                onClick={() => setDeleteTx(tx)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-2">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                  Showing{" "}
                  <span className="text-slate-300 font-black">
                    {transactionList.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, transactionList.length)}
                  </span>{" "}
                  of{" "}
                  <span className="text-slate-300 font-black">{transactionList.length}</span>{" "}
                  records
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

      {/* Delete Alert Dialog */}
      <AlertDialog open={!!deleteTx} onOpenChange={(open) => !open && setDeleteTx(null)}>
        <AlertDialogContent className="bg-slate-950 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white uppercase font-black tracking-tighter">Delete Transaction Record?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs uppercase font-bold">
              Warning: This clears the log entry from history. This will not trigger a database refund to the user's current balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending}
              className="bg-slate-900 border-slate-800 text-white hover:bg-slate-800"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-500 font-black uppercase text-[10px]"
            >
              {deleteMutation.isPending ? "Purging..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}