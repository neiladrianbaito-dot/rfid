import crypto from "node:crypto";

type AdminTokenPayload = {
  username: string;
  name: string;
  role: string;
  exp: number;
};

const secret = process.env.ADMIN_AUTH_SECRET || process.env.SESSION_SECRET || "termipay-dev-secret";

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64: string) {
  return b64url(crypto.createHmac("sha256", secret).update(payloadB64).digest());
}

export function createAdminToken(
  data: { username: string; name: string; role?: string },
  ttlSeconds = 60 * 60 * 8
) {
  const payload: AdminTokenPayload = {
    username: data.username,
    name: data.name,
    role: data.role === "super_admin" ? "super_admin" : "staff",
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyAdminToken(token: string): { username: string; name: string; role: string } | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = sign(payloadB64);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as AdminTokenPayload;
    if (!payload?.username || !payload?.name || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      username: payload.username,
      name: payload.name,
      role: payload.role === "super_admin" ? "super_admin" : "staff",
    };
  } catch {
    return null;
  }
}