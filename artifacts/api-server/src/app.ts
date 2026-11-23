import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger as baseLogger } from "./lib/logger";
import { getPublicIp } from "./lib/clientIp";

declare module "express-serve-static-core" {
  interface Request {
    publicIp?: string | null;
  }
}

const app: Express = express();

// Number of proxies between the internet and this app.
// Render = 1, local dev = 0. Override with TRUST_PROXY.
app.set("trust proxy", Number(process.env["TRUST_PROXY"] ?? 1));

// Attach the client's public IP to every request
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.publicIp = getPublicIp(req);
  next();
});

app.use(
  pinoHttp({
    logger: baseLogger,
    serializers: {
      req: (req: Request) => ({
        method: req.method,
        url: req.url?.split("?")[0],
        ip: req.publicIp ?? "unknown",
      }),
      res: (res: Response) => ({
        statusCode: res.statusCode,
      }),
    },
  })
);

const allowedOrigins = process.env["CORS_ORIGIN"]
  ? process.env["CORS_ORIGIN"].split(",").map((o) => o.trim())
  : true;

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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