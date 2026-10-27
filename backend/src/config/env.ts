import { config } from "dotenv";
import { resolve } from "node:path";
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
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
  isProduction: process.env.NODE_ENV === "production",
  uploadDir: resolve(fileURLToPath(new URL("../../../", import.meta.url)), process.env.UPLOAD_DIR ?? "uploads")
};

if (env.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long");
}
