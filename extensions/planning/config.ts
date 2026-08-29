import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PlanningConfig {
  artifactDirectory: string;
}

export const DEFAULT_CONFIG: PlanningConfig = {
  artifactDirectory: "docs/plan",
};

function relativeDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  return normalized;
}

/** Loads the one supported optional setting: where generated plans are stored. */
export async function loadPlanningConfig(cwd: string): Promise<PlanningConfig> {
  const path = resolve(cwd, ".pi", "planning.json");
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      artifact?: { directory?: unknown };
    };
    return {
      artifactDirectory:
        relativeDirectory(raw.artifact?.directory) ??
        DEFAULT_CONFIG.artifactDirectory,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return DEFAULT_CONFIG;
    throw new Error(
      `Invalid .pi/planning.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
