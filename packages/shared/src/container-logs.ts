import { request } from "node:http";

export interface ContainerLogsConfig {
  enabled: boolean;
  dockerSocketPath: string;
  composeProject: string;
  defaultTail: number;
  timeoutMs: number;
}

export interface ContainerLogService {
  service: string;
  containerId: string;
  containerName: string;
  image: string;
  state: string;
  status: string;
}

export interface ContainerLogsSnapshot {
  enabled: boolean;
  project: string;
  selectedService: string;
  tail: number;
  generatedAt: string;
  services: ContainerLogService[];
  rawText: string;
  unavailableReason?: string;
}

export interface ContainerLogsReader {
  read(options?: { service?: string; tail?: number }): Promise<ContainerLogsSnapshot>;
}

interface DockerContainerSummary {
  Id?: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function parseInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value ?? defaultValue);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

export function getContainerLogsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ContainerLogsConfig {
  return {
    enabled: parseBoolean(env.VIJI_CONTAINER_LOGS_ENABLED, true),
    dockerSocketPath: env.VIJI_DOCKER_SOCKET_PATH || "/var/run/docker.sock",
    composeProject: env.VIJI_DOCKER_COMPOSE_PROJECT || "viji-helper",
    defaultTail: parseInteger(env.VIJI_CONTAINER_LOGS_TAIL, 120, 1, 1000),
    timeoutMs: parseInteger(env.VIJI_CONTAINER_LOGS_TIMEOUT_MS, 5000, 500, 30000)
  };
}

function emptySnapshot(
  config: ContainerLogsConfig,
  selectedService: string,
  tail: number,
  unavailableReason?: string
): ContainerLogsSnapshot {
  return {
    enabled: config.enabled,
    project: config.composeProject,
    selectedService,
    tail,
    generatedAt: new Date().toISOString(),
    services: [],
    rawText: "",
    unavailableReason
  };
}

function normalizeTail(value: number | undefined, defaultTail: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return defaultTail;
  }

  return Math.min(1000, Math.max(1, value));
}

function serviceName(container: DockerContainerSummary): string | null {
  const labelValue = container.Labels?.["com.docker.compose.service"];
  if (labelValue) {
    return labelValue;
  }

  const firstName = container.Names?.[0]?.replace(/^\//, "");
  return firstName || null;
}

function containerName(container: DockerContainerSummary): string {
  return container.Names?.[0]?.replace(/^\//, "") || container.Id?.slice(0, 12) || "unknown";
}

function toService(container: DockerContainerSummary): ContainerLogService | null {
  const service = serviceName(container);
  if (!service || !container.Id) {
    return null;
  }

  return {
    service,
    containerId: container.Id,
    containerName: containerName(container),
    image: container.Image || "unknown",
    state: container.State || "unknown",
    status: container.Status || "unknown"
  };
}

function decodeDockerLogs(buffer: Buffer): string {
  if (buffer.byteLength < 8) {
    return buffer.toString("utf8");
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.byteLength) {
    const streamType = buffer[offset];
    const frameLength = buffer.readUInt32BE(offset + 4);
    const nextOffset = offset + 8 + frameLength;

    if (
      (streamType !== 1 && streamType !== 2) ||
      buffer[offset + 1] !== 0 ||
      buffer[offset + 2] !== 0 ||
      buffer[offset + 3] !== 0 ||
      nextOffset > buffer.byteLength
    ) {
      return buffer.toString("utf8");
    }

    chunks.push(buffer.subarray(offset + 8, nextOffset).toString("utf8"));
    offset = nextOffset;
  }

  if (offset < buffer.byteLength) {
    chunks.push(buffer.subarray(offset).toString("utf8"));
  }

  return chunks.join("");
}

function dockerRequest(
  config: ContainerLogsConfig,
  path: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const requestHandle = request(
      {
        socketPath: config.dockerSocketPath,
        path,
        method: "GET",
        timeout: config.timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                `Docker API returned HTTP ${response.statusCode ?? "unknown"}: ${body.toString("utf8")}`
              )
            );
            return;
          }

          resolve(body);
        });
      }
    );

    requestHandle.on("timeout", () => {
      requestHandle.destroy(new Error("Docker API request timed out"));
    });
    requestHandle.on("error", reject);
    requestHandle.end();
  });
}

async function listComposeContainers(
  config: ContainerLogsConfig
): Promise<DockerContainerSummary[]> {
  const filters = encodeURIComponent(
    JSON.stringify({
      label: [`com.docker.compose.project=${config.composeProject}`]
    })
  );
  const body = await dockerRequest(config, `/containers/json?all=1&filters=${filters}`);
  const containers = JSON.parse(body.toString("utf8")) as DockerContainerSummary[];
  return containers
    .filter((container) => Boolean(container.Id && serviceName(container)))
    .sort((left, right) => {
      const serviceCompare = (serviceName(left) || "").localeCompare(serviceName(right) || "");
      return serviceCompare === 0
        ? containerName(left).localeCompare(containerName(right))
        : serviceCompare;
    });
}

async function readContainerLogs(
  config: ContainerLogsConfig,
  container: DockerContainerSummary,
  tail: number
): Promise<string> {
  if (!container.Id) {
    return "";
  }

  const body = await dockerRequest(
    config,
    `/containers/${encodeURIComponent(container.Id)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`
  );
  return decodeDockerLogs(body).trimEnd();
}

export function createDockerContainerLogsReader(
  config: ContainerLogsConfig
): ContainerLogsReader {
  return {
    async read(options = {}) {
      const selectedService = options.service || "all";
      const tail = normalizeTail(options.tail, config.defaultTail);

      if (!config.enabled) {
        return emptySnapshot(config, selectedService, tail, "Container logs are disabled.");
      }

      try {
        const containers = await listComposeContainers(config);
        const services = containers
          .map(toService)
          .filter((service): service is ContainerLogService => Boolean(service));
        const selectedContainers =
          selectedService === "all"
            ? containers
            : containers.filter((container) => serviceName(container) === selectedService);

        const logBlocks = await Promise.all(
          selectedContainers.map(async (container) => {
            const service = serviceName(container) || "unknown";
            const name = containerName(container);
            const logs = await readContainerLogs(config, container, tail);
            return [
              `===== ${service} / ${name} =====`,
              logs || "(no recent logs)"
            ].join("\n");
          })
        );

        return {
          enabled: true,
          project: config.composeProject,
          selectedService,
          tail,
          generatedAt: new Date().toISOString(),
          services,
          rawText: logBlocks.join("\n\n")
        };
      } catch (error) {
        return emptySnapshot(
          config,
          selectedService,
          tail,
          error instanceof Error ? error.message : "Container logs are unavailable."
        );
      }
    }
  };
}
