import assert from "node:assert/strict";
import test from "node:test";

import { assertSuccess, run } from "../helpers/disposable-postgres.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/ai", "build"]);
assertSuccess(build, "build @viji/ai");

const {
  createOllamaLlmClient,
  embedTextWithOllama,
  getOllamaLlmConfigFromEnv,
  getOllamaModelHealth
} = await import("../../packages/ai/dist/index.js");

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

test("ollama client sends bounded generation request and maps usage metadata", async () => {
  let requestUrl;
  let requestBody;
  const fetchImpl = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init.body));
    return jsonResponse({
      response: "I can help you find that document.",
      prompt_eval_count: 42,
      eval_count: 9
    });
  };

  const client = createOllamaLlmClient({
    baseUrl: "http://127.0.0.1:11434/",
    model: "qwen3:4b-instruct-2507-q4_K_M",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl
  });
  const result = await client.generateDraft({
    prompt: "Latest inbound message:\nCan I have my marksheet?",
    modelName: "ignored-by-ollama-client",
    promptHash: "hash"
  });

  assert.equal(requestUrl, "http://127.0.0.1:11434/api/generate");
  assert.equal(requestBody.model, "qwen3:4b-instruct-2507-q4_K_M");
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.format.type, "object");
  assert.deepEqual(requestBody.options, {
    temperature: 0.2,
    num_predict: 160,
    num_ctx: 4096
  });
  assert.equal(result.text, "I can help you find that document.");
  assert.equal(result.modelName, "qwen3:4b-instruct-2507-q4_K_M");
  assert.equal(result.inputTokens, 42);
  assert.equal(result.outputTokens, 9);
  assert.equal(typeof result.latencyMs, "number");
});

test("ollama client parses structured draft responses", async () => {
  const fetchImpl = async () => {
    return jsonResponse({
      response: JSON.stringify({
        reply_text: "Do you mean Primary_Recipient_Marksheet.pdf?",
        intent: "resource_request",
        resource_query: "Primary_Recipient_Marksheet.pdf",
        confidence: 0.86,
        refusal_reason: null
      }),
      prompt_eval_count: 51,
      eval_count: 13
    });
  };
  const client = createOllamaLlmClient({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct-2507-q4_K_M",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl
  });

  const result = await client.generateDraft({
    prompt: "Latest inbound message:\nCan I have my marksheet?",
    modelName: "qwen3:4b-instruct-2507-q4_K_M",
    promptHash: "hash"
  });

  assert.equal(result.text, "Do you mean Primary_Recipient_Marksheet.pdf?");
  assert.equal(result.intent, "resource_request");
  assert.equal(result.resourceQuery, "Primary_Recipient_Marksheet.pdf");
  assert.equal(result.confidence, 0.86);
});

test("ollama client maps missing model failures to ai.model_missing", async () => {
  const fetchImpl = async () => {
    return new Response("model not found", { status: 404 });
  };
  const client = createOllamaLlmClient({
    baseUrl: "http://127.0.0.1:11434",
    model: "missing-model",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl
  });

  await assert.rejects(
    () =>
      client.generateDraft({
        prompt: "Hello",
        modelName: "missing-model",
        promptHash: "hash"
      }),
    (error) => {
      assert.equal(error.code, "ai.model_missing");
      return true;
    }
  );
});

test("ollama client neutralizes unsafe file-send claims", async () => {
  const fetchImpl = async () => {
    return jsonResponse({
      response: "Here's your marksheet: Primary_Recipient_Marksheet.pdf",
      prompt_eval_count: 50,
      eval_count: 12
    });
  };
  const client = createOllamaLlmClient({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct-2507-q4_K_M",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl
  });

  const result = await client.generateDraft({
    prompt: "Latest inbound message:\nCan I have my marksheet?",
    modelName: "qwen3:4b-instruct-2507-q4_K_M",
    promptHash: "hash"
  });

  assert.equal(result.text, "Do you mean Primary_Recipient_Marksheet.pdf?");
});

test("assistant prefix parser neutralizes unsafe file-send claims", async () => {
  const { ensureAiPrefix } = await import("../../packages/ai/dist/index.js");
  assert.equal(
    ensureAiPrefix("I will send the file now."),
    "[Pratiksha] Please confirm the exact file name you want me to share."
  );
});

