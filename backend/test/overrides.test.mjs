import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { pgPool } from "../dist/config/databases.js";

const requester = request.agent(app);
const reviewer = request.agent(app);
let documentId;
let overrideId;

async function getOrCreatePolicy() {
  const existing = await pgPool.query(
    `SELECT d.document_id AS id, d.current_version_id AS "currentVersionId",
            v.version_status AS "versionStatus", v.expiry_date AS "expiryDate"
     FROM documents d LEFT JOIN document_versions v ON v.version_id = d.current_version_id
     WHERE d.mongo_doc_id = 'phase6-breakglass-test-policy'`
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.versionStatus === "approved" && (!row.expiryDate || row.expiryDate >= new Date().toISOString().slice(0, 10))) return row.id;
    documentId = row.id;
  } else {
    const inserted = await pgPool.query(
      `INSERT INTO documents(title, category_id, owner_id, mongo_doc_id, document_status)
       SELECT 'Phase 6 synthetic emergency access policy', c.category_id, u.user_id,
              'phase6-breakglass-test-policy', 'active'
       FROM document_categories c CROSS JOIN users u
       WHERE c.category_name = 'Administration' AND u.email = 'admin1@docuguard.local'
       RETURNING document_id`,
    );
    documentId = inserted.rows[0].document_id;
  }

  const nextVersion = await pgPool.query(
    "SELECT COALESCE(max(version_number), 0)::integer + 1 AS next FROM document_versions WHERE document_id = $1",
    [documentId]
  );
  const suffix = randomUUID();
  const version = await pgPool.query(
    `INSERT INTO document_versions(
       document_id, version_number, file_path, mongo_content_id, checksum,
       uploaded_by, approved_by, approved_at, effective_date, expiry_date, version_status
     )
     SELECT $1, $2, $3, $4, $5, uploader.user_id, approver.user_id, now(), CURRENT_DATE,
            CURRENT_DATE + 365, 'approved'
     FROM users uploader CROSS JOIN users approver
     WHERE uploader.email = 'admin1@docuguard.local' AND approver.email = 'admin2@docuguard.local'
     RETURNING version_id`,
    [documentId, nextVersion.rows[0].next, `phase6-${suffix}.pdf`, `phase6-${suffix}`, suffix.replaceAll("-", "").padEnd(64, "0")]
  );
  await pgPool.query(
    "UPDATE documents SET current_version_id = $1, document_status = 'active' WHERE document_id = $2",
    [version.rows[0].version_id, documentId]
  );
  return documentId;
}

test("break-glass request atomically grants, audits, and notifies; Admin review closes it", async () => {
  assert.equal((await requester.post("/api/auth/login").send({
    email: "doctor1@docuguard.local", password: "DG-Demo-Doctor-01!"
  })).status, 200);
  assert.equal((await reviewer.post("/api/auth/login").send({
    email: "admin2@docuguard.local", password: "DG-Demo-Admin-02!"
  })).status, 200);
  documentId = await getOrCreatePolicy();

  const bad = await requester.post("/api/overrides").send({
    documentId, justification: "Too short", durationHours: 1
  });
  assert.equal(bad.status, 400);

  const created = await requester.post("/api/overrides").send({
    documentId,
    justification: "Urgent synthetic test: policy needed to verify emergency workflow.",
    durationHours: 24
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  overrideId = created.body.override.id;
  assert.equal(new Date(created.body.override.expiresAt) - new Date(created.body.override.grantedAt) <= 24 * 60 * 60 * 1000, true);

  const grant = await pgPool.query(
    "SELECT count(*)::integer AS count FROM fn_accessible_document_ids((SELECT user_id FROM users WHERE email = 'doctor1@docuguard.local')) WHERE document_id = $1",
    [documentId]
  );
  assert.equal(grant.rows[0].count, 1);
  const audit = await pgPool.query(
    "SELECT is_break_glass, override_id, row_hash FROM access_logs WHERE override_id = $1",
    [overrideId]
  );
  assert.equal(audit.rows[0].is_break_glass, true);
  assert.equal(audit.rows[0].override_id, overrideId);
  assert.equal(audit.rows[0].row_hash.trim().length, 64);
  const notices = await pgPool.query(
    "SELECT count(*)::integer AS count FROM notifications WHERE document_id = $1 AND notification_type = 'break_glass_review'",
    [documentId]
  );
  assert.equal(notices.rows[0].count >= 2, true);

  assert.equal((await requester.get("/api/overrides/pending")).status, 403);
  const queue = await reviewer.get("/api/overrides/pending");
  assert.equal(queue.status, 200);
  assert.equal(queue.body.requests.some(item => item.id === overrideId), true);

  const reviewed = await reviewer.post(`/api/overrides/${overrideId}/review`).send({ outcome: "justified" });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.request.outcome, "justified");
  const finalState = await pgPool.query(
    "SELECT status, review_outcome FROM access_overrides WHERE override_id = $1",
    [overrideId]
  );
  assert.equal(finalState.rows[0].status, "reviewed");
  assert.equal(finalState.rows[0].review_outcome, "justified");

  // The immutable access log FK requires these synthetic records to stay as audit evidence.
});

afterAll(async () => {
  // Access logs are append-only, so the synthetic policy and override are intentionally retained.
  await pgPool.end();
});
