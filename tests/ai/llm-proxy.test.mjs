import assert from "node:assert/strict";
import test from "node:test";

import { assertSuccess, run } from "../helpers/disposable-postgres.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/llm-proxy", "build"]);
assertSuccess(build, "build @viji/llm-proxy");

const { createLlmProxyServer } = await import("../../apps/llm-proxy/dist/index.js");

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("llm proxy exposes health, draft generation, and embedding endpoints", async () => {
  const token = "test-llm-proxy-token";
  const fetchCalls = [];
  const server = createLlmProxyServer({
    token,
    env: {
      VIJI_OLLAMA_BASE_URL: "http://ollama.test",
      VIJI_OLLAMA_MODEL: "qwen3:4b-instruct-2507-q4_K_M",
      VIJI_OLLAMA_EMBEDDING_MODEL: "mxbai-embed-large",
      VIJI_OLLAMA_TIMEOUT_MS: "1000",
      VIJI_OLLAMA_TEMPERATURE: "0.2",
      VIJI_OLLAMA_NUM_PREDICT: "160",
      VIJI_OLLAMA_CONTEXT_WINDOW_TOKENS: "4096"
    },
    fetchImpl: async (url, init = {}) => {
      fetchCalls.push({
        url: String(url),
        body: init.body ? JSON.parse(String(init.body)) : null
      });
      if (String(url).endsWith("/api/tags")) {
        return jsonResponse({
          models: [
            { name: "qwen3:4b-instruct-2507-q4_K_M", size: 1234 },
            { name: "mxbai-embed-large", size: 5678 }
          ]
        });
      }
      if (String(url).endsWith("/api/generate")) {
        return jsonResponse({
          response: JSON.stringify({
            reply_text: "I can help with that.",
            intent: "text_reply",
            confidence: 0.8
          }),
          prompt_eval_count: 4,
          eval_count: 5
        });
      }
      if (String(url).endsWith("/api/embed")) {
        return jsonResponse({ embeddings: [[0.4, 0.5]] });
      }
      return new Response("not found", { status: 404 });
    }
  });

  try {
    const baseUrl = await listen(server);
    const unauthorized = await fetch(`${baseUrl}/health`);
    assert.equal(unauthorized.status, 401);

    const health = await fetch(`${baseUrl}/health`, {
      headers: { "x-viji-llm-token": token }
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const draft = await fetch(`${baseUrl}/generate-draft`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-viji-llm-token": token
      },
      body: JSON.stringify({ prompt: "Hello", promptHash: "hash" })
    });
    assert.equal(draft.status, 200);
    const draftBody = await draft.json();
    assert.equal(draftBody.draft.text, "I can help with that.");
    assert.equal(draftBody.draft.intent, "text_reply");

    const embedding = await fetch(`${baseUrl}/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-viji-llm-token": token
      },
      body: JSON.stringify({ text: "Primary_Recipient_Marksheet.pdf" })
    });
    assert.equal(embedding.status, 200);
    const embeddingBody = await embedding.json();
    assert.deepEqual(embeddingBody.embedding.vector, [0.4, 0.5]);
    assert.equal(embeddingBody.embedding.dimensions, 2);

    assert.deepEqual(
      fetchCalls.map((call) => call.url),
      [
        "http://ollama.test/api/tags",
        "http://ollama.test/api/tags",
        "http://ollama.test/api/generate",
        "http://ollama.test/api/embed"
      ]
    );
    assert.equal(fetchCalls[3].body.model, "mxbai-embed-large");
  } finally {
    await closeServer(server);
  }
});
