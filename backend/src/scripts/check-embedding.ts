import { embedText } from "../services/ingest.js";
import { mongoClient, pgPool } from "../config/databases.js";

try {
  const vector = await embedText("needle prick sharps injury response");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (vector.length !== 384 || !vector.every(Number.isFinite) || Math.abs(norm - 1) > 0.01) {
    throw new Error(`Expected a normalized 384-value embedding; received ${vector.length} values with norm ${norm}`);
  }
  console.log(`Local embedding passed: dimensions=${vector.length}, norm=${norm.toFixed(4)}`);
} finally {
  await pgPool.end();
  await mongoClient.close();
}
