const CONTENT_KEY_PATTERN =
  /(^|_)(body|text|message|content|caption|conversation)($|_)/i;
const IDENTITY_KEY_PATTERN =
  /(phone|jid|waJid|chatJid|senderJid|participant|remoteJid)/i;

export function redactWacliPayload(value: unknown): Record<string, unknown> {
  const redacted = redactValue(value, "");
  if (isRecord(redacted)) {
    return redacted;
  }
  return { value: redacted };
}

function redactValue(value: unknown, key: string): unknown {
  if (CONTENT_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (IDENTITY_KEY_PATTERN.test(key)) {
    return "[redacted-id]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, ""));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = redactValue(childValue, childKey);
    }
    return output;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
