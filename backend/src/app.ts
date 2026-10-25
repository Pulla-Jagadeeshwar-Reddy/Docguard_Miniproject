import express from "express";
import helmet from "helmet";
import { checkDatabases } from "./config/databases.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

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
