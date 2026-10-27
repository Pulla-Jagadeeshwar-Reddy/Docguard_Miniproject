import type { PoolClient } from "pg";

export type AccessEvent = {
  userId: number;
  documentId: number;
  versionId: number | null;
  action: "view" | "download" | "upload" | "edit" | "approve";
  ip: string | null;
};

// Call inside the document transaction: the database trigger serializes and hashes this insert.
export async function logAccess(client: PoolClient, event: AccessEvent): Promise<number> {
  const result = await client.query(
    `INSERT INTO access_logs(user_id, document_id, version_id, action, ip_address)
     VALUES ($1, $2, $3, $4, $5) RETURNING log_id`,
    [event.userId, event.documentId, event.versionId, event.action, event.ip]
  );
  return result.rows[0].log_id;
}
