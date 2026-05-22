import { access } from "node:fs/promises";
import { constants } from "node:fs";

export type GuardCheck = {
  name: string;
  ok: boolean;
  message: string;
};

export async function checkMount(dataRoot: string): Promise<GuardCheck> {
  try {
    await access(dataRoot, constants.F_OK);
    return {
      name: "mount.exists",
      ok: true,
      message: `${dataRoot} exists`
    };
  } catch {
    return {
      name: "mount.exists",
      ok: false,
      message: `${dataRoot} is missing`
    };
  }
}
