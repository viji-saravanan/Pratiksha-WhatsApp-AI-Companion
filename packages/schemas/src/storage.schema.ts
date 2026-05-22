export type StorageGuardState = "healthy" | "warning" | "critical" | "missing" | "unwritable";

export type StorageGuardReport = {
  dataRoot: string;
  sentinelPath: string;
  profileName: "large-200gb" | "small-100gb";
  state: StorageGuardState;
  usedBytes: number;
  freeBytes: number;
  quotaLimitBytes: number;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
};
