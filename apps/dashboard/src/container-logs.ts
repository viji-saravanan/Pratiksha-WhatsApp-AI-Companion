export {
  createDockerContainerLogsReader,
  getContainerLogsConfigFromEnv
} from "@viji/shared";

export type {
  ContainerLogService,
  ContainerLogsConfig as DashboardContainerLogsConfig,
  ContainerLogsReader,
  ContainerLogsSnapshot
} from "@viji/shared";
