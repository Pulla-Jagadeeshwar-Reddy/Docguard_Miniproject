import assert from "node:assert/strict";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { pgPool } from "../dist/config/databases.js";

const message = "Phase 4 notification isolation test";
let notificationId;
const admin = request.agent(app);
const nurse = request.agent(app);

test("notification inbox is authenticated, user-scoped, and supports read state", async () => {
  assert.equal((await request(app).get("/api/notifications")).status, 401);
  assert.equal((await admin.post("/api/auth/login").send({
    email: "admin1@docuguard.local", password: "DG-Demo-Admin-01!"
  })).status, 200);
  assert.equal((await nurse.post("/api/auth/login").send({
    email: "nurse1@docuguard.local", password: "DG-Demo-Nurse-01!"
  })).status, 200);

  const inserted = await pgPool.query(
    `INSERT INTO notifications(user_id, notification_type, message)
     SELECT user_id, 'expiry_warning', $1 FROM users WHERE email = $2
     RETURNING notification_id`,
    [message, "admin1@docuguard.local"]
  );
  notificationId = inserted.rows[0].notification_id;

  const adminInbox = await admin.get("/api/notifications");
  assert.equal(adminInbox.status, 200);
  assert.equal(adminInbox.body.unreadCount >= 1, true);
  assert.equal(adminInbox.body.notifications.some(item => item.id === notificationId), true);

  const nurseInbox = await nurse.get("/api/notifications");
  assert.equal(nurseInbox.status, 200);
  assert.equal(nurseInbox.body.notifications.some(item => item.id === notificationId), false);
  assert.equal((await nurse.patch(`/api/notifications/${notificationId}/read`)).status, 404);

  const marked = await admin.patch(`/api/notifications/${notificationId}/read`);
  assert.equal(marked.status, 200);
  assert.equal(marked.body.notification.isRead, true);
  assert.equal((await admin.patch("/api/notifications/read-all")).status, 200);
});

afterAll(async () => {
  await pgPool.query("DELETE FROM notifications WHERE message = $1", [message]);
  await pgPool.end();
});
