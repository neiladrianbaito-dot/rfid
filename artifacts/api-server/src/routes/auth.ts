import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, adminsTable } from "@workspace/db";
import { LoginBody, GetMeResponse } from "@workspace/api-zod";
import { createAdminToken, verifyAdminToken } from "../lib/admin-token";
import { createUserToken, verifyUserToken } from "../lib/user-token";
import { signInSupabaseWithPassword } from "../lib/supabase";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const router: IRouter = Router();
let linkedCardColumnAvailable: boolean | null = null;

// ── Password helpers (scrypt) ─────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hashed = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password: string, storedPasswordHash: string): boolean {
  // Plain text fallback (legacy / first login)
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

// ── password_changed_at column helper ────────────────────────────────────────
// Ensures the column exists lazily (same pattern as linked_card_uid).

async function ensurePasswordChangedAtColumn(): Promise<void> {
  await db.execute(sql`
    alter table public.auth_users
    add column if not exists password_changed_at timestamptz
  `);
}

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
      // Auto-upgrade plain text to scrypt hash
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

    const { blocked, status: cardStatus } = await checkLinkedCardStatus(user.linked_card_uid);
    if (blocked) {
      res.status(403).json({
        success: false,
        message:
          cardStatus === "Blocked"
            ? "Your card has been blocked. Please contact support."
            : "Your card is inactive. Please contact support.",
      });
      return;
    }

    res.json({
      success: true,
      message: "Sign in successful",
      token: createUserToken({ id: user.uid, email: user.email, fullName: user.full_name }),
      user: {
        id: user.uid,
        fullName: user.full_name,
        email: user.email,
        linkedCardUid: user.linked_card_uid ?? "",
      },
    });
  } catch (error) {
    console.error("User sign in error:", error);
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
        ? sql`select id as uid, full_name, email, linked_card_uid from auth_users where id = ${currentUser.id} limit 1`
        : sql`select id as uid, full_name, email from auth_users where id = ${currentUser.id} limit 1`
    );

    type UserRow = { uid: string; full_name: string; email: string; linked_card_uid?: string | null };
    const user = extractRows<UserRow>(rawRecord)[0];

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const { blocked, status: cardStatus } = await checkLinkedCardStatus(user.linked_card_uid);
    if (blocked) {
      res.status(403).json({
        success: false,
        message:
          cardStatus === "Blocked"
            ? "Your card has been blocked. Please contact support."
            : "Your card is inactive. Please contact support.",
      });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.uid,
        fullName: user.full_name,
        email: user.email,
        linkedCardUid: user.linked_card_uid ?? "",
      },
    });
  } catch (error) {
    console.error("User me error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── CHECK CARD UID ────────────────────────────────────────────────────────────

// ─── In-memory attempt tracker (per authenticated user) ──────────────────────
// Key: user ID (from auth token)
// Value: { count, lockedUntil }
const cardUidAttemptMap = new Map<string, { count: number; lockedUntil: number }>();

const CARD_UID_MAX_ATTEMPTS = 3;
const CARD_UID_LOCKOUT_MS   = 60_000; // 60 seconds

// ─────────────────────────────────────────────────────────────────────────────

router.get("/auth/check-card-uid", async (req, res): Promise<void> => {
  try {
    const currentUser = getUserFromAuthHeader(req.headers.authorization);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }

    const userId = String(currentUser.id ?? currentUser.userId ?? currentUser.sub ?? "");

    // ── 1. Check lockout ────────────────────────────────────────────────────
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

    // ── 2. Validate query param ─────────────────────────────────────────────
    const cardUid =
      typeof req.query.cardUid === "string" ? req.query.cardUid.trim().toUpperCase() : "";
    if (!cardUid) {
      res.status(400).json({ success: false, message: "cardUid query param is required" });
      return;
    }

    await ensureLinkedCardUidColumn();

    // ── 3. Look up the card ─────────────────────────────────────────────────
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

    // ── 4. Card not found → increment attempt counter ───────────────────────
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

    // ── 5. Check if already linked to another account (409) ─────────────────
    // 409 does NOT count as a failed attempt
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

    // ── 6. Success — reset the attempt counter for this user ─────────────────
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
    // Don't count server errors against the attempt limiter
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

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
 
// ── 2. SIGNUP (REPLACE your existing router.post("/auth/signup", ...) with
// this version — it's identical except for the new name-check block added
// right after the existing field validation, before the password is hashed) ──
 
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
 
    // ── NEW: full name must match a pre-registered record in `users` ──
    // This is the real enforcement point — the frontend check can be
    // bypassed, so signup independently re-verifies the name here.
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
 
    res.status(201).json({ success: true, message: "Signup successful. You can now sign in." });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
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

    res.json({ success: true, linkedCardUid: cardUid });
  } catch (error) {
    console.error("Link card error:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while linking your card. Please try again.",
    });
  }
});

// ── CHANGE PASSWORD (User) ────────────────────────────────────────────────────
// 24-hour cooldown: a user can only change their password once every 24 hours.
// The `password_changed_at` column is created lazily if it doesn't exist yet.

const PASSWORD_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

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

    // Ensure the cooldown column exists (idempotent — safe to call every time)
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

    // ── 24-hour cooldown check ────────────────────────────────────────────────
    if (user.password_changed_at) {
      const lastChanged = new Date(user.password_changed_at).getTime();
      const elapsed = Date.now() - lastChanged;

      if (elapsed < PASSWORD_CHANGE_COOLDOWN_MS) {
        const remainingMs = PASSWORD_CHANGE_COOLDOWN_MS - elapsed;
        const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
        const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

        // Build a human-readable remaining time string
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
    // ─────────────────────────────────────────────────────────────────────────

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

    res.json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── USER LOGOUT ───────────────────────────────────────────────────────────────

router.post("/auth/user/logout", (_req, res): void => {
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

    // Auto-upgrade plain text password to scrypt hash on first login
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

    res.json({
      success: true,
      message: "Login successful",
      username: admin?.username ?? normalizedUsername,
      name: displayName,
      token: createAdminToken({
        username: admin?.username ?? normalizedUsername,
        name: displayName,
      }),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── UPDATE PROFILE ────────────────────────────────────────────────────────────

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

    const body = req.body as { name?: string; currentPassword?: string; newPassword?: string };
    const name = typeof body?.name === "string" ? body.name.trim() : "";
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

    const nextFullName = name || admin.full_name;
    const nextPasswordHash = newPassword ? hashPassword(newPassword) : admin.password_hash;

    await db
      .update(adminsTable)
      .set({ full_name: nextFullName, password_hash: nextPasswordHash })
      .where(eq(adminsTable.id, admin.id));

    res.json({
      success: true,
      message: "Profile updated successfully",
      username: admin.username,
      name: nextFullName,
      token: createAdminToken({ username: admin.username, name: nextFullName }),
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── ADMIN LOGOUT ──────────────────────────────────────────────────────────────

router.post("/auth/logout", (_req, res): void => {
  res.status(200).json({ success: true });
});

// ── ADMIN ME ──────────────────────────────────────────────────────────────────

router.get("/auth/me", async (req, res): Promise<void> => {
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

    const validatedUser = GetMeResponse.parse({
      username: adminUser.username,
      name: adminUser.name,
    });
    res.json(validatedUser);
  } catch (e) {
    console.error("Auth state error:", e);
    res.status(401).json({ error: "Invalid auth state" });
  }
});

export default router;