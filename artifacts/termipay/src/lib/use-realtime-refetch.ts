import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Nag-su-subscribe sa Postgres changes ng ibinigay na tables.
 * Tuwing may INSERT/UPDATE/DELETE sa kahit alin sa mga tables na
 * iyon, tatawagin ang onChange callback (karaniwa'y refetch ng
 * stats/trend queries mo).
 *
 * Halimbawa:
 *   useRealtimeRefetch(["transactions", "fare_routes", "users"], () => {
 *     refetchStats();
 *     refetchTrend();
 *   });
 */
export function useRealtimeRefetch(tables: string[], onChange: () => void) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onChangeRef = useRef(onChange);

  // laging gamitin yung pinaka-bagong version ng callback
  // nang hindi kinakailangang mag-resubscribe
  onChangeRef.current = onChange;

  useEffect(() => {
    // Unique channel name per subscription (base sa tables na sinusubaybayan)
    // para hindi mag-conflict ang mga magkahiwalay na pages/components
    const channelName = `realtime-${tables.join("-")}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase.channel(channelName);

    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          console.log("[Realtime] Change detected:", table, payload.eventType, payload);
          onChangeRef.current();
        }
      );
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[Realtime] Subscribed:", tables.join(", "));
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("[Realtime] Connection issue:", status);
      }
    });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(",")]);
}