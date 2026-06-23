import { useState } from "react";
import { createCheckout, MAX_BALANCE } from "@/lib/api";

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
      const data = await createCheckout(cardUid, amount);
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err: unknown) {
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
