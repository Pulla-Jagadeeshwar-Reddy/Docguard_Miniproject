import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { extname, basename, join } from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { pgPool } from "../config/databases.js";
import { env } from "../config/env.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";
import { deleteIngested, ingestFile, ingestionIsTemporaryStub, queueEmbedding } from "../services/ingest.js";
import { logAccess } from "../services/audit.js";

const documentsRouter = Router();
const versionsRouter = Router();
const allowedTypes = new Map([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
]);

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    mkdir(env.uploadDir, { recursive: true })
      .then(() => callback(null, env.uploadDir))
      .catch(error => callback(error as Error, env.uploadDir));
  },
  filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 8 },
  fileFilter: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    if (allowedTypes.get(extension) !== file.mimetype) {
      callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    callback(null, true);
  }
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const uploadFields = z.object({
  title: z.string().trim().min(1).max(255),
  categoryId: z.coerce.number().int().positive(),
  effectiveDate: dateSchema,
  expiryDate: z.union([dateSchema, z.literal("")]).optional()
}).strict();
const idSchema = z.coerce.number().int().positive();

type UploadRequest = Request & {
  user: NonNullable<Request["user"]>;
  file?: Express.Multer.File;
};

documentsRouter.use(requireAuth);

documentsRouter.get("/categories", async (_request, response, next) => {
  try {
    const result = await pgPool.query("SELECT category_id AS id, category_name AS name FROM document_categories ORDER BY category_name");
    response.json({ categories: result.rows });
  } catch (error) { next(error); }
});

documentsRouter.get("/", async (request, response, next) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100) : "";
  const categoryId = request.query.categoryId === undefined ? null : idSchema.safeParse(request.query.categoryId);
  if (categoryId && !categoryId.success) {
    response.status(400).json({ error: "Invalid category id" });
    return;
  }
  try {
    const result = await pgPool.query(
      `SELECT d.document_id AS id, d.title, d.document_status AS status,
              d.created_at AS "createdAt", d.updated_at AS "updatedAt",
              c.category_id AS "categoryId", c.category_name AS category,
              v.version_id AS "currentVersionId", v.version_number AS "currentVersion",
              v.version_status AS "versionStatus", v.effective_date AS "effectiveDate",
              v.expiry_date AS "expiryDate", owner.full_name AS owner
       FROM documents d
       JOIN document_categories c ON c.category_id = d.category_id
       JOIN users owner ON owner.user_id = d.owner_id
       LEFT JOIN document_versions v ON v.version_id = d.current_version_id
       WHERE d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($1))
         AND ($2::text = '' OR d.title ILIKE '%' || $2 || '%')
         AND ($3::int IS NULL OR d.category_id = $3)
       ORDER BY d.updated_at DESC, d.document_id DESC`,
      [request.user!.id, q, categoryId?.success ? categoryId.data : null]
    );
    response.json({ documents: result.rows });
  } catch (error) { next(error); }
});

