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

app.set("trust proxy", Number(process.env["TRUST_PROXY"] ?? 1));

// Attach the public IP to every request
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

// ...the rest of your code stays exactly the same