import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// The workspace root owns the single .env file even when npm starts this package from backend/.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.BACKEND_PORT ?? 4000),
  pg: {
    host: required("PG_HOST"),
    port: Number(process.env.PG_PORT ?? 5432),
    database: required("PG_DATABASE"),
    user: required("PG_USER"),
    password: required("PG_PASSWORD")
  },
  mongoUri: required("MONGO_URI"),
  mongoDb: required("MONGO_DB"),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000"
};
