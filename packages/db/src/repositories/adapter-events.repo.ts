import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface AdapterEventRecord {
  adapterEventId: string;
  channelAccountId: string;
  type: string;
  externalEventId: string | null;
  payload: Record<string, unknown>;
  inserted: boolean;
}

export interface InsertAdapterEventInput {
  channelAccountId: string;
  type: string;
  externalEventId?: string | null;
  payload?: Record<string, unknown>;
}

export type IdempotentAdapterEventResult =
  | { status: "inserted"; event: AdapterEventRecord }
  | { status: "existing"; event: AdapterEventRecord };

export function createAdapterEventsRepository(db: DbExecutor) {
  return {
    async insertAdapterEventIdempotent(
      input: InsertAdapterEventInput
    ): Promise<IdempotentAdapterEventResult> {
      if (!input.externalEventId) {
        const event = await queryRequired<AdapterEventRecord>(
          db,
          `
            INSERT INTO ops_adapter_events (
              source_core_channel_account_id,
              ops_adapter_event_type,
              ops_adapter_event_external_event_id,
              ops_adapter_event_payload
            ) VALUES ($1, $2, NULL, $3::jsonb)
            RETURNING
              ops_adapter_event_id AS "adapterEventId",
              source_core_channel_account_id AS "channelAccountId",
              ops_adapter_event_type AS "type",
              ops_adapter_event_external_event_id AS "externalEventId",
              ops_adapter_event_payload AS "payload",
              true AS "inserted"
          `,
          [input.channelAccountId, input.type, JSON.stringify(input.payload ?? {})],
          "Failed to insert adapter event"
        );
        return { status: "inserted", event };
      }

      const inserted = await queryOne<AdapterEventRecord>(
        db,
        `
          INSERT INTO ops_adapter_events (
            source_core_channel_account_id,
            ops_adapter_event_type,
            ops_adapter_event_external_event_id,
            ops_adapter_event_payload
          ) VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (
            source_core_channel_account_id,
            ops_adapter_event_external_event_id
          ) WHERE ops_adapter_event_external_event_id IS NOT NULL
          DO NOTHING
          RETURNING
            ops_adapter_event_id AS "adapterEventId",
            source_core_channel_account_id AS "channelAccountId",
            ops_adapter_event_type AS "type",
            ops_adapter_event_external_event_id AS "externalEventId",
            ops_adapter_event_payload AS "payload",
            true AS "inserted"
        `,
        [
          input.channelAccountId,
          input.type,
          input.externalEventId,
          JSON.stringify(input.payload ?? {})
        ]
      );

      if (inserted) {
        return { status: "inserted", event: inserted };
      }

      const existing = await queryRequired<AdapterEventRecord>(
        db,
        `
          SELECT
            ops_adapter_event_id AS "adapterEventId",
            source_core_channel_account_id AS "channelAccountId",
            ops_adapter_event_type AS "type",
            ops_adapter_event_external_event_id AS "externalEventId",
            ops_adapter_event_payload AS "payload",
            false AS "inserted"
          FROM ops_adapter_events
          WHERE source_core_channel_account_id = $1
            AND ops_adapter_event_external_event_id = $2
        `,
        [input.channelAccountId, input.externalEventId],
        "Failed to load existing adapter event"
      );

      return { status: "existing", event: existing };
    }
  };
}
