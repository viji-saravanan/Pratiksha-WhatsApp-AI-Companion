import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface ChannelAccountRecord {
  channelAccountId: string;
  channel: "whatsapp_personal";
  adapterType: "wacli" | "whatsmeow" | "baileys" | "wwebjs" | "official_cloud";
  label: string;
  storePath: string;
  state: "ready" | "auth_required" | "backoff" | "readonly" | "disabled";
}

export interface CreateChannelAccountInput {
  channel?: ChannelAccountRecord["channel"];
  adapterType?: ChannelAccountRecord["adapterType"];
  label: string;
  storePath: string;
  state?: ChannelAccountRecord["state"];
}

export function createChannelAccountsRepository(db: DbExecutor) {
  return {
    async createChannelAccount(
      input: CreateChannelAccountInput
    ): Promise<ChannelAccountRecord> {
      return queryRequired<ChannelAccountRecord>(
        db,
        `
          INSERT INTO core_channel_accounts (
            core_channel_account_channel,
            core_channel_account_adapter_type,
            core_channel_account_label,
            core_channel_account_store_path,
            core_channel_account_state
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING
            core_channel_account_id AS "channelAccountId",
            core_channel_account_channel AS "channel",
            core_channel_account_adapter_type AS "adapterType",
            core_channel_account_label AS "label",
            core_channel_account_store_path AS "storePath",
            core_channel_account_state AS "state"
        `,
        [
          input.channel ?? "whatsapp_personal",
          input.adapterType ?? "wacli",
          input.label,
          input.storePath,
          input.state ?? "auth_required"
        ],
        "Failed to create channel account"
      );
    },

    async findChannelAccountById(
      channelAccountId: string
    ): Promise<ChannelAccountRecord | null> {
      return queryOne<ChannelAccountRecord>(
        db,
        `
          SELECT
            core_channel_account_id AS "channelAccountId",
            core_channel_account_channel AS "channel",
            core_channel_account_adapter_type AS "adapterType",
            core_channel_account_label AS "label",
            core_channel_account_store_path AS "storePath",
            core_channel_account_state AS "state"
          FROM core_channel_accounts
          WHERE core_channel_account_id = $1
        `,
        [channelAccountId]
      );
    }
  };
}
