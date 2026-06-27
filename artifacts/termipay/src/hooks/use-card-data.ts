import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getUserByCardUid } from "@/lib/api";
import type { UserRecord, TransactionRecord } from "@/lib/types";

export function useCardData(cardUid: string) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  const prevBalanceRef = useRef<number | null>(null);
  const prevTxCountRef = useRef<number>(0);

  const fetchCardData = async (uid: string, showLoading = false) => {
    if (!uid) return;
    if (showLoading) setLoading(true);

    try {
      const payload = await getUserByCardUid(uid);
      const rawUser = payload.user || null;

      if (rawUser) {
        const newBalance = Number(rawUser.balance ?? 0);
        const newTxCount = (payload.transactions || []).length;

        if (
          prevBalanceRef.current !== null &&
          (prevBalanceRef.current !== newBalance || prevTxCountRef.current !== newTxCount)
        ) {
          setIsPulsing(true);
          setTimeout(() => setIsPulsing(false), 800);
        }

        prevBalanceRef.current = newBalance;
        prevTxCountRef.current = newTxCount;

        setUser({
          cardUid: rawUser.cardUid ?? rawUser.card_uid,
          fullName: rawUser.fullName ?? rawUser.full_name,
          email: rawUser.email ?? null,
          contactNumber: rawUser.contactNumber ?? rawUser.contact_number,
          type: rawUser.type,
          balance: newBalance,
          status: rawUser.status ?? "Inactive",
        });
      } else {
        setUser(null);
      }

      setTransactions((payload.transactions || []) as TransactionRecord[]);
      setLastUpdated(new Date());
      setError("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Card UID not found.";
      setError(message);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    if (!cardUid) return;

    void fetchCardData(cardUid, true);

    const channelName = `user-dashboard-${cardUid}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase.channel(channelName);

    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        void fetchCardData(cardUid, false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => {
        void fetchCardData(cardUid, false);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[Realtime] User dashboard subscribed for card:", cardUid);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[Realtime] User dashboard connection issue:", status);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [cardUid]);

  return { user, transactions, loading, error, lastUpdated, isPulsing };
}
