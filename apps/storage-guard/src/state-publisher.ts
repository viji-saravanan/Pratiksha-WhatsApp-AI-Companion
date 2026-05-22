import type { StorageGuardReport } from "@viji/schemas";
import { ERROR_CODES, type ErrorCode } from "@viji/shared";

export function getStorageGuardErrorCode(
  report: StorageGuardReport
): ErrorCode | null {
  switch (report.state) {
    case "healthy":
      return null;
    case "warning":
      return ERROR_CODES.storage.quotaWarning;
    case "critical":
      return ERROR_CODES.storage.quotaCritical;
    case "missing":
      return ERROR_CODES.storage.dataRootMissing;
    case "unwritable":
      return ERROR_CODES.storage.sentinelUnavailable;
  }
}

export function summarizeStorageState(report: StorageGuardReport): string {
  const errorCode = getStorageGuardErrorCode(report);
  return [
    `state=${report.state}`,
    ...(errorCode ? [`code=${errorCode}`] : []),
    `profile=${report.profileName}`,
    `used=${report.usedBytes}`,
    `free=${report.freeBytes}`,
    `root=${report.dataRoot}`
  ].join(" ");
}
