import assert from "node:assert/strict";
import test from "node:test";
import {
  plannedPaths,
  validatePlanDraft,
} from "../extensions/planning/schema.ts";
import { validDraft } from "./helpers.ts";

test("a complete dependency-aware plan is accepted", () => {
  const result = validatePlanDraft(validDraft());
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("every task and subtask requires concrete What, Why, How, files, and validation", () => {
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
});

test("architecture design requires a summary and Mermaid flowchart", () => {
  const missingSummary = validDraft({
    architecture: { ...validDraft().architecture, summary: "TBD" },
  });
  assert.match(
    validatePlanDraft(missingSummary).errors.join("\n"),
    /Architecture design summary/i,
  );

  const missingDiagram = validDraft({
    architecture: { ...validDraft().architecture, diagram: "" },
  });
  assert.match(
    validatePlanDraft(missingDiagram).errors.join("\n"),
    /Architecture diagram/i,
  );

  const unsupportedDiagram = validDraft({
    architecture: {
      ...validDraft().architecture,
      diagram: "sequenceDiagram\n  Browser->>Service: Sign in request",
    },
  });
  assert.match(
    validatePlanDraft(unsupportedDiagram).errors.join("\n"),
    /Mermaid flowchart/i,
  );
});

test("subtasks, global dependency IDs, and engineering coverage are required", () => {
  const missingSubtask = validDraft();
  missingSubtask.tasks[0] = { ...missingSubtask.tasks[0]!, subtasks: [] };
  assert.match(
    validatePlanDraft(missingSubtask).errors.join("\n"),
    /must include at least one implementation subtask/i,
  );

  const missingDependency = validDraft();
  missingDependency.tasks[1] = {
    ...missingDependency.tasks[1]!,
    dependsOn: ["unknown-work"],
  };
  assert.match(
    validatePlanDraft(missingDependency).errors.join("\n"),
    /unknown work item/i,
  );

  const incompleteEngineering = validDraft({
    engineering: validDraft().engineering.slice(1),
  });
  assert.match(
    validatePlanDraft(incompleteEngineering).errors.join("\n"),
    /architecture/i,
  );
});

test("blocking questions reject publication and planned paths include subtasks", () => {
  const draft = validDraft({
    openQuestions: [{ question: "Should rollout be staged?", blocking: true }],
  });
  assert.match(
    validatePlanDraft(draft).errors.join("\n"),
    /Blocking open questions/,
  );
  assert.deepEqual(plannedPaths(validDraft()), [
    "src/auth/types.ts",
    "src/auth/service.ts",
    "src/auth/routes.ts",
    "tests/auth/routes.test.ts",
  ]);
});
