import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { digestValue } from "./artifact.ts";
import type {
  ApprovalRecord,
  ExecutionPosture,
  PlanningState,
} from "./state.ts";

export interface BaselineSnapshot {
  digest: string;
  head: string;
  status: string[];
}

function normalizeStatus(status: string, ignoredPath?: string): string[] {
  const ignore = ignoredPath?.replaceAll("\\", "/");
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      if (!ignore) return true;
      const path = line.slice(3).replaceAll("\\", "/");
      return path !== ignore;
    })
    .sort();
}

export async function captureBaseline(
  pi: Pick<ExtensionAPI, "exec">,
  cwd: string,
  ignoredArtifactPath?: string,
): Promise<BaselineSnapshot> {
  const [headResult, statusResult] = await Promise.all([
    pi.exec("git", ["rev-parse", "--verify", "HEAD"], { cwd, timeout: 10_000 }),
    pi.exec("git", ["status", "--short", "--untracked-files=all"], {
      cwd,
      timeout: 10_000,
    }),
  ]);
  const head = headResult.code === 0 ? headResult.stdout.trim() : "NO_HEAD";
  const status =
    statusResult.code === 0
      ? normalizeStatus(statusResult.stdout, ignoredArtifactPath)
      : ["GIT_STATUS_UNAVAILABLE"];
  return { digest: digestValue({ head, status }), head, status };
}

export function createApprovalRecord(
  state: PlanningState,
  baseline: string,
  branchLeaf: string | undefined,
  sessionId: string,
  posture: ExecutionPosture,
  source: ApprovalRecord["source"],
  now = new Date().toISOString(),
): ApprovalRecord {
  if (!state.candidate || !state.artifact)
    throw new Error("Approval requires a published candidate and artifact.");
  return {
    candidateDigest: state.candidate.digest,
    artifactHash: state.artifact.contentHash,
    artifactPath: state.artifact.path,
    baseline,
    branchLeaf,
    sessionId,
    posture,
    approvedAt: now,
    source,
  };
}

export function approvalMatchesState(
  state: PlanningState,
  approval: ApprovalRecord,
): boolean {
  return Boolean(
    state.candidate &&
      state.artifact &&
      state.candidate.digest === approval.candidateDigest &&
      state.artifact.contentHash === approval.artifactHash &&
      state.artifact.path === approval.artifactPath,
  );
}
