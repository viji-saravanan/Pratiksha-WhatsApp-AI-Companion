import type { QueryResult, QueryResultRow } from "pg";
import { ERROR_CODES, VijiError } from "@viji/shared";

export interface DbExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

export async function queryOne<T extends QueryResultRow>(
  db: DbExecutor,
  text: string,
  values: unknown[] = []
): Promise<T | null> {
  const result = await db.query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function queryRequired<T extends QueryResultRow>(
  db: DbExecutor,
  text: string,
  values: unknown[] = [],
  message = "Expected database row was not found"
): Promise<T> {
  const row = await queryOne<T>(db, text, values);
  if (!row) {
    throw new VijiError({
      code: ERROR_CODES.database.writeRejected,
      message
    });
  }
  return row;
}
