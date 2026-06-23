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
            <colgroup>
              {/* Timestamp: needs room for date + time */}
              <col style={{ width: "30%" }} />
              {/* Service: short label, no wrap */}
              <col style={{ width: "20%" }} />
              {/* Amount: numbers + peso sign */}
              <col style={{ width: "28%" }} />
              {/* Result: badge */}
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead className="bg-slate-950/50">
              <tr>
                <th className="px-3 py-3 text-[9px] font-black uppercase text-slate-500 whitespace-nowrap">Timestamp</th>
                <th className="px-2 py-3 text-[9px] font-black uppercase text-slate-500 whitespace-nowrap">Service</th>
                <th className="px-2 py-3 text-[9px] font-black uppercase text-slate-500 text-right whitespace-nowrap">Amount</th>
                <th className="px-2 py-3 text-[9px] font-black uppercase text-slate-500 text-center whitespace-nowrap">Result</th>
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
                      {/* Timestamp */}
                      <td className="px-3 py-3">
                        <p className="text-[10px] text-slate-300 font-medium leading-tight whitespace-nowrap">
                          {new Date(tx.timestamp).toLocaleDateString()}
                        </p>
                        <p className="text-[9px] text-slate-500 font-mono leading-tight whitespace-nowrap">
                          {new Date(tx.timestamp).toLocaleTimeString()}
                        </p>
                      </td>

                      {/* Service — nowrap so "TOP-UP" stays on one line */}
                      <td className="px-2 py-3">
                        <span className="text-[10px] font-semibold text-slate-200 uppercase whitespace-nowrap">
                          {tx.type}
                        </span>
                      </td>

                      {/* Amount — right-aligned, never wraps */}
                      <td className="px-2 py-3 text-right">
                        <span
                          className="whitespace-nowrap text-[11px] font-bold tabular-nums"
                          style={{
                            color: isFare ? "rgb(248 113 113)" : "rgb(52 211 153)",
                          }}
                        >
                          {sign}&#8369;{amount}
                        </span>
                      </td>

                      {/* Result badge */}
                      <td className="px-2 py-3 text-center">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-black tracking-widest uppercase py-0 whitespace-nowrap ${
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