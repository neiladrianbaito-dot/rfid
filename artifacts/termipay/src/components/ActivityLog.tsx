import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TransactionRecord } from "../lib/types";

type Props = { transactions: TransactionRecord[] };

export function ActivityLog({ transactions }: Props) {
  return (
    <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-md overflow-hidden">
      <CardHeader className="bg-slate-900/20 border-b border-slate-800">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-400 uppercase tracking-widest">
          <Activity className="h-4 w-4 text-blue-400" />
          Activity Log
          <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
            <span className="realtime-dot h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
            LIVE
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-left table-fixed">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="px-2 py-4 text-[10px] font-black uppercase text-slate-500 w-[28%]">Timestamp</th>
                <th className="px-2 py-4 text-[10px] font-black uppercase text-slate-500 w-[22%]">Service</th>
                <th className="px-2 py-4 text-[10px] font-black uppercase text-slate-500 text-right w-[30%]">Amount</th>
                <th className="px-2 py-4 text-[10px] font-black uppercase text-slate-500 text-center w-[20%]">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {transactions.length === 0 ? (
                <tr>
                  <td className="p-12 text-center text-slate-600 text-sm italic" colSpan={4}>
                    No activity recorded.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const isFare = tx.type === "Fare";
                  const sign = isFare ? "-" : "+";
                  const amount = Math.abs(Number(tx.amount || 0)).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });

                  return (
                    <tr key={tx.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="px-2 py-4">
                        <p className="text-[10px] text-slate-300 font-medium">
                          {new Date(tx.timestamp).toLocaleDateString()}
                        </p>
                        <p className="text-[9px] text-slate-500 font-mono">
                          {new Date(tx.timestamp).toLocaleTimeString()}
                        </p>
                      </td>
                      <td className="px-2 py-4">
                        <span className="text-[10px] font-semibold text-slate-200 uppercase">{tx.type}</span>
                      </td>
                      <td className="px-2 py-4 text-right">
                        <span
                          className={`text-[10px] font-bold ${isFare ? "text-red-400" : "text-emerald-400"}`}
                          style={{ whiteSpace: "nowrap", display: "inline-block", unicodeBidi: "normal" }}
                        >
                          {sign}&#8369;{amount}
                        </span>
                      </td>
                      <td className="px-2 py-4 text-center">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-black tracking-widest uppercase py-0 ${
                            tx.status === "Success"
                              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                              : "text-red-400 border-red-500/30 bg-red-500/5"
                          }`}
                        >
                          {tx.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}