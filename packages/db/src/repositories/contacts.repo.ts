import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export interface PersonRecord {
  personId: string;
  displayName: string;
  notes: string | null;
}

export interface ContactRecord {
  contactId: string;
  ownerPersonId: string;
  channel: "whatsapp_personal" | "whatsapp_business";
  displayName: string;
  phoneE164: string | null;
  waJid: string | null;
  isAllowlisted: boolean;
  trustLevel: "low" | "normal" | "trusted";
}

export interface CreatePersonInput {
  displayName: string;
  notes?: string | null;
}

export interface CreateAllowlistedContactInput {
  ownerPersonId: string;
  displayName: string;
  channel?: ContactRecord["channel"];
  phoneE164?: string | null;
  waJid?: string | null;
  trustLevel?: ContactRecord["trustLevel"];
}

function contactReturningSql(): string {
  return `
    core_contact_id AS "contactId",
    owner_core_person_id AS "ownerPersonId",
    core_contact_channel AS "channel",
    core_contact_display_name AS "displayName",
    core_contact_phone_e164 AS "phoneE164",
    core_contact_wa_jid AS "waJid",
    core_contact_is_allowlisted AS "isAllowlisted",
    core_contact_trust_level AS "trustLevel"
  `;
}

export function createContactsRepository(db: DbExecutor) {
  return {
    async createPerson(input: CreatePersonInput): Promise<PersonRecord> {
      return queryRequired<PersonRecord>(
        db,
        `
          INSERT INTO core_people (
            core_person_display_name,
            core_person_notes
          ) VALUES ($1, $2)
          RETURNING
            core_person_id AS "personId",
            core_person_display_name AS "displayName",
            core_person_notes AS "notes"
        `,
        [input.displayName, input.notes ?? null],
        "Failed to create person"
      );
    },

    async createAllowlistedContact(
      input: CreateAllowlistedContactInput
    ): Promise<ContactRecord> {
      return queryRequired<ContactRecord>(
        db,
        `
          INSERT INTO core_contacts (
            owner_core_person_id,
            core_contact_channel,
            core_contact_display_name,
            core_contact_phone_e164,
            core_contact_wa_jid,
            core_contact_is_allowlisted,
            core_contact_trust_level
          ) VALUES ($1, $2, $3, $4, $5, true, $6)
          RETURNING ${contactReturningSql()}
        `,
        [
          input.ownerPersonId,
          input.channel ?? "whatsapp_personal",
          input.displayName,
          input.phoneE164 ?? null,
          input.waJid ?? null,
          input.trustLevel ?? "trusted"
        ],
        "Failed to create allowlisted contact"
      );
    },

    async findContactById(contactId: string): Promise<ContactRecord | null> {
      return queryOne<ContactRecord>(
        db,
        `
          SELECT ${contactReturningSql()}
          FROM core_contacts
          WHERE core_contact_id = $1
        `,
        [contactId]
      );
    },

    async findAllowlistedContactByDisplayName(
      displayName: string
    ): Promise<ContactRecord | null> {
      return queryOne<ContactRecord>(
        db,
        `
          SELECT ${contactReturningSql()}
          FROM core_contacts
          WHERE core_contact_display_name = $1
            AND core_contact_is_allowlisted = true
          ORDER BY core_contact_created_at DESC
          LIMIT 1
        `,
        [displayName]
      );
    },

    async findAllowlistedContactByWaJid(waJid: string): Promise<ContactRecord | null> {
      return queryOne<ContactRecord>(
        db,
        `
          SELECT ${contactReturningSql()}
          FROM core_contacts
          WHERE core_contact_wa_jid = $1
            AND core_contact_is_allowlisted = true
          LIMIT 1
        `,
        [waJid]
      );
    },

    async findAllowlistedContactByPhoneE164(
      phoneE164: string
    ): Promise<ContactRecord | null> {
      return queryOne<ContactRecord>(
        db,
        `
          SELECT ${contactReturningSql()}
          FROM core_contacts
          WHERE core_contact_phone_e164 = $1
            AND core_contact_is_allowlisted = true
          LIMIT 1
        `,
        [phoneE164]
      );
    },

    async listAllowlistedContacts(input: { limit?: number } = {}): Promise<ContactRecord[]> {
      const result = await db.query<ContactRecord>(
        `
          SELECT ${contactReturningSql()}
          FROM core_contacts
          WHERE core_contact_is_allowlisted = true
          ORDER BY core_contact_display_name ASC, core_contact_created_at ASC
          LIMIT $1
        `,
        [input.limit ?? 100]
      );

      return result.rows;
    }
  };
}
