import { ERROR_CODES, VijiError } from "@viji/shared";

export interface CliApiClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class CliApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CliApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = (await response.json()) as T & {
      error?: { code?: string; message?: string };
    };

    if (!response.ok) {
      throw new VijiError({
        code: ERROR_CODES.system.invalidState,
        message: payload.error?.message ?? `API request failed: ${response.status}`,
        details: {
          status: response.status,
          path
        }
      });
    }

    return payload;
  }
}

export function createCliApiClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): CliApiClient {
  return new CliApiClient({
    baseUrl: env.VIJI_API_BASE_URL || "http://127.0.0.1:8787",
    token: env.VIJI_API_TOKEN || "local-dev-token",
    fetchImpl
  });
}
