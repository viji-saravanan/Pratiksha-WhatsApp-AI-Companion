import {
  callFailure,
  callSuccess,
  ERROR_CODES,
  type ExternalCallResult
} from "@viji/shared";

import type { AgentOutboundJobKind } from "@viji/db";

export interface OutboundSendIntent {
  outboundJobId: string;
  idempotencyKey: string;
  kind: AgentOutboundJobKind;
  conversationId: string;
  sourceDraftId: string | null;
  payload: Record<string, unknown>;
}

export interface OutboundDispatchSuccess {
  externalMessageId: string | null;
}

export interface OutboundDispatcher {
  readonly adapterType: string;
  dispatch(
    intent: OutboundSendIntent
  ): Promise<ExternalCallResult<OutboundDispatchSuccess>>;
}

export interface RecordedOutboundDispatcherOptions {
  fail?: boolean;
  retryable?: boolean;
  errorMessage?: string;
}

export interface RecordedOutboundDispatcher extends OutboundDispatcher {
  readonly intents: OutboundSendIntent[];
}

export function createRecordedOutboundDispatcher(
  options: RecordedOutboundDispatcherOptions = {}
): RecordedOutboundDispatcher {
  const intents: OutboundSendIntent[] = [];

  return {
    adapterType: "recorded-test",
    intents,
    async dispatch(
      intent: OutboundSendIntent
    ): Promise<ExternalCallResult<OutboundDispatchSuccess>> {
      intents.push(intent);

      if (options.fail) {
        return callFailure(
          ERROR_CODES.adapter.commandFailed,
          options.errorMessage ?? "Recorded dispatcher failed",
          {
            component: "recorded-outbound-dispatcher",
            operation: "dispatch"
          },
          {
            retryable: options.retryable ?? true
          }
        );
      }

      return callSuccess(
        {
          externalMessageId: `recorded:${intent.idempotencyKey.slice(0, 24)}`
        },
        {
          component: "recorded-outbound-dispatcher",
          operation: "dispatch"
        }
      );
    }
  };
}

export function createDisabledLiveOutboundDispatcher(): OutboundDispatcher {
  return {
    adapterType: "wacli-disabled",
    async dispatch(): Promise<ExternalCallResult<OutboundDispatchSuccess>> {
      return callFailure(
        ERROR_CODES.system.notImplemented,
        "Live WhatsApp dispatch is disabled until Phase 8 adapter hardening is accepted.",
        {
          component: "disabled-live-outbound-dispatcher",
          operation: "dispatch"
        },
        {
          retryable: false
        }
      );
    }
  };
}
