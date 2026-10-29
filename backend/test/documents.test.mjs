import assert from "node:assert/strict";
import { afterAll, test } from "@jest/globals";
import request from "supertest";
import { app } from "../dist/app.js";
import { mongoClient, pgPool } from "../dist/config/databases.js";

function minimalPdf(label = "DocuGuard policy test file") {
  const stream = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(content, "binary"));
    content += object;
  }
  const xrefOffset = Buffer.byteLength(content, "binary");
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(content, "binary");
}

const pdf = minimalPdf();
const nextPdf = minimalPdf("DocuGuard updated policy test file");
const recoveryPdf = minimalPdf("DocuGuard recovery policy test file");
const policyTitle = "Automated Phase 3 document flow fixture";

test("upload, access, approval and audit APIs preserve permissions and workflow", async () => {
  const uploader = request.agent(app);
  const reviewer = request.agent(app);
  const nurse = request.agent(app);
  assert.equal((await uploader.post("/api/auth/login").send({ email: "admin1@docuguard.local", password: "DG-Demo-Admin-01!" })).status, 200);
  assert.equal((await reviewer.post("/api/auth/login").send({ email: "admin2@docuguard.local", password: "DG-Demo-Admin-02!" })).status, 200);
  assert.equal((await nurse.post("/api/auth/login").send({ email: "nurse1@docuguard.local", password: "DG-Demo-Nurse-01!" })).status, 200);

  const categories = await uploader.get("/api/documents/categories");
  assert.equal(categories.status, 200);
  const category = categories.body.categories[0];
  const unsupported = await uploader.post("/api/documents")
    .field("title", policyTitle)
    .field("categoryId", String(category.id))
    .field("effectiveDate", "2026-10-27")
    .attach("file", Buffer.from("not a policy file"), { filename: "payload.exe", contentType: "application/octet-stream" });
  assert.equal(unsupported.status, 400);
  const sendUpload = () => uploader.post("/api/documents")
    .field("title", policyTitle)
    .field("categoryId", String(category.id))
    .field("effectiveDate", "2026-10-27")
    .attach("file", pdf, { filename: "policy.pdf", contentType: "application/pdf" });

  let created = await sendUpload();
  let documentId;
  if (created.status === 201) documentId = created.body.documentId;
  else {
    // Audit rows are intentionally immutable, so the fixed fixture remains in the local demo DB.
    // Re-running the test should find and verify its existing policy instead of creating a duplicate.
    assert.equal(created.status, 409);
    const existing = await uploader.get(`/api/documents?q=${encodeURIComponent(policyTitle)}`);
    documentId = existing.body.documents.find(row => row.title === policyTitle)?.id;
  }
  assert.ok(documentId, "uploaded fixture must be visible to its permitted role");

  const visible = await uploader.get(`/api/documents?q=${encodeURIComponent(policyTitle)}`);
  assert.equal(visible.status, 200);
  assert.ok(visible.body.documents.some(row => row.id === documentId));
  const hiddenFromNurse = await nurse.get(`/api/documents?q=${encodeURIComponent(policyTitle)}`);
  assert.equal(hiddenFromNurse.status, 200);
  assert.equal(hiddenFromNurse.body.documents.some(row => row.id === documentId), false);

  let detail = await uploader.get(`/api/documents/${documentId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.document.title, policyTitle);
  assert.equal(typeof detail.body.ingestionPending, "boolean");
  assert.ok(detail.body.versions.length >= 1);
  const version = detail.body.versions[0];
  const download = await uploader.get(`/api/versions/${version.id}/file`);
  assert.equal(download.status, 200);
  assert.match(download.headers["content-disposition"], /attachment/);

  const mongoContentsBeforeDuplicate = await mongoClient.db(process.env.MONGO_DB).collection("document_contents")
    .countDocuments({ title: policyTitle });
  const duplicate = await sendUpload();
  assert.equal(duplicate.status, 409);
  const mongoContentsAfterDuplicate = await mongoClient.db(process.env.MONGO_DB).collection("document_contents")
    .countDocuments({ title: policyTitle });
  assert.equal(mongoContentsAfterDuplicate, mongoContentsBeforeDuplicate,
    "Mongo content written before the duplicate SQL check must be compensated");

  const firstVersion = detail.body.versions.find(item => item.versionNumber === 1);
  if (firstVersion?.status === "pending_review") {
    const selfApproval = await uploader.post(`/api/documents/versions/${firstVersion.id}/approve`);
    assert.equal(selfApproval.status, 403);
    const approval = await reviewer.post(`/api/documents/versions/${firstVersion.id}/approve`);
    assert.equal(approval.status, 200);
  }
  detail = await uploader.get(`/api/documents/${documentId}`);

  let latestVersion = detail.body.versions[0];
  if (latestVersion.status === "superseded") {
    const versionUpload = await uploader.post(`/api/documents/${documentId}/versions`)
      .field("title", policyTitle)
      .field("categoryId", String(category.id))
      .field("effectiveDate", "2026-10-27")
      .attach("file", recoveryPdf, { filename: "policy-recovery.pdf", contentType: "application/pdf" });
    assert.ok([201, 409].includes(versionUpload.status));
    detail = await uploader.get(`/api/documents/${documentId}`);
    latestVersion = detail.body.versions[0];
  } else if (latestVersion.versionNumber === 1) {
    const versionUpload = await uploader.post(`/api/documents/${documentId}/versions`)
      .field("title", policyTitle)
      .field("categoryId", String(category.id))
      .field("effectiveDate", "2026-10-27")
      .attach("file", nextPdf, { filename: "policy-v2.pdf", contentType: "application/pdf" });
    assert.ok([201, 409].includes(versionUpload.status));
    detail = await uploader.get(`/api/documents/${documentId}`);
    latestVersion = detail.body.versions[0];
  }
  assert.ok(latestVersion.versionNumber >= 2, "a replacement policy version must exist");

  if (latestVersion.status === "pending_review") {
    const selfApproval = await uploader.post(`/api/documents/versions/${latestVersion.id}/approve`);
    assert.equal(selfApproval.status, 403);
    const approval = await reviewer.post(`/api/documents/versions/${latestVersion.id}/approve`);
    assert.equal(approval.status, 200);
    assert.equal(approval.body.status, "approved");
  }

  const updatedDetail = await uploader.get(`/api/documents/${documentId}`);
  assert.equal(updatedDetail.body.document.status, "active");
  assert.equal(updatedDetail.body.versions[0].status, "approved");
  assert.equal(updatedDetail.body.document.currentVersionId, updatedDetail.body.versions[0].id);
  assert.equal(updatedDetail.body.versions.find(item => item.versionNumber === 1).status, "superseded");
  const logs = await reviewer.get("/api/audit/logs?action=upload&limit=100");
  assert.equal(logs.status, 200);
  assert.ok(logs.body.logs.some(item => item.documentId === documentId));
  const verification = await reviewer.post("/api/audit/verify");
  assert.equal(verification.status, 200);
  assert.equal(verification.body.check.result, "intact");
  const history = await reviewer.get("/api/audit/logs");
  assert.ok(history.body.integrityChecks.length >= 1);
});

afterAll(async () => {
  await pgPool.end();
  await mongoClient.close();
});
