import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSuccess,
  run,
  startDisposablePostgres
} from "../helpers/disposable-postgres.mjs";
import {
  countRows,
  createVijayalakshmiFixtureHarness
} from "../helpers/redacted-vijayalakshmi-fixture.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/worker", "build"]);
assertSuccess(build, "build @viji/worker");

const { createPgPool, createRepositories } = await import(
  "../../packages/db/dist/index.js"
);
const { rankResourceCandidates } = await import(
  "../../packages/resources/dist/index.js"
);
const {
  createResourceSuggestionDraftForInboundMessage,
  findSemanticResourceMatches
} = await import("../../apps/worker/dist/index.js");

const TEST_EMBEDDING_MODEL = "phase24-test-embedding";

function vectorForText(text) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("final school scorecard") ||
    normalized.includes("higher secondary") ||
    normalized.includes("twelfth board") ||
    normalized.includes("grade twelve")
  ) {
    return [1, 0, 0];
  }
  if (
    normalized.includes("secondary school") ||
    normalized.includes("tenth board") ||
    normalized.includes("grade ten")
  ) {
    return [0, 1, 0];
  }

  return [0, 0, 1];
}

const embeddingClient = {
  async embedText(input) {
    return {
      modelName: input.modelName ?? TEST_EMBEDDING_MODEL,
      vector: vectorForText(input.text),
      dimensions: 3,
      latencyMs: 0,
      inputTokens: Math.max(1, input.text.trim().split(/\s+/).length)
    };
  }
};

function semanticEnv(overrides = {}) {
  return {
    ...process.env,
    VIJI_RESOURCE_SEMANTIC_ENABLED: "true",
    VIJI_RESOURCE_EMBEDDING_MODEL: TEST_EMBEDDING_MODEL,
    VIJI_RESOURCE_SEMANTIC_MIN_SCORE: "0.7",
    VIJI_RESOURCE_EMBEDDING_INDEX_LIMIT: "20",
    VIJI_RESOURCE_EMBEDDING_CHUNK_LIMIT_PER_RESOURCE: "8",
    VIJI_RESOURCE_SEMANTIC_SEARCH_LIMIT: "5",
    ...overrides
  };
}

async function seedSemanticMarksheetResources(repositories, contactId) {
  const tenth = await repositories.resources.registerFileResource({
    storageUri: "./viji-files/viji_10_marksheet.pdf",
    checksumSha256: "sha256-phase24-10",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    registeredFileName: "viji_10_marksheet.pdf",
    title: "Viji grade ten academic PDF",
    aliases: ["grade ten record", "tenth board record"],
    description: "Secondary school academic file for Vijayalakshmi.",
    contentSummary: "Secondary school performance record for grade ten.",
    allowedContactIds: [contactId]
  });
  const twelfth = await repositories.resources.registerFileResource({
    storageUri: "./viji-files/viji_12_marksheet.pdf",
    checksumSha256: "sha256-phase24-12",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    registeredFileName: "viji_12_marksheet.pdf",
    title: "Viji grade twelve academic PDF",
    aliases: ["grade twelve record", "twelfth board record"],
    description: "Higher secondary academic file for Vijayalakshmi.",
    contentSummary: "Higher secondary board performance record for grade twelve.",
    allowedContactIds: [contactId]
  });

  const source = await repositories.knowledge.upsertKnowledgeSource({
    type: "resource_file_asset",
    name: "Phase 24 semantic fixture source",
    uri: "fixture://phase24/semantic-marksheets"
  });
  const document = await repositories.knowledge.upsertKnowledgeDocument({
    knowledgeSourceId: source.knowledgeSourceId,
    fileAssetId: twelfth.fileAssetId,
    title: "Viji 12th marksheet extracted text",
    mimeType: "application/pdf",
    contentHash: "phase24-12-document-hash",
    indexedState: "chunked",
    extractionStatus: "extracted",
    extractorName: "phase24-fixture",
    extractorVersion: "1",
    extractorMetadata: { redacted: true }
  });
  await repositories.knowledge.replaceDocumentChunks({
    documentId: document.documentId,
    chunks: [
      {
        chunkIndex: 0,
        content:
          "Higher secondary twelfth board score details for Vijayalakshmi.",
        tokenCount: 8,
        metadata: { page: 1 }
      }
    ]
  });

  return { tenth, twelfth };
}

