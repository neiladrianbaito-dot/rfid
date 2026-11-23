import { isIP } from "node:net";
import type { Request } from "express";

function normalize(ip: string): string {
  let v = ip.trim();
  if (v.startsWith("::ffff:")) v = v.slice(7);
  return v;
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  return (
    v === "::1" ||
    v === "::" ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe80")
  );
}

export function isPublicIp(raw: string): boolean {
  const ip = normalize(raw);
  const kind = isIP(ip);
  if (kind === 4) return !isPrivateV4(ip);
  if (kind === 6) return !isPrivateV6(ip);
  return false;
}

function headerValue(h: string | string[] | undefined): string {
  return Array.isArray(h) ? h.join(",") : (h ?? "");
}

/** Public (ISP router) IP of the client, or null if none found. */
export function getPublicIp(req: Request): string | null {
  const candidates: string[] = [
    headerValue(req.headers["cf-connecting-ip"]),
    headerValue(req.headers["true-client-ip"]),
    ...headerValue(req.headers["x-forwarded-for"]).split(","),
    headerValue(req.headers["x-real-ip"]),
    req.ip ?? "",
    req.socket.remoteAddress ?? "",
  ];

  for (const c of candidates) {
    const ip = normalize(c);
    if (ip && isPublicIp(ip)) return ip;
  }
  return null;
}

/**
 * Validates the local (LAN) IP sent by the device, e.g. 192.168.101.75.
 * Returns null if it is missing or not a valid IPv4 address.
 */
export function parseLocalIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  return isIP(ip) === 4 ? ip : null;
}