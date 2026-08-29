import assert from "node:assert/strict";
import test from "node:test";
import {
  createCandidate,
  hashText,
  type ArtifactRecord,
} from "../extensions/planning/artifact.ts";
import {
  approvalMatchesState,
  createApprovalRecord,
} from "../extensions/planning/approval.ts";
import { digestValue } from "../extensions/planning/artifact.ts";
import {
  approvePlan,
  confirmSharedUnderstanding,
  enterPlanning,
  replan,
  submitForReview,
  updateStepProgress,
  withCandidate,
  withDecisionTree,
} from "../extensions/planning/state.ts";
import { settledTree, validDraft } from "./helpers.ts";

function identities(names: string[]) {
  return names.map((name) => ({
    name,
    source: "builtin",
    path: `<builtin:${name}>`,
  }));
}

function artifact(candidateDigest: string): ArtifactRecord {
  return {
    path: "docs/plan/add-passkey-authentication.html",
    absolutePath: "/project/docs/plan/add-passkey-authentication.html",
    contentHash: hashText("artifact"),
    candidateDigest,
    writtenAt: "2026-08-28T00:02:00.000Z",
  };
}

test("state flow is fail-closed from planning through approval", () => {
  let state = enterPlanning(
    "Add passkeys",
    identities(["read", "bash", "edit", "write"]),
    "baseline-a",
  );
  const tree = settledTree();
  state = withDecisionTree(state, { nodes: tree.nodes });
  assert.throws(() => submitForReview(state), /candidate/i);

  state = confirmSharedUnderstanding(
    state,
    "Preserve existing sessions and reuse the authentication boundary.",
    digestValue(state.decisionTree.nodes),
  );
  const candidate = createCandidate(validDraft(), state.decisionTree, 1);
  state = withCandidate(state, candidate, artifact(candidate.digest));
  state = submitForReview(state);
  assert.equal(state.phase, "reviewing");

  const approval = createApprovalRecord(
    state,
    "baseline-a",
    "leaf-1",
    "session-1",
    "guarded",
    "review-ui",
    "2026-08-28T00:03:00.000Z",
  );
  state = approvePlan(state, approval);
  assert.equal(state.phase, "executing");
  assert.equal(approvalMatchesState(state, approval), true);
});

test("approval for another candidate cannot be applied", () => {
  let state = enterPlanning("Add passkeys", identities(["read"]), "baseline-a");
  const tree = settledTree();
  state = withDecisionTree(state, { nodes: tree.nodes });
  state = confirmSharedUnderstanding(
    state,
    "Shared",
    digestValue(state.decisionTree.nodes),
  );
  const candidate = createCandidate(validDraft(), state.decisionTree, 1);
  state = submitForReview(
    withCandidate(state, candidate, artifact(candidate.digest)),
  );
  const stale = {
    ...createApprovalRecord(
      state,
      "baseline-a",
      "leaf",
      "session",
      "guarded",
      "review-ui",
    ),
    candidateDigest: "different",
  };
  assert.throws(() => approvePlan(state, stale), /stale/i);
});

test("completed steps require evidence and all tasks determine completion", () => {
  let state = enterPlanning("Add passkeys", identities(["read"]), "baseline-a");
  const tree = settledTree();
  state = withDecisionTree(state, { nodes: tree.nodes });
  state = confirmSharedUnderstanding(
    state,
    "Shared",
    digestValue(state.decisionTree.nodes),
  );
  const candidate = createCandidate(validDraft(), state.decisionTree, 1);
  state = submitForReview(
    withCandidate(state, candidate, artifact(candidate.digest)),
  );
  state = approvePlan(
    state,
    createApprovalRecord(
      state,
      "baseline-a",
      "leaf",
      "session",
      "guarded",
      "review-ui",
    ),
  );

  assert.throws(
    () =>
      updateStepProgress(state, "extend-credential-contract", "completed", []),
    /evidence/i,
  );
  assert.throws(
    () =>
      updateStepProgress(state, "wire-passkey-route", "active", ["Started"]),
    /unfinished dependencies/i,
  );
  assert.throws(
    () =>
      updateStepProgress(state, "extend-credential-contract", "skipped", []),
    /evidence/i,
  );
  state = updateStepProgress(state, "extend-credential-contract", "completed", [
    "Unit tests pass",
  ]);
  assert.equal(state.phase, "executing");
  state = updateStepProgress(state, "wire-passkey-route", "completed", [
    "Route and manual flow pass",
  ]);
  assert.equal(state.phase, "completed");
});

test("replanning invalidates candidate and approval while preserving decisions", () => {
  let state = enterPlanning("Add passkeys", identities(["read"]), "baseline-a");
  const tree = settledTree();
  state = withDecisionTree(state, { nodes: tree.nodes });
  state = confirmSharedUnderstanding(
    state,
    "Shared",
    digestValue(state.decisionTree.nodes),
  );
  const candidate = createCandidate(validDraft(), state.decisionTree, 1);
  state = submitForReview(
    withCandidate(state, candidate, artifact(candidate.digest)),
  );
  state = approvePlan(
    state,
    createApprovalRecord(
      state,
      "baseline-a",
      "leaf",
      "session",
      "guarded",
      "review-ui",
    ),
  );
  state = replan(state);
  assert.equal(state.phase, "grilling");
  assert.equal(state.candidate, undefined);
  assert.equal(state.approval, undefined);
  assert.equal(state.decisionTree.nodes[0]?.answer?.value, "preserve");
  assert.equal(state.decisionTree.sharedUnderstanding, undefined);
});
