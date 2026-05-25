import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { ERROR_CODES, VijiError } from "@viji/shared";

export interface SpeechToTextConfig {
  enabled: boolean;
  command: string;
  commandArgs: string[];
  modelPath: string;
  modelName: string;
  timeoutMs: number;
  minConfidence: number;
  maxAudioBytes: number;
  tempRoot: string;
  ffmpegBin: string;
  transcodeToWav: boolean;
}

export interface SpeechToTextResult {
  text: string;
  language: string | null;
  confidence: number | null;
  durationMs: number | null;
  modelName: string;
  metadata: Record<string, unknown>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface ParsedTranscriptPayload {
  text?: string;
  language?: string;
  confidence?: number;
  duration_ms?: number;
  durationMs?: number;
  model?: string;
  model_name?: string;
  modelName?: string;
  segments?: unknown[];
  transcription?: unknown[];
  result?: Record<string, unknown>;
}

const DEFAULT_DATA_ROOT = "/data/pratiksha";
const DEFAULT_STT_MODEL_NAME = "whisper.cpp small multilingual";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MIN_CONFIDENCE = 0.65;
const DEFAULT_MAX_AUDIO_BYTES = 26_214_400;
const DEFAULT_COMMAND_ARGS = [
  "-m",
  "{model}",
  "-f",
  "{audio}",
  "-l",
  "auto",
  "-oj",
  "-of",
  "{output}"
];

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value === "true";
}

function positiveIntegerFromEnv(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberInRangeFromEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function parseCommandArgs(value: string | undefined): string[] {
  if (!value?.trim()) {
    return DEFAULT_COMMAND_ARGS;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string")
    ) {
      throw new VijiError({
        code: ERROR_CODES.system.invalidConfig,
        message: "VIJI_STT_COMMAND_ARGS must be a JSON string array"
      });
    }

    return parsed as string[];
  }

  return trimmed.split(/\s+/).filter(Boolean);
}

export function getSpeechToTextConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SpeechToTextConfig {
  const dataRoot = env.VIJI_DATA_ROOT || DEFAULT_DATA_ROOT;
  const modelPath =
    env.VIJI_STT_MODEL_PATH || `${dataRoot}/models/whisper/ggml-small.bin`;

  return {
    enabled: env.VIJI_STT_ENABLED === "true",
    command: env.VIJI_STT_COMMAND || "whisper-cli",
    commandArgs: parseCommandArgs(env.VIJI_STT_COMMAND_ARGS),
    modelPath,
    modelName: env.VIJI_STT_MODEL_NAME || DEFAULT_STT_MODEL_NAME,
    timeoutMs: positiveIntegerFromEnv(
      env.VIJI_STT_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    ),
    minConfidence: numberInRangeFromEnv(
      env.VIJI_STT_MIN_CONFIDENCE,
      DEFAULT_MIN_CONFIDENCE,
      0,
      1
    ),
    maxAudioBytes: positiveIntegerFromEnv(
      env.VIJI_STT_MAX_AUDIO_BYTES,
      DEFAULT_MAX_AUDIO_BYTES
    ),
    tempRoot: env.VIJI_STT_TMP_ROOT || `${dataRoot}/tmp/stt`,
    ffmpegBin: env.VIJI_STT_FFMPEG_BIN || "ffmpeg",
    transcodeToWav: booleanFromEnv(env.VIJI_STT_TRANSCODE_TO_WAV, true)
  };
}

async function assertReadable(path: string, code: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    throw new VijiError({
      code: code as typeof ERROR_CODES.ai.modelMissing,
      message: `${label} is not readable`,
      details: { path: basename(path) },
      cause: error
    });
  }
}

function renderedArgs(
  args: string[],
  replacements: Record<string, string>
): string[] {
  return args.map((arg) => {
    return Object.entries(replacements).reduce(
      (current, [key, value]) => current.replaceAll(`{${key}}`, value),
      arg
    );
  });
}

async function runCommand(input: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<CommandResult> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1_000_000) {
        stdout = stdout.slice(-1_000_000);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) {
        stderr = stderr.slice(-200_000);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new VijiError({
          code: ERROR_CODES.ai.modelUnavailable,
          message: `Speech-to-text command failed to start: ${error.message}`,
          cause: error
        })
      );
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        reject(
          new VijiError({
            code: ERROR_CODES.ai.modelUnavailable,
            message: "Speech-to-text command timed out",
            details: { durationMs }
          })
        );
        return;
      }

      if (exitCode !== 0) {
        reject(
          new VijiError({
            code: ERROR_CODES.ai.modelUnavailable,
            message: `Speech-to-text command exited with ${exitCode}`,
            details: { stderrPreview: stderr.trim().slice(0, 300) }
          })
        );
        return;
      }

      resolve({ stdout, stderr, durationMs });
    });
  });
}

