export type StorageProfileName = "large-200gb" | "small-100gb";

export type StorageProfile = {
  name: StorageProfileName;
  quotaLimitBytes: number;
  warningUsedBytes: number;
  criticalUsedBytes: number;
  warningFreeBytes: number;
  criticalFreeBytes: number;
};

export const DEFAULT_STORAGE_PROFILE: StorageProfileName = "large-200gb";

export const STORAGE_PROFILES: Record<StorageProfileName, StorageProfile> = {
  "large-200gb": {
    name: "large-200gb",
    quotaLimitBytes: 200 * 1024 ** 3,
    warningUsedBytes: 165 * 1024 ** 3,
    criticalUsedBytes: 185 * 1024 ** 3,
    warningFreeBytes: 25 * 1024 ** 3,
    criticalFreeBytes: 12 * 1024 ** 3
  },
  "small-100gb": {
    name: "small-100gb",
    quotaLimitBytes: 100 * 1024 ** 3,
    warningUsedBytes: 80 * 1024 ** 3,
    criticalUsedBytes: 90 * 1024 ** 3,
    warningFreeBytes: 15 * 1024 ** 3,
    criticalFreeBytes: 8 * 1024 ** 3
  }
};

export function getStorageProfile(name: string | undefined = DEFAULT_STORAGE_PROFILE): StorageProfile {
  if (name !== "large-200gb" && name !== "small-100gb") {
    throw new Error(`Unknown storage profile: ${name}`);
  }

  return STORAGE_PROFILES[name];
}
