import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getUserByCardUid } from "@/lib/api";
import type { UserRecord, TransactionRecord, CardTransfer } from "@/lib/types";

export function useCardData(cardUid: string) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [transfers, setTransfers] = useState<CardTransfer[]>([]); // 🆕
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  const prevBalanceRef = useRef<number | null>(null);
  const prevTxCountRef = useRef<number>(0);

  const fetchCardData = useCallback(async (uid: string, showLoading = false) => {
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
          // 🔧 FIX: id was missing entirely — now the backend sends it,
          // so this finally carries the real users.id primary key.
          id: rawUser.id ?? rawUser.user_id ?? null,
          cardUid: rawUser.cardUid ?? rawUser.card_uid,
          fullName: rawUser.fullName ?? rawUser.full_name,
          email: rawUser.email ?? null,
          contactNumber: rawUser.contactNumber ?? rawUser.contact_number,
          type: rawUser.type,
          balance: newBalance,
          status: rawUser.status ?? "Inactive",
          expirationDate: rawUser.expirationDate ?? rawUser.expiration_date ?? null,
        });
      } else {
        setUser(null);
      }

      const newTxs = (payload.transactions || []) as TransactionRecord[];
      setTransactions(prev => {
        if (
          prev.length === newTxs.length &&
          prev.every((t, i) => t.id === newTxs[i].id && t.amount === newTxs[i].amount)
        ) return prev;
        return newTxs;
      });

      // 🆕 Transfers now come straight from the backend payload — no
      // separate Supabase client call, no RLS dependency, no user.id
      // guessing. Same "only update if changed" pattern as transactions.
      const newTransfers = (payload.transfers || []) as CardTransfer[];
      setTransfers(prev => {
        if (
          prev.length === newTransfers.length &&
          prev.every((t, i) => t.id === newTransfers[i].id && t.status === newTransfers[i].status)
        ) return prev;
        return newTransfers;
      });

      setLastUpdated(new Date());
      setError("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Card UID not found.";
      setError(message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

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
      // 🆕 Also refetch on any card_balance_transfers change, so a new/
      // updated transfer shows up live without a manual refresh.
      .on("postgres_changes", { event: "*", schema: "public", table: "card_balance_transfers" }, () => {
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
  }, [cardUid, fetchCardData]);

  return { user, transactions, transfers, loading, error, lastUpdated, isPulsing }; // 🆕 transfers added
}