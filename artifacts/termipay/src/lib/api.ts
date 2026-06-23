import { buildApiUrl } from "./api-url";

export const USER_AUTH_TOKEN_KEY = "termipay_user_auth_token";
export const MAX_BALANCE = 20000;
export const RECAPTCHA_SITE_KEY = "6LfbiuQsAAAAAI9iR6ZsDDUGodOeSMUQSu6ALcfc";

// ─── Card UID Attempt Limiter ─────────────────────────────────────────────────
// 3 failed lookups → 60-second lockout → force exit callback is called
const CARD_UID_MAX_ATTEMPTS = 3;
const CARD_UID_LOCKOUT_MS   = 60_000; // 60 seconds

const cardUidAttemptState = {
  count: 0,
  lockedUntil: 0, // epoch ms; 0 = not locked
};

/**
 * Returns how many milliseconds remain in the lockout (0 if not locked).
 */
export function getCardUidLockoutRemaining(): number {
  const remaining = cardUidAttemptState.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Resets the attempt counter and lockout (e.g. after a successful scan).
 */
export function resetCardUidAttempts(): void {
  cardUidAttemptState.count = 0;
  cardUidAttemptState.lockedUntil = 0;
}

// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Validates that a card UID exists in the system.
 *
 * Built-in attempt limiter:
 *  - 3 consecutive failures → 60-second lockout
 *  - On the 3rd failure an error with `forceExit: true` is thrown
 *  - A successful lookup resets the counter automatically
 *
 * The caller should check `(error as any).forceExit === true` and redirect
 * the user away (e.g. back to the sign-in page).
 */
export async function validateCardUidExists(
  uid: string
): Promise<{ fullName?: string; cardUid: string; type?: string; status?: string }> {

  // ── 1. Check lockout ──────────────────────────────────────────────────────
  const remaining = getCardUidLockoutRemaining();
  if (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    const err: any = new Error(
      `Too many failed attempts. Please wait ${secs} second${secs !== 1 ? "s" : ""} before trying again.`
    );
    err.forceExit = true;
    err.lockoutRemainingMs = remaining;
    throw err;
  }

  // ── 2. Attempt the API call ───────────────────────────────────────────────
  let payload: any;
  let ok: boolean;

  try {
    const response = await fetch(
      buildApiUrl(`/auth/check-card-uid?cardUid=${encodeURIComponent(uid)}`),
      { headers: getUserAuthHeaders() }
    );
    payload = await response.json();
    ok = response.ok;
  } catch {
    // Network error — don't count against the limiter
    throw new Error("Network error. Please check your connection and try again.");
  }

  // ── 3. Handle failure ─────────────────────────────────────────────────────
  if (!ok || !payload?.card?.cardUid) {
    cardUidAttemptState.count += 1;
    const attemptsLeft = CARD_UID_MAX_ATTEMPTS - cardUidAttemptState.count;

    if (cardUidAttemptState.count >= CARD_UID_MAX_ATTEMPTS) {
      // Lock out and signal force-exit to the caller
      cardUidAttemptState.lockedUntil = Date.now() + CARD_UID_LOCKOUT_MS;

      const err: any = new Error(
        "Card UID not found. Maximum attempts reached. You have been locked out for 60 seconds."
      );
      err.forceExit = true;
      err.lockoutRemainingMs = CARD_UID_LOCKOUT_MS;
      throw err;
    }

    const msg =
      payload?.message ||
      payload?.error ||
      `Card UID not found in the system. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.`;

    const err: any = new Error(msg);
    err.attemptsLeft = attemptsLeft;
    throw err;
  }

  // ── 4. Success — reset the limiter ────────────────────────────────────────
  resetCardUidAttempts();

  const data = payload.card ?? payload;
  return {
    fullName: data.fullName ?? data.full_name,
    cardUid:  data.cardUid  ?? data.card_uid ?? uid,
    type:     data.type,
    status:   data.status,
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