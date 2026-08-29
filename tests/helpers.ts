import {
  answerDecision,
  remapDecisionTree,
} from "../extensions/planning/decision-tree.ts";
import type { DecisionTree, PlanDraft } from "../extensions/planning/schema.ts";

export function settledTree(): DecisionTree {
  let tree = remapDecisionTree([
    {
      id: "session-policy",
      question: "Should existing sessions remain valid during rollout?",
      dependsOn: [],
      factsReady: true,
      factEvidence: ["Existing sessions are versioned."],
      options: [
        { id: "preserve", label: "Preserve existing sessions" },
        { id: "reauth", label: "Require re-authentication" },
      ],
      recommendation: "preserve",
      recommendationRationale: "It avoids unnecessary user disruption.",
      impact: "This changes rollout and compatibility behavior.",
      material: true,
    },
  ]);
  tree = answerDecision(tree, "session-policy", {
    value: "preserve",
    label: "Preserve existing sessions",
    kind: "option",
    answeredAt: "2026-08-28T00:00:00.000Z",
  });
  return {
    ...tree,
    sharedUnderstanding: {
      confirmedAt: "2026-08-28T00:01:00.000Z",
      summary: "Preserve existing sessions during rollout.",
      treeDigest: "test-tree-digest",
    },
  };
}

export function validDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    title: "Add passkey authentication",
    slug: "add-passkey-authentication",
    tier: "standard",
    mainIdea:
      "Extend the existing authentication boundary instead of adding a parallel identity stack.",
    outcome:
      "Users can sign in with passkeys while existing password sessions and recovery behavior remain available.",
    acceptanceCriteria: [
      "A registered user can complete passkey sign-in and receive the existing session cookie.",
    ],
    inScope: ["Passkey registration and sign-in"],
    outOfScope: ["Removing password authentication"],
    constraints: ["Reuse the existing session issuance service."],
    findings: [
      {
        summary: "The authentication service already owns session issuance.",
        evidence: ["src/auth/service.ts:AuthService.createSession"],
      },
    ],
    tasks: [
      {
        id: "extend-credential-contract",
        title: "Extend the credential verification contract",
        what: "Add a WebAuthn assertion variant to the existing credential request and verification result types.",
        why: "The passkey flow must enter the existing authentication boundary without creating a second session stack.",
        how: "Update the named request types, reuse AuthService verification dispatch, preserve password handling, and cover both variants with focused unit tests.",
        files: ["src/auth/types.ts", "src/auth/service.ts"],
        dependsOn: [],
        validation: [
          "Run the focused authentication unit tests and confirm both credential variants pass.",
        ],
      },
      {
        id: "wire-passkey-route",
        title: "Wire the passkey sign-in route",
        what: "Accept validated passkey assertions in the sign-in route and return the existing session cookie response.",
        why: "This exposes the approved passkey behavior while preserving the current session contract.",
        how: "Call the extended AuthService method, map verification failures to existing error responses, reuse cookie issuance, and add route success and recovery-failure tests.",
        files: ["src/auth/routes.ts", "tests/auth/routes.test.ts"],
        dependsOn: ["extend-credential-contract"],
        validation: [
          "Run route tests and manually verify success, invalid assertion, and recovery fallback behavior.",
        ],
      },
    ],
    validation: [
      "Run the authentication unit and route suites, then exercise registration and sign-in end to end.",
    ],
    risks: [
      {
        risk: "Browser or authenticator differences may produce incompatible assertion data.",
        severity: "medium",
        mitigation:
          "Validate against the selected adapter and cover supported browser fixtures.",
      },
    ],
    assumptions: [
      {
        assumption: "Existing session cookies remain valid during rollout.",
        confidence: "high",
        impactIfFalse:
          "A migration and forced re-authentication flow would be required.",
        acknowledged: true,
      },
    ],
    openQuestions: [],
    deepSections: [],
    ...overrides,
  };
}
