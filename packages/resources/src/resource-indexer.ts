import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";

export type ResourceIndexScope = "inbox" | "library" | "staged";

export interface FileResourceRegistrationDraft {
  storageUri: string;
  originalUri: string | null;
  checksumSha256: string;
  mimeType: string;
  sizeBytes: number;
  registeredFileName: string;
  title: string;
  aliases: string[];
  description: string | null;
  contentSummary: string | null;
}

export interface BuildFileResourceRegistrationInput {
  resourceRoot: string;
  filePath: string;
  title?: string;
  aliases?: readonly string[];
  description?: string | null;
  contentSummaryMaxBytes?: number;
}

export interface ScanResourceDirectoryInput {
  resourceRoot: string;
  scope?: ResourceIndexScope;
  limit?: number;
  contentSummaryMaxBytes?: number;
}

const VALID_SCOPES = new Set<ResourceIndexScope>(["inbox", "library", "staged"]);
const DEFAULT_SCAN_LIMIT = 100;
const DEFAULT_CONTENT_SUMMARY_MAX_BYTES = 64 * 1024;
const MAX_CONTENT_SUMMARY_LENGTH = 2000;
const SKIPPED_DIRECTORY_NAMES = new Set([
  "manifests",
  "node_modules",
  "thumbnails",
  "tmp"
]);

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values"
]);

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function assertValidScope(scope: ResourceIndexScope | undefined): void {
  if (scope && !VALID_SCOPES.has(scope)) {
    throw new Error("resource index scope must be inbox, library, or staged");
  }
}

export function guessResourceMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export async function resolveResourcePathInsideRoot(
  resourceRoot: string,
  filePath: string
): Promise<{ resourceRootRealPath: string; fileRealPath: string }> {
  await mkdir(resourceRoot, { recursive: true });
  const resourceRootRealPath = await realpath(resourceRoot);
  const resolvedPath = resolve(resourceRootRealPath, filePath);
  const fileRealPath = await realpath(resolvedPath);

  if (!isPathInside(resourceRootRealPath, fileRealPath)) {
    throw new Error(`Resource path must stay under resource root: ${resourceRootRealPath}`);
  }

  return {
    resourceRootRealPath,
    fileRealPath
  };
}

export async function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, {
      start: 0,
      end: Math.max(0, maxBytes - 1)
    });

    stream.on("error", reject);
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolveBuffer(Buffer.concat(chunks)));
  });
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function summarizeText(value: string): string | null {
  const cleaned = value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, MAX_CONTENT_SUMMARY_LENGTH);
}

async function extractContentSummary(
  filePath: string,
  mimeType: string,
  maxBytes: number
): Promise<string | null> {
  if (!TEXT_LIKE_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const prefix = (await readFilePrefix(filePath, maxBytes)).toString("utf8");
  return summarizeText(mimeType === "text/html" ? stripHtml(prefix) : prefix);
}

function titleFromFileName(filePath: string): string {
  const extension = extname(filePath);
  const rawName = basename(filePath, extension) || basename(filePath);
  return rawName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  );
}

function aliasesFromFileName(filePath: string, title: string): string[] {
  const extension = extname(filePath);
  const fileNameWithoutExtension = basename(filePath, extension);
  return uniqueNonEmpty([
    title,
    basename(filePath),
    fileNameWithoutExtension,
    fileNameWithoutExtension.replace(/[_-]+/g, " ")
  ]);
}

export async function buildFileResourceRegistration(
  input: BuildFileResourceRegistrationInput
): Promise<FileResourceRegistrationDraft> {
  const { fileRealPath } = await resolveResourcePathInsideRoot(
    input.resourceRoot,
    input.filePath
  );
  const fileStat = await stat(fileRealPath);

  if (!fileStat.isFile()) {
    throw new Error("resource path must point to a file");
  }

  const mimeType = guessResourceMimeType(fileRealPath);
  const title = input.title?.trim() || titleFromFileName(fileRealPath);
  const contentSummary = await extractContentSummary(
    fileRealPath,
    mimeType,
    input.contentSummaryMaxBytes ?? DEFAULT_CONTENT_SUMMARY_MAX_BYTES
  );

  return {
    storageUri: fileRealPath,
    originalUri: null,
    checksumSha256: await hashFileSha256(fileRealPath),
    mimeType,
    sizeBytes: fileStat.size,
    registeredFileName: basename(fileRealPath),
    title,
    aliases: uniqueNonEmpty([
      ...aliasesFromFileName(fileRealPath, title),
      ...(input.aliases ?? [])
    ]),
    description: input.description ?? null,
    contentSummary
  };
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith(".") || SKIPPED_DIRECTORY_NAMES.has(name);
}

function shouldSkipFile(name: string): boolean {
  return name.startsWith(".");
}

async function collectResourceFiles(
  directory: string,
  output: string[],
  limit: number
): Promise<void> {
  if (output.length >= limit) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        await collectResourceFiles(entryPath, output, limit);
      }
    } else if (entry.isFile() && !shouldSkipFile(entry.name)) {
      const pathStat = await lstat(entryPath);
      if (pathStat.isFile()) {
        output.push(entryPath);
      }
    }

    if (output.length >= limit) {
      return;
    }
  }
}

export async function scanResourceDirectory(
  input: ScanResourceDirectoryInput
): Promise<FileResourceRegistrationDraft[]> {
  assertValidScope(input.scope);

  const limit = input.limit ?? DEFAULT_SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("resource index limit must be an integer from 1 to 200");
  }

  await mkdir(input.resourceRoot, { recursive: true });
  const root = await realpath(input.resourceRoot);
  const scanRoot = input.scope ? join(root, input.scope) : root;
  await mkdir(scanRoot, { recursive: true });

  const files: string[] = [];
  await collectResourceFiles(scanRoot, files, limit);

  return Promise.all(
    files.map((filePath) =>
      buildFileResourceRegistration({
        resourceRoot: root,
        filePath,
        contentSummaryMaxBytes: input.contentSummaryMaxBytes
      })
    )
  );
}
