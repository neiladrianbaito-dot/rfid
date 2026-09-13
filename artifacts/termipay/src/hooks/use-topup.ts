import { useState } from "react";
import { supabase } from "@/lib/supabase";

export const MAX_BALANCE_TOPUP = 20000; // ✅ tinugma sa 20000 na ginagamit sa dashboard mo

export function useTopup(cardUid: string, currentBalance: number) {
  const [isOpen, setIsOpenState] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", msg: "" });

  const remainingTopup = Math.max(MAX_BALANCE_TOPUP - currentBalance, 0);
  const isAtMaxBalance = currentBalance >= MAX_BALANCE_TOPUP;

  // ✅ THE FIX: dashboard calls `topup.setIsOpen(true)` directly (e.g. sa TOP UP
  // button, sa Settings tab, atbp). Dati walang setIsOpen ang hook na ito —
  // kaya walang nangyayari pag pinindot ang button. Ito ang dahilan bakit
  // "hindi ma-open" ang modal.
  const setIsOpen = (open: boolean) => {
    setIsOpenState(open);
    if (!open) setAmount("");
  };

  // Panatilihin din ang open/close kung meron pang ibang code na gumagamit nito
  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);

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

    if (!cardUid) {
      showAlert("No Card Linked", "Please link a card before topping up.");
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

      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error(err);
      showAlert("Error", "Unable to connect to the payment server. Please check your connection.");
      setLoading(false);
    }
  };

  return {
    isOpen,
    setIsOpen,   // ✅ ito yung ginagamit ng dashboard mo (topup.setIsOpen(true))
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