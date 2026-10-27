import assert from "node:assert/strict";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { pgPool } from "../dist/config/databases.js";

const admin = request.agent(app);
const nurse = request.agent(app);
const documentIds = [];

test("dashboard returns status, expiry, and permitted activity data", async () => {
  assert.equal((await admin.post("/api/auth/login").send({
    email: "admin1@docuguard.local", password: "DG-Demo-Admin-01!"
  })).status, 200);
  assert.equal((await nurse.post("/api/auth/login").send({
    email: "nurse1@docuguard.local", password: "DG-Demo-Nurse-01!"
  })).status, 200);
  assert.equal((await request(app).get("/api/dashboard")).status, 401);

  const adminDashboard = await admin.get("/api/dashboard");
  assert.equal(adminDashboard.status, 200);
  assert.ok(Array.isArray(adminDashboard.body.documentStatuses));
  assert.ok(Array.isArray(adminDashboard.body.expiringSoon));
  assert.ok(Array.isArray(adminDashboard.body.accessActivity));

  const nurseDashboard = await nurse.get("/api/dashboard");
  assert.equal(nurseDashboard.status, 200);
  assert.ok(Array.isArray(nurseDashboard.body.expiringSoon));
});

test("dependency impact and graph terminate across a three-document cycle", async () => {
  assert.equal((await request(app).post("/api/documents/1/references").send({ targetDocumentId: 2 })).status, 401);
  assert.equal((await nurse.get("/api/documents/1/impact")).status, 403);

  for (const title of ["Graph test A", "Graph test B", "Graph test C"]) {
    const result = await pgPool.query(
      `INSERT INTO documents(title, category_id, owner_id, mongo_doc_id)
       SELECT $1, c.category_id, u.user_id, $2
       FROM document_categories c CROSS JOIN users u
       WHERE c.category_name = 'Administration' AND u.email = 'admin1@docuguard.local'
       RETURNING document_id`,
      [title, `phase5-graph-${Date.now()}-${documentIds.length}`]
    );
    documentIds.push(result.rows[0].document_id);
  }

  const [a, b, c] = documentIds;
  assert.equal((await admin.post(`/api/documents/${a}/references`).send({ targetDocumentId: b, referenceType: "depends_on" })).status, 201);
  assert.equal((await admin.post(`/api/documents/${b}/references`).send({ targetDocumentId: c, referenceType: "depends_on" })).status, 201);
  assert.equal((await admin.post(`/api/documents/${c}/references`).send({ targetDocumentId: a, referenceType: "depends_on" })).status, 201);

  const impact = await admin.get(`/api/documents/${a}/impact`);
  assert.equal(impact.status, 200);
  assert.deepEqual(impact.body.impactedDocuments.map(item => item.id).sort((x, y) => x - y), [b, c].sort((x, y) => x - y));

  const graph = await admin.get(`/api/documents/${a}/graph`);
  assert.equal(graph.status, 200);
  assert.equal(graph.body.nodes.length, 3);
  assert.equal(graph.body.edges.length, 3);
});

afterAll(async () => {
  if (documentIds.length) {
    await pgPool.query(
      "DELETE FROM document_references WHERE source_document_id = ANY($1::integer[]) OR target_document_id = ANY($1::integer[])",
      [documentIds]
    );
    await pgPool.query("DELETE FROM documents WHERE document_id = ANY($1::integer[])", [documentIds]);
  }
  await pgPool.end();
});