async function maybeTranscodeToWav(input: {
  audioPath: string;
  outputPath: string;
  config: SpeechToTextConfig;
}): Promise<void> {
  if (!input.config.transcodeToWav) {
    return;
  }

  await runCommand({
    command: input.config.ffmpegBin,
    args: [
      "-y",
      "-v",
      "error",
      "-i",
      input.audioPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      input.outputPath
    ],
    timeoutMs: Math.min(input.config.timeoutMs, 60_000)
  });
}

function firstJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

async function readTranscriptPayload(input: {
  stdout: string;
  outputBase: string;
}): Promise<unknown | null> {
  const fromStdout = firstJsonObject(input.stdout);
  if (fromStdout) {
    return fromStdout;
  }

  for (const path of [input.outputBase, `${input.outputBase}.json`]) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      // Try the next expected output shape.
    }
  }

  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function arrayText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      const record = item as Record<string, unknown>;
      return stringValue(record.text) ?? stringValue(record.content) ?? "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function averageConfidence(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const values = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      return (
        numberValue(record.confidence) ??
        numberValue(record.probability) ??
        numberValue(record.avg_logprob)
      );
    })
    .filter((item): item is number => item !== null)
    .map((item) => {
      if (item < 0) {
        return Math.min(1, Math.max(0, Math.exp(item)));
      }
      return Math.min(1, Math.max(0, item));
    });

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function parseTranscriptPayload(
  payload: unknown,
  fallbackModelName: string
): Omit<SpeechToTextResult, "metadata"> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new VijiError({
      code: ERROR_CODES.ai.promptRejected,
      message: "Speech-to-text command did not return JSON"
    });
  }

  const record = payload as ParsedTranscriptPayload;
  const resultRecord =
    record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? record.result
      : {};
  const segments = record.segments ?? record.transcription;
  const text =
    stringValue(record.text) ??
    stringValue(resultRecord.text) ??
    arrayText(segments);
  const confidence =
    numberValue(record.confidence) ??
    numberValue(resultRecord.confidence) ??
    averageConfidence(segments);
  const durationMs =
    numberValue(record.duration_ms) ??
    numberValue(record.durationMs) ??
    numberValue(resultRecord.duration_ms) ??
    numberValue(resultRecord.durationMs);
  const modelName =
    stringValue(record.modelName) ??
    stringValue(record.model_name) ??
    stringValue(record.model) ??
    fallbackModelName;

  return {
    text: text ?? "",
    language:
      stringValue(record.language) ?? stringValue(resultRecord.language) ?? null,
    confidence:
      confidence === null ? null : Math.min(1, Math.max(0, confidence)),
    durationMs: durationMs === null ? null : Math.max(0, Math.round(durationMs)),
    modelName
  };
}

export async function transcribeAudioFile(input: {
  audioPath: string;
  config?: SpeechToTextConfig;
}): Promise<SpeechToTextResult> {
  const config = input.config ?? getSpeechToTextConfigFromEnv();
  if (!config.enabled) {
    throw new VijiError({
      code: ERROR_CODES.ai.modelUnavailable,
      message: "Speech-to-text is disabled"
    });
  }

  await assertReadable(input.audioPath, ERROR_CODES.ai.modelUnavailable, "Audio file");
  if (config.commandArgs.some((arg) => arg.includes("{model}"))) {
    await assertReadable(config.modelPath, ERROR_CODES.ai.modelMissing, "STT model");
  }

  const fileStat = await stat(input.audioPath);
  if (!fileStat.isFile()) {
    throw new VijiError({
      code: ERROR_CODES.ai.modelUnavailable,
      message: "Audio path is not a file"
    });
  }
  if (fileStat.size > config.maxAudioBytes) {
    throw new VijiError({
      code: ERROR_CODES.ai.modelUnavailable,
      message: "Audio file exceeds the configured STT byte limit"
    });
  }

  await mkdir(config.tempRoot, { recursive: true });
  const tempDir = join(config.tempRoot, `stt-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const wavPath = join(tempDir, "audio.wav");
  const outputBase = join(tempDir, "transcript");
  const startedAt = Date.now();

  try {
    await maybeTranscodeToWav({
      audioPath: input.audioPath,
      outputPath: wavPath,
      config
    });
    const audioForModel = config.transcodeToWav ? wavPath : input.audioPath;
    const args = renderedArgs(config.commandArgs, {
      audio: audioForModel,
      model: config.modelPath,
      output: outputBase
    });
    const commandResult = await runCommand({
      command: config.command,
      args,
      timeoutMs: config.timeoutMs
    });
    const payload = await readTranscriptPayload({
      stdout: commandResult.stdout,
      outputBase
    });
    const parsed = parseTranscriptPayload(payload, config.modelName);

    return {
      ...parsed,
      metadata: {
        engine: "local-command",
        command: basename(config.command),
        transcodedToWav: config.transcodeToWav,
        audioBytes: fileStat.size,
        commandDurationMs: commandResult.durationMs,
        totalDurationMs: Date.now() - startedAt
      }
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
