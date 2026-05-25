import { createRepositories, type DbExecutor } from "@viji/db";
import {
  extractFileContent,
  type FileContentExtractionResult
} from "@viji/resources";

export interface UnderstandFileResourceInput {
  resourceId: string;
  resourceRoot: string;
  now?: Date;
  maxFileBytes?: number;
  maxChunkChars?: number;
  maxChunks?: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  commands?: {
    pdftotext?: string;
    tesseract?: string;
  };
}

export interface UnderstandFileResourceResult {
  status: FileContentExtractionResult["status"];
  resourceId: string;
  fileAssetId: string;
  documentId: string;
  chunkCount: number;
  summaryUpdated: boolean;
  error: string | null;
}

const MAX_RESOURCE_SUMMARY_LENGTH = 2000;

function summarizeExtraction(result: FileContentExtractionResult): string | null {
  const firstChunk = result.chunks[0]?.content;
  if (!firstChunk) {
    return null;
  }

  return firstChunk.slice(0, MAX_RESOURCE_SUMMARY_LENGTH);
}

export async function understandFileResource(
  db: DbExecutor,
  input: UnderstandFileResourceInput
): Promise<UnderstandFileResourceResult> {
  const repositories = createRepositories(db);
  const resource = await repositories.resources.findFileResourceForSend(
    input.resourceId
  );

  if (!resource) {
    throw new Error(`File resource not found: ${input.resourceId}`);
  }
  if (!resource.fileAssetId || !resource.storageUri || !resource.mimeType) {
    throw new Error(`File resource has no backing file asset: ${input.resourceId}`);
  }
  if (!resource.checksumSha256) {
    throw new Error(`File resource has no checksum: ${input.resourceId}`);
  }

  const source = await repositories.knowledge.upsertKnowledgeSource({
    type: "resource_file_asset",
    name: "Pratiksha resource file assets",
    uri: "pratiksha://resource-file-assets",
    syncState: "indexed"
  });

  const extraction = await extractFileContent({
    resourceRoot: input.resourceRoot,
    filePath: resource.storageUri,
    mimeType: resource.mimeType,
    maxFileBytes: input.maxFileBytes,
    maxChunkChars: input.maxChunkChars,
    maxChunks: input.maxChunks,
    timeoutMs: input.timeoutMs,
    env: input.env,
    commands: input.commands
  });

  const indexedState =
    extraction.status === "extracted"
      ? "chunked"
      : extraction.status === "unsupported"
        ? "unsupported"
        : "failed";
  const document = await repositories.knowledge.upsertKnowledgeDocument({
    knowledgeSourceId: source.knowledgeSourceId,
    fileAssetId: resource.fileAssetId,
    title: resource.title,
    mimeType: resource.mimeType,
    contentHash: resource.checksumSha256,
    indexedState,
    extractionStatus: extraction.status,
    extractionError: extraction.error,
    extractorName: extraction.extractorName,
    extractorVersion: extraction.extractorVersion,
    extractorMetadata: {
      ...extraction.metadata,
      extractedAt: (input.now ?? new Date()).toISOString()
    }
  });
  const chunks = await repositories.knowledge.replaceDocumentChunks({
    documentId: document.documentId,
    chunks: extraction.chunks
  });
  const summary = summarizeExtraction(extraction);
  let summaryUpdated = false;

  if (summary) {
    await repositories.resources.updateResourceContentSummary({
      resourceId: resource.resourceId,
      contentSummary: summary
    });
    summaryUpdated = true;
  }

  await repositories.auditEvents.recordAuditEvent({
    type: "resource.content_extracted",
    severity: extraction.status === "extracted" ? "info" : "warn",
    detail: {
      resourceId: resource.resourceId,
      fileAssetId: resource.fileAssetId,
      documentId: document.documentId,
      status: extraction.status,
      chunkCount: chunks.length,
      error: extraction.error
    }
  });

  return {
    status: extraction.status,
    resourceId: resource.resourceId,
    fileAssetId: resource.fileAssetId,
    documentId: document.documentId,
    chunkCount: chunks.length,
    summaryUpdated,
    error: extraction.error
  };
}
