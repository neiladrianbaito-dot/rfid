import { PlusCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UserRecord } from "../lib/types";
import { useMemo } from "react";

type Props = {
  user: UserRecord | null;
  isPulsing: boolean;
  onTopup: () => void;
};

export function BalanceCard({ user, isPulsing, onTopup }: Props) {
  const balanceText = useMemo(() => {
    const value = Number(user?.balance || 0);
    return `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }, [user?.balance]);

  return (
    <Card className="md:col-span-1 border-slate-800 bg-slate-900/40 backdrop-blur-md overflow-hidden border-t-emerald-500/50 border-t-2">
      <CardContent className="pt-6">
        <div className="flex justify-between items-start mb-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Available Balance</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onTopup}
            className="h-7 text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
          >
            <PlusCircle className="h-3 w-3 mr-1" /> TOP UP
          </Button>
        </div>
        <h2 className={`text-5xl font-black text-white tracking-tighter ${isPulsing ? "balance-pulse" : ""}`}>
          {balanceText}
        </h2>
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge
            className={
              user?.status === "Active"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-3 py-1"
                : "bg-red-500/10 text-red-400 border-red-500/20 px-3 py-1"
            }
          >
            <ShieldCheck className="h-3 w-3 mr-1.5" />
            {user?.status || "Inactive"}
          </Badge>
          <Badge variant="outline" className="border-slate-700 text-slate-400 px-3 py-1">
            {user?.type || "Standard User"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
