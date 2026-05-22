export interface GenerateDraftInput {
  prompt: string;
  modelName: string;
  promptHash: string;
}

export interface GenerateDraftResult {
  text: string;
  modelName: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  intent?: "text_reply" | "resource_request" | "clarification" | "refusal";
  resourceQuery?: string | null;
  refusalReason?: string | null;
  confidence?: number;
}

export interface LlmClient {
  generateDraft(input: GenerateDraftInput): Promise<GenerateDraftResult>;
}
