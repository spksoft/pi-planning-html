import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { digestValue } from "./artifact.ts";
import type {
  ExactPermit,
  PlanningState,
  ToolIdentitySnapshot,
} from "./state.ts";

export type ToolIdentity = ToolIdentitySnapshot;

export interface ToolMetadata {
  name: string;
  sourceInfo?: {
    source?: string;
    path?: string;
  };
}

export interface PlanningPolicySnapshot {
  allowed: Record<string, ToolIdentity>;
}

export interface PolicyDecision {
  allowed: boolean;
  consumePermit?: boolean;
  reason?: string;
}

export const PACKAGE_TOOL_NAMES = [
  "plan_inspect",
  "plan_map_decisions",
  "plan_ask_frontier",
  "plan_confirm_understanding",
  "plan_request_exception",
  "plan_update",
  "plan_submit",
  "plan_step_status",
] as const;

export const PLANNING_SAFE_BUILTINS = ["read", "grep", "find", "ls"] as const;

/** Manifests and lockfiles whose mutation always needs a dependency decision. */
const DEPENDENCY_MANIFESTS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
];

const RISKY_SHELL = [
  /(^|[;&|]\s*)rm\b/i,
  /(^|[;&|]\s*)mv\b/i,
  /(^|[;&|]\s*)cp\b/i,
  /(^|[;&|]\s*)mkdir\b/i,
  /(^|[;&|]\s*)touch\b/i,
  /(^|[;&|]\s*)chmod\b/i,
  /(^|[;&|]\s*)chown\b/i,
  /(^|[;&|]\s*)ln\b/i,
  /(^|[;&|]\s*)tee\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update|ci|publish)\b/i,
  /\b(?:pip|pipx|uv)\s+(?:install|uninstall|add|remove|sync)\b/i,
  /\bgit\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|tag|init|clean)\b/i,
  /\b(?:sudo|su|kill|pkill|killall|reboot|shutdown)\b/i,
  /\b(?:curl|wget)\b[^\n]*(?:-o|--output|-O)\b/i,
];

/**
 * Shell metacharacters that can hide effects from prefix matching.
 * Checked after `&&`/`||` are normalized, so a lone `&` means backgrounding.
 */
