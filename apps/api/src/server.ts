import { createPgPool, getDatabaseConfigFromEnv } from "@viji/db";
import { createJsonLogger, isDirectNodeEntrypoint } from "@viji/shared";
import { createApiServer } from "./app.js";
import { getApiConfigFromEnv } from "./config.js";

export async function startApiServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = getApiConfigFromEnv(env);
  const pool = createPgPool(getDatabaseConfigFromEnv(env));
  const logger = createJsonLogger("api");
  const server = createApiServer({
    db: pool,
    env,
    token: config.token
  });

  server.listen(config.port, config.host, () => {
    logger.info("api.started", {
      host: config.host,
      port: config.port
    });
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await pool.end();
  };

  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
}

if (isDirectNodeEntrypoint(import.meta.url)) {
  void startApiServer();
}
