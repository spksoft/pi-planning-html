import type { DecisionAnswer, DecisionNode, DecisionTree } from "./schema.ts";

export interface DecisionNodeInput {
  id: string;
  question: string;
  description?: string;
  dependsOn?: string[];
  factsReady?: boolean;
  factEvidence?: string[];
  options: Array<{ id: string; label: string; description?: string }>;
  recommendation: string;
  recommendationRationale: string;
  impact: string;
  material?: boolean;
}

export interface TreeValidation {
  valid: boolean;
  errors: string[];
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function definitionKey(
  node: Pick<DecisionNode, "question" | "dependsOn" | "options">,
): string {
  return JSON.stringify({
    question: node.question.trim(),
    dependsOn: [...node.dependsOn].sort(),
    options: node.options.map((option) => ({
      id: option.id,
      label: option.label,
    })),
  });
}

export function validateDecisionNodes(nodes: DecisionNode[]): TreeValidation {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const node of nodes) {
    if (!ID_PATTERN.test(node.id))
      errors.push(`Decision ${node.id || "<missing>"} has an invalid ID.`);
    if (ids.has(node.id)) errors.push(`Decision ID ${node.id} is duplicated.`);
    ids.add(node.id);
    if (node.question.trim().length < 8)
      errors.push(`Decision ${node.id} needs a concrete question.`);
    if (node.options.length < 2)
      errors.push(`Decision ${node.id} needs at least two options.`);
    if (
      new Set(node.options.map((option) => option.id)).size !==
      node.options.length
    ) {
      errors.push(`Decision ${node.id} has duplicate option IDs.`);
    }
    if (!node.options.some((option) => option.id === node.recommendation)) {
      errors.push(
        `Decision ${node.id} recommendation must identify one of its options.`,
      );
    }
    if (node.recommendationRationale.trim().length < 8) {
      errors.push(`Decision ${node.id} needs a recommendation rationale.`);
    }
    if (node.impact.trim().length < 8)
      errors.push(`Decision ${node.id} needs impact detail.`);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency))
        errors.push(
          `Decision ${node.id} depends on unknown decision ${dependency}.`,
        );
      if (dependency === node.id)
        errors.push(`Decision ${node.id} cannot depend on itself.`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Decision dependency cycle includes ${id}.`);
      return;
    }
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of nodes) visit(node.id);

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function remapDecisionTree(
  inputs: DecisionNodeInput[],
  previous?: DecisionTree,
): DecisionTree {
  const previousById = new Map(
    previous?.nodes.map((node) => [node.id, node]) ?? [],
  );
  const nodes: DecisionNode[] = inputs.map((input) => {
    const base: DecisionNode = {
      id: input.id.trim(),
      question: input.question.trim(),
      description: input.description?.trim() || undefined,
      dependsOn: [...new Set(input.dependsOn ?? [])],
      factsReady: input.factsReady ?? true,
      factEvidence: (input.factEvidence ?? [])
        .map((item) => item.trim())
        .filter(Boolean),
      options: input.options.map((option) => ({
        id: option.id.trim(),
        label: option.label.trim(),
        description: option.description?.trim() || undefined,
      })),
      recommendation: input.recommendation.trim(),
      recommendationRationale: input.recommendationRationale.trim(),
      impact: input.impact.trim(),
      material: input.material ?? true,
    };
    const previousNode = previousById.get(base.id);
    if (
      previousNode?.answer &&
      definitionKey(previousNode) === definitionKey(base)
    ) {
      base.answer = previousNode.answer;
    }
    return base;
  });

  const validation = validateDecisionNodes(nodes);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));

  let changed = true;
  while (changed) {
    changed = false;
    const settled = new Set(
      nodes.filter((node) => node.answer).map((node) => node.id),
    );
    for (const node of nodes) {
      if (
        node.answer &&
        node.dependsOn.some((dependency) => !settled.has(dependency))
      ) {
        delete node.answer;
        changed = true;
      }
    }
  }
  return { nodes };
}

export function decisionFrontier(tree: DecisionTree): DecisionNode[] {
  const settled = new Set(
    tree.nodes.filter((node) => node.answer).map((node) => node.id),
  );
  return tree.nodes.filter(
    (node) =>
      !node.answer &&
      node.factsReady &&
      node.dependsOn.every((dependency) => settled.has(dependency)),
  );
}

export function waitingDecisions(tree: DecisionTree): DecisionNode[] {
  const settled = new Set(
    tree.nodes.filter((node) => node.answer).map((node) => node.id),
  );
  return tree.nodes.filter(
    (node) =>
      !node.answer &&
      (!node.factsReady ||
        node.dependsOn.some((dependency) => !settled.has(dependency))),
  );
}

function descendantsOf(tree: DecisionTree, id: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const node of tree.nodes) {
      if (
        parent &&
        node.dependsOn.includes(parent) &&
        !descendants.has(node.id)
      ) {
        descendants.add(node.id);
        queue.push(node.id);
      }
    }
  }
  return descendants;
}

export function answerDecision(
  tree: DecisionTree,
  id: string,
  answer: DecisionAnswer,
): DecisionTree {
  const current = tree.nodes.find((node) => node.id === id);
  if (!current) throw new Error(`Unknown decision ${id}.`);
  if (
    !decisionFrontier(tree).some((node) => node.id === id) &&
    !current.answer
  ) {
    throw new Error(`Decision ${id} is not on the current frontier.`);
  }
  if (
    answer.kind === "option" &&
    !current.options.some((option) => option.id === answer.value)
  ) {
    throw new Error(`Decision ${id} answer is not one of its options.`);
  }

  const changed =
    current.answer?.value !== answer.value ||
    current.answer?.kind !== answer.kind;
  const invalidated = changed ? descendantsOf(tree, id) : new Set<string>();
  return {
    nodes: tree.nodes.map((node) => {
      if (node.id === id) return { ...node, answer };
      if (invalidated.has(node.id)) return { ...node, answer: undefined };
      return { ...node };
    }),
  };
}

export function resetDecisionAnswers(
  tree: DecisionTree,
  ids: string[],
): DecisionTree {
  const reset = new Set<string>();
  for (const id of ids) {
    if (!tree.nodes.some((node) => node.id === id))
      throw new Error(`Unknown decision ${id}.`);
    reset.add(id);
    for (const descendant of descendantsOf(tree, id)) reset.add(descendant);
  }
  return {
    nodes: tree.nodes.map((node) => {
      if (!reset.has(node.id)) return { ...node };
      const copy = { ...node };
      delete copy.answer;
      return copy;
    }),
  };
}

export function treeIsSettled(tree: DecisionTree): boolean {
  return tree.nodes.every((node) => Boolean(node.answer));
}

export function summarizeDecisions(tree: DecisionTree): string {
  if (tree.nodes.length === 0)
    return "No user-owned implementation decisions were required after repository research.";
  return tree.nodes
    .map((node) => {
      const answer = node.answer;
      const value = answer
        ? `${answer.label}${answer.kind === "assumption" ? " (acknowledged assumption)" : ""}`
        : "UNRESOLVED";
      return `- ${node.question}\n  Decision: ${value}`;
    })
    .join("\n");
}