async function saveUpload(request: UploadRequest, response: Response, next: NextFunction, existingDocumentId: number | null) {
  const file = request.file;
  const parsed = uploadFields.safeParse(request.body);
  if (!file || !parsed.success) {
    if (file) await rm(file.path, { force: true });
    response.status(400).json({ error: "A PDF or DOCX file and valid policy details are required" });
    return;
  }

  const actor = request.user!;
  let mongoContentId: string | null = null;
  let transactionStarted = false;
  let client;
  try {
    const checksum = createHash("sha256").update(await readFile(file.path)).digest("hex");
    const exists = await pgPool.query("SELECT 1 FROM document_versions WHERE checksum = $1 LIMIT 1", [checksum]);
    if (exists.rowCount) {
      await rm(file.path, { force: true });
      response.status(409).json({ error: "This exact file has already been uploaded" });
      return;
    }

    let categoryName = "";
    const category = await pgPool.query("SELECT category_name FROM document_categories WHERE category_id = $1", [parsed.data.categoryId]);
    if (!category.rowCount) {
      await rm(file.path, { force: true });
      response.status(400).json({ error: "Unknown document category" });
      return;
    }
    categoryName = category.rows[0].category_name;

    if (existingDocumentId !== null) {
      const document = await pgPool.query(
        `SELECT d.document_id, d.title, d.owner_id
         FROM documents d
         WHERE d.document_id = $1
           AND ($2 = 'Admin' OR (
             d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($3))
             AND (d.owner_id = $3 OR EXISTS (
             SELECT 1 FROM document_permissions p
             WHERE p.document_id = d.document_id AND p.role_id = $4
               AND p.access_level IN ('write', 'admin') AND p.revoked_at IS NULL
             ))
           ))`,
        [existingDocumentId, actor.role, actor.id, actor.roleId]
      );
      if (!document.rowCount) {
        await rm(file.path, { force: true });
        response.status(404).json({ error: "Document not found" });
        return;
      }
    }

    const storedFileName = basename(file.filename);
    const ingested = await ingestFile(file.path, {
      documentId: existingDocumentId,
      title: parsed.data.title,
      category: categoryName,
      fileName: file.originalname,
      mimeType: file.mimetype
    });
    mongoContentId = ingested.mongoContentId;

    client = await pgPool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    // A per-checksum transaction lock closes the duplicate-check race between concurrent uploads.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [checksum]);
    const duplicate = await client.query("SELECT 1 FROM document_versions WHERE checksum = $1 LIMIT 1", [checksum]);
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      try { await deleteIngested(mongoContentId); }
      catch { console.warn("DocuGuard duplicate upload compensation failed; orphan sweeper will reconcile it"); }
      await rm(file.path, { force: true });
      response.status(409).json({ error: "This exact file has already been uploaded" });
      return;
    }

    let documentId = existingDocumentId;
    let versionNumber = 1;
    let embeddingQueued = false;
    if (documentId === null) {
      const created = await client.query(
        `INSERT INTO documents(title, category_id, owner_id, mongo_doc_id)
         VALUES ($1, $2, $3, $4) RETURNING document_id`,
        [parsed.data.title, parsed.data.categoryId, actor.id, ingested.mongoDocId]
      );
      documentId = created.rows[0].document_id;

      // New drafts are readable by Admin reviewers and by the role that submitted them.
      const adminRole = await client.query("SELECT role_id FROM roles WHERE role_name = 'Admin'");
      const roles = new Set<number>([actor.roleId, adminRole.rows[0].role_id]);
      for (const roleId of roles) {
        await client.query(
          `INSERT INTO document_permissions(document_id, role_id, access_level, granted_by)
           VALUES ($1, $2, 'read', $3) ON CONFLICT (document_id, role_id, access_level) DO NOTHING`,
          [documentId, roleId, actor.id]
        );
      }
    } else {
      await client.query("SELECT document_id FROM documents WHERE document_id = $1 FOR UPDATE", [documentId]);
      const next = await client.query("SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM document_versions WHERE document_id = $1", [documentId]);
      versionNumber = next.rows[0].next;
      await client.query("UPDATE documents SET document_status = 'under_review' WHERE document_id = $1", [documentId]);
    }

    if (documentId === null) throw new Error("Document creation did not return an id");

    const version = await client.query(
      `INSERT INTO document_versions(
         document_id, version_number, file_path, mongo_content_id, checksum,
         uploaded_by, effective_date, expiry_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING version_id, version_number, version_status`,
      [documentId, versionNumber, storedFileName, ingested.mongoContentId, checksum,
       actor.id, parsed.data.effectiveDate, parsed.data.expiryDate || null]
    );
    await logAccess(client, { userId: actor.id, documentId, versionId: version.rows[0].version_id, action: "upload", ip: request.ip ?? null });
    await client.query("COMMIT");
    transactionStarted = false;
    try { await queueEmbedding(version.rows[0].version_id); embeddingQueued = true; }
    catch { console.warn("DocuGuard embedding queue unavailable after committed upload"); }

    response.status(201).json({
      documentId,
      title: existingDocumentId === null ? parsed.data.title : undefined,
      versionId: version.rows[0].version_id,
      versionNumber: version.rows[0].version_number,
      versionStatus: version.rows[0].version_status,
      checksum,
      ingestionPending: ingestionIsTemporaryStub || ingested.chunkCount === 0 || !embeddingQueued
    });
  } catch (error) {
    if (client && transactionStarted) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    }
    if (mongoContentId) {
      try { await deleteIngested(mongoContentId); }
      catch { console.warn("DocuGuard upload compensation failed; orphan sweeper will reconcile it"); }
    }
    await rm(file.path, { force: true });
    next(error);
  } finally {
    client?.release();
  }
}

documentsRouter.post("/", requireRole("Admin", "Doctor"), upload.single("file"), (request, response, next) => {
  void saveUpload(request as UploadRequest, response, next, null);
});

