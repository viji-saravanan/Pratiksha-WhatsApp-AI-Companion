export interface EmbedTextInput {
  text: string;
  modelName?: string;
}

export interface EmbedTextResult {
  modelName: string;
  vector: number[];
  dimensions: number;
  latencyMs: number;
  inputTokens?: number;
}

export interface EmbeddingClient {
  embedText(input: EmbedTextInput): Promise<EmbedTextResult>;
}
