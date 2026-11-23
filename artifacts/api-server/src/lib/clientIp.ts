import { isIP } from "node:net";
import type { Request } from "express";

function normalize(ip: string): string {
  let v = ip.trim();
  if (v.startsWith("::ffff:")) v = v.slice(7); // IPv4-mapped IPv6
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
    (a === 100 && b >= 64 && b <= 127) // CGNAT (ISP-shared, not truly public)
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

/** Returns the client's public (ISP router) IP, or null if none found. */
export function getPublicIp(req: Request): string | null {
  const candidates: string[] = [
    ...(req.ips ?? []), // from X-Forwarded-For (respects "trust proxy")
    req.ip ?? "",
    req.socket.remoteAddress ?? "",
  ];

  for (const c of candidates) {
    const ip = normalize(c);
    if (ip && isPublicIp(ip)) return ip;
  }
  return null;
}