import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http"; // Isang import lang dapat
import router from "./routes";
import { logger as baseLogger } from "./lib/logger"; // I-rename para hindi mag-conflict sa middleware

const app: Express = express();

// Gamitin ang pinoHttp middleware nang tama
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

app.use(cors({ origin: true, credentials: true }));
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
