const LOCAL_PATH_PATTERN =
  /(?:\/Volumes\/[^.,;)\]\n\r]+|\/Users\/[^.,;)\]\n\r]+|[A-Za-z]:\\[^.,;)\]\n\r]+)/g;

const SECRET_WORD_PATTERN =
  /\b(?:token|secret|password|credential|api[_-]?key)\s*[:=]\s*[^\s]+/gi;
const FILE_NAME_PATTERN =
  /\b[A-Za-z0-9][A-Za-z0-9._ -]*\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|txt|zip)\b/i;
const FILE_SEND_CLAIM_PATTERN =
  /\b(?:here(?:'s| is)|attached|i(?:'ll| will)? send|i(?:'ve| have) sent|sending|sent|share it|send it)\b/i;
const FILE_REQUEST_WORD_PATTERN =
  /\b(?:file|document|resource|marksheet|resume|certificate|pdf|attachment)\b/i;

export function sanitizeReferenceText(text: string): string {
  return text
    .replace(LOCAL_PATH_PATTERN, "[local-path-redacted]")
    .replace(SECRET_WORD_PATTERN, "[secret-redacted]")
    .trim();
}

export function sanitizeDraftText(text: string): string {
  return sanitizeReferenceText(text).replace(/\s+/g, " ").trim();
}

export function enforceDraftPolicyText(text: string): string {
  const sanitized = sanitizeDraftText(text);
  const fileName = sanitized.match(FILE_NAME_PATTERN)?.[0]?.trim();
  const claimsFileSend = FILE_SEND_CLAIM_PATTERN.test(sanitized);

  if (fileName && claimsFileSend && !/\bdo you mean\b/i.test(sanitized)) {
    return `Do you mean ${fileName}?`;
  }

  if (claimsFileSend && FILE_REQUEST_WORD_PATTERN.test(sanitized)) {
    return "Please confirm the exact file name you want me to share.";
  }

  return sanitized;
}
