export interface ApiConfig {
  host: string;
  port: number;
  token: string;
}

export function getApiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.VIJI_API_HOST || "127.0.0.1",
    port: Number(env.VIJI_API_PORT || 8787),
    token: env.VIJI_API_TOKEN || "local-dev-token"
  };
}
