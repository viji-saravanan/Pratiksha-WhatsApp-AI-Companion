export const DEFAULT_DATA_ROOT = "/Volumes/Arya 1TB/VijiAI";
export const DEFAULT_SENTINEL_FILE = ".viji-helper-root";
export const DEFAULT_RESOURCE_ROOT = `${DEFAULT_DATA_ROOT}/viji-files`;
export const DEFAULT_WACLI_STORE = `${DEFAULT_DATA_ROOT}/wacli/store`;
export const DEFAULT_WACLI_MEDIA = `${DEFAULT_DATA_ROOT}/wacli/media`;

export type RuntimePaths = {
  dataRoot: string;
  sentinelFile: string;
  resourceRoot: string;
  wacliStore: string;
  wacliMedia: string;
};

export function getRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const dataRoot = env.VIJI_DATA_ROOT || DEFAULT_DATA_ROOT;
  return {
    dataRoot,
    sentinelFile: env.VIJI_SENTINEL_FILE || DEFAULT_SENTINEL_FILE,
    resourceRoot: env.VIJI_RESOURCE_ROOT || `${dataRoot}/viji-files`,
    wacliStore: env.VIJI_WACLI_STORE || `${dataRoot}/wacli/store`,
    wacliMedia: env.VIJI_WACLI_MEDIA_ROOT || `${dataRoot}/wacli/media`
  };
}
