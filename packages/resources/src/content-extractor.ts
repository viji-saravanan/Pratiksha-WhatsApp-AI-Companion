import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import {
  guessResourceMimeType,
  resolveResourcePathInsideRoot
} from "./resource-indexer.js";

export type ContentExtractionStatus = "extracted" | "unsupported" | "failed";

export interface ExtractedContentChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: Record<string, unknown>;
}

export interface FileContentExtractionResult {
  status: ContentExtractionStatus;
  extractorName: string;
  extractorVersion: string;
  text: string | null;
  chunks: ExtractedContentChunk[];
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface ExtractFileContentInput {
  resourceRoot: string;
  filePath: string;
  mimeType?: string | null;
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

interface CommandResult {
  status: "completed" | "not_found" | "timeout" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const EXTRACTOR_NAME = "pratiksha-local-content-extractor";
const EXTRACTOR_VERSION = "phase22-v1";
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CHUNK_CHARS = 1200;
const DEFAULT_MAX_CHUNKS = 12;
const DEFAULT_TIMEOUT_MS = 10_000;

const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "image/svg+xml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values"
]);

const UNSAFE_SNIPPET_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/gi,
  /\b(?:system|developer)\s+prompt\b/gi,
  /\b(?:api[_ -]?(?:key|token)|access[_ -]?token|password|secret)\b/gi,
  /\/(?:Volumes|Users)\/[^\s"'<>]+/g
];

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeExtractedTextForPrompt(value: string): string {
  let sanitized = normalizeExtractedText(value);
  for (const pattern of UNSAFE_SNIPPET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[removed unsafe snippet]");
  }

  return sanitized.trim();
}

function estimateTokenCount(value: string): number {
  return Math.max(1, Math.ceil(value.trim().split(/\s+/).length * 1.3));
}

export function chunkExtractedText(
  text: string,
  options: {
    maxChunkChars?: number;
    maxChunks?: number;
    metadata?: Record<string, unknown>;
  } = {}
): ExtractedContentChunk[] {
  const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const normalized = sanitizeExtractedTextForPrompt(text);
  if (!normalized) {
    return [];
  }

  const chunks: ExtractedContentChunk[] = [];
  let offset = 0;
  while (offset < normalized.length && chunks.length < maxChunks) {
    const end = Math.min(normalized.length, offset + maxChunkChars);
    const candidate = normalized.slice(offset, end);
    const lastBoundary = candidate.search(/\s+\S*$/);
    const nextOffset =
      end < normalized.length && lastBoundary > Math.floor(maxChunkChars * 0.7)
        ? offset + lastBoundary
        : end;
    const content = normalized.slice(offset, nextOffset).trim();

    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenCount: estimateTokenCount(content),
        pageStart: null,
        pageEnd: null,
        metadata: {
          ...options.metadata,
          untrustedExtractedContent: true
        }
      });
    }

    offset = nextOffset;
  }

  return chunks;
}

function htmlToText(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function extractPdfLiteralText(buffer: Buffer): string | null {
  const source = buffer.toString("latin1");
  const parts: string[] = [];
  const literalPattern = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  const arrayPattern = /\[((?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*)+)\]\s*TJ/g;

  for (const match of source.matchAll(literalPattern)) {
    parts.push(decodePdfLiteral(match[1]));
  }

  for (const match of source.matchAll(arrayPattern)) {
    for (const literal of match[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
      parts.push(decodePdfLiteral(literal[1]));
    }
  }

  const text = normalizeExtractedText(parts.join(" "));
  return text || null;
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolve({
          status: "timeout",
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: null
        });
      }
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        status: error.code === "ENOENT" ? "not_found" : "failed",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        exitCode: null
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        status: exitCode === 0 ? "completed" : "failed",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode
      });
    });
  });
}

function resultFromText(
  text: string,
  metadata: Record<string, unknown>,
  options: {
    maxChunkChars: number;
    maxChunks: number;
  }
): FileContentExtractionResult {
  const sanitized = sanitizeExtractedTextForPrompt(text);
  const chunks = chunkExtractedText(sanitized, {
    maxChunkChars: options.maxChunkChars,
    maxChunks: options.maxChunks,
    metadata
  });

  if (chunks.length === 0) {
    return {
      status: "failed",
      extractorName: EXTRACTOR_NAME,
      extractorVersion: EXTRACTOR_VERSION,
      text: null,
      chunks: [],
      error: "no_extractable_text",
      metadata
    };
  }

  return {
    status: "extracted",
    extractorName: EXTRACTOR_NAME,
    extractorVersion: EXTRACTOR_VERSION,
    text: sanitized,
    chunks,
    error: null,
    metadata
  };
}

