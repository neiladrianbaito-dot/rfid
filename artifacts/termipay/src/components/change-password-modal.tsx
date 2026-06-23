import { KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DASHBOARD_STYLES } from "@/lib/dashboard-styles";
import type { useChangePassword } from "@/hooks/use-change-password";

type Props = ReturnType<typeof useChangePassword>;

export function ChangePasswordModal({
  isOpen, close,
  currentPassword, setCurrentPassword,
  newPassword, setNewPassword,
  confirmPassword, setConfirmPassword,
  showCurrent, setShowCurrent,
  showNew, setShowNew,
  showConfirm, setShowConfirm,
  loading, error, setError, success,
  submit,
}: Props) {
  return (
    <>
      <style>{DASHBOARD_STYLES}</style>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="p-0 border-none bg-transparent w-[calc(100vw-2rem)] max-w-[440px] mx-auto [&>button]:text-white [&>button]:opacity-100 [&>button:hover]:opacity-70">
          <DialogTitle className="sr-only">Change Password</DialogTitle>
          <DialogDescription className="sr-only">Update your account password securely.</DialogDescription>
          <div className="rgb-container">
            <div className="p-6 sm:p-8 text-white">

              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20 shrink-0">
                  <KeyRound className="h-6 w-6 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-tight">Change Password</h2>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Account Security</p>
                </div>
              </div>

              {success ? (
                <div className="space-y-5">
                  <div className="flex flex-col items-center gap-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
                    <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                    <div>
                      <p className="font-bold text-emerald-400 text-base">Password Changed!</p>
                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        Your password has been updated successfully. Please use your new password on your next login.
                      </p>
                    </div>
                  </div>
                  <Button onClick={close} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12">
                    Done
                  </Button>
                </div>
              ) : (
                <div className="space-y-5">

                  {/* Current Password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Current Password
                    </label>
                    <div className="relative">
                      <Input
                        type={showCurrent ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => { setCurrentPassword(e.target.value); setError(""); }}
                        placeholder="Enter current password"
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-violet-500/50 pr-11 h-11"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrent((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                        tabIndex={-1}
                      >
                        {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* New Password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      New Password
                    </label>
                    <div className="relative">
                      <Input
                        type={showNew ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                        placeholder="At least 8 characters"
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-violet-500/50 pr-11 h-11"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNew((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                        tabIndex={-1}
                      >
                        {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {/* Strength bar */}
                    {newPassword.length > 0 && (
                      <div className="flex gap-1 pt-1">
                        {[...Array(4)].map((_, i) => {
                          const strength = Math.min(Math.floor(newPassword.length / 3), 4);
                          const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500"];
                          return (
                            <div
                              key={i}
                              className={`h-1 flex-1 rounded-full transition-all ${i < strength ? colors[strength - 1] : "bg-slate-700"}`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <Input
                        type={showConfirm ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                        placeholder="Repeat new password"
                        className={`bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-violet-500/50 pr-11 h-11 ${
                          confirmPassword && newPassword !== confirmPassword
                            ? "border-red-500/50"
                            : confirmPassword && newPassword === confirmPassword
                            ? "border-emerald-500/50"
                            : ""
                        }`}
                        disabled={loading}
                        onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                        tabIndex={-1}
                      >
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="text-[11px] text-red-400 flex items-center gap-1">
                        <XCircle className="h-3 w-3 shrink-0" /> Passwords do not match
                      </p>
                    )}
                    {confirmPassword && newPassword === confirmPassword && (
                      <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" /> Passwords match
                      </p>
                    )}
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-3">
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <Button
                      onClick={close}
                      disabled={loading}
                      variant="outline"
                      className="flex-1 border-slate-700 !text-white hover:bg-slate-800 hover:!text-white h-11"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={submit}
                      disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                      className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold h-11 disabled:opacity-50"
                    >
                      {loading
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</>
                        : <><KeyRound className="h-4 w-4 mr-2" />Update Password</>}
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
    </>
  );
}