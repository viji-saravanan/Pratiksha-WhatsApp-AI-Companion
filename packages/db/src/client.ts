import { Pool } from "pg";
import { ERROR_CODES, VijiError } from "@viji/shared";

export interface DatabaseConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export function getDatabaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DatabaseConfig {
  if (!env.DATABASE_URL) {
    throw new VijiError({
      code: ERROR_CODES.system.invalidConfig,
      message: "DATABASE_URL is required for database access"
    });
  }

  return {
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000
  };
}

export function createPgPool(config: DatabaseConfig = getDatabaseConfigFromEnv()): Pool {
  return new Pool(config);
}
