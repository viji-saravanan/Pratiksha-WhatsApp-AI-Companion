import "./lib/load-env.mjs";

import {
  buildDraftPrompt,
  createOllamaLlmClient,
  ensureAiPrefix,
  getOllamaLlmConfigFromEnv,
  getOllamaModelHealth
} from "../packages/ai/dist/index.js";

const config = getOllamaLlmConfigFromEnv(process.env);
const health = await getOllamaModelHealth(config);

if (health.status !== "healthy") {
  console.error(JSON.stringify({ ok: false, health }, null, 2));
  process.exit(1);
}

const prompt = buildDraftPrompt({
  contactDisplayName: "Primary Recipient",
  contextState: "fresh",
  conversationSummary: "Primary recipient may ask for help finding documents or resources.",
  knowledgeSnippets: [
    {
      title: "Available registered resource",
      body: "Registered filename: Primary_Recipient_Marksheet.pdf"
    }
  ],
  latestUserMessage: "Can I have my marksheet file?"
});

const client = createOllamaLlmClient(config);
const result = await client.generateDraft({
  prompt: prompt.prompt,
  modelName: config.model,
  promptHash: prompt.promptHash
});

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "ollama",
      modelName: result.modelName,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      draft: ensureAiPrefix(result.text)
    },
    null,
    2
  )
);
