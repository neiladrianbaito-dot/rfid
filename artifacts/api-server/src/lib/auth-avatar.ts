import { createClient } from "@supabase/supabase-js";

// SERVICE ROLE key: nasa backend lang, huwag ilagay sa frontend!
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── Simpleng in-memory cache (10 min) para hindi paulit-ulit ang Auth API ──
type CacheEntry = { value: string | null; expires: number };
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function getCached(key: string): string | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function setCached(key: string, value: string | null) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// Kunin ang avatar mula sa Google identity ng Supabase Auth user
function extractGoogleAvatar(authUser: any): string | null {
  const google = authUser?.identities?.find((i: any) => i.provider === "google");
  if (!google) return null; // email/password lang → walang avatar
  const d = (google.identity_data ?? {}) as Record<string, any>;
  return d.avatar_url || d.picture || null;
}

// A) Pinakamabilis: kung alam mo ang Supabase auth user id
export async function getAuthAvatarById(supabaseUserId: string): Promise<string | null> {
  const key = `id:${supabaseUserId}`;
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(supabaseUserId);
  if (error) {
    console.warn("auth.admin.getUserById failed:", error.message);
    return null;
  }
  const url = extractGoogleAvatar(data?.user);
  setCached(key, url);
  return url;
}

// B) Fallback: hanapin sa email gamit ang Auth Admin API
export async function getAuthAvatarByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;

  const key = `email:${target}`;
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn("auth.admin.listUsers failed:", error.message);
      return null;
    }

    const authUser = data.users.find((u) => u.email?.toLowerCase() === target);
    if (authUser) {
      const url = extractGoogleAvatar(authUser);
      setCached(key, url);
      return url;
    }

    if (data.users.length < perPage) break; // wala nang next page
  }

  setCached(key, null);
  return null;
}

// Isang function na sumusubok muna ng id, tapos email
export async function resolveAuthAvatar(opts: {
  supabaseUserId?: string | null;
  email?: string | null;
}): Promise<string | null> {
  if (opts.supabaseUserId) {
    const byId = await getAuthAvatarById(opts.supabaseUserId);
    if (byId) return byId;
  }
  if (opts.email) return getAuthAvatarByEmail(opts.email);
  return null;
}