import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface FileResourceRecord {
  resourceId: string;
  fileAssetId: string | null;
  registeredFileName: string;
  title: string;
  aliases: string[];
  description: string | null;
  contentSummary: string | null;
  type: "file" | "link" | "note" | "template";
  sensitivity: "public" | "normal" | "private" | "restricted";
  allowedContactIds: string[] | null;
  requiresRecipientConfirmation: boolean;
  isActive: boolean;
}

export interface FileAssetRecord {
  fileAssetId: string;
  storageUri: string;
  originalUri: string | null;
  checksumSha256: string;
  mimeType: string;
  sizeBytes: string;
  storageState: "available" | "missing" | "quarantined" | "deleted";
}

export interface FileResourceForSendRecord extends FileResourceRecord {
  storageUri: string | null;
  mimeType: string | null;
  checksumSha256: string | null;
  sizeBytes: string | null;
}

export interface UpsertFileAssetInput {
  storageUri: string;
  originalUri?: string | null;
  checksumSha256: string;
  mimeType: string;
  sizeBytes: number;
  storageState?: FileAssetRecord["storageState"];
}

export interface RegisterFileResourceInput {
  storageUri: string;
  originalUri?: string | null;
  checksumSha256: string;
  mimeType: string;
  sizeBytes: number;
  registeredFileName: string;
  title: string;
  aliases?: string[];
  description?: string | null;
  contentSummary?: string | null;
  sensitivity?: FileResourceRecord["sensitivity"];
  allowedContactIds?: string[] | null;
  requiresRecipientConfirmation?: boolean;
  isActive?: boolean;
}

export interface CreateFileResourceForAssetInput {
  fileAssetId: string;
  registeredFileName: string;
  title: string;
  aliases?: string[];
  description?: string | null;
  contentSummary?: string | null;
  sensitivity?: FileResourceRecord["sensitivity"];
  allowedContactIds?: string[] | null;
  requiresRecipientConfirmation?: boolean;
  isActive?: boolean;
}

export interface CreateResourceProposalInput {
  agentDraftId: string;
  conversationId: string;
  triggerMessageId: string;
  queryText: string;
  options: Array<{
    resourceId: string;
    rank: number;
    score: number;
  }>;
}

export interface ResourceProposalRecord {
  resourceProposalId: string;
  agentDraftId: string;
  conversationId: string;
  triggerMessageId: string;
  queryText: string;
  state: "pending" | "resolved" | "expired" | "blocked";
}

export interface ResourceProposalOptionRecord extends FileResourceRecord {
  resourceProposalOptionId: string;
  resourceProposalId: string;
  rank: number;
  score: string;
}

export interface ResourceProposalWithOptions {
  proposal: ResourceProposalRecord;
  options: ResourceProposalOptionRecord[];
}

function resourceReturningSql(): string {
  return `
    res_resources.res_resource_id AS "resourceId",
    res_resources.backing_res_file_asset_id AS "fileAssetId",
    res_resources.res_resource_registered_file_name AS "registeredFileName",
    res_resources.res_resource_title AS "title",
    res_resources.res_resource_aliases AS "aliases",
    res_resources.res_resource_description AS "description",
    res_resources.res_resource_content_summary AS "contentSummary",
    res_resources.res_resource_type AS "type",
    res_resources.res_resource_sensitivity AS "sensitivity",
    res_resources.res_resource_allowed_contact_ids AS "allowedContactIds",
    res_resources.res_resource_requires_recipient_confirmation AS "requiresRecipientConfirmation",
    res_resources.res_resource_is_active AS "isActive"
  `;
}

function fileAssetReturningSql(): string {
  return `
    res_file_asset_id AS "fileAssetId",
    res_file_asset_storage_uri AS "storageUri",
    res_file_asset_original_uri AS "originalUri",
    res_file_asset_checksum_sha256 AS "checksumSha256",
    res_file_asset_mime_type AS "mimeType",
    res_file_asset_size_bytes AS "sizeBytes",
    res_file_asset_storage_state AS "storageState"
  `;
}

