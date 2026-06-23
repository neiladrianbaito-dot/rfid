import { buildApiUrl } from "./api-url";

export const USER_AUTH_TOKEN_KEY = "termipay_user_auth_token";
export const MAX_BALANCE = 20000;
export const RECAPTCHA_SITE_KEY = "6LfbiuQsAAAAAI9iR6ZsDDUGodOeSMUQSu6ALcfc";

export function cleanCardUid(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-_]/g, "");
}

export function getUserAuthHeaders(): HeadersInit {
  const token = window.localStorage.getItem(USER_AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getUserByCardUid(normalizedUid: string) {
  const response = await fetch(
    buildApiUrl(`/paymongo/dashboard?cardUid=${encodeURIComponent(normalizedUid)}`),
    { headers: getUserAuthHeaders() }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to load dashboard data");
  }
  return payload;
}

export async function getSignedInUser() {
  const response = await fetch(buildApiUrl("/auth/user-me"), {
    headers: getUserAuthHeaders(),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Not authenticated");
  }
  return payload as { user?: { linkedCardUid?: string } };
}

export async function saveLinkedCardUid(cardUid: string) {
  const response = await fetch(buildApiUrl("/auth/user/link-card"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserAuthHeaders() },
    body: JSON.stringify({ cardUid }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Failed to save linked card.");
}

export async function validateCardUidExists(
  uid: string
): Promise<{ fullName?: string; cardUid: string; type?: string; status?: string }> {
  const response = await fetch(
    buildApiUrl(`/auth/check-card-uid?cardUid=${encodeURIComponent(uid)}`),
    { headers: getUserAuthHeaders() }
  );
  const payload = await response.json();
  if (!response.ok) {
    const msg = payload?.message || payload?.error || "Card UID not found in the system.";
    throw new Error(msg);
  }
  const data = payload?.card ?? payload;
  if (!data || !data.cardUid) throw new Error("Card UID not found in the system.");
  return {
    fullName: data.fullName ?? data.full_name,
    cardUid: data.cardUid ?? data.card_uid ?? uid,
    type: data.type,
    status: data.status,
  };
}

export async function changeUserPassword(currentPassword: string, newPassword: string) {
  const response = await fetch(buildApiUrl("/auth/user/change-password"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserAuthHeaders() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || payload?.error || "Failed to change password.");
  return payload;
}

export async function createCheckout(cardUid: string, amount: string) {
  const res = await fetch(
    "https://bpznyktrerwtnpqjrvgz.supabase.co/functions/v1/create-checkout",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_uid: cardUid, amount }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Failed to initiate payment.");
  return data as { checkout_url?: string };
}
