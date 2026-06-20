import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";

const router: IRouter = Router();

// ── Config ────────────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const APP_URL = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Resend client ─────────────────────────────────────────────────────────────

const resend = new Resend(RESEND_API_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hashed = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.includes(":")) return storedHash === password;
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, stored] = parts;
  const computed = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(computed, "hex"));
}

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

async function ensureResetTokensTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists password_reset_tokens (
      id         uuid        primary key default gen_random_uuid(),
      user_id    text        not null,
      token      text        not null unique,
      expires_at timestamptz not null,
      used       boolean     not null default false,
      created_at timestamptz not null default now()
    )
  `);
}

// ── POST /auth/user/forgot-password ──────────────────────────────────────────
// Accepts an email, creates a reset token, and emails the link.
// Always responds with 200 to prevent email enumeration.

router.post("/auth/user/forgot-password", async (req, res): Promise<void> => {
  try {
    await ensureResetTokensTable();

    const body = req.body as { email?: string };
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !email.includes("@")) {
      res.status(400).json({ success: false, message: "A valid email address is required." });
      return;
    }

    // Look up the user
    const rawUser = await db.execute(sql`
      select id as uid, full_name, email
      from auth_users
      where email = ${email}
      limit 1
    `);
    const user = extractRows<{ uid: string; full_name: string; email: string }>(rawUser)[0];

    // Always return success to prevent enumeration
    if (!user) {
      res.json({
        success: true,
        message: "If that email is registered, you will receive a reset link shortly.",
      });
      return;
    }

    // Invalidate any existing unused tokens for this user
    await db.execute(sql`
      update password_reset_tokens
      set used = true
      where user_id = ${user.uid} and used = false
    `);

    // Create a new token
    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await db.execute(sql`
      insert into password_reset_tokens (user_id, token, expires_at)
      values (${user.uid}, ${rawToken}, ${expiresAt.toISOString()})
    `);

    const resetLink = `${APP_URL}/reset-password?token=${rawToken}`;

    // Send email via Resend
    const { error: sendError } = await resend.emails.send({
      from: "Transit Wallet <onboarding@resend.dev>",
      to: user.email,
      subject: "Reset your password",
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:40px 0;margin:0">
            <div style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;padding:40px;border:1px solid #334155">
              <h2 style="color:#60a5fa;margin:0 0 8px">Password Reset</h2>
              <p style="color:#94a3b8;margin:0 0 24px;font-size:14px">
                Hi ${user.full_name}, you requested to reset your password.
                Click the button below — this link expires in <strong>1 hour</strong>.
              </p>
              <a href="${resetLink}"
                 style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                        padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px">
                Reset Password
              </a>
              <p style="color:#475569;font-size:12px;margin:24px 0 0">
                If you didn't request this, you can safely ignore this email.<br/>
                Link: <a href="${resetLink}" style="color:#60a5fa">${resetLink}</a>
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (sendError) {
      console.error("Resend send error:", sendError);
      res.status(500).json({ success: false, message: "Failed to send reset email." });
      return;
    }

    res.json({
      success: true,
      message: "If that email is registered, you will receive a reset link shortly.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── GET /auth/user/verify-reset-token ────────────────────────────────────────
// The frontend calls this on page load to validate the token before showing the form.

router.get("/auth/user/verify-reset-token", async (req, res): Promise<void> => {
  try {
    await ensureResetTokensTable();

    const token =
      typeof req.query.token === "string" ? req.query.token.trim() : "";

    if (!token) {
      res.status(400).json({ valid: false, message: "Token is required." });
      return;
    }

    const rawToken = await db.execute(sql`
      select id, user_id, expires_at, used
      from password_reset_tokens
      where token = ${token}
      limit 1
    `);
    const row = extractRows<{
      id: string;
      user_id: string;
      expires_at: string;
      used: boolean;
    }>(rawToken)[0];

    if (!row) {
      res.status(404).json({ valid: false, message: "Invalid or expired reset link." });
      return;
    }
    if (row.used) {
      res.status(410).json({ valid: false, message: "This reset link has already been used." });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(410).json({ valid: false, message: "This reset link has expired. Please request a new one." });
      return;
    }

    res.json({ valid: true });
  } catch (error) {
    console.error("Verify reset token error:", error);
    res.status(500).json({ valid: false, message: "Internal server error." });
  }
});

// ── POST /auth/user/reset-password ───────────────────────────────────────────
// Validates token, updates password, and marks token as used.

router.post("/auth/user/reset-password", async (req, res): Promise<void> => {
  try {
    await ensureResetTokensTable();

    const body = req.body as { token?: string; newPassword?: string };
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!token || !newPassword) {
      res.status(400).json({ success: false, message: "Token and new password are required." });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
      return;
    }

    const rawToken = await db.execute(sql`
      select id, user_id, expires_at, used
      from password_reset_tokens
      where token = ${token}
      limit 1
    `);
    const row = extractRows<{
      id: string;
      user_id: string;
      expires_at: string;
      used: boolean;
    }>(rawToken)[0];

    if (!row) {
      res.status(404).json({ success: false, message: "Invalid or expired reset link." });
      return;
    }
    if (row.used) {
      res.status(410).json({ success: false, message: "This reset link has already been used." });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(410).json({ success: false, message: "This reset link has expired. Please request a new one." });
      return;
    }

    // Check new password isn't the same as current
    const rawUser = await db.execute(sql`
      select password_hash from auth_users where id = ${row.user_id} limit 1
    `);
    const userRow = extractRows<{ password_hash: string }>(rawUser)[0];
    if (userRow && verifyPassword(newPassword, userRow.password_hash)) {
      res.status(400).json({
        success: false,
        message: "New password must be different from your current password.",
      });
      return;
    }

    const newHash = hashPassword(newPassword);

    // Update password and reset the 24h cooldown timestamp
    await db.execute(sql`
      update auth_users
      set
        password_hash       = ${newHash},
        password_changed_at = now(),
        updated_at          = now()
      where id = ${row.user_id}
    `);

    // Mark token as used
    await db.execute(sql`
      update password_reset_tokens
      set used = true
      where id = ${row.id}
    `);

    res.json({ success: true, message: "Password reset successfully. You can now sign in." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

export default router;