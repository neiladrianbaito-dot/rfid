import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function getSupabaseConfigError(): string {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseKey)
    missing.push("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY / SUPABASE_KEY)");
  return `Supabase is not configured: missing ${missing.join(" and ")}`;
}

export async function signInSupabaseWithPassword(email: string, password: string) {
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return null;
  }
  return data.user ?? null;
}

export async function signUpSupabaseWithPassword(
  email: string,
  password: string,
  fullName: string,
) {
  if (!supabase) {
    return { user: null, error: getSupabaseConfigError() } as const;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    return { user: null, error: error.message } as const;
  }

  return { user: data.user ?? null, error: null } as const;
}

function isLikelyDuplicateAuthUserError(err: { message?: string; status?: number }): boolean {
  const msg = (err.message || "").toLowerCase();
  if (err.status === 422) return true;
  return (
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("duplicate") ||
    msg.includes("user already exists")
  );
}

async function findSupabaseUserIdByEmail(email: string): Promise<string | null> {
  if (!supabase) return null;
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  const maxPages = 25;

  for (; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    const found = data.users.find((u) => (u.email || "").toLowerCase() === normalized);
    if (found?.id) return found.id;
    if (data.users.length < perPage) break;
  }
  return null;
}

/**
 * Ensures a Supabase Auth user exists (dashboard "Users" list + password reset).
 * Prefer SUPABASE_SERVICE_ROLE_KEY so users are created with email_confirm and no extra client step.
 */
export async function syncSupabaseAuthUserForSignup(
  email: string,
  password: string,
  fullName: string,
): Promise<{ userId: string | null; error: string | null }> {
  if (!supabase) {
    return { userId: null, error: getSupabaseConfigError() };
  }

  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasServiceRole) {
    const { user, error } = await signUpSupabaseWithPassword(email, password, fullName);
    if (error) return { userId: null, error };
    if (!user?.id) {
      return {
        userId: null,
        error:
          "Supabase did not return a user (confirm email settings or set SUPABASE_SERVICE_ROLE_KEY on the API server).",
      };
    }
    return { userId: user.id, error: null };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (!error && data.user?.id) {
    return { userId: data.user.id, error: null };
  }

  if (error && isLikelyDuplicateAuthUserError(error)) {
    const existingId = await findSupabaseUserIdByEmail(email);
    if (!existingId) {
      return { userId: null, error: error.message };
    }
    const { error: upErr } = await supabase.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (upErr) {
      return { userId: null, error: upErr.message };
    }
    return { userId: existingId, error: null };
  }

  return { userId: null, error: error?.message ?? "Failed to create Supabase Auth user" };
}

type AdminGetUserResult = {
  data: { user: { id: string; email?: string | null } | null };
  error: { message: string } | null;
};

/**
 * Confirms a Supabase Auth user id belongs to the given email (for saving credentials to public.auth_users after client signUp).
 */
export async function verifySupabaseUserIdMatchesEmail(
  userId: string,
  normalizedEmail: string,
): Promise<boolean> {
  if (!supabase || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  const email = normalizedEmail.trim().toLowerCase();
  const admin = supabase.auth.admin as { getUserById: (id: string) => Promise<AdminGetUserResult> };
  const { data, error } = await admin.getUserById(userId);
  if (error || !data?.user?.email) return false;
  return data.user.email.trim().toLowerCase() === email;
}

export async function getSupabaseUserFromToken(token: string) {
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error) {
    return null;
  }
  return data.user ?? null;
}

/** Sends Supabase Auth password recovery email (reset link). redirectTo must be allowlisted in Supabase project Auth URL config. */
export async function sendPasswordResetEmail(email: string, redirectTo: string) {
  if (!supabase) {
    return { error: getSupabaseConfigError() } as const;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    return { error: error.message } as const;
  }
  return { error: null } as const;
}
