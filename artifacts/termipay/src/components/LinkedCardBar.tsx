import { Lock } from "lucide-react";

type Props = {
  cardUid: string;
  loading: boolean;
  lastUpdated: Date | null;
};

export function LinkedCardBar({ cardUid, loading, lastUpdated }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/20 p-4 rounded-2xl border border-slate-800/50">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
          <Lock className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-xs font-bold text-slate-300">Linked Card</p>
          <p className="text-[10px] text-slate-500">Permanently linked · Cannot be changed</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 font-mono text-sm text-slate-300 tracking-widest select-all">
          {cardUid || "Not linked"}
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${loading ? "bg-yellow-400" : "bg-emerald-400 realtime-dot"}`} />
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            {loading ? "Loading..." : lastUpdated ? lastUpdated.toLocaleTimeString() : "Connecting..."}
          </span>
        </div>
      </div>
    </div>
  );
}
