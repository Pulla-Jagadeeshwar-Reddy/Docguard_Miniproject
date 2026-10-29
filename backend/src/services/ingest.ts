import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pipeline } from "@huggingface/transformers";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { mongoClient, pgPool } from "../config/databases.js";
import { env } from "../config/env.js";

export type IngestMetadata = {
  documentId: number | null;
  mongoDocId?: string;
  title: string;
  category: string;
  fileName: string;
  mimeType: string;
};

export type IngestResult = {
  mongoDocId: string;
  mongoContentId: string;
  chunkCount: number;
};

export const ingestionIsTemporaryStub = false;

type Section = { heading: string; level: number; line: number; text: string };
type MongoContentDocument = { _id: string; mongoDocId: string; versionId: number | null; documentId: number | null; [key: string]: unknown };
type MongoTextChunk = { _id: string; contentId: string; versionId: number | null; documentId: number | null; chunkIndex: number; text: string; [key: string]: unknown };

function splitIntoChunks(text: string, sections: Section[], maxWords = 300, overlapWords = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const step = maxWords - overlapWords;
  const chunks: Array<{ text: string; heading: string; tokenCount: number; chunkIndex: number }> = [];
  for (let start = 0; start < words.length; start += step) {
    const piece = words.slice(start, start + maxWords).join(" ").trim();
    if (piece) {
      const heading = sections.find(section => section.text.includes(words[start]))?.heading ?? "Document";
      chunks.push({ text: piece, heading, tokenCount: words.slice(start, start + maxWords).length, chunkIndex: chunks.length });
    }
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}

function keywords(text: string): string[] {
  const stop = new Set(["about", "after", "also", "been", "being", "each", "from", "have", "into", "more", "must", "only", "other", "should", "that", "their", "there", "these", "they", "this", "through", "under", "using", "when", "where", "which", "with", "would", "your", "shall", "will", "staff", "policy", "document"]);
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (!stop.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([word]) => word);
}

async function extractText(path: string): Promise<{ text: string; pages: Array<{ n: number; text: string }> }> {
  const extension = extname(path).toLowerCase();
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path });
    const text = result.value.trim();
    if (!text) throw new Error("The DOCX file contains no extractable text");
    return { text, pages: [{ n: 1, text }] };
  }
  if (extension !== ".pdf") throw new Error("Only PDF and DOCX ingestion is supported");

  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: Array<{ n: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    pages.push({ n: pageNumber, text });
  }
  const text = pages.map(page => page.text).filter(Boolean).join("\n\n");
  if (!text) throw new Error("The PDF contains no extractable text; scanned-image OCR is not supported");
  return { text, pages };
}

function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let heading = "Document";
  let level = 1;
  let startLine = 1;
  let lines: string[] = [];
  const flush = () => {
    sections.push({ heading, level, line: startLine, text: lines.join(" ").trim() });
    lines = [];
  };
  text.split(/\r?\n/).forEach((line, index) => {
    const markdown = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const numbered = line.match(/^\s*(?:\d+(?:\.\d+)*[.)]?|[A-Z][.)])\s+(.{4,100})$/);
    if (markdown || numbered) {
      if (lines.length) flush();
      heading = (markdown?.[2] ?? numbered?.[1] ?? "Document").trim();
      level = markdown?.[1].length ?? 2;
      startLine = index + 1;
    } else {
      lines.push(line.trim());
    }
  });
  if (lines.length || sections.length === 0) flush();
  return sections.filter(section => section.text || section.heading !== "Document");
}

export async function ingestFile(path: string, meta: IngestMetadata): Promise<IngestResult> {
  const { text, pages } = await extractText(path);
  const sections = parseSections(text);
  const chunks = splitIntoChunks(text, sections);
  const mongoDocId = meta.mongoDocId ?? randomUUID();
  const mongoContentId = randomUUID();
  await mongoClient.connect();
  const db = mongoClient.db(env.mongoDb);
  const now = new Date();
  try {
    await db.collection<MongoContentDocument>("document_contents").insertOne({
      _id: mongoContentId,
      mongoDocId,
      documentId: meta.documentId,
      versionId: null,
      category: meta.category,
      title: meta.title,
      fileName: basename(meta.fileName),
      mimeType: meta.mimeType,
      pageCount: pages.length,
      pages,
      sections: sections.map(section => ({ heading: section.heading, level: section.level, pageStart: 1, lineStart: section.line })),
      extracted: { keywords: keywords(text), wordCount: text.split(/\s+/).filter(Boolean).length, language: "en", tables: [], datesMentioned: [] },
      createdAt: now
    });
    if (chunks.length) {
      await db.collection<MongoTextChunk>("document_chunks").insertMany(chunks.map(chunk => ({
        _id: randomUUID(), contentId: mongoContentId, documentId: meta.documentId, versionId: null,
        chunkIndex: chunk.chunkIndex, heading: chunk.heading, page: 1, text: chunk.text,
        tokenCount: chunk.tokenCount, createdAt: now
      })));
    }
    return { mongoDocId, mongoContentId, chunkCount: chunks.length };
  } catch (error) {
    await deleteIngested(mongoContentId).catch(() => undefined);
    throw error;
  }
}

