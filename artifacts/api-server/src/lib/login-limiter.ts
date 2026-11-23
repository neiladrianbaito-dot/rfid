// server/lib/login-limiter.ts
//
// Simple in-memory brute-force protection for login endpoints.
// No extra npm package needed.
//
//  - MAX_ATTEMPTS wrong passwords for the same account from the same IP
//    -> locked out for LOCKOUT_MINUTES.
//  - Also a looser per-IP cap (MAX_PER_IP) so someone can't just try a
//    different email on every attempt from one IP.
//  - A successful login clears the counter.
//
// Configurable with env variables (all optional):
//   LOGIN_MAX_ATTEMPTS     default 3
//   LOGIN_LOCKOUT_MINUTES  default 15
//   LOGIN_MAX_PER_IP       default 10
//
// NOTE: state lives in memory, so it resets when the server restarts/deploys
// and is per-instance. That is fine for a single Render instance.

import type { Request } from "express";
import { getClientIp } from "./audit-logger";

const MAX_ATTEMPTS = Number(process.env["LOGIN_MAX_ATTEMPTS"] ?? 3);
const MAX_PER_IP = Number(process.env["LOGIN_MAX_PER_IP"] ?? 10);
const LOCKOUT_MS = Number(process.env["LOGIN_LOCKOUT_MINUTES"] ?? 15) * 60_000;
const WINDOW_MS = 15 * 60_000; // failures older than this are forgotten

type Entry = { count: number; firstAt: number; lockedUntil: number };
const store = new Map<string, Entry>();

function keys(req: Request, identifier: string) {
  const ip = getClientIp(req) ?? "no-ip";
  return {
    accountKey: `acct|${ip}|${identifier.trim().toLowerCase()}`,
    ipKey: `ip|${ip}`,
  };
}

// Returns a live entry, or null if it never existed / has already expired.
function readEntry(key: string, now: number): Entry | null {
  const entry = store.get(key);
  if (!entry) return null;
  const lockExpired = entry.lockedUntil > 0 && entry.lockedUntil <= now;
  const windowExpired = entry.lockedUntil === 0 && now - entry.firstAt > WINDOW_MS;
  if (lockExpired || windowExpired) {
    store.delete(key);
    return null;
  }
  return entry;
}

export function lockMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many failed attempts. Please try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`;
}

/** Call BEFORE checking the password. */
export function checkLoginLock(
  req: Request,
  identifier: string
): { locked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const { accountKey, ipKey } = keys(req, identifier);

  let until = 0;
  for (const key of [accountKey, ipKey]) {
    const entry = readEntry(key, now);
    if (entry && entry.lockedUntil > now) until = Math.max(until, entry.lockedUntil);
  }

  return until > now
    ? { locked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) }
    : { locked: false, retryAfterSeconds: 0 };
}

/** Call after a WRONG password / unknown account. */
export function recordLoginFailure(
  req: Request,
  identifier: string
): { locked: boolean; justLocked: boolean; attemptsLeft: number; retryAfterSeconds: number } {
  const now = Date.now();
  const { accountKey, ipKey } = keys(req, identifier);
  let justLocked = false;

  const bump = (key: string, max: number): Entry => {
    const entry = readEntry(key, now) ?? { count: 0, firstAt: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= max && entry.lockedUntil === 0) {
      entry.lockedUntil = now + LOCKOUT_MS;
      justLocked = true;
    }
    store.set(key, entry);
    return entry;
  };

  const acct = bump(accountKey, MAX_ATTEMPTS);
  const ip = bump(ipKey, MAX_PER_IP);

  const until = Math.max(acct.lockedUntil, ip.lockedUntil);
  const locked = until > now;
  return {
    locked,
    justLocked,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - acct.count),
    retryAfterSeconds: locked ? Math.ceil((until - now) / 1000) : 0,
  };
}

/** Call after a SUCCESSFUL login. */
export function clearLoginFailures(req: Request, identifier: string): void {
  const { accountKey } = keys(req, identifier);
  store.delete(accountKey);
}

// Housekeeping so the map can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const key of Array.from(store.keys())) readEntry(key, now);
}, 5 * 60_000).unref();