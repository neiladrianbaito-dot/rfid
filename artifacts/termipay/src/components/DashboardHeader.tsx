import { Wallet, KeyRound, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onChangePassword: () => void;
  onLogout: () => void;
};

export function DashboardHeader({ onChangePassword, onLogout }: Props) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/10 rounded-xl">
          <Wallet className="h-7 w-7 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white leading-none">Fare Collection System</h1>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-1 font-semibold">User Dashboard</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={onChangePassword}
          className="text-slate-400 hover:text-violet-400 hover:bg-violet-400/10 gap-2"
        >
          <KeyRound className="h-4 w-4" />
          <span className="hidden sm:inline">Change Password</span>
        </Button>
        <Button
          variant="ghost"
          onClick={onLogout}
          className="text-slate-400 hover:text-red-400 hover:bg-red-400/10 gap-2"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </div>
  );
}
