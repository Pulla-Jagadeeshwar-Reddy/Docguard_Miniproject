import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const mongoUri = process.env.MONGO_URI;
const mongoDbName = process.env.MONGO_DB;
const pgConfig = {
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5433),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  connectionTimeoutMillis: 5000
};
if (!mongoUri || !mongoDbName || !pgConfig.host || !pgConfig.database || !pgConfig.user || !pgConfig.password) {
  throw new Error('Set MONGO_URI, MONGO_DB, PG_HOST, PG_DATABASE, PG_USER and PG_PASSWORD in .env. Run SQL migrations first.');
}

const policyFiles = [
  { file: 'standard-precautions.md', pdf: 'standard-precautions-and-sharps-injury-response.pdf', mongoDocId: 'demo-infection-control', contentId: 'demo-content-infection-control-v1', category: 'Infection Control' },
  { file: 'patient-privacy.md', pdf: 'patient-information-privacy-and-minimum-necessary-access.pdf', mongoDocId: 'demo-patient-privacy', contentId: 'demo-content-patient-privacy-v1', category: 'Privacy' },
  { file: 'patient-identification.md', pdf: 'emergency-department-patient-identification.pdf', mongoDocId: 'demo-patient-identification', contentId: 'demo-content-patient-identification-v1', category: 'Patient Safety' },
  { file: 'hand-hygiene.md', pdf: 'hand-hygiene-for-clinical-staff.pdf', mongoDocId: 'demo-hand-hygiene', contentId: 'demo-content-hand-hygiene-v1', category: 'Infection Control' },
  { file: 'hand-hygiene-quick-reference.md', pdf: 'hand-hygiene-quick-reference.pdf', mongoDocId: 'demo-hand-hygiene-quick', contentId: 'demo-content-hand-hygiene-quick-v1', category: 'Infection Control' },
  { file: 'medication-safety.md', pdf: 'medication-safety-and-independent-checks.pdf', mongoDocId: 'demo-medication-safety', contentId: 'demo-content-medication-safety-v1', category: 'Medication Safety' },
  { file: 'biomedical-waste.md', pdf: 'biomedical-waste-segregation.pdf', mongoDocId: 'demo-biomedical-waste', contentId: 'demo-content-biomedical-waste-v1', category: 'Waste Management' },
  { file: 'emergency-code.md', pdf: 'emergency-code-and-incident-communication.pdf', mongoDocId: 'demo-emergency-code', contentId: 'demo-content-emergency-code-v1', category: 'Emergency Preparedness' },
  { file: 'visitor-access.md', pdf: 'visitor-access-and-conduct.pdf', mongoDocId: 'demo-visitor-access', contentId: 'demo-content-visitor-access-v1', category: 'Administration' },
  { file: 'retention-seven-year.md', pdf: 'records-retention-schedule-seven-year-example.pdf', mongoDocId: 'demo-retention-seven-year', contentId: 'demo-content-retention-seven-year-v1', category: 'Records Management' },
  { file: 'retention-ten-year.md', pdf: 'records-retention-schedule-ten-year-example.pdf', mongoDocId: 'demo-retention-ten-year', contentId: 'demo-content-retention-ten-year-v1', category: 'Records Management' },
  { file: 'backup-recovery.md', pdf: 'backup-and-disaster-recovery.pdf', mongoDocId: 'demo-backup-recovery', contentId: 'demo-content-backup-recovery-v1', category: 'Emergency Preparedness' }
];

function splitIntoChunks(text, maxWords = 300, overlapWords = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  const step = Math.max(1, maxWords - overlapWords);
  for (let start = 0; start < words.length; start += step) {
    const piece = words.slice(start, start + maxWords).join(' ').trim();
    if (piece) chunks.push(piece);
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}

function extractSections(text) {
  return text.split('\n').flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    return match ? [{ heading: match[2].trim(), level: match[1].length, line: index + 1 }] : [];
  });
}

function extractKeywords(text) {
  const stop = new Set(['about','after','also','been','being','each','from','have','into','more','must','only','other','should','that','their','there','these','they','this','through','under','using','when','where','which','with','would','your','shall','will','staff','policy','document']);
  const counts = new Map();
  for (const token of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (!stop.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25).map(([word]) => word);
}

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
const pg = new Pool(pgConfig);
try {
  const uploadDir = resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');
  await mkdir(uploadDir, { recursive: true });
  for (const policy of policyFiles) {
    await copyFile(
      resolve(process.cwd(), 'docs', 'demo-policies', 'files', 'pdf', policy.pdf),
      resolve(uploadDir, policy.pdf)
    );
  }

  await mongo.connect();
  const db = mongo.db(mongoDbName);
  const contents = db.collection('document_contents');
  const chunksCollection = db.collection('document_chunks');

  for (const policy of policyFiles) {
    const filePath = resolve(process.cwd(), 'docs', 'demo-policies', policy.file);
    const text = (await readFile(filePath, 'utf8')).trim();
    const title = text.split('\n').find((line) => line.startsWith('# '))?.slice(2).trim() ?? basename(policy.file, '.md');
    const sqlResult = await pg.query(
      `SELECT d.document_id, v.version_id, v.version_number
       FROM documents d
       JOIN document_versions v ON v.document_id = d.document_id
       WHERE d.mongo_doc_id = $1 AND v.mongo_content_id = $2 AND v.version_number = 1
       LIMIT 1`,
      [policy.mongoDocId, policy.contentId]
    );
    if (sqlResult.rowCount !== 1) {
      throw new Error(`No matching SQL document/version found for ${policy.file}. Run npm run db:apply first.`);
    }
    const { document_id: documentId, version_id: versionId, version_number: versionNumber } = sqlResult.rows[0];
    const chunkTexts = splitIntoChunks(text);
    const sections = extractSections(text);
    const now = new Date();
    const contentDoc = {
      _id: policy.contentId,
      versionId,
      documentId,
      category: policy.category,
      fileName: policy.pdf,
      mimeType: 'application/pdf',
      pageCount: 1,
      pages: [{ n: 1, text }],
      sections: sections.map((section) => ({ heading: section.heading, level: section.level, pageStart: 1, lineStart: section.line })),
      extracted: {
        keywords: extractKeywords(text),
        wordCount: text.split(/\s+/).filter(Boolean).length,
        language: 'en',
        tables: [],
        datesMentioned: []
      },
      createdAt: now,
      versionNumber
    };
    await contents.replaceOne({ _id: policy.contentId }, contentDoc, { upsert: true });
    await chunksCollection.deleteMany({ versionId });
    if (chunkTexts.length) {
      await chunksCollection.insertMany(chunkTexts.map((chunkText, chunkIndex) => ({
        _id: `${policy.mongoDocId}-v${versionNumber}-chunk-${chunkIndex}`,
        versionId,
        documentId,
        chunkIndex,
        heading: sections.at(-1)?.heading ?? title,
        page: 1,
        text: chunkText,
        tokenCount: chunkText.split(/\s+/).filter(Boolean).length
      })));
    }
    console.log(`Seeded ${policy.file}: ${chunkTexts.length} MongoDB chunk(s).`);
  }
  console.log('Synthetic policy content seeded. Run npm run db:embeddings to create local vectors.');
} finally {
  await pg.end();
  await mongo.close();
}
