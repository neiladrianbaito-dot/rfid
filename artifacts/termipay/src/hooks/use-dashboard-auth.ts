import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { cleanCardUid, getSignedInUser, USER_AUTH_TOKEN_KEY } from "@/lib/api";
import { supabase } from "@/lib/supabase";

type AuthProfile = { fullName: string; email: string; avatarUrl: string | null };

// Google avatar lang kung may Supabase session AT tugma ang email sa backend profile
async function getGoogleAvatar(email: string): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sbUser = session?.user;
    if (!sbUser?.email || !email) return null;
    if (sbUser.email.toLowerCase() !== email.toLowerCase()) return null;
    const meta = sbUser.user_metadata ?? {};
    return meta.avatar_url || meta.picture || null;
  } catch {
    return null;
  }
}

export function useDashboardAuth() {
  const [, setLocation] = useLocation();
  const [cardUid, setCardUid] = useState("");
  const [authProfile, setAuthProfile] = useState<AuthProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);
    if (!token) {
      setLocation("/signin");
      setAuthChecking(false);
      return;
    }

    void (async () => {
      try {
        const profile = await getSignedInUser();
        const email = profile?.user?.email || "";

        setAuthProfile({
          fullName: profile?.user?.fullName || "",
          email,
          avatarUrl: await getGoogleAvatar(email),
        });

        const linkedUid = cleanCardUid(profile?.user?.linkedCardUid || "");
        if (linkedUid) setCardUid(linkedUid);
      } catch {
        window.localStorage.removeItem(USER_AUTH_TOKEN_KEY);
        setLocation("/signin");
      } finally {
        setAuthChecking(false);
      }
    })();
  }, [setLocation]);

  return { cardUid, setCardUid, authProfile, authChecking };
}