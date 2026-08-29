import {
  digestValue,
  type ArtifactRecord,
  type PlanCandidate,
} from "./artifact.ts";
import {
  validatePlanDraft,
  type DecisionTree,
  type PlanDraft,
  type PlanTask,
} from "./schema.ts";

export const PLANNING_STATE_ENTRY = "pi-planning-html/state-v1";
export const PLANNING_STATE_VERSION = 1 as const;

export const PLANNING_PHASES = [
  "inactive",
  "discovering",
  "grilling",
  "drafting",
  "reviewing",
  "approved",
  "executing",
  "completed",
  "blocked",
  "cancelled",
] as const;
export type PlanningPhase = (typeof PLANNING_PHASES)[number];

export const EXECUTION_POSTURES = [
  "guarded",
  "review-every-mutation",
  "fresh-session",
] as const;
export type ExecutionPosture = (typeof EXECUTION_POSTURES)[number];

export const STEP_STATES = [
  "pending",
  "active",
  "blocked",
  "skipped",
  "completed",
] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface ToolIdentitySnapshot {
  name: string;
  source: string;
  path: string;
}

export interface StepProgress {
  taskId: string;
  state: StepState;
  evidence: string[];
  blocker?: string | undefined;
  updatedAt: string;
}

export interface ExactPermit {
  toolName: string;
  toolSource: string;
  toolPath: string;
  inputDigest: string;
  cwd: string;
  candidateDigest: string | null;
  reason: string;
  expectedEffects: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApprovalRecord {
  candidateDigest: string;
  artifactHash: string;
  artifactPath: string;
  baseline: string;
  branchLeaf?: string | undefined;
  sessionId: string;
  posture: ExecutionPosture;
  approvedAt: string;
  source: "review-ui" | "explicit-command";
}

export interface PlanningState {
  version: typeof PLANNING_STATE_VERSION;
  phase: PlanningPhase;
  request?: string | undefined;
  toolsBeforePlanning: ToolIdentitySnapshot[];
  baseline?: string | undefined;
  decisionTree: DecisionTree;
  candidate?: PlanCandidate | undefined;
  artifact?: ArtifactRecord | undefined;
  approval?: ApprovalRecord | undefined;
  progress: StepProgress[];
  permit?: ExactPermit | undefined;
}

export function inactiveState(): PlanningState {
  return {
    version: PLANNING_STATE_VERSION,
    phase: "inactive",
    toolsBeforePlanning: [],
    decisionTree: { nodes: [] },
    progress: [],
  };
}

function uniqueIdentities(
  tools: ToolIdentitySnapshot[],
): ToolIdentitySnapshot[] {
  const byName = new Map<string, ToolIdentitySnapshot>();
  for (const tool of tools)
    byName.set(tool.name, {
      name: tool.name,
      source: tool.source,
      path: tool.path,
    });
  return [...byName.values()];
}

export function enterPlanning(
  request: string,
  toolsBeforePlanning: ToolIdentitySnapshot[],
  baseline: string,
): PlanningState {
  return {
    version: PLANNING_STATE_VERSION,
    phase: "discovering",
    request: request.trim(),
    toolsBeforePlanning: uniqueIdentities(toolsBeforePlanning),
    baseline,
    decisionTree: { nodes: [] },
    progress: [],
  };
}

export function withDecisionTree(
  state: PlanningState,
  decisionTree: DecisionTree,
): PlanningState {
  if (!isPlanning(state))
    throw new Error("Decision trees can only be changed while planning.");
  return {
    ...state,
    phase: "grilling",
    decisionTree: { nodes: decisionTree.nodes },
    candidate: undefined,
    artifact: undefined,
    approval: undefined,
    progress: [],
    permit: undefined,
  };
}

export function confirmSharedUnderstanding(
  state: PlanningState,
  summary: string,
  treeDigest: string,
  now = new Date().toISOString(),
): PlanningState {
  if (!isPlanning(state))
    throw new Error(
      "Shared understanding can only be confirmed while planning.",
    );
  return {
    ...state,
    phase: "drafting",
    decisionTree: {
      nodes: state.decisionTree.nodes,
      sharedUnderstanding: {
        confirmedAt: now,
        summary: summary.trim(),
        treeDigest,
      },
    },
    candidate: undefined,
    artifact: undefined,
    approval: undefined,
    permit: undefined,
  };
}

export function withCandidate(
  state: PlanningState,
  candidate: PlanCandidate,
  artifact: ArtifactRecord,
): PlanningState {
  if (!isPlanning(state))
    throw new Error("Candidates can only be published while planning.");
  return {
    ...state,
    phase: "drafting",
    candidate,
    artifact,
    approval: undefined,
    permit: undefined,
    progress: candidate.draft.tasks.map((task) => pendingProgress(task)),
  };
}

export function submitForReview(state: PlanningState): PlanningState {
  if (!isPlanning(state))
    throw new Error("Only a planning candidate can be submitted.");
  if (!state.candidate || !state.artifact)
    throw new Error("A published candidate is required before review.");
  if (!state.decisionTree.sharedUnderstanding)
    throw new Error("Shared understanding must be confirmed before review.");
  return { ...state, phase: "reviewing", permit: undefined };
}

export function approvePlan(
  state: PlanningState,
  approval: ApprovalRecord,
): PlanningState {
  if (state.phase !== "reviewing")
    throw new Error("Only a reviewed candidate can be approved.");
  if (!state.candidate || !state.artifact)
    throw new Error("Approval requires a candidate and artifact.");
  if (approval.candidateDigest !== state.candidate.digest)
    throw new Error("Approval candidate is stale.");
  if (approval.artifactHash !== state.artifact.contentHash)
    throw new Error("Approval artifact is stale.");
  if (approval.artifactPath !== state.artifact.path)
    throw new Error("Approval artifact path is stale.");
  return {
    ...state,
    phase: approval.posture === "fresh-session" ? "approved" : "executing",
    approval,
    permit: undefined,
  };
}

export function beginFreshExecution(state: PlanningState): PlanningState {
  if (
    state.phase !== "approved" ||
    state.approval?.posture !== "fresh-session"
  ) {
    throw new Error("Fresh execution requires a fresh-session approval.");
  }
  return { ...state, phase: "executing" };
}

export function replan(state: PlanningState): PlanningState {
  if (!isExecution(state))
    throw new Error("Replanning requires an approved or executing plan.");
  return {
    ...state,
    phase: "grilling",
    decisionTree: { nodes: state.decisionTree.nodes },
    candidate: undefined,
    artifact: undefined,
    approval: undefined,
    permit: undefined,
    progress: [],
  };
}

export function cancelPlanning(state: PlanningState): PlanningState {
  return {
    ...state,
    phase: "cancelled",
    permit: undefined,
    approval: undefined,
  };
}

export function setPermit(
  state: PlanningState,
  permit: ExactPermit,
): PlanningState {
  if (!isPlanning(state))
    throw new Error("Exact permits are only available while planning.");
  return { ...state, permit };
}

export function consumePermit(state: PlanningState): PlanningState {
  return { ...state, permit: undefined };
}

export function updateStepProgress(
  state: PlanningState,
  taskId: string,
  stepState: StepState,
  evidence: string[],
  blocker?: string,
  now = new Date().toISOString(),
): PlanningState {
  if (state.phase !== "executing" && state.phase !== "blocked") {
    throw new Error("Step progress can only change during execution.");
  }
  const task = state.candidate?.draft.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId}.`);
  if (
    (stepState === "completed" || stepState === "skipped") &&
    evidence.filter((item) => item.trim()).length === 0
  ) {
    throw new Error(`Task ${taskId} cannot be ${stepState} without evidence.`);
  }
  if (stepState === "active" || stepState === "completed") {
    const unfinishedDependencies = task.dependsOn.filter((dependency) => {
      const progress = state.progress.find(
        (item) => item.taskId === dependency,
      );
      return progress?.state !== "completed" && progress?.state !== "skipped";
    });
    if (unfinishedDependencies.length > 0) {
      throw new Error(
        `Task ${taskId} is blocked by unfinished dependencies: ${unfinishedDependencies.join(", ")}.`,
      );
    }
  }
  if (stepState === "blocked" && !blocker?.trim()) {
    throw new Error(`Task ${taskId} needs a blocker description.`);
  }
  const progress: StepProgress = {
    taskId,
    state: stepState,
    evidence: evidence.map((item) => item.trim()).filter(Boolean),
    blocker: blocker?.trim() || undefined,
    updatedAt: now,
  };
  const all = state.progress.map((item) =>
    item.taskId === taskId ? progress : item,
  );
  const complete =
    all.length > 0 &&
    all.every((item) => item.state === "completed" || item.state === "skipped");
  return {
    ...state,
    phase: complete
      ? "completed"
      : stepState === "blocked"
        ? "blocked"
        : "executing",
    progress: all,
  };
}

function pendingProgress(task: PlanTask): StepProgress {
  return {
    taskId: task.id,
    state: "pending",
    evidence: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function isPlanning(state: PlanningState): boolean {
  return ["discovering", "grilling", "drafting", "reviewing"].includes(
    state.phase,
  );
}

export function isExecution(state: PlanningState): boolean {
  return ["approved", "executing", "blocked", "completed"].includes(
    state.phase,
  );
}

export function activeToolNames(state: PlanningState): string[] {
  return state.toolsBeforePlanning.map((tool) => tool.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseIdentities(value: unknown): ToolIdentitySnapshot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: ToolIdentitySnapshot[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { name, source, path } = entry;
    if (
      typeof name !== "string" ||
      typeof source !== "string" ||
      typeof path !== "string"
    )
      return undefined;
    parsed.push({ name, source, path });
  }
  return parsed;
}

function parsePlanDraft(value: unknown): PlanDraft | undefined {
  if (!isRecord(value)) return undefined;
  const strings = ["title", "slug", "tier", "mainIdea", "outcome"];
  if (strings.some((key) => typeof value[key] !== "string")) return undefined;
  if (!["brief", "standard", "deep"].includes(value.tier as string))
    return undefined;
  if (
    !isStringArray(value.acceptanceCriteria) ||
    !isStringArray(value.inScope) ||
    !isStringArray(value.outOfScope) ||
    !isStringArray(value.constraints) ||
    !isStringArray(value.validation)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.tasks) || !Array.isArray(value.findings))
    return undefined;
  if (
    !Array.isArray(value.risks) ||
    !Array.isArray(value.assumptions) ||
    !Array.isArray(value.openQuestions) ||
    !Array.isArray(value.deepSections)
  ) {
    return undefined;
  }
  for (const task of value.tasks) {
    if (
      !isRecord(task) ||
      ["id", "title", "what", "why", "how"].some(
        (key) => typeof task[key] !== "string",
      ) ||
      !isStringArray(task.files) ||
      !isStringArray(task.dependsOn) ||
      !isStringArray(task.validation)
    ) {
      return undefined;
    }
  }
  for (const finding of value.findings) {
    if (
      !isRecord(finding) ||
      typeof finding.summary !== "string" ||
      !isStringArray(finding.evidence)
    ) {
      return undefined;
    }
  }
  for (const risk of value.risks) {
    if (
      !isRecord(risk) ||
      typeof risk.risk !== "string" ||
      typeof risk.mitigation !== "string" ||
      !["low", "medium", "high"].includes(risk.severity as string)
    ) {
      return undefined;
    }
  }
  for (const assumption of value.assumptions) {
    if (
      !isRecord(assumption) ||
      typeof assumption.assumption !== "string" ||
      typeof assumption.impactIfFalse !== "string" ||
      typeof assumption.acknowledged !== "boolean" ||
      !["low", "medium", "high"].includes(assumption.confidence as string)
    ) {
      return undefined;
    }
  }
  for (const question of value.openQuestions) {
    if (
      !isRecord(question) ||
      typeof question.question !== "string" ||
      typeof question.blocking !== "boolean"
    ) {
      return undefined;
    }
  }
  for (const section of value.deepSections) {
    if (
      !isRecord(section) ||
      typeof section.content !== "string" ||
      ![
        "architecture",
        "security",
        "migration",
        "rollout",
        "observability",
        "rollback",
      ].includes(section.name as string)
    ) {
      return undefined;
    }
  }
  // SAFETY: every PlanDraft field and nested collection has been shape-checked above.
  return value as unknown as PlanDraft;
}

function parseDecisionTree(value: unknown): DecisionTree | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return undefined;
  for (const node of value.nodes) {
    if (
      !isRecord(node) ||
      [
        "id",
        "question",
        "recommendation",
        "recommendationRationale",
        "impact",
      ].some((key) => typeof node[key] !== "string") ||
      typeof node.factsReady !== "boolean" ||
      typeof node.material !== "boolean" ||
      !isStringArray(node.dependsOn) ||
      !isStringArray(node.factEvidence) ||
      !Array.isArray(node.options)
    ) {
      return undefined;
    }
    if (node.description !== undefined && typeof node.description !== "string")
      return undefined;
    for (const option of node.options) {
      if (
        !isRecord(option) ||
        typeof option.id !== "string" ||
        typeof option.label !== "string" ||
        (option.description !== undefined &&
          typeof option.description !== "string")
      ) {
        return undefined;
      }
    }
    if (node.answer !== undefined) {
      if (!isRecord(node.answer)) return undefined;
      const answer = node.answer;
      if (
        typeof answer.value !== "string" ||
        typeof answer.label !== "string" ||
        typeof answer.answeredAt !== "string" ||
        !["option", "custom", "assumption"].includes(answer.kind as string) ||
        (answer.rationale !== undefined && typeof answer.rationale !== "string")
      ) {
        return undefined;
      }
    }
  }
  if (value.sharedUnderstanding !== undefined) {
    if (!isRecord(value.sharedUnderstanding)) return undefined;
    const shared = value.sharedUnderstanding;
    if (
      typeof shared.confirmedAt !== "string" ||
      typeof shared.summary !== "string" ||
      typeof shared.treeDigest !== "string"
    ) {
      return undefined;
    }
  }
  // SAFETY: every DecisionTree node, option, answer, and shared-understanding field was checked above.
  return value as unknown as DecisionTree;
}

function parseCandidate(value: unknown): PlanCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const { revision, digest, createdAt } = value;
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    typeof createdAt !== "string"
  ) {
    return undefined;
  }
  const draft = parsePlanDraft(value.draft);
  const decisionTree = parseDecisionTree(value.decisionTree);
  if (!draft || !decisionTree || !validatePlanDraft(draft).valid)
    return undefined;
  if (digest !== digestValue({ draft, decisionTree })) return undefined;
  return { revision, digest, createdAt, draft, decisionTree };
}

function parseArtifact(value: unknown): ArtifactRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { path, absolutePath, contentHash, candidateDigest, writtenAt } = value;
  if (
    typeof path !== "string" ||
    typeof absolutePath !== "string" ||
    typeof writtenAt !== "string"
  )
    return undefined;
  if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash))
    return undefined;
  if (
    typeof candidateDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidateDigest)
  )
    return undefined;
  return { path, absolutePath, contentHash, candidateDigest, writtenAt };
}

function parseApproval(value: unknown): ApprovalRecord | undefined {
  if (!isRecord(value)) return undefined;
  const {
    candidateDigest,
    artifactHash,
    artifactPath,
    baseline,
    branchLeaf,
    sessionId,
    posture,
    approvedAt,
    source,
  } = value;
  if (
    typeof candidateDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidateDigest)
  )
    return undefined;
  if (typeof artifactHash !== "string" || !/^[a-f0-9]{64}$/.test(artifactHash))
    return undefined;
  if (
    typeof artifactPath !== "string" ||
    typeof baseline !== "string" ||
    typeof sessionId !== "string"
  )
    return undefined;
  if (typeof approvedAt !== "string") return undefined;
  if (branchLeaf !== undefined && typeof branchLeaf !== "string")
    return undefined;
  if (
    typeof posture !== "string" ||
    !(EXECUTION_POSTURES as readonly string[]).includes(posture)
  )
    return undefined;
  if (source !== "review-ui" && source !== "explicit-command") return undefined;
  return {
    candidateDigest,
    artifactHash,
    artifactPath,
    baseline,
    branchLeaf,
    sessionId,
    posture: posture as ExecutionPosture,
    approvedAt,
    source,
  };
}

function parseProgress(value: unknown): StepProgress[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: StepProgress[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { taskId, state, evidence, blocker, updatedAt } = entry;
    if (typeof taskId !== "string" || typeof updatedAt !== "string")
      return undefined;
    if (
      typeof state !== "string" ||
      !(STEP_STATES as readonly string[]).includes(state)
    )
      return undefined;
    if (!isStringArray(evidence)) return undefined;
    if (blocker !== undefined && typeof blocker !== "string") return undefined;
    parsed.push({
      taskId,
      state: state as StepState,
      evidence,
      blocker,
      updatedAt,
    });
  }
  return parsed;
}

function parsePermit(value: unknown): ExactPermit | undefined {
  if (!isRecord(value)) return undefined;
  const {
    toolName,
    toolSource,
    toolPath,
    inputDigest,
    cwd,
    candidateDigest,
    reason,
    expectedEffects,
    createdAt,
    expiresAt,
  } = value;
  if (
    typeof toolName !== "string" ||
    typeof toolSource !== "string" ||
    typeof toolPath !== "string"
  )
    return undefined;
  if (
    typeof inputDigest !== "string" ||
    typeof cwd !== "string" ||
    typeof reason !== "string"
  )
    return undefined;
  if (
    typeof expectedEffects !== "string" ||
    typeof createdAt !== "string" ||
    typeof expiresAt !== "string"
  )
    return undefined;
  if (candidateDigest !== null && typeof candidateDigest !== "string")
    return undefined;
  return {
    toolName,
    toolSource,
    toolPath,
    inputDigest,
    cwd,
    candidateDigest,
    reason,
    expectedEffects,
    createdAt,
    expiresAt,
  };
}

/**
 * Parses persisted session state with phase-discriminated invariants.
 * Malformed or internally inconsistent state returns undefined so callers fail closed.
 */
export function restorePlanningState(
  value: unknown,
): PlanningState | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== PLANNING_STATE_VERSION) return undefined;
  const phase = value.phase;
  if (
    typeof phase !== "string" ||
    !(PLANNING_PHASES as readonly string[]).includes(phase)
  )
    return undefined;

  const toolsBeforePlanning = parseIdentities(value.toolsBeforePlanning);
  if (!toolsBeforePlanning) return undefined;
  const progress = parseProgress(value.progress);
  if (!progress) return undefined;
  const decisionTree = parseDecisionTree(value.decisionTree);
  if (!decisionTree) return undefined;
  if (value.request !== undefined && typeof value.request !== "string")
    return undefined;
  if (value.baseline !== undefined && typeof value.baseline !== "string")
    return undefined;

  const candidate =
    value.candidate === undefined ? undefined : parseCandidate(value.candidate);
  if (value.candidate !== undefined && !candidate) return undefined;
  const artifact =
    value.artifact === undefined ? undefined : parseArtifact(value.artifact);
  if (value.artifact !== undefined && !artifact) return undefined;
  const approval =
    value.approval === undefined ? undefined : parseApproval(value.approval);
  if (value.approval !== undefined && !approval) return undefined;
  const permit =
    value.permit === undefined ? undefined : parsePermit(value.permit);
  if (value.permit !== undefined && !permit) return undefined;

  const restored: PlanningState = {
    version: PLANNING_STATE_VERSION,
    phase: phase as PlanningPhase,
    request: value.request as string | undefined,
    toolsBeforePlanning,
    baseline: value.baseline as string | undefined,
    decisionTree,
    candidate,
    artifact,
    approval,
    progress,
    permit,
  };

  if (
    candidate &&
    digestValue(restored.decisionTree) !== digestValue(candidate.decisionTree)
  )
    return undefined;
  if (restored.phase === "reviewing" && (!candidate || !artifact))
    return undefined;
  if (isExecution(restored)) {
    if (!candidate || !artifact || !approval) return undefined;
    if (approval.candidateDigest !== candidate.digest) return undefined;
    if (approval.artifactHash !== artifact.contentHash) return undefined;
    if (approval.artifactPath !== artifact.path) return undefined;
    if (artifact.candidateDigest !== candidate.digest) return undefined;
    const taskIds = new Set(candidate.draft.tasks.map((task) => task.id));
    if (progress.some((item) => !taskIds.has(item.taskId))) return undefined;
    if (restored.phase === "approved" && approval.posture !== "fresh-session")
      return undefined;
  }
  return restored;
}
