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
import { dashboardRouter } from "./routes/dashboard.js";
import { dependenciesRouter } from "./routes/dependencies.js";
import { overridesRouter } from "./routes/overrides.js";
import { similarRouter } from "./routes/similar.js";
import { analyticsRouter } from "./routes/analytics.js";
import { acknowledgmentsRouter, assignmentsRouter, complianceRouter } from "./routes/acknowledgments.js";
import { regulationsRouter, controlsRouter, mappingsRouter, coverageComplianceRouter } from "./routes/coverage.js";

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
app.use("/api/dashboard", dashboardRouter);
app.use("/api/documents", dependenciesRouter);
app.use("/api/documents", similarRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/acknowledgments", acknowledgmentsRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/compliance", complianceRouter);
app.use("/api/regulations", regulationsRouter);
app.use("/api/controls", controlsRouter);
app.use("/api/control-map", mappingsRouter);
app.use("/api/compliance", coverageComplianceRouter);
app.use("/api/overrides", overridesRouter);

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
