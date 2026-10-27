import { pgPool } from "../config/databases.js";

// A transaction-scoped advisory lock prevents two API instances sweeping the same day together.
export async function runExpirySweep(): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [73104, 1]);
    const result = await client.query(
      "SELECT fn_expire_overrides() AS overrides_expired, fn_expiry_sweep() AS versions_and_warnings"
    );
    await client.query("COMMIT");
    console.info("Policy expiry sweep completed", result.rows[0]);
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    // Avoid logging database error details; failures can be diagnosed in local development separately.
    console.error("Policy expiry sweep failed");
  } finally {
    client.release();
  }
}

export function scheduleExpirySweep(): void {
  void runExpirySweep();
  const interval = setInterval(() => void runExpirySweep(), 24 * 60 * 60 * 1000);
  interval.unref();
}
