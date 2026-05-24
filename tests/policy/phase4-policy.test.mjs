import assert from "node:assert/strict";
import test from "node:test";

import { assertSuccess, run } from "../helpers/disposable-postgres.mjs";

const build = run("corepack", ["pnpm", "--filter", "@viji/policy", "build"]);
assertSuccess(build, "build @viji/policy");

const { evaluateOutboundPolicy } = await import(
  "../../packages/policy/dist/index.js"
);

function basePolicyInput(overrides = {}) {
  return {
    globalKillSwitch: false,
    idempotencyKeyAlreadySent: false,
    ...overrides,
    intent: {
      kind: "text_reply",
      messageAgeSeconds: 30,
      maxMessageAgeSeconds: 300,
      ...overrides.intent
    },
    contact: {
      isAllowlisted: true,
      trustLevel: "trusted",
      ...overrides.contact
    },
    conversation: {
      mode: "auto",
      contextState: "fresh",
      isPaused: false,
      ...overrides.conversation
    },
    health: {
      storage: "healthy",
      database: "healthy",
      adapter: "healthy",
      model: "healthy",
      ...overrides.health
    }
  };
}

function exactResource(overrides = {}) {
  return {
    resourceId: "res-file-001",
    registeredFileName: "marksheet.pdf",
    isAllowedForContact: true,
    matchConfidence: "exact",
    hasRecipientConfirmation: false,
    confirmedResourceId: null,
    pendingConfirmationResourceId: "res-file-001",
    confirmationExpired: false,
    ...overrides
  };
}

test("auto mode allows trusted text replies when every send gate passes", () => {
  const decision = evaluateOutboundPolicy(basePolicyInput());

  assert.equal(decision.allowed, true);
  assert.equal(decision.action, "allow_text");
  assert.equal(decision.outcome, "allowed");
  assert.equal(decision.reasons.includes("text_auto_allowed"), true);
});

test("unknown contacts are ignored before any outbound behavior", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      contact: { isAllowlisted: false }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.action, "ignore");
  assert.equal(decision.code, "policy.contact_not_allowed");
});

test("readonly mode blocks outbound jobs", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      conversation: { mode: "readonly" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.action, "block");
  assert.equal(decision.code, "policy.readonly_mode");
});

test("paused conversations do not draft or send", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      conversation: { isPaused: true }
    })
  );

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, ["conversation_paused"]);
});

test("paused mode blocks outbound behavior", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      conversation: { mode: "paused" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, ["mode_paused"]);
});

test("idle mode blocks outbound behavior", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      conversation: { mode: "idle" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.idle_mode");
});

test("stale context blocks auto-send after reconnect uncertainty", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      conversation: { contextState: "stale" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.stale_context");
});

test("storage full blocks send behavior", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      health: { storage: "full" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, ["storage_not_healthy"]);
  assert.equal(decision.code, "storage.write_unavailable");
});

test("database, adapter, and model health are required for normal text sends", () => {
  const databaseDecision = evaluateOutboundPolicy(
    basePolicyInput({ health: { database: "unavailable" } })
  );
  const adapterDecision = evaluateOutboundPolicy(
    basePolicyInput({ health: { adapter: "degraded" } })
  );
  const modelDecision = evaluateOutboundPolicy(
    basePolicyInput({ health: { model: "unavailable" } })
  );

  assert.equal(databaseDecision.code, "database.unavailable");
  assert.equal(adapterDecision.code, "adapter.network_unavailable");
  assert.equal(modelDecision.code, "ai.model_unavailable");
});

test("global kill switch blocks even otherwise valid replies", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      globalKillSwitch: true
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.global_kill_switch");
});

test("auto text requires trusted contact level", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      contact: { trustLevel: "normal" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.contact_trust_insufficient");
});

test("duplicate outbound idempotency keys block repeat sends", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      idempotencyKeyAlreadySent: true
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.duplicate_outbound");
});

test("old messages are not auto-replied to", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: {
        messageAgeSeconds: 301,
        maxMessageAgeSeconds: 300
      }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.message_too_old");
});

test("confirm_resource mode blocks unrelated auto text replies", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      conversation: { mode: "confirm_resource" }
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.mode_does_not_allow_text");
});

test("exact registered resource match allows the WhatsApp confirmation prompt", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: { kind: "resource_confirmation_prompt" },
      conversation: { mode: "confirm_resource" },
      resource: exactResource()
    })
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.action, "allow_resource_confirmation_prompt");
  assert.equal(
    decision.reasons.includes("resource_confirmation_required"),
    true
  );
});

test("normal file send requires Vijayalakshmi's exact-file confirmation", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: { kind: "resource_send" },
      conversation: { mode: "confirm_resource" },
      resource: exactResource()
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.action, "require_resource_confirmation");
  assert.equal(decision.code, "policy.recipient_confirmation_required");
});

test("exact confirmed file send is allowed only for the confirmed resource", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: { kind: "resource_send" },
      conversation: { mode: "confirm_resource" },
      resource: exactResource({
        hasRecipientConfirmation: true,
        confirmedResourceId: "res-file-001"
      })
    })
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.action, "allow_resource");
});

test("ambiguous resource matches ask for clarification and do not send", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: { kind: "resource_send" },
      conversation: { mode: "confirm_resource" },
      resource: exactResource({
        matchConfidence: "high"
      })
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.action, "ask_clarification");
  assert.equal(decision.code, "policy.resource_match_ambiguous");
});

test("resource confirmation mismatch does not send a different file", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: { kind: "resource_send" },
      conversation: { mode: "confirm_resource" },
      resource: exactResource({
        hasRecipientConfirmation: true,
        confirmedResourceId: "res-file-002"
      })
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.action, "ask_clarification");
  assert.deepEqual(decision.reasons, ["resource_confirmation_mismatch"]);
});

test("resource allowlist policy blocks restricted files", () => {
  const decision = evaluateOutboundPolicy(
    basePolicyInput({
      intent: { kind: "resource_send" },
      conversation: { mode: "confirm_resource" },
      resource: exactResource({
        isAllowedForContact: false,
        hasRecipientConfirmation: true,
        confirmedResourceId: "res-file-001"
      })
    })
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "policy.resource_not_allowed");
});
