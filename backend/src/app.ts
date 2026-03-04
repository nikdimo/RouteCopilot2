import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { corsAllowedOrigins, env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";

export const app = express();
const allowedOrigins = new Set(corsAllowedOrigins.map((origin) => origin.toLowerCase()));
const allowAllOrigins = allowedOrigins.has("*");
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (allowAllOrigins || !origin) {
        return callback(null, true);
      }
      if (allowedOrigins.has(origin.toLowerCase())) {
        return callback(null, true);
      }
      return callback(null, false);
    }
  })
);
app.use(morgan("combined"));
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  })
);

app.get("/healthz", (_req, res) => {
  return res.json({
    ok: true,
    service: "wiseplan-backend",
    authMode: env.AUTH_MODE
  });
});

app.use(env.API_BASE_PATH, apiRouter);

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.originalUrl
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled backend error:", error);
  res.status(500).json({
    error: "Internal server error"
  });
});