/** Link Mongo content to SQL-generated ids before the upload transaction commits. */
export async function linkIngested(mongoContentId: string, mongoDocId: string, documentId: number, versionId: number): Promise<void> {
  await mongoClient.connect();
  const db = mongoClient.db(env.mongoDb);
  const updated = await db.collection<MongoContentDocument>("document_contents").updateOne(
    { _id: mongoContentId }, { $set: { mongoDocId, documentId, versionId } }
  );
  if (updated.matchedCount !== 1) throw new Error("Ingested Mongo content disappeared before it could be linked");
  await db.collection<MongoTextChunk>("document_chunks").updateMany(
        { contentId: mongoContentId }, { $set: { mongoDocId, documentId, versionId } }
  );
}

export async function deleteIngested(mongoContentId: string): Promise<void> {
  await mongoClient.connect();
  const db = mongoClient.db(env.mongoDb);
  await db.collection<MongoTextChunk>("document_chunks").deleteMany({ contentId: mongoContentId });
  await db.collection<MongoContentDocument>("document_contents").deleteOne({ _id: mongoContentId });
}

/** Remove old content whose compensating delete failed after a SQL rollback. */
export async function sweepOrphanedIngestions(): Promise<number> {
  await mongoClient.connect();
  const contents = mongoClient.db(env.mongoDb).collection<MongoContentDocument>("document_contents");
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const candidates = await contents.find({ createdAt: { $lt: cutoff } }, { projection: { _id: 1 } }).toArray();
  if (!candidates.length) return 0;
  const ids = candidates.map(row => row._id);
  const linked = await pgPool.query(
    "SELECT mongo_content_id FROM document_versions WHERE mongo_content_id = ANY($1::varchar[])", [ids]
  );
  const existingIds = new Set<string>(linked.rows.map(row => String(row.mongo_content_id)));
  const orphanIds = ids.filter(id => !existingIds.has(id));
  if (!orphanIds.length) return 0;
  const db = mongoClient.db(env.mongoDb);
  await db.collection<MongoTextChunk>("document_chunks").deleteMany({ contentId: { $in: orphanIds } });
  const removed = await contents.deleteMany({ _id: { $in: orphanIds } });
  return removed.deletedCount;
}

export function scheduleOrphanedIngestionSweep(): void {
  const run = () => {
    void sweepOrphanedIngestions().then(removed => {
      if (removed) console.info(`DocuGuard orphan sweep removed ${removed} unlinked Mongo content record(s)`);
    }).catch(() => console.warn("DocuGuard Mongo orphan sweep failed; it will retry later"));
  };
  setTimeout(run, 60 * 60 * 1000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

type FeatureExtractor = (input: string, options: { pooling: "mean"; normalize: true }) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<FeatureExtractor> | null = null;
function getExtractor(): Promise<FeatureExtractor> {
  extractor ??= pipeline("feature-extraction", process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" }) as unknown as Promise<FeatureExtractor>;
  return extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const vectors = (await (await getExtractor())(text, { pooling: "mean", normalize: true })).tolist();
  const vector = vectors[0];
  if (!vector || vector.length !== 384 || vector.some(value => !Number.isFinite(value))) {
    throw new Error("Embedding model must return exactly 384 finite values");
  }
  return vector;
}

export async function queueEmbedding(versionId: number): Promise<void> {
  await mongoClient.connect();
  const db = mongoClient.db(env.mongoDb);
  const chunks = await db.collection<MongoTextChunk>("document_chunks").find({ versionId }).sort({ chunkIndex: 1 }).toArray();
  if (!chunks.length) throw new Error(`No MongoDB text chunks exist for version ${versionId}`);
  const embed = await getExtractor();
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM document_chunks WHERE version_id = $1", [versionId]);
    for (const chunk of chunks) {
      const vector = await embedText(String(chunk.text));
      await client.query(
        `INSERT INTO document_chunks(version_id, chunk_index, mongo_chunk_id, embedding, tsv)
         VALUES ($1, $2, $3, $4::vector, to_tsvector('english', $5))`,
        [versionId, chunk.chunkIndex, String(chunk._id), `[${vector.join(",")}]`, chunk.text]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
