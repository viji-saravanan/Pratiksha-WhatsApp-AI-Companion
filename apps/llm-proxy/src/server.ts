import { createJsonLogger, isDirectNodeEntrypoint } from "@viji/shared";

import { createLlmProxyServer } from "./app.js";
import { getLlmProxyConfigFromEnv } from "./config.js";

export async function startLlmProxyServer(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const config = getLlmProxyConfigFromEnv(env);
  const logger = createJsonLogger("llm-proxy");
  const server = createLlmProxyServer({
    env,
    token: config.token
  });

  server.listen(config.port, config.host, () => {
    logger.info("llm_proxy.started", {
      host: config.host,
      port: config.port
    });
  });

  const shutdown = async (): Promise<void> => {
    server.close();
  };

  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
}

if (isDirectNodeEntrypoint(import.meta.url)) {
  void startLlmProxyServer();
}
