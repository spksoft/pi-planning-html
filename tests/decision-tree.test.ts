import assert from "node:assert/strict";
import test from "node:test";
import {
  answerDecision,
  decisionFrontier,
  remapDecisionTree,
  treeIsSettled,
  validateDecisionNodes,
  waitingDecisions,
  type DecisionNodeInput,
} from "../extensions/planning/decision-tree.ts";

const storageDecision = {
  id: "storage",
  question: "Where should the plan artifact be stored?",
  options: [
    { id: "workspace", label: "Workspace" },
    { id: "private", label: "Private directory" },
  ],
  recommendation: "workspace",
  recommendationRationale: "It preserves package compatibility.",
  impact: "The choice affects collaboration and repository state.",
} satisfies DecisionNodeInput;

const formatDecision = {
  id: "format",
  question: "Which artifact view should be canonical for review?",
  dependsOn: ["storage"],
  options: [
    { id: "html", label: "HTML" },
    { id: "markdown", label: "Markdown" },
  ],
  recommendation: "html",
  recommendationRationale: "HTML is the package's review contract.",
  impact: "The choice controls rendering and artifact validation.",
} satisfies DecisionNodeInput;

const inputs: DecisionNodeInput[] = [storageDecision, formatDecision];

function answer(value: string, label: string) {
  return {
    value,
    label,
    kind: "option" as const,
    answeredAt: "2026-08-28T00:00:00.000Z",
  };
}

test("frontier contains only decisions whose prerequisites are settled", () => {
  let tree = remapDecisionTree([...inputs]);
  assert.deepEqual(
    decisionFrontier(tree).map((node) => node.id),
    ["storage"],
  );
  assert.deepEqual(
    waitingDecisions(tree).map((node) => node.id),
    ["format"],
  );

  tree = answerDecision(tree, "storage", answer("workspace", "Workspace"));
  assert.deepEqual(
    decisionFrontier(tree).map((node) => node.id),
    ["format"],
  );
  tree = answerDecision(tree, "format", answer("html", "HTML"));
  assert.equal(treeIsSettled(tree), true);
});

test("remapping preserves answers only when the decision definition is unchanged", () => {
  let tree = remapDecisionTree([...inputs]);
  tree = answerDecision(tree, "storage", answer("workspace", "Workspace"));
  const preserved = remapDecisionTree([...inputs], tree);
  assert.equal(preserved.nodes[0]?.answer?.value, "workspace");

  const changed = remapDecisionTree(
    [
      {
        ...storageDecision,
        question: "Should plans be committed to the workspace?",
      },
      formatDecision,
    ],
    tree,
  );
  assert.equal(changed.nodes[0]?.answer, undefined);
});

test("changing or remapping a parent invalidates settled descendants", () => {
  let tree = remapDecisionTree([...inputs]);
  tree = answerDecision(tree, "storage", answer("workspace", "Workspace"));
  tree = answerDecision(tree, "format", answer("html", "HTML"));
  tree = answerDecision(
    tree,
    "storage",
    answer("private", "Private directory"),
  );
  assert.equal(
    tree.nodes.find((node) => node.id === "format")?.answer,
    undefined,
  );
  assert.deepEqual(
    decisionFrontier(tree).map((node) => node.id),
    ["format"],
  );

  tree = answerDecision(tree, "format", answer("html", "HTML"));
  const remapped = remapDecisionTree(
    [
      {
        ...storageDecision,
        question: "Should the plan be stored in the workspace?",
      },
      formatDecision,
    ],
    tree,
  );
  assert.equal(
    remapped.nodes.find((node) => node.id === "storage")?.answer,
    undefined,
  );
  assert.equal(
    remapped.nodes.find((node) => node.id === "format")?.answer,
    undefined,
  );
});

test("invalid dependencies and cycles are rejected", () => {
  assert.throws(
    () =>
      remapDecisionTree([
        { ...storageDecision, dependsOn: ["format"] },
        { ...formatDecision, dependsOn: ["storage"] },
      ]),
    /cycle/i,
  );

  const tree = remapDecisionTree([...inputs]);
  assert.equal(validateDecisionNodes(tree.nodes).valid, true);
});

test("facts that are not ready wait without blocking independent frontier nodes", () => {
  const tree = remapDecisionTree([
    { ...storageDecision, factsReady: false, factEvidence: [] },
    {
      id: "recovery",
      question: "Which recovery policy should the feature use?",
      options: [
        { id: "email", label: "Verified email" },
        { id: "admin", label: "Administrator only" },
      ],
      recommendation: "email",
      recommendationRationale: "It provides user-controlled recovery.",
      impact: "Recovery policy affects account access and support load.",
    },
  ]);
  assert.deepEqual(
    decisionFrontier(tree).map((node) => node.id),
    ["recovery"],
  );
  assert.deepEqual(
    waitingDecisions(tree).map((node) => node.id),
    ["storage"],
  );
});
