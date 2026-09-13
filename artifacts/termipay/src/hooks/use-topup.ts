import { useState } from "react";
import { supabase } from "@/lib/supabase"; // adjust to your actual client import

export const MAX_BALANCE_TOPUP = 10000; // adjust kung iba yung wallet cap mo

export function useTopup(cardUid: string, currentBalance: number) {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", msg: "" });

  const remainingTopup = Math.max(MAX_BALANCE_TOPUP - currentBalance, 0);
  const isAtMaxBalance = currentBalance >= MAX_BALANCE_TOPUP;

  const open = () => setIsOpen(true);
  const close = () => {
    setIsOpen(false);
    setAmount("");
  };

  const showAlert = (title: string, msg: string) => {
    setAlertContent({ title, msg });
    setAlertOpen(true);
  };

  const handleTopup = async () => {
    const numAmount = parseFloat(amount);

    if (!numAmount || numAmount <= 0) {
      showAlert("Invalid Amount", "Please enter a valid top-up amount.");
      return;
    }

    if (numAmount > remainingTopup) {
      showAlert("Amount Too High", `You can only top up up to ₱${remainingTopup.toLocaleString()}.`);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("create-topup", {
        body: { cardUid, amount: numAmount },
      });

      if (error || !data?.checkoutUrl) {
        console.error("Topup error:", error, data);
        showAlert("Top-up Failed", "Something went wrong while creating your GCash payment. Please try again.");
        setLoading(false);
        return;
      }

      // Redirect user to GCash checkout
      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error(err);
      showAlert("Error", "Unable to connect to the payment server. Please check your connection.");
      setLoading(false);
    }
  };

  return {
    isOpen,
    open,
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
  };
}