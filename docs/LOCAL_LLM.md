# Local LLM Runtime

## Decision

The current local model runtime is Ollama running on macOS as a host service, with model files stored on the SSD:

```text
/Volumes/Arya 1TB/VijiAI/models/ollama
```

This is an intentional Mac-specific runtime decision. Docker Desktop on macOS does not expose Apple Metal GPU acceleration to Linux containers, so a host Ollama service is the practical way to use the M2 GPU while still keeping the rest of the project Docker-first.

The project boundary remains:

- `apps/llm-proxy` owns the project-facing generation API.
- `packages/ai` owns the shared typed client interface and Ollama client implementation.
- `apps/worker` should receive an injected `LlmClient` and must not hard-code a model runtime.

## Primary Model

```text
qwen3:4b-instruct-2507-q4_K_M
```

Reasoning:

- Fits the MacBook Air M2 with 8 GB RAM better than default 7B/8B models.
- The pulled Ollama artifact is about 2.5 GB, leaving room within the 200 GB project allocation.
- It is an instruct model, not a thinking model, so responses are less likely to include hidden reasoning blocks.
- It supports the WhatsApp assistant use case: concise instruction following, resource clarification, and multilingual text.

References:

- Ollama model page: <https://ollama.com/library/qwen3%3A4b-instruct-2507-q4_K_M>
- Qwen model card: <https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507>
- Ollama FAQ: <https://docs.ollama.com/faq>

## Embedding Model

```text
mxbai-embed-large
```

Reasoning:

- Keeps retrieval embeddings local and unlimited.
- The pulled Ollama artifact is about 669 MB, which is acceptable inside the 200 GB SSD allocation.
- It returns 1024-dimensional vectors through Ollama's `/api/embed` endpoint.
- It separates chat generation from retrieval indexing, because the primary chat model does not support embeddings.

Reference:

- Ollama model page: <https://ollama.com/library/mxbai-embed-large>

## Host Service Configuration

These values are in `.env` and `.env.example`:

```bash
VIJI_LLM_PROVIDER="ollama"
VIJI_LLM_PROXY_HOST="127.0.0.1"
VIJI_LLM_PROXY_PORT="8791"
VIJI_LLM_PROXY_TOKEN="local-llm-token"
VIJI_OLLAMA_BASE_URL="http://127.0.0.1:11434"
VIJI_OLLAMA_DOCKER_BASE_URL="http://host.docker.internal:11434"
VIJI_OLLAMA_MODEL="qwen3:4b-instruct-2507-q4_K_M"
VIJI_OLLAMA_EMBEDDING_MODEL="mxbai-embed-large"
VIJI_OLLAMA_TIMEOUT_MS="120000"
VIJI_OLLAMA_TEMPERATURE="0.2"
VIJI_OLLAMA_NUM_PREDICT="160"
VIJI_OLLAMA_CONTEXT_WINDOW_TOKENS="4096"
OLLAMA_MODELS="/Volumes/Arya 1TB/VijiAI/models/ollama"
OLLAMA_HOST="127.0.0.1:11434"
OLLAMA_NO_CLOUD="1"
OLLAMA_FLASH_ATTENTION="1"
OLLAMA_KV_CACHE_TYPE="q8_0"
```

On macOS, Ollama service environment is set through `launchctl` before starting the service:

```bash
launchctl setenv OLLAMA_MODELS "/Volumes/Arya 1TB/VijiAI/models/ollama"
launchctl setenv OLLAMA_HOST "127.0.0.1:11434"
launchctl setenv OLLAMA_NO_CLOUD "1"
launchctl setenv OLLAMA_FLASH_ATTENTION "1"
launchctl setenv OLLAMA_KV_CACHE_TYPE "q8_0"
brew services start ollama
```

## Verification

Check runtime health:

```bash
curl -fsS http://127.0.0.1:11434/api/tags
OLLAMA_MODELS="/Volumes/Arya 1TB/VijiAI/models/ollama" ollama list
du -sh "/Volumes/Arya 1TB/VijiAI/models/ollama"
```

Run the project smoke test:

```bash
corepack pnpm typecheck
node --test tests/ai/ollama-client.test.mjs
corepack pnpm ai:smoke
```

Run the local proxy:

```bash
corepack pnpm llm-proxy:start
```

Or run the proxy in Docker while it calls the host Ollama service:

```bash
docker compose --profile ai up --build llm-proxy
```

Health endpoint:

```bash
curl -fsS \
  -H "x-viji-llm-token: local-llm-token" \
  http://127.0.0.1:8791/health
```

Embedding endpoint:

```bash
curl -fsS \
  -H "content-type: application/json" \
  -H "x-viji-llm-token: local-llm-token" \
  -d '{"text":"Registered filename: Vijayalakshmi_Marksheet.pdf"}' \
  http://127.0.0.1:8791/embed
```

Expected health state:

- `model.status` is `healthy` for `qwen3:4b-instruct-2507-q4_K_M`.
- `embeddingModel.status` is `healthy` for `mxbai-embed-large`.
- `/embed` returns a 1024-dimensional vector.

## Fallback Behavior

If the model is missing, unavailable, or times out:

- `packages/ai` returns `ai.model_missing` or `ai.model_unavailable`.
- The worker records the agent run as failed.
- No outbound job should be created from a failed model run.
- Runtime status surfaces should show model health before auto-reply is enabled.

This is an idle state, not a fallback reply.
