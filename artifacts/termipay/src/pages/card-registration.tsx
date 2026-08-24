import { useState, useEffect, useRef } from "react";
import { 
  useCreateUser, 
  useListRecentUsers, 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { CreditCard, Plus, Cpu, ShieldCheck, Zap } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { useRealtimeRefetch } from "@/lib/use-realtime-refetch";

export default function CardRegistrationPage() {
  const { isDark } = useTheme();
  const [cardUid, setCardUid] = useState("");
  const [fullName, setFullName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [initialBalance, setInitialBalance] = useState("");
  const [type, setType] = useState("Regular");

  // ✅ Validation error states
  const [balanceError, setBalanceError] = useState("");
  const [contactError, setContactError] = useState("");
  const [cardUidError, setCardUidError] = useState(""); // ✅ NEW

  // ✅ Realtime pulse state
  const [isPulsing, setIsPulsing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const prevCountRef = useRef<number>(0);

  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  // ✅ Card UID handler — only alphanumeric, max 8 characters
  const handleCardUidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const alphanumeric = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (alphanumeric.length > 8) return; // lock at 8 characters
    setCardUid(alphanumeric);
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
    setContactNumber(digits);
    if (digits.length === 11) {
      setContactError("");
    } else if (digits.length > 0) {
      setContactError(`${11 - digits.length} digit${11 - digits.length !== 1 ? "s" : ""} remaining`);
    } else {
      setContactError("");
    }
  };

  // ✅ Initial balance handler — allow 1 to 100 only
  const handleBalanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInitialBalance(raw);
    const num = parseFloat(raw);
    if (raw === "" || isNaN(num)) {
      setBalanceError("");
    } else if (num < 1) {
      setBalanceError("Minimum balance is ₱1.00");
    } else if (num > 100) {
      setBalanceError("Maximum balance is ₱100.00");
    } else {
      setBalanceError("");
    }
  };

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setCardUid("");
        setFullName("");
        setContactNumber("");
        setInitialBalance("");
        setType("Regular");
        setBalanceError("");
        setContactError("");
        setCardUidError(""); // ✅ NEW
        toast({ title: "Card registered successfully" });
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
            description: `"${cardUid}" is already registered. Please use a different card.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Failed to register card", variant: "destructive" });
        }
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // ✅ Card UID must be exactly 8 alphanumeric characters
    if (cardUid.length !== 8) {
      setCardUidError("Card UID must be exactly 8 characters");
      return;
    }

    // ✅ Contact number must be exactly 11 digits
    if (contactNumber.length !== 11) {
      setContactError("Contact number must be exactly 11 digits");
      return;
    }

    // ✅ Balance must be 1–100
    const balanceNum = parseFloat(initialBalance);
    if (isNaN(balanceNum) || balanceNum < 1 || balanceNum > 100) {
      setBalanceError("Balance must be between ₱1.00 and ₱100.00");
      return;
    }

    createMutation.mutate({
      data: {
        cardUid,
        fullName,
        contactNumber,
        type,
        initialBalance: balanceNum,
      },
    });
  };

  // ✅ Disable submit if there are validation errors or fields are incomplete
  const isFormInvalid =
    !!balanceError ||
    !!contactError ||
    !!cardUidError ||                          // ✅ NEW
    cardUid.length !== 8 ||                   // ✅ NEW
    contactNumber.length !== 11 ||
    parseFloat(initialBalance) < 1 ||
    parseFloat(initialBalance) > 100 ||
    !cardUid ||
    !fullName ||
    !initialBalance;

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
        <div className={`flex items-center gap-2 px-4 py-2 border rounded-lg ${isDark ? "bg-blue-950/40 border-blue-900" : "bg-blue-50 border-blue-100"}`}>
          <ShieldCheck className="text-blue-500" size={16} />
          <span className={`text-xs font-semibold ${isDark ? "text-blue-400" : "text-blue-700"}`}>System Link Active</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Registration Form */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <Card className={`shadow-sm overflow-hidden relative ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-cyan-400" />
            <CardHeader className="space-y-1">
              <CardTitle className={`text-base font-bold flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
                <Plus size={18} className="text-blue-500" />
                Register New Card
              </CardTitle>
              <CardDescription className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>Fill in cardholder details</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">

                {/* ✅ Card UID — exactly 8 alphanumeric characters */}
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
                          : cardUid.length === 8
                          ? "border-emerald-400 focus-visible:ring-emerald-400"
                          : isDark
                          ? "border-slate-800 focus-visible:ring-blue-500"
                          : "border-slate-200 focus-visible:ring-blue-500"
                      }`}
                      placeholder="e.g. A1B2C3D4"
                      value={cardUid}
                      onChange={handleCardUidChange}
                      required
                    />
                    {/* character counter badge */}
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums ${
                      cardUid.length === 8 ? "text-emerald-500" : isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {cardUid.length}/8
                    </span>
                  </div>
                  {cardUidError && (
                    <p className="text-xs font-medium text-red-500">{cardUidError}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Full Name</Label>
                  <Input
                    id="fullName"
                    className={`focus-visible:ring-blue-500 ${
                      isDark
                        ? "bg-slate-950 border-slate-800 text-white placeholder:text-slate-600"
                        : "bg-white border-slate-200 text-slate-900 placeholder:text-slate-400"
                    }`}
                    placeholder="Enter full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>User Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className={`font-medium text-sm cursor-pointer ${isDark ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className={isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}>
                      <SelectItem value="Regular" className="cursor-pointer">Regular</SelectItem>
                      <SelectItem value="Student" className="cursor-pointer">Student</SelectItem>
                      <SelectItem value="Senior" className="cursor-pointer">Senior</SelectItem>
                      <SelectItem value="PWD" className="cursor-pointer">PWD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ✅ Contact Number — exactly 11 digits, locks at 11 */}
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
                          : contactNumber.length === 11
                          ? "border-emerald-400 focus-visible:ring-emerald-400"
                          : isDark
                          ? "border-slate-800 focus-visible:ring-blue-500"
                          : "border-slate-200 focus-visible:ring-blue-500"
                      }`}
                      placeholder="09XXXXXXXXX"
                      value={contactNumber}
                      onChange={handleContactChange}
                      required
                    />
                    {/* digit counter badge */}
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums ${
                      contactNumber.length === 11 ? "text-emerald-500" : isDark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {contactNumber.length}/11
                    </span>
                  </div>
                  {contactError && (
                    <p className="text-xs font-medium text-red-500">{contactError}</p>
                  )}
                </div>

                {/* ✅ Initial Balance — 1 to 100 only */}
                <div className="space-y-2">
                  <Label htmlFor="initialBalance" className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    Initial Balance (PHP)
                    <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>(₱1 – ₱100)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="initialBalance"
                      type="number"
                      step="0.01"
                      min="1"
                      max="100"
                      className={`font-semibold pl-8 text-emerald-500 ${isDark ? "bg-slate-950" : "bg-white"} ${
                        balanceError
                          ? "border-red-400 focus-visible:ring-red-400"
                          : initialBalance && !balanceError
                          ? "border-emerald-400 focus-visible:ring-emerald-400"
                          : isDark
                          ? "border-slate-800 focus-visible:ring-emerald-400"
                          : "border-slate-200 focus-visible:ring-emerald-400"
                      }`}
                      placeholder="0.00"
                      value={initialBalance}
                      onChange={handleBalanceChange}
                      required
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-semibold text-xs">₱</span>
                  </div>
                  {balanceError && (
                    <p className="text-xs font-medium text-red-500">{balanceError}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-6 shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={createMutation.isPending || isFormInvalid}
                >
                  {createMutation.isPending ? (
                    <Zap className="w-4 h-4 mr-2 animate-pulse" />
                  ) : (
                    <CreditCard className="w-4 h-4 mr-2" />
                  )}
                  {createMutation.isPending ? "Registering..." : "Register Card"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        {/* History Table */}
        <motion.div className="lg:col-span-2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <Card className={`h-full shadow-sm ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
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
                                className={`text-[10px] font-semibold ${isDark ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}
                              >
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
                                    ? "bg-slate-800 text-slate-400 border-slate-700"
                                    : "bg-slate-100 text-slate-500 border-slate-200"
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
      </div>
    </div>
  );
}