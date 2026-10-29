import assert from "node:assert/strict";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { mongoClient, pgPool } from "../dist/config/databases.js";

async function signIn(email, password) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password });
  assert.equal(response.status, 200);
  return agent;
}

test("Admin coverage matrix summarizes controls and other roles are denied", async () => {
  const admin = await signIn("admin1@docuguard.local", "DG-Demo-Admin-01!");
  const response = await admin.get("/api/compliance/coverage");
  assert.equal(response.status, 200);
  assert.ok(response.body.regulations.some(item => item.regulationName === "NABH"));
  assert.ok(response.body.controls.some(item => item.regulationName === "NABH" && item.controlCode === "EDU-01"));
  assert.ok(response.body.controls.every(item => typeof item.isCovered === "boolean"));

  const staff = await signIn("staff1@docuguard.local", "DG-Demo-Staff-01!");
  assert.equal((await staff.get("/api/compliance/coverage")).status, 403);
  assert.equal((await staff.get("/api/control-map")).status, 403);
});

test("control mapping creation is idempotent for an existing policy-control pair", async () => {
  const admin = await signIn("admin1@docuguard.local", "DG-Demo-Admin-01!");
  const pair = await pgPool.query(
    `SELECT dcm.document_id AS "documentId", dcm.control_id AS "controlId"
     FROM document_control_map dcm JOIN documents d ON d.document_id = dcm.document_id
     WHERE d.mongo_doc_id = 'demo-infection-control' ORDER BY dcm.control_id LIMIT 1`
  );
  assert.equal(pair.rowCount, 1);
  const response = await admin.post("/api/control-map").send(pair.rows[0]);
  assert.equal(response.status, 200);
  assert.equal(response.body.alreadyMapped, true);
});

afterAll(async () => {
  await pgPool.end();
  await mongoClient.close();
});
