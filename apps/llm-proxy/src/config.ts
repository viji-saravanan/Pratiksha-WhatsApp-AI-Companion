export interface LlmProxyConfig {
  host: string;
  port: number;
  token: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("VIJI_LLM_PROXY_PORT must be an integer from 1 to 65535");
  }

  return parsed;
}

export function getLlmProxyConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LlmProxyConfig {
  return {
    host: env.VIJI_LLM_PROXY_HOST || "127.0.0.1",
    port: parsePort(env.VIJI_LLM_PROXY_PORT, 8791),
    token: env.VIJI_LLM_PROXY_TOKEN || "local-llm-token"
  };
}
