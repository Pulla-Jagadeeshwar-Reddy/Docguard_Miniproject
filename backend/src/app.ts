import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { checkDatabases } from "./config/databases.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { errorHandler } from "./middleware/errors.js";
import { env } from "./config/env.js";
import { searchRouter } from "./routes/search.js";
import { documentsRouter, versionsRouter } from "./routes/documents.js";
import { auditRouter } from "./routes/audit.js";
import { notificationsRouter } from "./routes/notifications.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === env.frontendOrigin) {
      callback(null, true);
    } else {
      callback(new Error("Origin not allowed"));
    }
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/search", searchRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/versions", versionsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/notifications", notificationsRouter);

app.get("/health", async (_request, response) => {
  const databases = await checkDatabases();
  const healthy = databases.postgres && databases.mongo;
  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    databases
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use(errorHandler);
