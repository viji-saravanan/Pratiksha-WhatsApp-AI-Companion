import { randomUUID } from "node:crypto";
import { open, mkdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { DashboardUploadConfig } from "./config.js";

export interface DashboardUploadedResource {
  relativePath: string;
  savedFileName: string;
  originalFileName: string;
  sizeBytes: number;
  title?: string;
  aliases?: string[];
  description?: string | null;
}

interface MultipartFile {
  name: string;
  fileName: string;
  content: Buffer;
}

interface MultipartForm {
  fields: Record<string, string>;
  files: MultipartFile[];
}

const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");

function multipartBoundary(contentType: string | undefined): string {
  const match = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary) {
    throw new Error("Upload must use multipart/form-data.");
  }

  return boundary;
}

function contentDispositionValue(headers: string, name: string): string | undefined {
  const match = headers.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1];
}

function parseMultipartForm(contentType: string | undefined, body: Buffer): MultipartForm {
  const boundary = multipartBoundary(contentType);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  let cursor = body.indexOf(delimiter);

  while (cursor !== -1) {
    cursor += delimiter.byteLength;
    if (body.subarray(cursor, cursor + 2).toString("utf8") === "--") {
      break;
    }
    if (body.subarray(cursor, cursor + 2).toString("utf8") === "\r\n") {
      cursor += 2;
    }

    const headerEnd = body.indexOf(HEADER_SEPARATOR, cursor);
    if (headerEnd === -1) {
      break;
    }

    const headers = body.subarray(cursor, headerEnd).toString("utf8");
    const contentStart = headerEnd + HEADER_SEPARATOR.byteLength;
    const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), contentStart);
    if (nextBoundary === -1) {
      break;
    }

    const name = contentDispositionValue(headers, "name");
    const fileName = contentDispositionValue(headers, "filename");
    const content = body.subarray(contentStart, nextBoundary);
    if (name && fileName !== undefined) {
      files.push({ name, fileName, content });
    } else if (name) {
      fields[name] = content.toString("utf8").trim();
    }

    cursor = nextBoundary + 2;
    cursor = body.indexOf(delimiter, cursor);
  }

  return { fields, files };
}

function safeFileName(input: string): string {
  const rawBaseName = basename(input.replaceAll("\\", "/")).trim();
  const cleaned = rawBaseName
    .replace(/[^\w .()-]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 140);
  return cleaned || `upload-${randomUUID()}.bin`;
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !resolve(path).startsWith(".."));
}

async function writeUniqueFile(
  directory: string,
  fileName: string,
  content: Buffer
): Promise<{ filePath: string; savedFileName: string }> {
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const savedFileName = attempt === 0 ? fileName : `${stem}-${attempt + 1}${extension}`;
    const filePath = resolve(directory, savedFileName);
    if (!isPathInside(directory, filePath)) {
      throw new Error("Upload path escaped the staging directory.");
    }

    try {
      const handle = await open(filePath, "wx");
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
      return { filePath, savedFileName };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not find a unique upload filename.");
}

function aliasesFromField(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const aliases = Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  return aliases.length > 0 ? aliases : undefined;
}

export async function saveDashboardResourceUpload(
  config: DashboardUploadConfig,
  contentType: string | undefined,
  body: Buffer
): Promise<DashboardUploadedResource> {
  if (body.byteLength > config.maxBytes) {
    throw new Error(`Upload exceeds the configured ${config.maxBytes} byte limit.`);
  }

  const form = parseMultipartForm(contentType, body);
  const file = form.files.find((item) => item.name === "file") || form.files[0];
  if (!file || file.content.byteLength === 0) {
    throw new Error("Upload requires a non-empty file.");
  }

  const root = resolve(config.resourceRoot);
  const stagedDirectory = resolve(root, "staged");
  if (!isPathInside(root, stagedDirectory)) {
    throw new Error("Upload staging directory escaped the resource root.");
  }

  await mkdir(stagedDirectory, { recursive: true });
  const originalFileName = file.fileName || "upload.bin";
  const { savedFileName } = await writeUniqueFile(
    stagedDirectory,
    safeFileName(originalFileName),
    file.content
  );

  return {
    relativePath: join("staged", savedFileName),
    savedFileName,
    originalFileName,
    sizeBytes: file.content.byteLength,
    title: form.fields.title || undefined,
    aliases: aliasesFromField(form.fields.aliases),
    description: form.fields.description || null
  };
}