test("ollama health distinguishes pulled, missing, and unavailable models", async () => {
  const healthy = await getOllamaModelHealth({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct-2507-q4_K_M",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl: async () =>
      jsonResponse({
        models: [
          {
            name: "qwen3:4b-instruct-2507-q4_K_M",
            size: 2497293803,
            digest: "0edcdef34593",
            details: { family: "qwen3" }
          }
        ]
      })
  });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.sizeBytes, 2497293803);

  const latestAlias = await getOllamaModelHealth({
    baseUrl: "http://127.0.0.1:11434",
    model: "mxbai-embed-large",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl: async () =>
      jsonResponse({
        models: [{ name: "mxbai-embed-large:latest", size: 669000000 }]
      })
  });
  assert.equal(latestAlias.status, "healthy");
  assert.equal(latestAlias.sizeBytes, 669000000);

  const missing = await getOllamaModelHealth({
    baseUrl: "http://127.0.0.1:11434",
    model: "missing",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl: async () => jsonResponse({ models: [] })
  });
  assert.equal(missing.status, "missing");
  assert.equal(missing.errorCode, "ai.model_missing");

  const unavailable = await getOllamaModelHealth({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct-2507-q4_K_M",
    timeoutMs: 1000,
    temperature: 0.2,
    numPredict: 160,
    contextWindowTokens: 4096,
    fetchImpl: async () => {
      throw new Error("connection refused");
    }
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.errorCode, "ai.model_unavailable");
});

test("ollama embedding wrapper returns vector metadata", async () => {
  let requestUrl;
  let requestBody;
  const result = await embedTextWithOllama(
    {
      baseUrl: "http://127.0.0.1:11434/",
      model: "qwen3:4b-instruct-2507-q4_K_M",
      embeddingModel: "mxbai-embed-large",
      timeoutMs: 1000,
      temperature: 0.2,
      numPredict: 160,
      contextWindowTokens: 4096,
      fetchImpl: async (url, init) => {
        requestUrl = String(url);
        requestBody = JSON.parse(String(init.body));
        return jsonResponse({
          embeddings: [[0.1, 0.2, 0.3]],
          prompt_eval_count: 7
        });
      }
    },
    {
      text: "Registered filename: Primary_Recipient_Marksheet.pdf"
    }
  );

  assert.equal(requestUrl, "http://127.0.0.1:11434/api/embed");
  assert.deepEqual(requestBody, {
    model: "mxbai-embed-large",
    input: "Registered filename: Primary_Recipient_Marksheet.pdf"
  });
  assert.deepEqual(result.vector, [0.1, 0.2, 0.3]);
  assert.equal(result.dimensions, 3);
  assert.equal(result.inputTokens, 7);
});

test("ollama embedding wrapper maps missing model failures", async () => {
  await assert.rejects(
    () =>
      embedTextWithOllama(
        {
          baseUrl: "http://127.0.0.1:11434",
          model: "missing-model",
          timeoutMs: 1000,
          temperature: 0.2,
          numPredict: 160,
          contextWindowTokens: 4096,
          fetchImpl: async () => new Response("model not found", { status: 404 })
        },
        { text: "hello" }
      ),
    (error) => {
      assert.equal(error.code, "ai.model_missing");
      return true;
    }
  );
});

test("ollama config is read from project environment variables", () => {
  const config = getOllamaLlmConfigFromEnv({
    VIJI_OLLAMA_BASE_URL: "http://127.0.0.1:11434/",
    VIJI_OLLAMA_MODEL: "qwen3:4b-instruct-2507-q4_K_M",
    VIJI_OLLAMA_EMBEDDING_MODEL: "mxbai-embed-large",
    VIJI_OLLAMA_TIMEOUT_MS: "90000",
    VIJI_OLLAMA_TEMPERATURE: "0.15",
    VIJI_OLLAMA_NUM_PREDICT: "96",
    VIJI_OLLAMA_CONTEXT_WINDOW_TOKENS: "2048"
  });

  assert.deepEqual(config, {
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct-2507-q4_K_M",
    embeddingModel: "mxbai-embed-large",
    timeoutMs: 90000,
    temperature: 0.15,
    numPredict: 96,
    contextWindowTokens: 2048
  });
});
