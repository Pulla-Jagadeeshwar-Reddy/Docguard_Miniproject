import { MongoClient } from "mongodb";
import { Pool } from "pg";
import { env } from "./env.js";

export const pgPool = new Pool({ ...env.pg, connectionTimeoutMillis: 3000 });
export const mongoClient = new MongoClient(env.mongoUri, { serverSelectionTimeoutMS: 3000 });

export async function checkDatabases(): Promise<{ postgres: boolean; mongo: boolean }> {
  const status = { postgres: false, mongo: false };
  try {
    await pgPool.query("SELECT 1");
    status.postgres = true;
  } catch {
    // Health response reports unavailable without exposing connection details.
  }
  try {
    await mongoClient.connect();
    await mongoClient.db(env.mongoDb).command({ ping: 1 });
    status.mongo = true;
  } catch {
    // Health response reports unavailable without exposing connection details.
  }
  return status;
}