const SHELL_EXPANSION = /[$`<>(){}[\]*?~!\\\n\r&]/;

const SAFE_EXECUTION_COMMANDS = [
  /^(?:pwd|whoami|date)$/i,
  /^(?:ls|cat|head|tail|wc|stat|file|tree|rg|grep|fd|find|diff)(?:\s+[\w@./:=+-]+)*$/i,
  /^git\s+(?:status|diff|log|show|branch|rev-parse)(?:\s+[\w@./:=+-]+)*$/i,
  /^(?:node|python3?|go|rustc|cargo|npm|pnpm|yarn|bun|tsc)\s+--version$/i,
  /^(?:cargo|go)\s+(?:test|check|build|vet)(?:\s+[\w@./:=+-]+)*$/i,
  /^(?:pytest|python3?\s+-m\s+pytest)(?:\s+[\w@./:=+-]+)*$/i,
  /^tsc\s+--noEmit$/i,
];

function identity(metadata: ToolMetadata): ToolIdentity {
  return {
    name: metadata.name,
    source: metadata.sourceInfo?.source ?? "unknown",
    path: metadata.sourceInfo?.path ?? "unknown",
  };
}

export function toolIdentity(metadata: ToolMetadata): ToolIdentity {
  return identity(metadata);
}

export function sameIdentity(left: ToolIdentity, right: ToolIdentity): boolean {
  return (
    left.name === right.name &&
    left.source === right.source &&
    left.path === right.path
  );
}

export function capturePlanningPolicy(
  tools: ToolMetadata[],
  expectedPackagePath?: string,
): PlanningPolicySnapshot {
  const allowed: Record<string, ToolIdentity> = {};
  for (const tool of tools) {
    const isSafeBuiltin =
      (PLANNING_SAFE_BUILTINS as readonly string[]).includes(tool.name) &&
      tool.sourceInfo?.source === "builtin";
    const isPackageTool =
      (PACKAGE_TOOL_NAMES as readonly string[]).includes(tool.name) &&
      (!expectedPackagePath ||
        resolve(tool.sourceInfo?.path ?? "") === resolve(expectedPackagePath));
    if (isSafeBuiltin || isPackageTool) allowed[tool.name] = identity(tool);
  }
  return { allowed };
}

export function planningToolNames(snapshot: PlanningPolicySnapshot): string[] {
  return Object.keys(snapshot.allowed);
}

export function createExactPermit(
  metadata: ToolMetadata,
  input: unknown,
  reason: string,
  expectedEffects: string,
  cwd: string,
  candidateDigest: string | null,
  now = Date.now(),
  lifetimeMs = 5 * 60_000,
): ExactPermit {
  const tool = identity(metadata);
  return {
    toolName: tool.name,
    toolSource: tool.source,
    toolPath: tool.path,
    inputDigest: digestValue(input),
    cwd: resolve(cwd),
    candidateDigest,
    reason: reason.trim(),
    expectedEffects: expectedEffects.trim(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + lifetimeMs).toISOString(),
  };
}

function permitMatches(
  permit: ExactPermit,
  metadata: ToolMetadata | undefined,
  toolName: string,
  input: unknown,
  cwd: string,
  candidateDigest: string | null,
  now: number,
): boolean {
  if (!metadata) return false;
  const tool = identity(metadata);
  return (
    permit.toolName === toolName &&
    permit.toolSource === tool.source &&
    permit.toolPath === tool.path &&
    permit.inputDigest === digestValue(input) &&
    permit.cwd === resolve(cwd) &&
    permit.candidateDigest === candidateDigest &&
    Date.parse(permit.expiresAt) >= now
  );
}

export function evaluatePlanningCall(
  state: PlanningState,
  snapshot: PlanningPolicySnapshot,
  metadata: ToolMetadata | undefined,
  toolName: string,
  input: unknown,
  cwd: string,
  now = Date.now(),
): PolicyDecision {
  const expected = snapshot.allowed[toolName];
  if (expected && metadata && sameIdentity(expected, identity(metadata)))
    return { allowed: true };

  const permit = state.permit;
  if (
    permit &&
    permitMatches(
      permit,
      metadata,
      toolName,
      input,
      cwd,
      state.candidate?.digest ?? null,
      now,
    )
  ) {
    return { allowed: true, consumePermit: true };
  }

  if (expected && metadata) {
    return {
      allowed: false,
      reason: `Planning mode blocked ${toolName}: tool provenance changed from ${expected.source}:${expected.path}.`,
    };
  }
  return {
    allowed: false,
    reason: `Planning mode blocked ${toolName}. Use read/search tools or request one exact evidence exception.`,
  };
}

/**
 * Verifies an execution-time call against the tool identities captured before planning.
 * A same-name replacement never inherits the original tool's trust.
 */
export function executionIdentityMatches(
  toolsBeforePlanning: ToolIdentitySnapshot[],
  metadata: ToolMetadata | undefined,
  toolName: string,
): boolean {
  const expected = toolsBeforePlanning.find((tool) => tool.name === toolName);
  return Boolean(
    expected && metadata && sameIdentity(expected, identity(metadata)),
  );
}

export function isRiskyShell(command: string): boolean {
  return RISKY_SHELL.some((pattern) => pattern.test(command));
}

/**
 * Returns true only for fully anchored, expansion-free validation commands.
 * Anything else must be confirmed directly by the user.
 */
export function isKnownExecutionCommand(command: string): boolean {
  if (isRiskyShell(command)) return false;
  const normalized = command.replaceAll("&&", ";").replaceAll("||", ";");
  if (SHELL_EXPANSION.test(normalized)) return false;
  const segments = normalized
    .split(/;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return (
    segments.length > 0 &&
    segments.every((segment) =>
      SAFE_EXECUTION_COMMANDS.some((pattern) => pattern.test(segment)),
    )
  );
}

function inside(base: string, target: string): boolean {
  const fromBase = relative(base, target);
  return (
    fromBase === "" ||
    (!fromBase.startsWith(`..${sep}`) &&
      fromBase !== ".." &&
      !isAbsolute(fromBase))
  );
}

export function mutationPathFromInput(
  toolName: string,
  input: unknown,
): string | undefined {
  if (toolName !== "edit" && toolName !== "write") return undefined;
  if (!input || typeof input !== "object") return undefined;
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? path : undefined;
}

export function isDependencyManifest(requestedPath: string): boolean {
  const normalized = requestedPath.replaceAll("\\", "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return DEPENDENCY_MANIFESTS.includes(base);
}

export function isMutationPathPlanned(
  cwd: string,
  candidatePaths: string[],
  requestedPath: string,
): boolean {
  const project = resolve(cwd);
  const requested = resolve(project, requestedPath);
  if (!inside(project, requested)) return false;

  return candidatePaths.some((entry) => {
    const normalized = entry.trim();
    if (!normalized || normalized.includes("*") || normalized.includes("?"))
      return false;
    const planned = resolve(project, normalized);
    if (!inside(project, planned)) return false;
    const directoryIntent =
      normalized.endsWith("/") || normalized.endsWith("\\");
    return directoryIntent ? inside(planned, requested) : requested === planned;
  });
}

/**
 * Resolves a mutation target through the filesystem so a symlinked path cannot
 * present itself as an approved in-project file.
 */
export async function mutationTargetEscapesProject(
  cwd: string,
  requestedPath: string,
): Promise<boolean> {
  try {
    const project = await realpath(cwd);
    const requested = resolve(project, requestedPath);
    try {
      const stat = await lstat(requested);
      if (stat.isSymbolicLink()) return true;
      return !inside(project, await realpath(requested));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true;
      let parent = dirname(requested);
      for (;;) {
        try {
          const parentStat = await lstat(parent);
          if (parentStat.isSymbolicLink()) return true;
          const realParent = await realpath(parent);
          if (!inside(project, realParent)) return true;
          return !inside(
            project,
            resolve(realParent, relative(parent, requested)),
          );
        } catch (parentError) {
          if ((parentError as NodeJS.ErrnoException).code !== "ENOENT")
            return true;
          const next = dirname(parent);
          if (next === parent) return true;
          parent = next;
        }
      }
    }
  } catch {
    return true;
  }
}
