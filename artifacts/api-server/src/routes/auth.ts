import { Router, type IRouter } from "express";
import { resolveAuthAvatar } from "../lib/auth-avatar";
import { eq, sql } from "drizzle-orm";
import { db, adminsTable } from "@workspace/db";
import { LoginBody, GetMeResponse } from "@workspace/api-zod";
import { createAdminToken, verifyAdminToken } from "../lib/admin-token";
import { createUserToken, verifyUserToken } from "../lib/user-token";
import { signInSupabaseWithPassword, getSupabaseUserFromToken } from "../lib/supabase";
import { logAudit } from "../lib/audit-logger";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  requireAdmin,
  requireFullAccess,
  requireSuperAdmin,
  loadAdminContext,
  ensurePermissionColumn,
} from "../middleware/permission-middleware";
// 🔒 NEW: per-role granular permission map (Permission Matrix), attached to
// GET /auth/me below so the frontend's usePermissions() hook — and the
// create-disbursement Edge Function's server-side check — can read it.
import { getEffectivePermissions } from "../lib/permissions";

const router: IRouter = Router();
let linkedCardColumnAvailable: boolean | null = null;

// ── Role helpers ───────────────────────────────────────────────────────────
function normalizeRole(role: unknown): "staff" | "super_admin" {
  return role === "super_admin" ? "super_admin" : "staff";
}

function roleLabel(role: string): "Staff" | "Super Admin" {
  return role === "super_admin" ? "Super Admin" : "Staff";
}

function isSuperAdmin(role: unknown): boolean {
  return role === "super_admin";
}

// ── Permission helpers ───────────────────────────────────────────────────────
function normalizePermission(permission: unknown, role: unknown): "full_access" | "view_only" {
  if (isSuperAdmin(role)) return "full_access";
  return permission === "view_only" ? "view_only" : "full_access";
}

function isViewOnly(role: unknown, permission: unknown): boolean {
  return !isSuperAdmin(role) && permission === "view_only";
}

// ── Password helpers (scrypt) ─────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hashed = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password: string, storedPasswordHash: string): boolean {
  if (!storedPasswordHash.includes(":")) {
    return storedPasswordHash === password;
  }
  const parts = storedPasswordHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, storedHash] = parts;
  const computedHash = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(computedHash, "hex"));
}

// ── Token / auth helpers ──────────────────────────────────────────────────────

function getBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function getUserFromAuthHeader(authorization?: string) {
  const token = getBearerToken(authorization);
  if (!token) return null;
  return verifyUserToken(token);
}

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

// ── linked_card_uid column helpers ───────────────────────────────────────────

async function hasLinkedCardUidColumn(): Promise<boolean> {
  if (linkedCardColumnAvailable !== null) return linkedCardColumnAvailable;
  const result = await db.execute(sql`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'auth_users'
      and column_name = 'linked_card_uid'
    limit 1
  `);
  linkedCardColumnAvailable = extractRows(result).length > 0;
  return linkedCardColumnAvailable;
}

async function ensureLinkedCardUidColumn(): Promise<void> {
  if (await hasLinkedCardUidColumn()) return;
  await db.execute(sql`
    alter table public.auth_users
    add column if not exists linked_card_uid text
  `);
  linkedCardColumnAvailable = true;
}

async function ensurePasswordChangedAtColumn(): Promise<void> {
  await db.execute(sql`
    alter table public.auth_users
    add column if not exists password_changed_at timestamptz
  `);
}

// NOTE: card status is still looked up and returned to the client so the
// frontend can show "your card is blocked, contact support" banners etc,
// but it no longer blocks login. Login access and card access are now
// independent — a blocked/unlinked card just means restricted card
// features, not a locked-out account.
async function checkLinkedCardStatus(linkedCardUid: string | null | undefined): Promise<{
  blocked: boolean;
  status: string | null;
}> {
  if (!linkedCardUid || linkedCardUid.trim() === "" || linkedCardUid.toLowerCase() === "none") {
    return { blocked: false, status: null };
  }
  const result = await db.execute(sql`
    select status from users
    where lower(trim(card_uid)) = lower(trim(${linkedCardUid}))
    limit 1
  `);
  const rows = extractRows<{ status: string }>(result);
  if (rows.length === 0) return { blocked: false, status: null };
  const status = rows[0].status;
  const blocked = status === "Blocked" || status === "Inactive";
  return { blocked, status };
}

