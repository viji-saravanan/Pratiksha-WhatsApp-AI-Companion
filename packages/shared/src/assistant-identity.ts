export interface AssistantIdentity {
  name: string;
  replyPrefix: string;
  legacyReplyPrefixes: readonly string[];
}

export const DEFAULT_ASSISTANT_NAME = "Pratiksha";
export const DEFAULT_ASSISTANT_REPLY_PREFIX = "[Pratiksha]";
export const LEGACY_ASSISTANT_REPLY_PREFIXES = ["[AI]"] as const;

export function getAssistantIdentity(
  env: Record<string, string | undefined> = process.env
): AssistantIdentity {
  const name = nonEmpty(env.VIJI_ASSISTANT_NAME) ?? DEFAULT_ASSISTANT_NAME;
  const replyPrefix =
    nonEmpty(env.VIJI_ASSISTANT_REPLY_PREFIX) ?? `[${name}]`;

  return {
    name,
    replyPrefix,
    legacyReplyPrefixes: LEGACY_ASSISTANT_REPLY_PREFIXES
  };
}

export function ensureAssistantReplyPrefix(
  text: string,
  identity: AssistantIdentity = getAssistantIdentity()
): string {
  const trimmed = text.trim();
  if (trimmed.startsWith(identity.replyPrefix)) {
    return trimmed;
  }

  for (const prefix of identity.legacyReplyPrefixes) {
    if (trimmed.startsWith(prefix)) {
      return `${identity.replyPrefix}${trimmed.slice(prefix.length)}`.trim();
    }
  }

  return `${identity.replyPrefix} ${trimmed}`;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