documentsRouter.get("/:id", async (request, response, next) => {
  const id = idSchema.safeParse(request.params.id);
  if (!id.success) { response.status(400).json({ error: "Invalid document id" }); return; }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT d.document_id AS id, d.title, d.document_status AS status,
              d.created_at AS "createdAt", d.updated_at AS "updatedAt",
              c.category_id AS "categoryId", c.category_name AS category,
              owner.full_name AS owner, d.current_version_id AS "currentVersionId",
              COALESCE(d.current_version_id, (SELECT v.version_id FROM document_versions v WHERE v.document_id = d.document_id ORDER BY v.version_number DESC LIMIT 1)) AS "accessVersionId",
              EXISTS (
                SELECT 1 FROM document_versions ingest_version
                WHERE ingest_version.version_id = COALESCE(
                  d.current_version_id,
                  (SELECT v.version_id FROM document_versions v WHERE v.document_id = d.document_id ORDER BY v.version_number DESC LIMIT 1)
                ) AND ingest_version.mongo_content_id LIKE 'stub-%'
              ) AS "ingestionPending"
       FROM documents d
       JOIN document_categories c ON c.category_id = d.category_id
       JOIN users owner ON owner.user_id = d.owner_id
       WHERE d.document_id = $1
         AND d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($2))`,
      [id.data, request.user!.id]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Document not found" });
      return;
    }
    const document = result.rows[0];
    const versions = await client.query(
      `SELECT version_id AS id, version_number AS "versionNumber", version_status AS status,
              uploaded_at AS "uploadedAt", effective_date AS "effectiveDate", expiry_date AS "expiryDate",
              uploader.full_name AS "uploadedBy", approver.full_name AS "approvedBy", approved_at AS "approvedAt"
       FROM document_versions v JOIN users uploader ON uploader.user_id = v.uploaded_by
       LEFT JOIN users approver ON approver.user_id = v.approved_by
       WHERE v.document_id = $1 ORDER BY v.version_number DESC`, [id.data]
    );
    await logAccess(client, { userId: request.user!.id, documentId: id.data, versionId: document.accessVersionId, action: "view", ip: request.ip ?? null });
    await client.query("COMMIT");
    const ingestionPending = document.ingestionPending;
    delete document.accessVersionId;
    delete document.ingestionPending;
    response.json({ document, versions: versions.rows, ingestionPending });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    next(error);
  } finally { client.release(); }
});

documentsRouter.post("/:id/versions", requireRole("Admin", "Doctor"), upload.single("file"), (request, response, next) => {
  const id = idSchema.safeParse(request.params.id);
  if (!id.success) {
    if (request.file) void rm(request.file.path, { force: true });
    response.status(400).json({ error: "Invalid document id" });
    return;
  }
  void saveUpload(request as UploadRequest, response, next, id.data);
});

documentsRouter.post("/versions/:versionId/approve", requirePermission("DOCUMENT_APPROVE"), async (request, response, next) => {
  const id = idSchema.safeParse(request.params.versionId);
  if (!id.success) { response.status(400).json({ error: "Invalid version id" }); return; }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE document_versions
       SET approved_by = $1, approved_at = now(), version_status = 'approved'
       WHERE version_id = $2 AND version_status = 'pending_review' AND uploaded_by <> $1
       RETURNING version_id, document_id, version_number, version_status`,
      [request.user!.id, id.data]
    );
    if (!result.rowCount) {
      const owner = await client.query("SELECT uploaded_by FROM document_versions WHERE version_id = $1", [id.data]);
      await client.query("ROLLBACK");
      response.status(owner.rowCount && owner.rows[0].uploaded_by === request.user!.id ? 403 : 409).json({
        error: owner.rowCount && owner.rows[0].uploaded_by === request.user!.id ? "You cannot approve a version you uploaded" : "Version is not pending review"
      });
      return;
    }
    const approved = result.rows[0];
    await logAccess(client, { userId: request.user!.id, documentId: approved.document_id, versionId: approved.version_id, action: "approve", ip: request.ip ?? null });
    await client.query("COMMIT");
    response.json({ versionId: approved.version_id, versionNumber: approved.version_number, status: approved.version_status });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    next(error);
  } finally { client.release(); }
});

versionsRouter.use(requireAuth);
versionsRouter.get("/:versionId/file", async (request, response, next) => {
  const id = idSchema.safeParse(request.params.versionId);
  if (!id.success) { response.status(400).json({ error: "Invalid version id" }); return; }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT v.version_id, v.document_id, v.version_number, v.file_path, d.title
       FROM document_versions v JOIN documents d ON d.document_id = v.document_id
       WHERE v.version_id = $1
         AND d.document_id IN (SELECT document_id FROM fn_accessible_document_ids($2))`,
      [id.data, request.user!.id]
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK"); response.status(404).json({ error: "Document version not found" }); return;
    }
    const row = found.rows[0];
    const safeName = basename(row.file_path);
    if (safeName !== row.file_path) {
      await client.query("ROLLBACK"); response.status(404).json({ error: "Document file not found" }); return;
    }
    const filePath = join(env.uploadDir, safeName);
    await readFile(filePath);
    await logAccess(client, { userId: request.user!.id, documentId: row.document_id, versionId: row.version_id, action: "download", ip: request.ip ?? null });
    await client.query("COMMIT");
    const extension = extname(safeName);
    const downloadName = `${String(row.title).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "policy"}-v${row.version_number}${extension}`;
    response.download(filePath, downloadName, error => { if (error && !response.headersSent) next(error); });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      response.status(404).json({ error: "Document file not found" });
    } else next(error);
  } finally { client.release(); }
});

export { documentsRouter, versionsRouter };
