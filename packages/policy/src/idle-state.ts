import { ERROR_CODES, type ErrorCode } from "@viji/shared";

import type {
  PolicyDecisionReason,
  PolicyDependencyName,
  PolicyDependencyState,
  PolicyHealthInputs
} from "./types.js";

export interface BlockingDependency {
  dependency: PolicyDependencyName;
  state: PolicyDependencyState;
  reason: PolicyDecisionReason;
  code: ErrorCode;
}

const DEPENDENCY_BLOCKS: Record<
  PolicyDependencyName,
  { reason: PolicyDecisionReason; code: ErrorCode }
> = {
  storage: {
    reason: "storage_not_healthy",
    code: ERROR_CODES.storage.writeUnavailable
  },
  database: {
    reason: "database_not_healthy",
    code: ERROR_CODES.database.unavailable
  },
  adapter: {
    reason: "adapter_not_healthy",
    code: ERROR_CODES.adapter.networkUnavailable
  },
  model: {
    reason: "model_not_healthy",
    code: ERROR_CODES.ai.modelUnavailable
  }
};

export function isBlockingDependencyState(state: PolicyDependencyState): boolean {
  return state !== "healthy";
}

export function findBlockingDependency(
  health: PolicyHealthInputs
): BlockingDependency | null {
  const dependencyNames: PolicyDependencyName[] = [
    "storage",
    "database",
    "adapter",
    "model"
  ];

  for (const dependency of dependencyNames) {
    const state = health[dependency];
    if (isBlockingDependencyState(state)) {
      const block = DEPENDENCY_BLOCKS[dependency];
      return {
        dependency,
        state,
        reason: block.reason,
        code: block.code
      };
    }
  }

  return null;
}
