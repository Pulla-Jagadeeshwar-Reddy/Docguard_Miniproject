import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB;
if (!uri || !dbName) throw new Error('MONGO_URI and MONGO_DB must be set in the repository .env file.');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

try {
  await client.connect();
  const db = client.db(dbName);
  await db.collection('document_contents').createIndexes([
    { key: { versionId: 1 }, name: 'uq_document_contents_version', unique: true },
    { key: { documentId: 1, category: 1 }, name: 'idx_document_contents_document_category' },
    { key: { 'extracted.keywords': 1 }, name: 'idx_document_contents_keywords' },
    { key: { category: 1 }, name: 'idx_document_contents_category' },
    { key: { createdAt: -1 }, name: 'idx_document_contents_created_at' }
  ]);
  await db.collection('document_chunks').createIndexes([
    { key: { versionId: 1, chunkIndex: 1 }, name: 'uq_document_chunks_version_index', unique: true },
    { key: { documentId: 1, versionId: 1 }, name: 'idx_document_chunks_document_version' },
    { key: { heading: 1 }, name: 'idx_document_chunks_heading' }
  ]);
  console.log(`MongoDB indexes ready for database "${dbName}".`);
} finally {
  await client.close();
}
