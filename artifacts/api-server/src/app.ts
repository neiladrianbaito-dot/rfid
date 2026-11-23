import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger as baseLogger } from "./lib/logger";

const app: Express = express();

// Needed so req.ip is the real client IP and not your host's proxy.
// = number of proxies between the internet and this app
//   (Render / Railway / Heroku / Nginx = 1, local dev = 0).
// Override with the TRUST_PROXY env variable.
app.set("trust proxy", Number(process.env["TRUST_PROXY"] ?? 1));

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

// /audit/log-export is public, so limit it to stop log spamming.
app.use("/api/audit", rateLimit({ windowMs: 60_000, limit: 20 }));

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