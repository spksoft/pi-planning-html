import assert from "node:assert/strict";
import test from "node:test";
import {
  plannedPaths,
  validatePlanDraft,
} from "../extensions/planning/schema.ts";
import { validDraft } from "./helpers.ts";

test("valid implementation-ready plan is accepted", () => {
  const result = validatePlanDraft(validDraft());
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("every task requires concrete What, Why, and How detail", () => {
  for (const field of ["what", "why", "how"] as const) {
    const draft = validDraft();
    draft.tasks[0] = { ...draft.tasks[0]!, [field]: "TBD" };
    const result = validatePlanDraft(draft);
    assert.equal(result.valid, false);
    assert.match(
      result.errors.join("\n"),
      new RegExp(`must include .*${field}`, "i"),
    );
  }
});

test("blocking questions and unacknowledged assumptions reject review", () => {
  const draft = validDraft({
    openQuestions: [{ question: "Should rollout be staged?", blocking: true }],
    assumptions: [
      {
        assumption: "Rollout can happen in one release.",
        confidence: "low",
        impactIfFalse: "A feature flag and staged rollout task are required.",
        acknowledged: false,
      },
    ],
  });
  const result = validatePlanDraft(draft);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /Blocking open questions/);
  assert.match(result.errors.join("\n"), /Assumption must be acknowledged/);
});

test("task graph rejects missing dependencies and cycles", () => {
  const missing = validDraft();
  missing.tasks[1] = { ...missing.tasks[1]!, dependsOn: ["unknown-task"] };
  assert.match(validatePlanDraft(missing).errors.join("\n"), /unknown task/);

  const cyclic = validDraft();
  cyclic.tasks[0] = { ...cyclic.tasks[0]!, dependsOn: [cyclic.tasks[1]!.id] };
  assert.match(validatePlanDraft(cyclic).errors.join("\n"), /cycle/);
});

test("deep plans require architecture, rollout, and rollback", () => {
  const draft = validDraft({ tier: "deep" });
  assert.equal(validatePlanDraft(draft).valid, false);
  draft.deepSections = [
    {
      name: "architecture",
      content:
        "Extend the existing authentication boundary and credential adapter.",
    },
    {
      name: "rollout",
      content:
        "Release behind a flag, observe failures, then expand by cohort.",
    },
    {
      name: "rollback",
      content:
        "Disable the flag while preserving stored credentials and password access.",
    },
  ];
  assert.equal(validatePlanDraft(draft).valid, true);
});

test("planned paths are unique across tasks", () => {
  const paths = plannedPaths(validDraft());
  assert.deepEqual(paths, [
    "src/auth/types.ts",
    "src/auth/service.ts",
    "src/auth/routes.ts",
    "tests/auth/routes.test.ts",
  ]);
});
