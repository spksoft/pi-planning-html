import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditPlanDraft,
  planCoverageReport,
  plannedPaths,
  validatePlanDraft,
} from "../extensions/planning/schema.ts";
import { validDraft } from "./helpers.ts";

test("a complete traceable dependency-aware plan is accepted", () => {
  const result = validatePlanDraft(validDraft());
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.deepEqual(result.coverage.uncoveredRequirementIds, []);
  assert.deepEqual(result.coverage.uncoveredAcceptanceCriteriaIds, []);

  const invalidLanguage = validDraft({ language: "English" });
  assert.match(
    validatePlanDraft(invalidLanguage).errors.join("\n"),
    /BCP 47 language tag/i,
  );
});

test("task dependency IDs are executable task order while subtasks are detailed decomposition", () => {
  const draft = validDraft();
  draft.tasks[0]!.id = "T1";
  draft.tasks[1]!.id = "T2";
  draft.tasks[1]!.dependsOn = ["T1"];
  draft.tasks[0]!.subtasks[0]!.id = "T1.1";
  draft.tasks[1]!.subtasks[0]!.id = "T2.1";
  draft.architecture.nodes.forEach((node) => {
    node.taskIds = node.taskIds.map((id) =>
      id === "extend-credential-contract" ? "T1" : "T2",
    );
  });

  assert.deepEqual(validatePlanDraft(draft).errors, []);
});

test("every task and subtask requires concrete What, Why, How, observed/proposed files, and validation", () => {
  for (const field of ["what", "why", "how"] as const) {
    const draft = validDraft();
    draft.tasks[0] = { ...draft.tasks[0]!, [field]: "TBD" };
    assert.match(
      validatePlanDraft(draft).errors.join("\n"),
      new RegExp(`Task .*${field}`, "i"),
    );

    const subtaskDraft = validDraft();
    subtaskDraft.tasks[0] = {
      ...subtaskDraft.tasks[0]!,
      subtasks: [{ ...subtaskDraft.tasks[0]!.subtasks[0]!, [field]: "TBD" }],
    };
    assert.match(
      validatePlanDraft(subtaskDraft).errors.join("\n"),
      new RegExp(`Subtask .*${field}`, "i"),
    );
  }

  const genericHow = validDraft();
  genericHow.tasks[0] = {
    ...genericHow.tasks[0]!,
    how: "Update the code to support the requested feature and ensure that it works correctly.",
  };
  assert.match(
    validatePlanDraft(genericHow).errors.join("\n"),
    /generic implementation prose/i,
  );

  const unsupportedObservedFile = validDraft();
  unsupportedObservedFile.tasks[0]!.files[0] = {
    path: "src/auth/types.ts",
    status: "observed",
  };
  assert.match(
    validatePlanDraft(unsupportedObservedFile).errors.join("\n"),
    /cite evidence|need repository evidence/i,
  );

  const evidenceWithoutSeams = validDraft();
  evidenceWithoutSeams.repositoryEvidence[0]!.seams = [];
  assert.match(
    validatePlanDraft(evidenceWithoutSeams).errors.join("\n"),
    /needs unique project-relative seams|names observed file/i,
  );

  const mismatchedEvidenceSeam = validDraft();
  mismatchedEvidenceSeam.repositoryEvidence[0]!.seams = ["src/auth/service.ts"];
  assert.match(
    validatePlanDraft(mismatchedEvidenceSeam).errors.join("\n"),
    /names observed file/i,
  );

  for (const field of ["expectedBehavior", "parallelSafety"] as const) {
    const draft = validDraft();
    draft.tasks[0] = { ...draft.tasks[0]!, [field]: "TBD" };
    assert.match(
      validatePlanDraft(draft).errors.join("\n"),
      new RegExp(
        field === "expectedBehavior" ? "expected behavior" : "parallel-safety",
        "i",
      ),
    );
  }
});

test("typed architecture requires actor, component, persistence or external dependency, and valid interactions", () => {
  const noStore = validDraft();
  noStore.architecture.nodes = noStore.architecture.nodes.filter(
    (node) => node.kind !== "store",
  );
  noStore.architecture.edges = noStore.architecture.edges.filter(
    (edge) =>
      edge.from !== "credential-store" && edge.to !== "credential-store",
  );
  assert.match(
    validatePlanDraft(noStore).errors.join("\n"),
    /persisted or external/i,
  );

  const unknownNode = validDraft();
  unknownNode.architecture.edges[0] = {
    from: "unknown-node",
    to: "auth-route",
    label: "submits assertion",
  };
  assert.match(
    validatePlanDraft(unknownNode).errors.join("\n"),
    /known nodes/i,
  );
});

test("requirements, acceptance criteria, validations, decisions, and findings must be covered", () => {
  const missingFindingEvidence = validDraft();
  missingFindingEvidence.findings[0]!.evidenceIds = [];
  assert.match(
    validatePlanDraft(missingFindingEvidence).errors.join("\n"),
    /Finding evidence/i,
  );

  const missingRequirementCoverage = validDraft();
  missingRequirementCoverage.acceptanceCriteria[0]!.requirementIds = [];
  assert.match(
    validatePlanDraft(missingRequirementCoverage).errors.join("\n"),
    /requirements must reference/i,
  );

  const uncoveredAcceptance = validDraft();
  uncoveredAcceptance.tasks.forEach(
    (task) => (task.acceptanceCriteriaIds = []),
  );
  assert.match(
    validatePlanDraft(uncoveredAcceptance).errors.join("\n"),
    /Acceptance criteria lack task/i,
  );

  const missingValidation = validDraft();
  missingValidation.acceptanceCriteria[0]!.validationIds = [];
  assert.match(
    validatePlanDraft(missingValidation).errors.join("\n"),
    /validation must reference/i,
  );

  const mismatchedValidation = validDraft();
  mismatchedValidation.validations[0]!.acceptanceCriteriaIds = [];
  assert.match(
    validatePlanDraft(mismatchedValidation).errors.join("\n"),
    /must link to each other/i,
  );

  const nonE2eGate = validDraft();
  nonE2eGate.endToEndValidationIds = ["VAL-route"];
  assert.match(
    validatePlanDraft(nonE2eGate).errors.join("\n"),
    /must use the e2e validation level/i,
  );

  const hardDecision = validDraft();
  hardDecision.decisions[0]!.reversibility = "hard";
  hardDecision.decisions[0]!.alternatives = [];
  assert.match(
    validatePlanDraft(hardDecision).errors.join("\n"),
    /Hard-to-reverse decision/i,
  );
});

