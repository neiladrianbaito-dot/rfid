import crypto from "node:crypto";

type UserTokenPayload = {
  id: string;
  email: string;
  fullName: string;
  exp: number;
};

const secret = process.env.USER_AUTH_SECRET || process.env.SESSION_SECRET || "termipay-user-dev-secret";

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64: string) {
  return b64url(crypto.createHmac("sha256", secret).update(payloadB64).digest());
}

export function createUserToken(
  data: { id: string; email: string; fullName: string },
  ttlSeconds = 60 * 60 * 8,
) {
  const payload: UserTokenPayload = {
    id: data.id,
    email: data.email,
    fullName: data.fullName,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyUserToken(token: string): { id: string; email: string; fullName: string } | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = sign(payloadB64);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as UserTokenPayload;
    if (!payload?.id || !payload?.email || !payload?.fullName || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: payload.id, email: payload.email, fullName: payload.fullName };
  } catch {
    return null;
  }
}