async function isNameAlreadyLinkedToAccount(fullName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select id from auth_users
    where lower(trim(full_name)) = lower(trim(${fullName}))
    limit 1
  `);
  return extractRows<{ id: string }>(result).length > 0;
}

// ── SHARED: auto-unlink a card from whatever auth_users account has it
// linked. Used by the manual admin "Unlink Card" endpoint below, AND
// called automatically from users.ts whenever a card gets blocked,
// deactivated, or reassigned/transferred to a different person. Exported
// so other route files can import and call it directly. ─────────────────────

export async function unlinkCardFromAnyAccount(
  cardUidRaw: string,
  actor: { username: string },
  reason: string
): Promise<{ unlinked: boolean; previousAccount?: { id: string; fullName: string; email: string } }> {
  const cardUid = cardUidRaw.trim().toUpperCase();
  if (!cardUid) return { unlinked: false };

  await ensureLinkedCardUidColumn();

  const existingRaw = await db.execute(sql`
    select id, full_name, email from auth_users
    where upper(trim(linked_card_uid)) = ${cardUid}
    limit 1
  `);
  const existing = extractRows<{ id: string; full_name: string; email: string }>(existingRaw)[0];

  if (!existing) return { unlinked: false };

  await db.execute(sql`
    update auth_users
    set linked_card_uid = null, updated_at = now()
    where id = ${existing.id}
  `);

  await logAudit({
    user: actor.username,
    action: "UPDATE",
    entity: "User",
    details: `${actor.username} auto-unlinked card ${cardUid} from account ${existing.email} (${existing.full_name}) — ${reason}`,
  });

  return {
    unlinked: true,
    previousAccount: { id: existing.id, fullName: existing.full_name, email: existing.email },
  };
}

// ── SIGNUP ────────────────────────────────────────────────────────────────────

router.post("/auth/signup", async (req, res): Promise<void> => {
  try {
    const body = req.body as { fullName?: string; email?: string; password?: string };
    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!fullName || !email || !password) {
      res.status(400).json({ success: false, message: "Full name, email, and password are required" });
      return;
    }
    if (!email.includes("@")) {
      res.status(400).json({ success: false, message: "Please provide a valid email address" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
      return;
    }

    const nameMatchRaw = await db.execute(sql`
      select full_name from users
      where lower(trim(full_name)) = lower(trim(${fullName}))
      limit 1
    `);
    const nameMatchRows = extractRows<{ full_name: string }>(nameMatchRaw);
    if (nameMatchRows.length === 0) {
      res.status(403).json({
        success: false,
        message: "This name is not registered in our system. Please contact your admin.",
      });
      return;
    }

    const nameAlreadyUsed = await isNameAlreadyLinkedToAccount(fullName);
    if (nameAlreadyUsed) {
      res.status(409).json({
        success: false,
        message: "This name is already linked to an existing account.",
      });
      return;
    }

    const passwordHash = hashPassword(password);
    const insertResult = await db.execute(sql`
      insert into auth_users (supabase_auth_id, full_name, email, password_hash)
      values (gen_random_uuid(), ${fullName}, ${email}, ${passwordHash})
      on conflict (email) do nothing
      returning id as uid
    `);

    const inserted = extractRows<{ uid: string }>(insertResult);
    if (inserted.length === 0) {
      res.status(409).json({ success: false, message: "Email is already registered" });
      return;
    }

    await logAudit({
      user: email,
      action: "CREATE",
      entity: "User",
      details: `${fullName} (${email}) signed up`,
    });

    res.status(201).json({ success: true, message: "Signup successful. You can now sign in." });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── USER SIGNIN ───────────────────────────────────────────────────────────────

router.post("/auth/user-signin", async (req, res): Promise<void> => {
  try {
    const body = req.body as { email?: string; password?: string };
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(400).json({ success: false, message: "Email and password are required" });
      return;
    }

    const canReadLinkedCard = await hasLinkedCardUidColumn();
    const rawRecord = await db.execute(
      canReadLinkedCard
        ? sql`select id as uid, full_name, email, password_hash, linked_card_uid from auth_users where email = ${email} limit 1`
        : sql`select id as uid, full_name, email, password_hash from auth_users where email = ${email} limit 1`
    );

    type UserRow = {
      uid: string;
      full_name: string;
      email: string;
      password_hash: string;
      linked_card_uid?: string | null;
    };

    let user = extractRows<UserRow>(rawRecord)[0];
    const hasLocalMatch = !!user && !!user.password_hash && verifyPassword(password, user.password_hash);

    if (!hasLocalMatch) {
      let supabaseUser: Awaited<ReturnType<typeof signInSupabaseWithPassword>> = null;
      try {
        supabaseUser = await signInSupabaseWithPassword(email, password);
      } catch (supabaseErr) {
        console.warn("Supabase fallback signin failed (non-fatal):", supabaseErr);
        supabaseUser = null;
      }

      if (!supabaseUser) {
        res.status(401).json({ success: false, message: "Invalid email or password" });
        return;
      }

      const fullNameFromSupabase =
        typeof supabaseUser.user_metadata?.full_name === "string" &&
        supabaseUser.user_metadata.full_name.trim().length > 0
          ? supabaseUser.user_metadata.full_name.trim()
          : email;

      const nextPasswordHash = hashPassword(password);

      await db.execute(sql`
        insert into auth_users (supabase_auth_id, full_name, email, password_hash)
        values (${supabaseUser.id}::uuid, ${fullNameFromSupabase}, ${email}, ${nextPasswordHash})
        on conflict (email) do update
        set
          supabase_auth_id = excluded.supabase_auth_id,
          full_name        = excluded.full_name,
          password_hash    = excluded.password_hash,
          updated_at       = now()
      `);

      const syncedRaw = await db.execute(
        canReadLinkedCard
          ? sql`select id as uid, full_name, email, password_hash, linked_card_uid from auth_users where email = ${email} limit 1`
          : sql`select id as uid, full_name, email, password_hash from auth_users where email = ${email} limit 1`
      );
      user = extractRows<UserRow>(syncedRaw)[0];
    } else if (user && !user.password_hash.includes(":")) {
      const upgradedHash = hashPassword(password);
      await db.execute(sql`
        update auth_users
        set password_hash = ${upgradedHash}, updated_at = now()
        where id = ${user.uid}
      `);
      user.password_hash = upgradedHash;
    }

    if (!user) {
      res.status(401).json({ success: false, message: "Invalid email or password" });
      return;
    }

    // Card status no longer blocks login — it's only informational now.
    // A user can always sign in to their account; a blocked/inactive card
    // just means restricted card-related features on the frontend.
    const { blocked: cardBlocked, status: cardStatus } = await checkLinkedCardStatus(user.linked_card_uid);

    await logAudit({
      user: user.email,
      action: "LOGIN",
      entity: "User",
      details: `${user.email} logged in`,
    });

    res.json({
      success: true,
      message: "Sign in successful",
      token: createUserToken({ id: user.uid, email: user.email, fullName: user.full_name }),
      user: {
        id: user.uid,
        fullName: user.full_name,
        email: user.email,
        linkedCardUid: user.linked_card_uid ?? "",
        cardBlocked,
        cardStatus,
      },
    });
  } catch (error) {
    console.error("User sign in error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── GOOGLE OAUTH SYNC ─────────────────────────────────────────────────────────
// Called by the frontend right after Supabase finishes the Google OAuth
// redirect (see AuthCallback.tsx). We NEVER trust email/fullName sent
// directly by the client for this — anyone could POST here claiming to be
// someone else. Instead we verify the Supabase access token server-side
// and pull the email/name from that verified response only.
//
// Behavior: auto-create. First-time Google sign-in creates a new
// auth_users row; a returning one just re-links/refreshes it.

router.post("/auth/oauth-sync", async (req, res): Promise<void> => {
  try {
    const body = req.body as { accessToken?: string };
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken : "";

    if (!accessToken) {
      res.status(400).json({ success: false, message: "accessToken is required" });
      return;
    }

    const supabaseUser = await getSupabaseUserFromToken(accessToken);
    if (!supabaseUser || !supabaseUser.email) {
      console.error(
        "OAuth sync: getSupabaseUserFromToken returned null. Check that SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY are set on this server and point to the " +
        "SAME Supabase project as the frontend's VITE_SUPABASE_URL."
      );
      res.status(401).json({ success: false, message: "Invalid or expired session. Please sign in again." });
      return;
    }

    const email = supabaseUser.email.trim().toLowerCase();

    const fullNameFromGoogle =
      (typeof supabaseUser.user_metadata?.full_name === "string" && supabaseUser.user_metadata.full_name.trim()) ||
      (typeof supabaseUser.user_metadata?.name === "string" && supabaseUser.user_metadata.name.trim()) ||
      email;

    const canReadLinkedCard = await hasLinkedCardUidColumn();

    // auth_users.password_hash is required by the schema even for OAuth
    // accounts — store an unusable random hash, since these accounts will
    // only ever sign in through Google, never via /auth/user-signin
    // password auth.
    const placeholderHash = hashPassword(randomBytes(32).toString("hex"));

    await db.execute(sql`
      insert into auth_users (supabase_auth_id, full_name, email, password_hash)
      values (${supabaseUser.id}::uuid, ${fullNameFromGoogle}, ${email}, ${placeholderHash})
      on conflict (email) do update
      set
        supabase_auth_id = excluded.supabase_auth_id,
        updated_at       = now()
    `);

    const rawRecord = await db.execute(
      canReadLinkedCard
        ? sql`select id as uid, full_name, email, linked_card_uid from auth_users where email = ${email} limit 1`
        : sql`select id as uid, full_name, email from auth_users where email = ${email} limit 1`
    );

    type UserRow = { uid: string; full_name: string; email: string; linked_card_uid?: string | null };
    const user = extractRows<UserRow>(rawRecord)[0];

    if (!user) {
      res.status(500).json({ success: false, message: "Could not create account. Please try again." });
      return;
    }

    // Same as the password-based signin route: card status is
    // informational only, never blocks access to the account itself.
    const { blocked: cardBlocked, status: cardStatus } = await checkLinkedCardStatus(user.linked_card_uid);

    await logAudit({
      user: user.email,
      action: "LOGIN",
      entity: "User",
      details: `${user.email} signed in with Google`,
    });

    res.json({
      success: true,
      message: "Signed in with Google",
      token: createUserToken({ id: user.uid, email: user.email, fullName: user.full_name }),
      user: {
        id: user.uid,
        fullName: user.full_name,
        email: user.email,
        linkedCardUid: user.linked_card_uid ?? "",
        cardBlocked,
        cardStatus,
      },
    });
  } catch (error) {
    console.error("OAuth sync error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── USER ME ───────────────────────────────────────────────────────────────────

router.get("/auth/user-me", async (req, res): Promise<void> => {
  try {
    const currentUser = getUserFromAuthHeader(req.headers.authorization);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }

    const canReadLinkedCard = await hasLinkedCardUidColumn();
    const rawRecord = await db.execute(
      canReadLinkedCard
        ? sql`select id as uid, full_name, email, linked_card_uid, supabase_auth_id from auth_users where id = ${currentUser.id} limit 1`
        : sql`select id as uid, full_name, email, supabase_auth_id from auth_users where id = ${currentUser.id} limit 1`
    );

    type UserRow = {
      uid: string;
      full_name: string;
      email: string;
      linked_card_uid?: string | null;
      supabase_auth_id?: string | null;
    };
    const user = extractRows<UserRow>(rawRecord)[0];

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    // Same as signin: card status is informational only, never blocks
    // access to the account itself.
    const { blocked: cardBlocked, status: cardStatus } = await checkLinkedCardStatus(user.linked_card_uid);

    // Best-effort avatar lookup — hindi dapat ito mag-fail ng buong request
    // kung walang picture o may isyu sa lookup.
    let avatarUrl: string | null = null;
    try {
      avatarUrl = await resolveAuthAvatar({
        supabaseUserId: user.supabase_auth_id ?? null,
        email: user.email, // galing sa verified DB row, hindi sa request body
      });
    } catch (avatarError) {
      console.warn("resolveAuthAvatar failed in /auth/user-me:", avatarError);
    }

    res.json({
      success: true,
      user: {
        id: user.uid,
        fullName: user.full_name,
        email: user.email,
        linkedCardUid: user.linked_card_uid ?? "",
        cardBlocked,
        cardStatus,
        avatarUrl,
      },
    });
  } catch (error) {
    console.error("User me error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── CHECK CARD UID ────────────────────────────────────────────────────────────

const cardUidAttemptMap = new Map<string, { count: number; lockedUntil: number }>();

const CARD_UID_MAX_ATTEMPTS = 3;
const CARD_UID_LOCKOUT_MS   = 60_000;

router.get("/auth/check-card-uid", async (req, res): Promise<void> => {
  try {
    const currentUser = getUserFromAuthHeader(req.headers.authorization);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }

    const userId = String(currentUser.id ?? currentUser.userId ?? currentUser.sub ?? "");

    const tracker = cardUidAttemptMap.get(userId) ?? { count: 0, lockedUntil: 0 };
    const now = Date.now();

    if (tracker.lockedUntil > now) {
      const secsLeft = Math.ceil((tracker.lockedUntil - now) / 1000);
      res.status(429).json({
        success: false,
        message: `Too many failed attempts. Please wait ${secsLeft} second${secsLeft !== 1 ? "s" : ""} before trying again.`,
        lockedOutSeconds: secsLeft,
        forceExit: true,
      });
      return;
    }

    const cardUid =
      typeof req.query.cardUid === "string" ? req.query.cardUid.trim().toUpperCase() : "";
    if (!cardUid) {
      res.status(400).json({ success: false, message: "cardUid query param is required" });
      return;
    }

    await ensureLinkedCardUidColumn();

    const cardRaw = await db.execute(sql`
      select card_uid, full_name, type, status
      from users
      where card_uid = ${cardUid}
      limit 1
    `);
    const cardRows = extractRows<{
      card_uid: string;
      full_name: string;
      type: string;
      status: string;
    }>(cardRaw);

    if (cardRows.length === 0) {
      tracker.count += 1;
      const attemptsLeft = CARD_UID_MAX_ATTEMPTS - tracker.count;

      if (tracker.count >= CARD_UID_MAX_ATTEMPTS) {
        tracker.lockedUntil = now + CARD_UID_LOCKOUT_MS;
        cardUidAttemptMap.set(userId, tracker);

        res.status(429).json({
          success: false,
          message: "Card UID not found. Maximum attempts reached. You are locked out for 60 seconds.",
          lockedOutSeconds: 60,
          forceExit: true,
        });
        return;
      }

      cardUidAttemptMap.set(userId, tracker);
      res.status(404).json({
        success: false,
        message: `Card UID not found in the system. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.`,
        attemptsLeft,
      });
      return;
    }

    const linkedRaw = await db.execute(sql`
      select id as uid from auth_users
      where linked_card_uid = ${cardUid}
      limit 1
    `);
    const linkedRows = extractRows<{ uid: string }>(linkedRaw);

    if (linkedRows.length > 0) {
      res.status(409).json({
        success: false,
        message:
          "This Card UID is already linked to another account and cannot be linked again. Please use a different card.",
      });
      return;
    }

    cardUidAttemptMap.delete(userId);

    const card = cardRows[0];
    res.json({
      success: true,
      card: {
        cardUid:  card.card_uid,
        fullName: card.full_name,
        type:     card.type,
        status:   card.status,
      },
    });
  } catch (error) {
    console.error("Check card UID error:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ── CHECK FULL NAME ───────────────────────────────────────────────────────────

router.get("/auth/check-full-name", async (req, res): Promise<void> => {
  try {
    const fullName =
      typeof req.query.fullName === "string" ? req.query.fullName.trim() : "";

    if (!fullName) {
      res.status(400).json({ success: false, message: "fullName query param is required" });
      return;
    }

    const userRaw = await db.execute(sql`
      select full_name, status
      from users
      where lower(trim(full_name)) = lower(trim(${fullName}))
      limit 1
    `);
    const userRows = extractRows<{ full_name: string; status: string }>(userRaw);

    if (userRows.length === 0) {
      res.status(404).json({
        success: false,
        message: "We couldn't find this name in our records. Please check with your admin.",
      });
      return;
    }

    const nameAlreadyUsed = await isNameAlreadyLinkedToAccount(fullName);
    if (nameAlreadyUsed) {
      res.status(409).json({
        success: false,
        message: "This name is already linked to an existing account.",
      });
      return;
    }

    const matched = userRows[0];
    res.json({
      success: true,
      user: {
        fullName: matched.full_name,
        status: matched.status,
      },
    });
  } catch (error) {
    console.error("Check full name error:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ── LINK CARD ─────────────────────────────────────────────────────────────────

router.post("/auth/user/link-card", async (req, res): Promise<void> => {
  try {
    const currentUser = getUserFromAuthHeader(req.headers.authorization);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }

    const body = req.body as { cardUid?: string };
    const cardUid = typeof body?.cardUid === "string" ? body.cardUid.trim().toUpperCase() : "";
    if (!cardUid) {
      res.status(400).json({ success: false, message: "cardUid is required" });
      return;
    }

    await ensureLinkedCardUidColumn();

    const existingRaw = await db.execute(sql`
      select id as uid from auth_users
      where linked_card_uid = ${cardUid}
      limit 1
    `);
    const existingRows = extractRows<{ uid: string }>(existingRaw);

    if (existingRows.length > 0) {
      res.status(409).json({
        success: false,
        message: "This Card UID is already linked to another account and cannot be linked again. Please use a different card.",
      });
      return;
    }

    const currentUserRaw = await db.execute(sql`
      select linked_card_uid from auth_users
      where id = ${currentUser.id}
      limit 1
    `);
    const currentUserRows = extractRows<{ linked_card_uid?: string | null }>(currentUserRaw);
    const alreadyLinked = currentUserRows[0]?.linked_card_uid;

    if (alreadyLinked) {
      res.status(409).json({
        success: false,
        message: "Your account already has a linked card. This action cannot be changed.",
      });
      return;
    }

    await db.execute(sql`
      update auth_users
      set linked_card_uid = ${cardUid}
      where id = ${currentUser.id}
    `);

    await logAudit({
      user: currentUser.email ?? String(currentUser.id),
      action: "UPDATE",
      entity: "User",
      details: `${currentUser.email ?? currentUser.id} linked card ${cardUid}`,
    });

    res.json({ success: true, linkedCardUid: cardUid });
  } catch (error) {
    console.error("Link card error:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while linking your card. Please try again.",
    });
  }
});

// ── ADMIN: UNLINK CARD ────────────────────────────────────────────────────────
// Lets an admin/staff account remove a card from whichever auth_users
// account it's linked to, so it becomes available to link to a new/other
// account (e.g. after a card is reported lost, blocked, or reassigned).
//
// WRITE ACTION → guarded by requireFullAccess. A view_only staff member
// gets a 403 with code VIEW_ONLY, which the frontend turns into a modal.
//
// (This still runs off the old full_access/view_only switch rather than
// the Permission Matrix. If you want it under the matrix instead, swap
// requireFullAccess for requirePermission("user.card.disable") — see the
// note in server/routes/users.ts's PATCH /users/:id handler.)

router.post("/admin/users/unlink-card", requireFullAccess, async (req, res): Promise<void> => {
  try {
    const adminUser = req.adminUser!;

    const body = req.body as { cardUid?: string };
    const cardUid = typeof body?.cardUid === "string" ? body.cardUid.trim() : "";
    if (!cardUid) {
      res.status(400).json({ error: "cardUid is required" });
      return;
    }

    const result = await unlinkCardFromAnyAccount(cardUid, adminUser, "manual admin unlink");

    if (!result.unlinked) {
      res.status(404).json({ error: "No account is currently linked to this card" });
      return;
    }

    res.json({
      success: true,
      message: `Card ${cardUid.trim().toUpperCase()} has been unlinked from ${result.previousAccount!.fullName}'s account.`,
      previousAccount: result.previousAccount,
    });
  } catch (error) {
    console.error("Admin unlink card error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── CHANGE PASSWORD (User) ────────────────────────────────────────────────────

const PASSWORD_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

router.post("/auth/user/change-password", async (req, res): Promise<void> => {
  try {
    const currentUser = getUserFromAuthHeader(req.headers.authorization);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Invalid token. Please sign in again." });
      return;
    }

    const body = req.body as { currentPassword?: string; newPassword?: string };
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, message: "Current and new password are required." });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
      return;
    }

    await ensurePasswordChangedAtColumn();

    const rawRecord = await db.execute(sql`
      select id as uid, password_hash, password_changed_at
      from auth_users
      where id = ${currentUser.id}
      limit 1
    `);
    const user = extractRows<{
      uid: string;
      password_hash: string;
      password_changed_at: string | null;
    }>(rawRecord)[0];

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    if (user.password_changed_at) {
      const lastChanged = new Date(user.password_changed_at).getTime();
      const elapsed = Date.now() - lastChanged;

      if (elapsed < PASSWORD_CHANGE_COOLDOWN_MS) {
        const remainingMs = PASSWORD_CHANGE_COOLDOWN_MS - elapsed;
        const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
        const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

        const timeLeft =
          remainingHours > 0
            ? `${remainingHours} hour${remainingHours !== 1 ? "s" : ""} and ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`
            : `${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;

        res.status(429).json({
          success: false,
          message: `You can only change your password once every 24 hours. Please try again in ${timeLeft}.`,
          retryAfterMs: remainingMs,
        });
        return;
      }
    }

    if (!verifyPassword(currentPassword, user.password_hash)) {
      res.status(401).json({ success: false, message: "Current password is incorrect." });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ success: false, message: "New password must be different from the current password." });
      return;
    }

    const newHash = hashPassword(newPassword);
    await db.execute(sql`
      update auth_users
      set
        password_hash       = ${newHash},
        password_changed_at = now(),
        updated_at          = now()
      where id = ${currentUser.id}
    `);

    await logAudit({
      user: currentUser.email ?? String(currentUser.id),
      action: "UPDATE",
      entity: "User",
      details: `${currentUser.email ?? currentUser.id} changed their password`,
    });

    res.json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── USER LOGOUT ───────────────────────────────────────────────────────────────

router.post("/auth/user/logout", async (req, res): Promise<void> => {
  const currentUser = getUserFromAuthHeader(req.headers.authorization);
  if (currentUser) {
    await logAudit({
      user: currentUser.email ?? String(currentUser.id),
      action: "LOGOUT",
      entity: "User",
      details: `${currentUser.email ?? currentUser.id} logged out`,
    });
  }
  res.status(200).json({ success: true });
});

// ── ADMIN LOGIN ───────────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    await ensurePermissionColumn();

    const [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.username, parsed.data.username))
      .limit(1);

    const { username, password } = parsed.data;
    const looksLikeEmail = username.includes("@");
    const supabaseUser = looksLikeEmail
      ? await signInSupabaseWithPassword(username, password)
      : null;

    const isLegacyAdminValid = !!admin && verifyPassword(password, admin.password_hash);

    if (!supabaseUser && !isLegacyAdminValid) {
      res.status(401).json({ success: false, message: "Invalid credentials" });
      return;
    }

    if (admin && (admin as any).status === "Disabled") {
      res.status(403).json({
        success: false,
        message: "This account has been disabled. Please contact a Super Admin.",
      });
      return;
    }

    if (admin && !admin.password_hash.includes(":")) {
      const upgradedHash = hashPassword(password);
      await db
        .update(adminsTable)
        .set({ password_hash: upgradedHash })
        .where(eq(adminsTable.id, admin.id));
    }

    const normalizedUsername = admin?.username ?? supabaseUser?.email ?? username;
    const displayName =
      admin?.full_name ||
      (typeof supabaseUser?.user_metadata?.full_name === "string"
        ? supabaseUser.user_metadata.full_name
        : null) ||
      normalizedUsername;

    const role = normalizeRole(admin?.role);
    const permission = normalizePermission((admin as any)?.permission, role);

    await logAudit({
      user: admin?.username ?? normalizedUsername,
      action: "LOGIN",
      entity: roleLabel(role),
      details: `${admin?.username ?? normalizedUsername} logged in`,
    });

    res.json({
      success: true,
      message: "Login successful",
      username: admin?.username ?? normalizedUsername,
      name: displayName,
      role,
      permission,
      canManage: !isViewOnly(role, permission),
      token: createAdminToken({
        username: admin?.username ?? normalizedUsername,
        name: displayName,
        role,
      }),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── UPDATE PROFILE ────────────────────────────────────────────────────────────
// NOTE: intentionally NOT guarded by requireFullAccess — this only edits the
// caller's OWN name/username/password. A view_only account must still be able
// to change its own password.

router.post("/auth/update-profile", async (req, res): Promise<void> => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const adminUser = verifyAdminToken(token);
    if (!adminUser) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const body = req.body as {
      name?: string;
      username?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword.trim() : "";

    const [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.username, adminUser.username))
      .limit(1);

    if (!admin) {
      res.status(404).json({ error: "Admin account not found" });
      return;
    }

    if (newPassword && !currentPassword) {
      res.status(400).json({ error: "Current password is required" });
      return;
    }

    if (newPassword && !verifyPassword(currentPassword, admin.password_hash)) {
      res.status(401).json({ error: "Invalid current password" });
      return;
    }

    if (newPassword && newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }

    // ── Username change: validate + uniqueness check ──────────────────────
    const wantsUsernameChange = !!username && username.toLowerCase() !== admin.username.toLowerCase();

    if (username === "" && body.username !== undefined) {
      res.status(400).json({ error: "Username cannot be empty" });
      return;
    }

    if (wantsUsernameChange) {
      const clash = await db.execute(sql`
        select id from admins
        where lower(username) = lower(${username}) and id != ${admin.id}
        limit 1
      `);
      if (extractRows(clash).length > 0) {
        res.status(409).json({ error: "That username is already taken" });
        return;
      }
    }

    const nextFullName = name || admin.full_name;
    const nextUsername = wantsUsernameChange ? username : admin.username;
    const nextPasswordHash = newPassword ? hashPassword(newPassword) : admin.password_hash;
    const role = normalizeRole(admin.role);

    await db
      .update(adminsTable)
      .set({ full_name: nextFullName, username: nextUsername, password_hash: nextPasswordHash })
      .where(eq(adminsTable.id, admin.id));

    await logAudit({
      user: nextUsername,
      action: "UPDATE",
      entity: roleLabel(role),
      details: [
        wantsUsernameChange ? `changed username from "${admin.username}" to "${nextUsername}"` : null,
        newPassword ? "changed their password" : null,
        !wantsUsernameChange && !newPassword ? "updated their profile" : null,
      ]
        .filter(Boolean)
        .join(", "),
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      username: nextUsername,
      name: nextFullName,
      role,
      // Re-issue the token — it's signed with the OLD username, so if that
      // changed, every subsequent request with the stale token would fail
      // to find the admin row (verifyAdminToken -> username lookup above).
      token: createAdminToken({ username: nextUsername, name: nextFullName, role }),
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── ADMIN ME ──────────────────────────────────────────────────────────────────
// Single source of truth for the frontend's useAdminAccess() / usePermissions()
// hooks, AND for server-side callers (like the create-disbursement Edge
// Function) that verify a caller's permission by hitting this endpoint.
// Always reads role + permission LIVE from the admins table / Permission
// Matrix, never from the token.

router.get("/auth/me", async (req, res): Promise<void> => {
  try {
    const admin = await loadAdminContext(req.headers.authorization);
    if (!admin) {
      res.status(401).json({ error: "Not authenticated", code: "UNAUTHENTICATED" });
      return;
    }

    const validatedUser = GetMeResponse.parse({
      username: admin.username,
      name: admin.name ?? admin.username,
      role: admin.role,
    });

    // 🔒 NEW: per-module granular permissions from the Permission Matrix,
    // e.g. { "user.delete": false, "fare.route.add": false,
    // "reports.download.excel": true, "disbursement.trigger": false, ... }.
    // super_admin always comes back all-true (see isPermitted() in
    // server/lib/permissions.ts).
    const permissions = await getEffectivePermissions(admin.role);

    res.json({
      ...validatedUser,
      permission: admin.permission,
      canManage: admin.permission === "full_access",
      isSuperAdmin: admin.role === "super_admin",
      permissions,
    });
  } catch (e) {
    console.error("Auth state error:", e);
    res.status(401).json({ error: "Invalid auth state" });
  }
});

// ── LIST STAFF (ADMIN) ────────────────────────────────────────────────────────
// READ-ONLY → any authenticated admin, including view_only staff.

router.get("/admin/staff", requireAdmin, async (req, res): Promise<void> => {
  try {
    await ensurePermissionColumn();

    const rows = await db.execute(sql`
      select id, username, full_name, role, status, created_at, permission
      from admins
      order by created_at desc
    `);

    res.json({
      success: true,
      staff: extractRows(rows),
      canManage: req.adminUser!.permission === "full_access",
      isSuperAdmin: req.adminUser!.role === "super_admin",
    });
  } catch (error) {
    console.error("List staff error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── CREATE STAFF (ADMIN) ───────────────────────────────────────────────────────
// Super Admin only, and also blocked for view_only as a belt-and-braces check.

router.post("/admin/staff", requireSuperAdmin, requireFullAccess, async (req, res): Promise<void> => {
  try {
    const adminUser = req.adminUser!;

    const body = req.body as {
      username?: string;
      password?: string;
      fullName?: string;
      role?: string;
      permission?: string;
    };
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const role = normalizeRole(body?.role);
    const permission = normalizePermission(body?.permission, role);

    if (!username || !password || !fullName) {
      res.status(400).json({ error: "Username, password, and full name are required" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    await ensurePermissionColumn();

    const existingRaw = await db.execute(sql`
      select id from admins where lower(username) = lower(${username}) limit 1
    `);
    if (extractRows(existingRaw).length > 0) {
      res.status(409).json({ error: "Username is already taken" });
      return;
    }

    const passwordHash = hashPassword(password);
    const insertedRaw = await db.execute(sql`
      insert into admins (username, password_hash, full_name, role, status, permission)
      values (${username}, ${passwordHash}, ${fullName}, ${role}, 'Active', ${permission})
      returning id, username, full_name, role, status, created_at, permission
    `);
    const inserted = extractRows(insertedRaw)[0];

    await logAudit({
      user: adminUser.username,
      action: "CREATE",
      entity: roleLabel(role),
      details: `${adminUser.username} created ${roleLabel(role).toLowerCase()} account "${username}" (${permission})`,
    });

    res.status(201).json({ success: true, staff: inserted });
  } catch (error) {
    console.error("Create staff error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── USER SELF-SERVICE: UNLINK CARD ───────────────────────────────────────────

router.post("/auth/user/unlink-card", async (req, res): Promise<void> => {
  try {
    const currentUser = getUserFromAuthHeader(req.headers.authorization);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }

    await ensureLinkedCardUidColumn();

    const currentUserRaw = await db.execute(sql`
      select linked_card_uid from auth_users
      where id = ${currentUser.id}
      limit 1
    `);
    const linkedCardUid = extractRows<{ linked_card_uid: string | null }>(currentUserRaw)[0]?.linked_card_uid;

    if (!linkedCardUid || linkedCardUid.trim() === "") {
      res.status(400).json({ success: false, message: "No card is currently linked to your account." });
      return;
    }

    await db.execute(sql`
      update auth_users
      set linked_card_uid = null, updated_at = now()
      where id = ${currentUser.id}
    `);

    await logAudit({
      user: currentUser.email ?? String(currentUser.id),
      action: "UPDATE",
      entity: "User",
      details: `${currentUser.email ?? currentUser.id} unlinked their own card (${linkedCardUid})`,
    });

    res.json({ success: true, message: "Card unlinked successfully." });
  } catch (error) {
    console.error("User unlink card error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── UPDATE STAFF ACCESS (ADMIN) ────────────────────────────────────────────
// Super Admin only. This is the endpoint that flips a staff account between
// full_access and view_only.
//
// NOTE: this still governs the old blunt full_access/view_only switch
// (admins.permission), which is now superseded for the four gated
// modules by the Permission Matrix. It's left in place because
// requireFullAccess / requireSuperAdmin elsewhere (e.g. staff account
// management itself, just below) still read it.

router.patch("/admin/staff/:id/access", requireSuperAdmin, async (req, res): Promise<void> => {
  try {
    const adminUser = req.adminUser!;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const body = req.body as { permission?: string };
    const permission = body?.permission;
    if (permission !== "full_access" && permission !== "view_only") {
      res.status(400).json({ error: "permission must be 'full_access' or 'view_only'" });
      return;
    }

    await ensurePermissionColumn();

    const targetRaw = await db.execute(sql`
      select id, username, role from admins where id = ${targetId} limit 1
    `);
    const target = extractRows<{ id: number; username: string; role: string }>(targetRaw)[0];
    if (!target) {
      res.status(404).json({ error: "Staff account not found" });
      return;
    }

    if (isSuperAdmin(target.role)) {
      res.status(403).json({ error: "Cannot change access level of a Super Admin." });
      return;
    }

    await db.execute(sql`
      update admins
      set permission = ${permission}, updated_at = now()
      where id = ${targetId}
    `);

    await logAudit({
      user: adminUser.username,
      action: "UPDATE",
      entity: "Staff",
      details: `${adminUser.username} set "${target.username}" access to ${permission}`,
    });

    res.json({ success: true, permission });
  } catch (error) {
    console.error("Update staff access error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE STAFF (ADMIN) ───────────────────────────────────────────────────────
// Super Admin only.

router.delete("/admin/staff/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  try {
    const adminUser = req.adminUser!;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const [selfAdmin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.username, adminUser.username))
      .limit(1);

    if (selfAdmin && selfAdmin.id === targetId) {
      res.status(400).json({ error: "You cannot remove your own account" });
      return;
    }

    const targetRaw = await db.execute(sql`
      select username, role from admins where id = ${targetId} limit 1
    `);
    const target = extractRows<{ username: string; role: string }>(targetRaw)[0];
    if (!target) {
      res.status(404).json({ error: "Staff account not found" });
      return;
    }

    await db.execute(sql`delete from admins where id = ${targetId}`);

    await logAudit({
      user: adminUser.username,
      action: "DELETE",
      entity: roleLabel(normalizeRole(target.role)),
      details: `${adminUser.username} removed ${roleLabel(normalizeRole(target.role)).toLowerCase()} account "${target.username}"`,
    });

    res.json({ success: true, message: "Staff account removed" });
  } catch (error) {
    console.error("Delete staff error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;