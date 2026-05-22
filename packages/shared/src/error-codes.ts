type LeafValues<T> = T extends string
  ? T
  : T extends Record<string, unknown>
    ? { [K in keyof T]: LeafValues<T[K]> }[keyof T]
    : never;

export const ERROR_CODES = {
  adapter: {
    authRequired: "adapter.auth_required",
    backoffActive: "adapter.backoff_active",
    commandFailed: "adapter.command_failed",
    networkUnavailable: "adapter.network_unavailable",
    sendFailed: "adapter.send_failed",
    storageUnavailable: "adapter.storage_unavailable",
    storeLocked: "adapter.store_locked",
    unknown: "adapter.unknown",
    unsupportedPayload: "adapter.unsupported_payload"
  },
  ai: {
    modelMissing: "ai.model_missing",
    modelUnavailable: "ai.model_unavailable",
    promptRejected: "ai.prompt_rejected"
  },
  database: {
    migrationFailed: "database.migration_failed",
    unavailable: "database.unavailable",
    writeRejected: "database.write_rejected"
  },
  policy: {
    contactNotAllowed: "policy.contact_not_allowed",
    contactTrustInsufficient: "policy.contact_trust_insufficient",
    conversationPaused: "policy.conversation_paused",
    duplicateOutbound: "policy.duplicate_outbound",
    globalKillSwitch: "policy.global_kill_switch",
    idleMode: "policy.idle_mode",
    messageTooOld: "policy.message_too_old",
    modeDoesNotAllowText: "policy.mode_does_not_allow_text",
    readonlyMode: "policy.readonly_mode",
    resourceConfirmationMismatch: "policy.resource_confirmation_mismatch",
    resourceMatchAmbiguous: "policy.resource_match_ambiguous",
    resourceNotAllowed: "policy.resource_not_allowed",
    recipientConfirmationRequired: "policy.recipient_confirmation_required",
    staleContext: "policy.stale_context"
  },
  storage: {
    dataRootMissing: "storage.data_root_missing",
    filesystemLow: "storage.filesystem_low",
    quotaCritical: "storage.quota_critical",
    quotaWarning: "storage.quota_warning",
    sentinelUnavailable: "storage.sentinel_unavailable",
    writeUnavailable: "storage.write_unavailable"
  },
  system: {
    invalidConfig: "system.invalid_config",
    invalidState: "system.invalid_state",
    notImplemented: "system.not_implemented"
  }
} as const;

export type ErrorCode = LeafValues<typeof ERROR_CODES>;