function proposalReturningSql(table = ""): string {
  const prefix = table ? `${table}.` : "";
  return `
    ${prefix}res_resource_proposal_id AS "resourceProposalId",
    ${prefix}source_agent_draft_id AS "agentDraftId",
    ${prefix}target_msg_conversation_id AS "conversationId",
    ${prefix}trigger_msg_message_id AS "triggerMessageId",
    ${prefix}res_resource_proposal_query_text AS "queryText",
    ${prefix}res_resource_proposal_state AS "state"
  `;
}

export function createResourcesRepository(db: DbExecutor) {
  return {
    async upsertFileAsset(input: UpsertFileAssetInput): Promise<FileAssetRecord> {
      return queryRequired<FileAssetRecord>(
        db,
        `
          INSERT INTO res_file_assets (
            res_file_asset_storage_uri,
            res_file_asset_original_uri,
            res_file_asset_checksum_sha256,
            res_file_asset_mime_type,
            res_file_asset_size_bytes,
            res_file_asset_storage_state
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (res_file_asset_storage_uri) DO UPDATE
          SET
            res_file_asset_original_uri = EXCLUDED.res_file_asset_original_uri,
            res_file_asset_checksum_sha256 = EXCLUDED.res_file_asset_checksum_sha256,
            res_file_asset_mime_type = EXCLUDED.res_file_asset_mime_type,
            res_file_asset_size_bytes = EXCLUDED.res_file_asset_size_bytes,
            res_file_asset_storage_state = EXCLUDED.res_file_asset_storage_state,
            res_file_asset_updated_at = now()
          RETURNING ${fileAssetReturningSql()}
        `,
        [
          input.storageUri,
          input.originalUri ?? null,
          input.checksumSha256,
          input.mimeType,
          input.sizeBytes,
          input.storageState ?? "available"
        ],
        "Failed to upsert file asset"
      );
    },

    async createFileResourceForAsset(
      input: CreateFileResourceForAssetInput
    ): Promise<FileResourceRecord> {
      return queryRequired<FileResourceRecord>(
        db,
        `
          INSERT INTO res_resources (
            backing_res_file_asset_id,
            res_resource_registered_file_name,
            res_resource_title,
            res_resource_aliases,
            res_resource_description,
            res_resource_content_summary,
            res_resource_type,
            res_resource_sensitivity,
            res_resource_allowed_contact_ids,
            res_resource_requires_recipient_confirmation,
            res_resource_is_active
          ) VALUES (
            $1,
            $2,
            $3,
            $4::text[],
            $5,
            $6,
            'file',
            $7,
            $8::uuid[],
            $9,
            $10
          )
          ON CONFLICT (res_resource_registered_file_name) DO UPDATE
          SET
            backing_res_file_asset_id = EXCLUDED.backing_res_file_asset_id,
            res_resource_title = EXCLUDED.res_resource_title,
            res_resource_aliases = EXCLUDED.res_resource_aliases,
            res_resource_description = EXCLUDED.res_resource_description,
            res_resource_content_summary = EXCLUDED.res_resource_content_summary,
            res_resource_sensitivity = EXCLUDED.res_resource_sensitivity,
            res_resource_allowed_contact_ids = EXCLUDED.res_resource_allowed_contact_ids,
            res_resource_requires_recipient_confirmation =
              EXCLUDED.res_resource_requires_recipient_confirmation,
            res_resource_is_active = EXCLUDED.res_resource_is_active,
            res_resource_updated_at = now()
          RETURNING ${resourceReturningSql()}
        `,
        [
          input.fileAssetId,
          input.registeredFileName,
          input.title,
          input.aliases ?? [],
          input.description ?? null,
          input.contentSummary ?? null,
          input.sensitivity ?? "normal",
          input.allowedContactIds ?? null,
          input.requiresRecipientConfirmation ?? true,
          input.isActive ?? true
        ],
        "Failed to register resource"
      );
    },

    async registerFileResource(
      input: RegisterFileResourceInput
    ): Promise<FileResourceRecord> {
      const fileAsset = await this.upsertFileAsset({
        storageUri: input.storageUri,
        originalUri: input.originalUri,
        checksumSha256: input.checksumSha256,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageState: "available"
      });

      return this.createFileResourceForAsset({
        fileAssetId: fileAsset.fileAssetId,
        registeredFileName: input.registeredFileName,
        title: input.title,
        aliases: input.aliases,
        description: input.description,
        contentSummary: input.contentSummary,
        sensitivity: input.sensitivity,
        allowedContactIds: input.allowedContactIds,
        requiresRecipientConfirmation: input.requiresRecipientConfirmation,
        isActive: input.isActive
      });
    },

    async listSearchableFileResources(input: {
      contactId?: string | null;
      limit?: number;
    } = {}): Promise<FileResourceRecord[]> {
      const result = await db.query<FileResourceRecord>(
        `
          SELECT ${resourceReturningSql()}
          FROM res_resources
          LEFT JOIN res_file_assets
            ON res_file_assets.res_file_asset_id =
              res_resources.backing_res_file_asset_id
          WHERE res_resources.res_resource_is_active = true
            AND res_resources.res_resource_type = 'file'
            AND (
              res_resources.backing_res_file_asset_id IS NULL OR
              res_file_assets.res_file_asset_storage_state = 'available'
            )
            AND (
              res_resources.res_resource_allowed_contact_ids IS NULL OR
              $1::uuid = ANY(res_resources.res_resource_allowed_contact_ids)
            )
          ORDER BY res_resources.res_resource_registered_file_name ASC
          LIMIT $2
        `,
        [input.contactId ?? null, input.limit ?? 100]
      );

      return result.rows;
    },

    async findFileResourceForSend(
      resourceId: string
    ): Promise<FileResourceForSendRecord | null> {
      return queryOne<FileResourceForSendRecord>(
        db,
        `
          SELECT
            ${resourceReturningSql()},
            res_file_assets.res_file_asset_storage_uri AS "storageUri",
            res_file_assets.res_file_asset_mime_type AS "mimeType",
            res_file_assets.res_file_asset_checksum_sha256 AS "checksumSha256",
            res_file_assets.res_file_asset_size_bytes AS "sizeBytes"
          FROM res_resources
          LEFT JOIN res_file_assets
            ON res_file_assets.res_file_asset_id =
              res_resources.backing_res_file_asset_id
          WHERE res_resources.res_resource_id = $1
            AND res_resources.res_resource_is_active = true
            AND res_resources.res_resource_type = 'file'
            AND (
              res_resources.backing_res_file_asset_id IS NULL OR
              res_file_assets.res_file_asset_storage_state = 'available'
            )
        `,
        [resourceId]
      );
    },

    async updateResourceContentSummary(input: {
      resourceId: string;
      contentSummary: string | null;
    }): Promise<FileResourceRecord> {
      return queryRequired<FileResourceRecord>(
        db,
        `
          UPDATE res_resources
          SET
            res_resource_content_summary = $2,
            res_resource_updated_at = now()
          WHERE res_resource_id = $1
          RETURNING ${resourceReturningSql()}
        `,
        [input.resourceId, input.contentSummary],
        "Failed to update resource content summary"
      );
    },

    async createResourceProposal(
      input: CreateResourceProposalInput
    ): Promise<ResourceProposalWithOptions> {
      const proposal = await queryRequired<ResourceProposalRecord>(
        db,
        `
          INSERT INTO res_resource_proposals (
            source_agent_draft_id,
            target_msg_conversation_id,
            trigger_msg_message_id,
            res_resource_proposal_query_text,
            res_resource_proposal_state
          ) VALUES ($1, $2, $3, $4, 'pending')
          RETURNING ${proposalReturningSql()}
        `,
        [
          input.agentDraftId,
          input.conversationId,
          input.triggerMessageId,
          input.queryText
        ],
        "Failed to create resource proposal"
      );

      for (const option of input.options) {
        await db.query(
          `
            INSERT INTO res_resource_proposal_options (
              parent_res_resource_proposal_id,
              target_res_resource_id,
              res_resource_proposal_option_rank,
              res_resource_proposal_option_score
            ) VALUES ($1, $2, $3, $4)
          `,
          [
            proposal.resourceProposalId,
            option.resourceId,
            option.rank,
            option.score
          ]
        );
      }

      const loaded = await this.findPendingResourceProposalForDraft(
        input.agentDraftId
      );
      if (!loaded) {
        throw new Error("Failed to load created resource proposal");
      }

      return loaded;
    },

    async findPendingResourceProposalForDraft(
      agentDraftId: string
    ): Promise<ResourceProposalWithOptions | null> {
      const proposal = await queryOne<ResourceProposalRecord>(
        db,
        `
          SELECT ${proposalReturningSql("res_resource_proposals")}
          FROM res_resource_proposals
          WHERE source_agent_draft_id = $1
            AND res_resource_proposal_state = 'pending'
        `,
        [agentDraftId]
      );

      if (!proposal) {
        return null;
      }

      const options = await db.query<ResourceProposalOptionRecord>(
        `
          SELECT
            res_resource_proposal_options.res_resource_proposal_option_id
              AS "resourceProposalOptionId",
            res_resource_proposal_options.parent_res_resource_proposal_id
              AS "resourceProposalId",
            res_resource_proposal_options.res_resource_proposal_option_rank
              AS "rank",
            res_resource_proposal_options.res_resource_proposal_option_score
              AS "score",
            ${resourceReturningSql()}
          FROM res_resource_proposal_options
          INNER JOIN res_resources
            ON res_resources.res_resource_id =
              res_resource_proposal_options.target_res_resource_id
          WHERE res_resource_proposal_options.parent_res_resource_proposal_id = $1
          ORDER BY res_resource_proposal_options.res_resource_proposal_option_rank ASC
        `,
        [proposal.resourceProposalId]
      );

      return {
        proposal,
        options: options.rows
      };
    },

    async findLatestPendingResourceProposalForConversation(input: {
      conversationId: string;
      contactId?: string | null;
    }): Promise<ResourceProposalWithOptions | null> {
      const proposal = await queryOne<ResourceProposalRecord>(
        db,
        `
          SELECT ${proposalReturningSql("res_resource_proposals")}
          FROM res_resource_proposals
          INNER JOIN agent_drafts
            ON agent_drafts.agent_draft_id =
              res_resource_proposals.source_agent_draft_id
          INNER JOIN msg_messages
            ON msg_messages.msg_message_id =
              agent_drafts.trigger_msg_message_id
          WHERE res_resource_proposals.target_msg_conversation_id = $1
            AND res_resource_proposals.res_resource_proposal_state = 'pending'
            AND ($2::uuid IS NULL OR msg_messages.sender_core_contact_id = $2::uuid)
          ORDER BY
            res_resource_proposals.res_resource_proposal_created_at DESC
          LIMIT 1
        `,
        [input.conversationId, input.contactId ?? null]
      );

      if (!proposal) {
        return null;
      }

      return this.findPendingResourceProposalForDraft(proposal.agentDraftId);
    },

    async markResourceProposalState(input: {
      resourceProposalId: string;
      state: ResourceProposalRecord["state"];
    }): Promise<ResourceProposalRecord> {
      return queryRequired<ResourceProposalRecord>(
        db,
        `
          UPDATE res_resource_proposals
          SET
            res_resource_proposal_state = $2,
            res_resource_proposal_updated_at = now()
          WHERE res_resource_proposal_id = $1
          RETURNING ${proposalReturningSql()}
        `,
        [input.resourceProposalId, input.state],
        "Failed to update resource proposal state"
      );
    }
  };
}
