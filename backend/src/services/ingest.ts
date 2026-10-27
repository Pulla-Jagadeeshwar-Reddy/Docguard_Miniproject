import { randomUUID } from "node:crypto";

export type IngestMetadata = {
  documentId: number | null;
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

// TEMPORARY PUSH INTEGRATION STUB. Push has not merged its MongoDB extraction service yet.
// Keep this interface aligned with docs/WORK_SPLIT.md; replace the body with Push's adapter.
export const ingestionIsTemporaryStub = true;

export async function ingestFile(_path: string, _meta: IngestMetadata): Promise<IngestResult> {
  const id = () => `stub-${randomUUID()}`;
  return { mongoDocId: id(), mongoContentId: id(), chunkCount: 0 };
}

// The stub writes nothing to MongoDB, so compensation is intentionally a no-op until Push lands.
export async function deleteIngested(_mongoContentId: string): Promise<void> {}

// Push replaces this with the embedding worker queue after the PostgreSQL transaction commits.
export async function queueEmbedding(_versionId: number): Promise<void> {}