test("exact filename ranking remains stronger than semantic-only matches", () => {
  const candidates = rankResourceCandidates(
    [
      {
        resourceId: "exact",
        registeredFileName: "viji_resume.pdf",
        title: "Viji resume",
        aliases: [],
        description: null,
        contentSummary: null
      },
      {
        resourceId: "semantic",
        registeredFileName: "viji_12_marksheet.pdf",
        title: "Viji grade twelve academic PDF",
        aliases: [],
        description: null,
        contentSummary: null
      }
    ],
    "please send viji_resume.pdf",
    {
      semanticMatches: [{ resourceId: "semantic", semanticScore: 1 }],
      semanticWeight: 100
    }
  );

  assert.equal(candidates[0].resourceId, "exact");
  assert.equal(candidates[0].semanticScore, null);
});

test("semantic retrieval suggests a file when the query uses different wording", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase24-semantic"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      await seedSemanticMarksheetResources(
        repositories,
        harness.contact.contactId
      );
      const inbound = await harness.createInboundMessage({
        externalMessageId: "wamid.redacted.vijayalakshmi.phase24-semantic",
        body: "can you send my final school scorecard"
      });

      const proposal = await createResourceSuggestionDraftForInboundMessage(
        pool,
        {
          triggerMessageId: inbound.messageId,
          now: new Date("2026-05-01T10:01:00.000Z"),
          env: semanticEnv(),
          embeddingClient
        }
      );

      assert.equal(proposal.status, "suggested");
      assert.match(proposal.draft.body, /viji_12_marksheet\.pdf/);
      assert.equal(proposal.proposal.options[0].registeredFileName, "viji_12_marksheet.pdf");
      assert.equal(await countRows(pool, "kb_embedding_models"), 1);
      assert.equal(await countRows(pool, "kb_retrieval_runs"), 1);
      assert.ok((await countRows(pool, "kb_embeddings")) >= 2);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});

test("semantic retrieval still enforces contact-level resource permissions", async () => {
  const postgres = await startDisposablePostgres({
    prefix: "viji-phase24-permissions"
  });

  try {
    postgres.runProjectScript("scripts/run-migrations.mjs");
    const pool = createPgPool({ connectionString: postgres.connectionString });

    try {
      const repositories = createRepositories(pool);
      const harness = await createVijayalakshmiFixtureHarness(repositories);
      const otherPerson = await repositories.contacts.createPerson({
        displayName: "Other fixture person"
      });
      const otherContact =
        await repositories.contacts.createAllowlistedContact({
          ownerPersonId: otherPerson.personId,
          displayName: "Other fixture contact"
        });
      const privateResource =
        await repositories.resources.registerFileResource({
          storageUri: "./viji-files/private_scorecard.pdf",
          checksumSha256: "sha256-phase24-private",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          registeredFileName: "private_scorecard.pdf",
          title: "Private higher secondary scorecard",
          aliases: ["higher secondary scorecard"],
          description: "Higher secondary scorecard for a different contact.",
          contentSummary: "Higher secondary twelfth board score details.",
          allowedContactIds: [otherContact.contactId]
        });
      const model = await repositories.knowledge.upsertEmbeddingModel({
        name: TEST_EMBEDDING_MODEL,
        dimensions: 3,
        runtime: "local"
      });
      await repositories.knowledge.upsertResourceEmbedding({
        resourceId: privateResource.resourceId,
        embeddingModelId: model.embeddingModelId,
        vector: [1, 0, 0],
        contentHash: "phase24-private-embedding"
      });

      const matches = await findSemanticResourceMatches(pool, {
        queryText: "send final school scorecard",
        contactId: harness.contact.contactId,
        env: semanticEnv(),
        embeddingClient
      });

      assert.deepEqual(matches, []);
    } finally {
      await pool.end();
    }
  } finally {
    postgres.stop();
  }
});
