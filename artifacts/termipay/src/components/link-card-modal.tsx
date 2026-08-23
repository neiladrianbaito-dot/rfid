import { CreditCard, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MAX_BALANCE } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import type { useTopup } from "@/hooks/use-topup";

type Props = ReturnType<typeof useTopup> & {
  cardUid: string;
  currentBalance: number;
};

export function TopupModal({
  isOpen,
  close,
  amount,
  setAmount,
  loading,
  alertOpen,
  setAlertOpen,
  alertContent,
  remainingTopup,
  isAtMaxBalance,
  handleTopup,
  currentBalance,
}: Props) {
  const { isDark } = useTheme();

  const balancePercent = Math.min(
    (currentBalance / MAX_BALANCE) * 100,
    100
  );

  const amountValue = parseFloat(amount || "0");
  const exceedsLimit =
    !!amount && amountValue > remainingTopup && !isAtMaxBalance;

  return (
    <>
      {/* =========================
          ALERT DIALOG
      ========================== */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent
          className={`
            w-[calc(100vw-2rem)]
            max-w-[380px]
            mx-auto
            rounded-2xl
            border
            shadow-2xl
            [&>button]:opacity-100
            [&>button:hover]:opacity-70
            [&>button]:cursor-pointer

            ${
              isDark
                ? `
                  bg-slate-900
                  text-white
                  border-slate-700
                  [&>button]:text-white
                `
                : `
                  bg-white
                  text-slate-900
                  border-slate-200
                  [&>button]:text-slate-700
                `
            }
          `}
        >
          <DialogHeader>
            <DialogTitle
              className={
                isDark ? "text-white" : "text-slate-900"
              }
            >
              {alertContent.title}
            </DialogTitle>

            <DialogDescription
              className={
                isDark ? "text-slate-400" : "text-slate-500"
              }
            >
              {alertContent.msg}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              onClick={() => setAlertOpen(false)}
              className="
                w-full
                sm:w-auto
                bg-emerald-600
                hover:bg-emerald-700
                text-white
                font-semibold
                cursor-pointer
              "
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =========================
          TOP-UP DIALOG
      ========================== */}
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className={`
            p-0
            border-none
            bg-transparent
            w-[calc(100vw-2rem)]
            max-w-[400px]
            mx-auto
            [&>button]:opacity-100
            [&>button:hover]:opacity-70
            [&>button]:cursor-pointer
            ${
              isDark
                ? "[&>button]:text-white"
                : "[&>button]:text-slate-700"
            }
          `}
        >
          <DialogTitle className="sr-only">
            Top-up Wallet
          </DialogTitle>

          <DialogDescription className="sr-only">
            Add funds to your wallet via GCash or Maya through PayMongo.
          </DialogDescription>

          {/* CARD */}
          <div
            className={`
              rounded-2xl
              overflow-hidden
              shadow-2xl
              border

              ${
                isDark
                  ? "bg-slate-900 border-slate-700"
                  : "bg-white border-slate-200"
              }
            `}
          >
            {/* Accent */}
            <div className="h-1 w-full bg-emerald-500" />

            <div
              className={`
                p-5
                sm:p-6
                ${
                  isDark
                    ? "text-white"
                    : "text-slate-900"
                }
              `}
            >
              {/* =========================
                  HEADER
              ========================== */}
              <div className="mb-5">
                <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                  <CreditCard
                    className={`
                      h-5
                      w-5
                      shrink-0
                      ${
                        isDark
                          ? "text-emerald-400"
                          : "text-emerald-600"
                      }
                    `}
                  />

                  <span>Top-up Wallet</span>
                </h2>

                <p
                  className={`
                    text-[11px]
                    mt-1
                    uppercase
                    tracking-wider
                    ${
                      isDark
                        ? "text-slate-400"
                        : "text-slate-500"
                    }
                  `}
                >
                  Secure Payment via PayMongo
                </p>
              </div>

              {/* =========================
                  BALANCE
              ========================== */}
              <div
                className={`
                  mb-5
                  border
                  rounded-xl
                  p-3
                  space-y-2

                  ${
                    isDark
                      ? "bg-slate-800/70 border-slate-700"
                      : "bg-slate-50 border-slate-200"
                  }
                `}
              >
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider gap-2">
                  <span
                    className={
                      isDark
                        ? "text-slate-400"
                        : "text-slate-500"
                    }
                  >
                    Wallet Limit
                  </span>

                  <span
                    className={`
                      text-right
                      tabular-nums
                      ${
                        isAtMaxBalance
                          ? isDark
                            ? "text-red-400"
                            : "text-red-600"
                          : isDark
                          ? "text-emerald-400"
                          : "text-emerald-600"
                      }
                    `}
                  >
                    ₱
                    {currentBalance.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}{" "}
                    / ₱{MAX_BALANCE.toLocaleString()}
                  </span>
                </div>

                {/* Progress */}
                <div
                  className={`
                    w-full
                    rounded-full
                    h-1.5
                    overflow-hidden
                    ${
                      isDark
                        ? "bg-slate-700"
                        : "bg-slate-200"
                    }
                  `}
                >
                  <div
                    className={`
                      h-1.5
                      rounded-full
                      transition-all

                      ${
                        isAtMaxBalance
                          ? "bg-red-500"
                          : balancePercent >= 80
                          ? "bg-amber-400"
                          : "bg-emerald-500"
                      }
                    `}
                    style={{
                      width: `${balancePercent}%`,
                    }}
                  />
                </div>

                <p
                  className={`
                    text-[10px]
                    ${
                      isDark
                        ? "text-slate-400"
                        : "text-slate-500"
                    }
                  `}
                >
                  {isAtMaxBalance ? (
                    <span
                      className={`
                        font-semibold
                        ${
                          isDark
                            ? "text-red-400"
                            : "text-red-600"
                        }
                      `}
                    >
                      Wallet is full. You cannot top up further.
                    </span>
                  ) : (
                    <>
                      You can still top up{" "}
                      <span
                        className={`
                          font-bold
                          ${
                            isDark
                              ? "text-emerald-400"
                              : "text-emerald-600"
                          }
                        `}
                      >
                        ₱
                        {remainingTopup.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </>
                  )}
                </p>
              </div>

              {/* =========================
                  FORM
              ========================== */}
              <div className="space-y-4">
                <div>
                  <label
                    className={`
                      text-[10px]
                      font-bold
                      uppercase
                      block
                      mb-1
                      ${
                        isDark
                          ? "text-slate-400"
                          : "text-slate-500"
                      }
                    `}
                  >
                    Amount (PHP)
                  </label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={
                      isAtMaxBalance
                        ? "Wallet is full"
                        : `Max ₱${remainingTopup.toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                            }
                          )}`
                    }
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isAtMaxBalance}
                    className={`
                      h-11
                      focus-visible:ring-emerald-500
                      focus-visible:border-emerald-500

                      ${
                        isDark
                          ? `
                            bg-slate-800
                            border-slate-700
                            text-white
                            placeholder:text-slate-500
                            disabled:bg-slate-800/50
                            disabled:text-slate-500
                          `
                          : `
                            bg-white
                            border-slate-300
                            text-slate-900
                            placeholder:text-slate-400
                            disabled:bg-slate-100
                            disabled:text-slate-400
                          `
                      }

                      ${
                        exceedsLimit
                          ? isDark
                            ? "border-red-500 focus-visible:border-red-500"
                            : "border-red-400 focus-visible:border-red-500"
                          : ""
                      }
                    `}
                  />

                  {/* Error */}
                  {exceedsLimit && (
                    <p
                      className={`
                        text-[10px]
                        mt-1
                        flex
                        items-start
                        gap-1
                        ${
                          isDark
                            ? "text-red-400"
                            : "text-red-600"
                        }
                      `}
                    >
                      <XCircle className="h-3 w-3 shrink-0 mt-0.5" />

                      <span>
                        Amount exceeds your remaining limit of ₱
                        {remainingTopup.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </p>
                  )}
                </div>

                {/* Submit */}
                <Button
                  onClick={handleTopup}
                  disabled={
                    loading ||
                    isAtMaxBalance ||
                    !amount ||
                    amountValue <= 0 ||
                    exceedsLimit
                  }
                  className="
                    w-full
                    bg-emerald-600
                    hover:bg-emerald-500
                    text-white
                    font-bold
                    h-12
                    disabled:opacity-50
                    cursor-pointer
                    disabled:cursor-not-allowed
                  "
                >
                  {loading
                    ? "Verifying..."
                    : isAtMaxBalance
                    ? "Wallet Full"
                    : "Pay via PayMongo"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}