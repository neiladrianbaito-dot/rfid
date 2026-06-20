import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type TopupModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  cardUid: string;
  amount: string;
  onAmountChange: (val: string) => void;
  loading: boolean;
  onTopup: () => void;
};

export function TopupModal({ isOpen, onOpenChange, cardUid, amount, onAmountChange, loading, onTopup }: TopupModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 border-none bg-transparent max-w-[380px]">
        <div className="rgb-container">
          <div className="p-6 text-white">
            <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
              <CreditCard className="text-emerald-400" /> Top-up Wallet
            </h2>
            <p className="text-[11px] text-slate-400 mb-6 uppercase tracking-wider">Secure Payment via PayMongo</p>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Card UID</label>
                <Input disabled value={cardUid} className="bg-white/5 border-white/10 text-slate-300 font-mono" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Amount (PHP)</label>
                <Input
                  type="number"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => onAmountChange(e.target.value)}
                  className="bg-white/5 border-white/10 text-white focus:border-emerald-500/50"
                />
              </div>
              <Button
                onClick={onTopup}
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12"
              >
                {loading ? "Verifying..." : "Pay via GCash / Maya"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AlertDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
};

export function AlertDialog({ isOpen, onClose, title, message }: AlertDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 text-white border-slate-800">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-400">{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700">Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
