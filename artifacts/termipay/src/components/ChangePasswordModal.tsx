import { KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  currentPassword: string;
  setCurrentPassword: (v: string) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  showCurrent: boolean;
  setShowCurrent: (v: boolean) => void;
  showNew: boolean;
  setShowNew: (v: boolean) => void;
  showConfirm: boolean;
  setShowConfirm: (v: boolean) => void;
  loading: boolean;
  error: string;
  setError: (v: string) => void;
  success: boolean;
  onSubmit: () => void;
};

function PasswordStrengthBar({ password }: { password: string }) {
  if (!password.length) return null;
  const strength = Math.min(Math.floor(password.length / 3), 4);
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500"];
  return (
    <div className="mt-1.5 flex gap-1">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`h-0.5 flex-1 rounded-full transition-all ${i < strength ? colors[strength - 1] : "bg-slate-700"}`}
        />
      ))}
    </div>
  );
}

function PasswordInput({
  label, value, onChange, show, onToggleShow, placeholder, disabled, error: fieldError, onKeyDown, confirmValue,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  disabled?: boolean;
  error?: string;
  onKeyDown?: React.KeyboardEventHandler;
  confirmValue?: string; // used to show match/no-match state
}) {
  const showMatch = confirmValue !== undefined && value.length > 0;
  const isMatch = value === confirmValue;
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{label}</label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={onKeyDown}
          className={`bg-white/5 border-white/10 text-white focus:border-violet-500/50 pr-10 ${
            showMatch && !isMatch ? "border-red-500/50" : showMatch && isMatch ? "border-emerald-500/50" : ""
          }`}
        />
        <button
          type="button"
          onClick={onToggleShow}
          tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {fieldError && <p className="text-[10px] text-red-400 mt-1">{fieldError}</p>}
      {showMatch && isMatch && (
        <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Passwords match
        </p>
      )}
    </div>
  );
}

export function ChangePasswordModal({
  isOpen, onClose,
  currentPassword, setCurrentPassword,
  newPassword, setNewPassword,
  confirmPassword, setConfirmPassword,
  showCurrent, setShowCurrent,
  showNew, setShowNew,
  showConfirm, setShowConfirm,
  loading, error, setError, success, onSubmit,
}: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!loading && !open) onClose(); }}>
      <DialogContent className="p-0 border-none bg-transparent max-w-[420px]">
        <div className="rgb-container">
          <div className="p-7 text-white">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20">
                <KeyRound className="h-6 w-6 text-violet-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight">Change Password</h2>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Account Security</p>
              </div>
            </div>

            {success ? (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                  <div>
                    <p className="font-bold text-emerald-400 text-base">Password Changed!</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Your password has been updated. Please use your new password on your next login.
                    </p>
                  </div>
                </div>
                <Button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12">
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <PasswordInput
                  label="Current Password"
                  value={currentPassword}
                  onChange={(v) => { setCurrentPassword(v); setError(""); }}
                  show={showCurrent}
                  onToggleShow={() => setShowCurrent(!showCurrent)}
                  placeholder="Enter current password"
                  disabled={loading}
                />

                <div>
                  <PasswordInput
                    label="New Password"
                    value={newPassword}
                    onChange={(v) => { setNewPassword(v); setError(""); }}
                    show={showNew}
                    onToggleShow={() => setShowNew(!showNew)}
                    placeholder="At least 8 characters"
                    disabled={loading}
                  />
                  <PasswordStrengthBar password={newPassword} />
                </div>

                <PasswordInput
                  label="Confirm New Password"
                  value={confirmPassword}
                  onChange={(v) => { setConfirmPassword(v); setError(""); }}
                  show={showConfirm}
                  onToggleShow={() => setShowConfirm(!showConfirm)}
                  placeholder="Repeat new password"
                  disabled={loading}
                  onKeyDown={(e) => e.key === "Enter" && !loading && onSubmit()}
                  confirmValue={newPassword}
                  error={confirmPassword && newPassword !== confirmPassword ? "Passwords do not match." : undefined}
                />

                {error && (
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={onClose}
                    disabled={loading}
                    variant="outline"
                    className="flex-1 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white h-12"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={onSubmit}
                    disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold h-12 transition-all disabled:opacity-50"
                  >
                    {loading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</>
                      : <><KeyRound className="h-4 w-4 mr-2" />Update Password</>
                    }
                  </Button>
                </div>

                <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                  You'll use your new password on your next login.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
