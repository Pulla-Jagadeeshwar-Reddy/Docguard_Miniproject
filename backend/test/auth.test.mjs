import assert from "node:assert/strict";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { mongoClient, pgPool } from "../dist/config/databases.js";

const adminSession = request.agent(app);

test("health reports both databases connected", async () => {
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok", databases: { postgres: true, mongo: true } });
});

test("login errors are generic for unknown users and wrong passwords", async () => {
  const known = await request(app).post("/api/auth/login").send({
    email: "admin1@docuguard.local", password: "incorrect-password"
  });
  const unknown = await request(app).post("/api/auth/login").send({
    email: "nobody@docuguard.local", password: "incorrect-password"
  });
  assert.equal(known.status, 401);
  assert.deepEqual(known.body, { error: "Invalid email or password" });
  assert.deepEqual(unknown.body, known.body);
});

test("sessions authenticate and logout", async () => {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({
    email: "admin1@docuguard.local", password: "DG-Demo-Admin-01!"
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers["set-cookie"][0].includes("HttpOnly"), true);
  assert.equal(login.headers["set-cookie"][0].includes("docuguard_session"), true);

  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, "Admin");
  assert.equal("password_hash" in me.body.user, false);

  const logout = await agent.post("/api/auth/logout");
  assert.equal(logout.status, 204);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("user administration is permission-gated and never returns password hashes", async () => {
  const nurse = request.agent(app);
  await nurse.post("/api/auth/login").send({ email: "nurse1@docuguard.local", password: "DG-Demo-Nurse-01!" });
  assert.equal((await nurse.get("/api/users")).status, 403);

  await adminSession.post("/api/auth/login").send({ email: "admin1@docuguard.local", password: "DG-Demo-Admin-01!" });
  const response = await adminSession.get("/api/users");
  assert.equal(response.status, 200);
  assert.ok(response.body.users.length >= 8);
  assert.equal(JSON.stringify(response.body).includes("password_hash"), false);
  assert.equal(JSON.stringify(response.body).includes("$2a$"), false);
});

test("admin can create and update a user without exposing the password", async () => {
  const options = await adminSession.get("/api/users");
  const staffRole = options.body.roles.find(role => role.name === "Staff");
  assert.ok(staffRole);
  const email = `phase2-${Date.now()}@docuguard.local`;
  let createdId;
  try {
    const created = await adminSession.post("/api/users").send({
      fullName: "Phase Two Test User", email, password: "Temporary-Demo-Password-1!",
      roleId: staffRole.id, departmentId: null
    });
    assert.equal(created.status, 201);
    assert.equal("password_hash" in created.body.user, false);
    createdId = created.body.user.id;
    const updated = await adminSession.patch(`/api/users/${createdId}`).send({ accountStatus: "suspended" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.accountStatus, "suspended");
    assert.equal("password_hash" in updated.body.user, false);
  } finally {
    if (createdId) await pgPool.query("DELETE FROM users WHERE user_id = $1", [createdId]);
  }
});

afterAll(async () => {
  await pgPool.end();
  await mongoClient.close();
});
