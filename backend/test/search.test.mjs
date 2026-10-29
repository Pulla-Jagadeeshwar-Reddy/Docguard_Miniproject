import assert from "node:assert/strict";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { mongoClient, pgPool } from "../dist/config/databases.js";

async function signedIn(email, password) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ email, password });
  assert.equal(login.status, 200);
  return agent;
}

test("semantic and hybrid search return snippets only from accessible approved policies", async () => {
  const nurse = await signedIn("nurse1@docuguard.local", "DG-Demo-Nurse-01!");
  const semantic = await nurse.get("/api/search?q=needle%20prick%20injury&type=semantic");
  assert.equal(semantic.status, 200);
  assert.ok(semantic.body.results.some(result => result.title.includes("Sharps Injury")));
  assert.ok(semantic.body.results.every(result => result.snippet.length > 0));

  const injection = await nurse.get(`/api/search?q=${encodeURIComponent("' OR 1=1 --")}&type=keyword`);
  assert.equal(injection.status, 200);
  assert.equal(injection.body.type, "keyword");
  assert.equal(JSON.stringify(injection.body).includes("Minimum Necessary Access"), false);
});

test("hybrid rank fusion returns permitted category results", async () => {
  const staff = await signedIn("staff1@docuguard.local", "DG-Demo-Staff-01!");
  const response = await staff.get("/api/search?q=patient%20privacy&type=hybrid");
  assert.equal(response.status, 200);
  assert.equal(response.body.type, "hybrid");
  assert.ok(response.body.results.some(result => result.title.includes("Privacy")));
  assert.equal(response.body.results.some(result => result.title.includes("Patient Identification")), false);
});

test("similar policies endpoint is authenticated and permission filtered", async () => {
  const anonymous = await request(app).get("/api/documents/1/similar");
  assert.equal(anonymous.status, 401);
  const staff = await signedIn("staff1@docuguard.local", "DG-Demo-Staff-01!");
  const source = await pgPool.query(
    `SELECT d.document_id FROM documents d WHERE d.mongo_doc_id = 'demo-patient-privacy' LIMIT 1`
  );
  assert.equal(source.rowCount, 1);
  const response = await staff.get(`/api/documents/${source.rows[0].document_id}/similar`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.similar));
  assert.equal(response.body.similar.some(row => row.title.includes("Patient Identification")), false);
});

afterAll(async () => {
  await pgPool.end();
  await mongoClient.close();
});
