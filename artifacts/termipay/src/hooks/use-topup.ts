import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { MAX_BALANCE } from "@/lib/api";

export function useTopup(cardUid: string, currentBalance: number) {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", msg: "" });

  const remainingTopup = Math.max(0, MAX_BALANCE - currentBalance);
  const isAtMaxBalance = remainingTopup <= 0;

  const showAlert = (title: string, msg: string) => {
    setAlertContent({ title, msg });
    setAlertOpen(true);
  };

  const handleTopup = async () => {
    if (!cardUid || !amount) {
      showAlert("Missing Information", "Please enter an amount.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showAlert("Invalid Amount", "Please enter a valid amount.");
      return;
    }
    const projected = currentBalance + parsedAmount;
    if (projected > MAX_BALANCE) {
      showAlert(
        "Balance Limit Reached",
        remainingTopup <= 0
          ? "Your wallet is already at the maximum balance of ₱20,000.00. You cannot top up further."
          : `You can only top up ₱${remainingTopup.toLocaleString(undefined, { minimumFractionDigits: 2 })} more. Your wallet has a ₱20,000.00 maximum balance limit.`
      );
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase.functions.invoke("create-topup", {
        body: { cardUid, amount: parsedAmount },
      });

      if (error) {
        // ✅ FIX: FunctionsHttpError hides the real response body by default.
        // error.context is the raw Response object from the edge function —
        // read its JSON to get the actual error message we sent back
        // (e.g. "User not found", "cardUid and valid amount required", or
        // whatever Xendit itself complained about).
        let details = error.message || "Could not connect to the payment server.";
        try {
          const errBody = await error.context?.json?.();
          if (errBody?.error) {
            details = typeof errBody.error === "string" ? errBody.error : JSON.stringify(errBody.error);
          }
        } catch {
          // context wasn't JSON, fall back to error.message
        }
        console.error("Topup error details:", details);
        showAlert("Top-up Failed", details);
        return;
      }

      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        console.error("No checkoutUrl in response:", data);
        showAlert("Top-up Failed", "No checkout URL was returned. Please try again.");
      }
    } catch (err: unknown) {
      console.error(err);
      showAlert("Connection Error", err instanceof Error ? err.message : "Could not connect to the payment server.");
    } finally {
      setLoading(false);
    }
  };

  const close = () => { setIsOpen(false); setAmount(""); };

  return {
    isOpen, setIsOpen, close,
    amount, setAmount,
    loading, alertOpen, setAlertOpen, alertContent,
    remainingTopup, isAtMaxBalance,
    handleTopup,
  };
}