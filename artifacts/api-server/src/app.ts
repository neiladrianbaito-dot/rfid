import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger as baseLogger } from "./lib/logger";

const app: Express = express();

// ── Real client IP (not the proxy's / private IP) ────────────────────────────
// Render puts proxies in front of the app, so the TCP address Express sees is
// NOT the visitor. The visitor's IP is in X-Forwarded-For, and every proxy in
// the chain appends its own address to it.
//
// "trust proxy" tells Express which addresses are OUR proxies. Express then
// walks X-Forwarded-For from the right, skips the trusted ones, and req.ip
// becomes the first address that is NOT a trusted proxy = the real visitor.
// Anything an attacker writes on the left of the header is ignored.
//
//   loopback / linklocal / uniquelocal = private addresses (127.x, 10.x,
//   172.16-31.x, 192.168.x, fc00::/7) -> Render's internal hops get skipped.
//   Cloudflare ranges = Render is fronted by Cloudflare, so its public IPs
//   must be skipped too, otherwise you would record a Cloudflare IP.
//
// Cloudflare's list can change: https://www.cloudflare.com/ips/
// Override everything with the TRUST_PROXY env variable:
//   - a number, e.g. TRUST_PROXY=2  (trust that many hops)
//   - or a comma-separated list of IPs / CIDRs / keywords
//   - TRUST_PROXY=0 for local development (no proxy)
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function resolveTrustProxy(): number | string[] {
  const raw = process.env["TRUST_PROXY"]?.trim();
  if (raw) {
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return ["loopback", "linklocal", "uniquelocal", ...CLOUDFLARE_RANGES];
}

app.set("trust proxy", resolveTrustProxy());

app.use(
  pinoHttp({
    logger: baseLogger,
    serializers: {
      req: (req: Request) => ({
        method: req.method,
        url: req.url?.split("?")[0],
      }),
      res: (res: Response) => ({
        statusCode: res.statusCode,
      }),
    },
  })
);

// Optional: set CORS_ORIGIN="https://your-frontend.com" (comma-separated for
// several). If not set, behaves exactly like before (allows any origin).
const allowedOrigins = process.env["CORS_ORIGIN"]
  ? process.env["CORS_ORIGIN"].split(",").map((o) => o.trim())
  : true;

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// TEMPORARY helper to verify the IP on Render. Only exists when you set the
// env variable DEBUG_IP=true. Open  https://<your-api>/api/debug-ip  in your
// browser, compare "detectedIp" with https://api.ipify.org, then REMOVE the
// DEBUG_IP variable.
if (process.env["DEBUG_IP"] === "true") {
  app.get("/api/debug-ip", (req: Request, res: Response) => {
    res.json({
      detectedIp: req.ip,
      xForwardedFor: req.headers["x-forwarded-for"] ?? null,
      socketAddress: req.socket.remoteAddress ?? null,
      cfConnectingIp: req.headers["cf-connecting-ip"] ?? null,
    });
  });
}

app.use("/api", router);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const error = err as { status?: number; type?: string; message?: string };
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      message: "Invalid JSON body. Please check request payload.",
    });
    return;
  }

  const status = typeof error?.status === "number" ? error.status : 500;
  res.status(status).json({
    success: false,
    message: error?.message || "Internal server error",
  });
});

export default app;