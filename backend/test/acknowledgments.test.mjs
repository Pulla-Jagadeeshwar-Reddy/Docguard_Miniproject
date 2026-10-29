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

test("Admin assignment and current-version acknowledgment flow is role scoped", async () => {
  const admin = await signIn("admin1@docuguard.local", "DG-Demo-Admin-01!");
  const nurse = await signIn("nurse1@docuguard.local", "DG-Demo-Nurse-01!");
  const source = await pgPool.query(
    `SELECT d.document_id AS "documentId", r.role_id AS "roleId"
     FROM documents d JOIN document_versions v ON v.version_id = d.current_version_id
     CROSS JOIN roles r
     WHERE d.mongo_doc_id = 'demo-infection-control' AND r.role_name = 'Nurse'`
  );
  assert.equal(source.rowCount, 1);
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const invalid = await admin.post("/api/assignments").send({
    documentId: source.rows[0].documentId, targetType: "role", targetRoleId: source.rows[0].roleId,
    targetDepartmentId: 1, dueDate
  });
  assert.equal(invalid.status, 400);

  let assignments = (await admin.get("/api/assignments")).body.assignments;
  let assignment = assignments.find(item => item.documentId === source.rows[0].documentId && item.targetRoleId === source.rows[0].roleId);
  if (!assignment) {
    const created = await admin.post("/api/assignments").send({
      documentId: source.rows[0].documentId, targetType: "role", targetRoleId: source.rows[0].roleId, dueDate
    });
    assert.equal(created.status, 201);
    assignment = created.body.assignment;
  }

  const mine = await nurse.get("/api/acknowledgments/mine");
  assert.equal(mine.status, 200);
  assert.ok(mine.body.policies.some(item => item.assignmentId === assignment.assignmentId));
  const acknowledged = await nurse.post("/api/acknowledgments").send({ assignmentId: assignment.assignmentId });
  assert.ok([200, 201].includes(acknowledged.status));
  const compliance = await admin.get("/api/compliance/acknowledgments");
  assert.equal(compliance.status, 200);
  assert.ok(Array.isArray(compliance.body.departments));
});

afterAll(async () => {
  await pgPool.end();
  await mongoClient.close();
});