function terminalResult(
  status: ContentExtractionStatus,
  error: string,
  metadata: Record<string, unknown>
): FileContentExtractionResult {
  return {
    status,
    extractorName: EXTRACTOR_NAME,
    extractorVersion: EXTRACTOR_VERSION,
    text: null,
    chunks: [],
    error,
    metadata
  };
}

async function extractPdfText(
  fileRealPath: string,
  buffer: Buffer,
  input: ExtractFileContentInput,
  options: {
    maxChunkChars: number;
    maxChunks: number;
    timeoutMs: number;
  }
): Promise<FileContentExtractionResult> {
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return terminalResult("failed", "invalid_pdf_header", {
      parser: "pdf",
      fileName: basename(fileRealPath)
    });
  }

  const command = input.commands?.pdftotext ?? "pdftotext";
  const external = await runCommand(command, [fileRealPath, "-"], {
    env: input.env,
    timeoutMs: options.timeoutMs
  });
  if (external.status === "completed" && external.stdout.trim()) {
    return resultFromText(
      external.stdout,
      {
        parser: "pdftotext",
        fileName: basename(fileRealPath)
      },
      options
    );
  }

  const fallbackText = extractPdfLiteralText(buffer);
  if (fallbackText) {
    return resultFromText(
      fallbackText,
      {
        parser: "pdf-literal-fallback",
        fileName: basename(fileRealPath),
        pdftotextStatus: external.status
      },
      options
    );
  }

  return terminalResult(
    external.status === "not_found" ? "unsupported" : "failed",
    external.status === "not_found" ? "pdftotext_unavailable" : "pdf_text_extraction_failed",
    {
      parser: "pdf",
      fileName: basename(fileRealPath),
      pdftotextStatus: external.status,
      pdftotextExitCode: external.exitCode
    }
  );
}

async function extractImageText(
  fileRealPath: string,
  input: ExtractFileContentInput,
  options: {
    maxChunkChars: number;
    maxChunks: number;
    timeoutMs: number;
  }
): Promise<FileContentExtractionResult> {
  const command = input.commands?.tesseract ?? "tesseract";
  const external = await runCommand(command, [fileRealPath, "stdout", "--dpi", "150"], {
    env: input.env,
    timeoutMs: options.timeoutMs
  });

  if (external.status === "completed" && external.stdout.trim()) {
    return resultFromText(
      external.stdout,
      {
        parser: "tesseract",
        fileName: basename(fileRealPath)
      },
      options
    );
  }

  return terminalResult(
    external.status === "not_found" ? "unsupported" : "failed",
    external.status === "not_found" ? "tesseract_unavailable" : "image_ocr_failed",
    {
      parser: "tesseract",
      fileName: basename(fileRealPath),
      tesseractStatus: external.status,
      tesseractExitCode: external.exitCode
    }
  );
}

export async function extractFileContent(
  input: ExtractFileContentInput
): Promise<FileContentExtractionResult> {
  const { fileRealPath } = await resolveResourcePathInsideRoot(
    input.resourceRoot,
    input.filePath
  );
  const fileStat = await stat(fileRealPath);
  if (!fileStat.isFile()) {
    throw new Error("content extraction path must point to a file");
  }

  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (fileStat.size > maxFileBytes) {
    return terminalResult("failed", "file_too_large_for_extraction", {
      fileName: basename(fileRealPath),
      sizeBytes: fileStat.size,
      maxFileBytes
    });
  }

  const mimeType = input.mimeType ?? guessResourceMimeType(fileRealPath);
  const maxChunkChars = input.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxChunks = input.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const buffer = await readFile(fileRealPath);

  if (TEXT_LIKE_MIME_TYPES.has(mimeType)) {
    const rawText = buffer.toString("utf8");
    return resultFromText(
      mimeType === "text/html" ? htmlToText(rawText) : rawText,
      {
        parser: "text",
        mimeType,
        fileName: basename(fileRealPath)
      },
      {
        maxChunkChars,
        maxChunks
      }
    );
  }

  if (mimeType === "application/pdf") {
    return extractPdfText(fileRealPath, buffer, input, {
      maxChunkChars,
      maxChunks,
      timeoutMs
    });
  }

  if (mimeType.startsWith("image/")) {
    return extractImageText(fileRealPath, input, {
      maxChunkChars,
      maxChunks,
      timeoutMs
    });
  }

  return terminalResult("unsupported", "unsupported_mime_type", {
    mimeType,
    fileName: basename(fileRealPath)
  });
}
