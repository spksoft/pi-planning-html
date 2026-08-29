import assert from "node:assert/strict";
import test from "node:test";
import {
  createCandidate,
  hashText,
  type ArtifactRecord,
} from "../extensions/planning/artifact.ts";
import {
  PLANNING_STATE_VERSION,
  enterPlanning,
  restorePlanningState,
  type PlanningState,
} from "../extensions/planning/state.ts";
import { settledTree, validDraft } from "./helpers.ts";

function executingState(): PlanningState {
  const decisionTree = settledTree();
  const candidate = createCandidate(
    validDraft(),
    decisionTree,
    1,
    "2026-08-28T00:00:00.000Z",
  );
  const artifact: ArtifactRecord = {
    path: "docs/plan/add-passkey-authentication.html",
    absolutePath: "/project/docs/plan/add-passkey-authentication.html",
    contentHash: hashText("artifact"),
    candidateDigest: candidate.digest,
    writtenAt: "2026-08-28T00:02:00.000Z",
  };
  return {
    version: PLANNING_STATE_VERSION,
    phase: "executing",
    request: "Add passkeys",
    toolsBeforePlanning: [
      { name: "read", source: "builtin", path: "<builtin:read>" },
    ],
    baseline: "baseline-a",
    decisionTree,
    candidate,
    artifact,
    approval: {
      candidateDigest: candidate.digest,
      artifactHash: artifact.contentHash,
      artifactPath: artifact.path,
      baseline: "baseline-a",
      branchLeaf: "leaf-1",
      sessionId: "session-1",
      posture: "guarded",
      approvedAt: "2026-08-28T00:03:00.000Z",
      source: "review-ui",
    },
    progress: candidate.draft.tasks.map((task) => ({
      taskId: task.id,
      state: "pending" as const,
      evidence: [],
      updatedAt: "2026-08-28T00:03:00.000Z",
    })),
  };
}

test("valid persisted states round-trip through JSON", () => {
  const planning = enterPlanning(
    "Add passkeys",
    [{ name: "read", source: "builtin", path: "<builtin:read>" }],
    "baseline-a",
  );
  const restoredPlanning = restorePlanningState(
    JSON.parse(JSON.stringify(planning)),
  );
  // Optional keys are restored as explicit undefined, so compare through JSON.
  assert.deepEqual(
    JSON.parse(JSON.stringify(restoredPlanning)),
    JSON.parse(JSON.stringify(planning)),
  );

  const executing = executingState();
  const restored = restorePlanningState(JSON.parse(JSON.stringify(executing)));
  assert.equal(restored?.phase, "executing");
  assert.equal(
    restored?.approval?.candidateDigest,
    executing.candidate?.digest,
  );
});

test("malformed, unknown, and non-object state fails closed", () => {
  for (const value of [
    undefined,
    null,
    42,
    "planning",
    [],
    {},
    { version: 99, phase: "executing" },
  ]) {
    assert.equal(
      restorePlanningState(value),
      undefined,
      JSON.stringify(value ?? null),
    );
  }
  assert.equal(
    restorePlanningState({ ...executingState(), phase: "not-a-phase" }),
    undefined,
  );
  assert.equal(
    restorePlanningState({
      ...executingState(),
      toolsBeforePlanning: ["read"],
    }),
    undefined,
  );
  assert.equal(
    restorePlanningState({ ...executingState(), progress: [{ taskId: "x" }] }),
    undefined,
  );
});

test("execution state without a complete, self-consistent approval is rejected", () => {
  const base = executingState();

  assert.equal(
    restorePlanningState({ ...base, approval: undefined }),
    undefined,
  );
  assert.equal(
    restorePlanningState({ ...base, candidate: undefined }),
    undefined,
  );
  assert.equal(
    restorePlanningState({ ...base, artifact: undefined }),
    undefined,
  );

  const staleDigest = {
    ...base,
    approval: { ...base.approval!, candidateDigest: "b".repeat(64) },
  };
  assert.equal(restorePlanningState(staleDigest), undefined);

  const staleArtifactHash = {
    ...base,
    approval: { ...base.approval!, artifactHash: "c".repeat(64) },
  };
  assert.equal(restorePlanningState(staleArtifactHash), undefined);

  const swappedArtifactPath = {
    ...base,
    approval: { ...base.approval!, artifactPath: "docs/plan/other.html" },
  };
  assert.equal(restorePlanningState(swappedArtifactPath), undefined);

  const foreignProgress = {
    ...base,
    progress: [{ ...base.progress[0]!, taskId: "unknown-task" }],
  };
  assert.equal(restorePlanningState(foreignProgress), undefined);

  // "approved" is only valid for a fresh-session posture awaiting its handoff.
  assert.equal(restorePlanningState({ ...base, phase: "approved" }), undefined);
  assert.equal(
    restorePlanningState({
      ...base,
      phase: "approved",
      approval: { ...base.approval!, posture: "fresh-session" },
    })?.phase,
    "approved",
  );
});

test("persisted candidate content and decision snapshots are digest-bound", () => {
  const base = executingState();
  const changedPath = {
    ...base,
    candidate: {
      ...base.candidate!,
      draft: {
        ...base.candidate!.draft,
        tasks: base.candidate!.draft.tasks.map((task, index) =>
          index === 0 ? { ...task, files: ["src/outside-the-plan.ts"] } : task,
        ),
      },
    },
  };
  assert.equal(restorePlanningState(changedPath), undefined);

  const changedDecision = {
    ...base,
    decisionTree: {
      ...base.decisionTree,
      nodes: base.decisionTree.nodes.map((node, index) =>
        index === 0 ? { ...node, recommendation: "tampered" } : node,
      ),
    },
  };
  assert.equal(restorePlanningState(changedDecision), undefined);
});

test("malformed candidate tasks cannot restore execution permissions", () => {
  const base = executingState();
  const brokenTasks = {
    ...base,
    candidate: {
      ...base.candidate!,
      draft: {
        ...base.candidate!.draft,
        tasks: [{ id: "x", title: "No What/Why/How" }],
      },
    },
  };
  assert.equal(restorePlanningState(brokenTasks), undefined);
});