test("cycles, self-dependencies, foundation links, blocking unknowns, and unexplained N/A reject publication", () => {
  const cycle = validDraft();
  cycle.tasks[0]!.dependsOn = [cycle.tasks[1]!.id];
  assert.match(validatePlanDraft(cycle).errors.join("\n"), /cycle/i);

  const self = validDraft();
  self.tasks[0]!.dependsOn = [self.tasks[0]!.id];
  assert.match(
    validatePlanDraft(self).errors.join("\n"),
    /cannot depend on itself/i,
  );

  const foundation = validDraft();
  foundation.tasks[0]!.kind = "foundation";
  foundation.tasks[0]!.foundationFor = [foundation.tasks[1]!.id];
  foundation.tasks[1]!.dependsOn = [];
  assert.match(
    validatePlanDraft(foundation).errors.join("\n"),
    /must be a dependency/i,
  );

  const blockingUnknown = validDraft({
    unknowns: [
      {
        id: "UNK-rollout",
        statement:
          "The production rollout owner has not selected a capability-flag policy.",
        impact:
          "The deployment cannot prove rollback behavior without an approved policy.",
        severity: "high",
        status: "needs-decision",
        blocking: true,
        deferredWithUserApproval: false,
        evidenceIds: [],
        resolutionOwner: "Product owner",
        resolutionPoint: "Before implementation begins.",
        trigger:
          "Before the capability flag can be configured for a deployment.",
        fallback: "Do not publish or deploy until the policy is settled.",
      },
    ],
  });
  assert.match(
    validatePlanDraft(blockingUnknown).errors.join("\n"),
    /Blocking or undecided unknowns/i,
  );

  const unapprovedHighDeferral = validDraft({
    unknowns: [
      {
        id: "UNK-high-deferral",
        statement: "The deployment owner has not agreed a rollback policy.",
        impact:
          "A failed release could not demonstrate a safe rollback without that policy.",
        severity: "high",
        status: "deferred",
        blocking: false,
        deferredWithUserApproval: false,
        evidenceIds: [],
        resolutionOwner: "Release owner",
        resolutionPoint: "Before production rollout.",
        trigger: "Before the capability flag is enabled in production.",
        fallback:
          "Do not enable the feature until a rollback policy is approved.",
      },
    ],
  });
  assert.match(
    validatePlanDraft(unapprovedHighDeferral).errors.join("\n"),
    /needs explicit user approval/i,
  );

  const na = validDraft();
  na.engineering[0] = { area: "architecture", assessment: "N/A" };
  assert.match(validatePlanDraft(na).errors.join("\n"), /must explain why/i);
});

test("repository-seam auditing rejects nonexistent and escaping observed paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-audit-"));
  await mkdir(join(cwd, "src/auth"), { recursive: true });
  await mkdir(join(cwd, "tests/auth"), { recursive: true });
  await Promise.all([
    writeFile(join(cwd, "src/auth/types.ts"), "export {};\n"),
    writeFile(join(cwd, "src/auth/service.ts"), "export {};\n"),
    writeFile(join(cwd, "src/auth/routes.ts"), "export {};\n"),
    writeFile(join(cwd, "tests/auth/routes.test.ts"), "export {};\n"),
  ]);
  assert.equal((await auditPlanDraft(validDraft(), cwd)).valid, true);

  const missing = validDraft();
  missing.tasks[0]!.files[0]!.path = "src/auth/missing.ts";
  assert.match(
    (await auditPlanDraft(missing, cwd)).errors.join("\n"),
    /was not found|names observed file/i,
  );

  const missingEvidenceSeam = validDraft();
  missingEvidenceSeam.repositoryEvidence[0]!.seams = ["src/auth/missing.ts"];
  assert.match(
    (await auditPlanDraft(missingEvidenceSeam, cwd)).errors.join("\n"),
    /was not found|names observed file/i,
  );

  const escaped = validDraft();
  escaped.tasks[0]!.files[0]!.path = "../outside.ts";
  assert.match(
    (await auditPlanDraft(escaped, cwd)).errors.join("\n"),
    /escapes the current project/i,
  );
});

test("planned paths include task and subtask files and coverage report exposes orphan work", () => {
  assert.deepEqual(plannedPaths(validDraft()), [
    "src/auth/types.ts",
    "src/auth/service.ts",
    "src/auth/routes.ts",
    "tests/auth/routes.test.ts",
  ]);
  const orphan = validDraft();
  orphan.tasks[0]!.requirementIds = [];
  orphan.tasks[0]!.acceptanceCriteriaIds = [];
  assert.deepEqual(planCoverageReport(orphan).orphanTaskIds, [
    "extend-credential-contract",
  ]);
});
