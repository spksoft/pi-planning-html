import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PlanningTier } from "./schema.ts";

export interface PlanningConfig {
  artifactDirectory: string;
  defaultTier: "auto" | PlanningTier;
  allowExactExceptions: boolean;
  askOnDependencyChange: boolean;
}

export const DEFAULT_CONFIG: PlanningConfig = {
  artifactDirectory: "docs/plan",
  defaultTier: "auto",
  allowExactExceptions: true,
  askOnDependencyChange: true,
};

function relativeDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..")
  )
    return undefined;
  return normalized.replace(/\/$/, "");
}

export async function loadPlanningConfig(
  cwd: string,
  trusted: boolean,
): Promise<PlanningConfig> {
  if (!trusted) return DEFAULT_CONFIG;
  const path = resolve(cwd, ".pi", "planning.json");
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      artifact?: { directory?: unknown };
      planning?: { defaultTier?: unknown; allowExactExceptions?: unknown };
      execution?: { askOnDependencyChange?: unknown };
    };
    const directory = relativeDirectory(raw.artifact?.directory);
    const tier = raw.planning?.defaultTier;
    return {
      artifactDirectory: directory ?? DEFAULT_CONFIG.artifactDirectory,
      defaultTier:
        tier === "brief" ||
        tier === "standard" ||
        tier === "deep" ||
        tier === "auto"
          ? tier
          : DEFAULT_CONFIG.defaultTier,
      allowExactExceptions:
        typeof raw.planning?.allowExactExceptions === "boolean"
          ? raw.planning.allowExactExceptions
          : DEFAULT_CONFIG.allowExactExceptions,
      askOnDependencyChange:
        typeof raw.execution?.askOnDependencyChange === "boolean"
          ? raw.execution.askOnDependencyChange
          : DEFAULT_CONFIG.askOnDependencyChange,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return DEFAULT_CONFIG;
    throw new Error(
      `Invalid .pi/planning.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
