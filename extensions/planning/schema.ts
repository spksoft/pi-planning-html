export const PLANNING_TIERS = ["brief", "standard", "deep"] as const;
export type PlanningTier = (typeof PLANNING_TIERS)[number];

export interface DecisionOption {
  id: string;
  label: string;
  description?: string | undefined;
}

export interface DecisionAnswer {
  value: string;
  label: string;
  kind: "option" | "custom" | "assumption";
  rationale?: string;
  answeredAt: string;
}

export interface DecisionNode {
  id: string;
  question: string;
  description?: string | undefined;
  dependsOn: string[];
  factsReady: boolean;
  factEvidence: string[];
  options: DecisionOption[];
  recommendation: string;
  recommendationRationale: string;
  impact: string;
  material: boolean;
  answer?: DecisionAnswer | undefined;
}

export interface DecisionTree {
  nodes: DecisionNode[];
  sharedUnderstanding?: {
    confirmedAt: string;
    summary: string;
    treeDigest: string;
  };
}

export interface PlanFinding {
  summary: string;
  evidence: string[];
}

export interface PlanTask {
  id: string;
  title: string;
  what: string;
  why: string;
  how: string;
  files: string[];
  dependsOn: string[];
  validation: string[];
}

export interface PlanRisk {
  risk: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
}

export interface PlanAssumption {
  assumption: string;
  confidence: "low" | "medium" | "high";
  impactIfFalse: string;
  acknowledged: boolean;
}

export interface PlanOpenQuestion {
  question: string;
  blocking: boolean;
}

export interface DeepPlanSection {
  name:
    | "architecture"
    | "security"
    | "migration"
    | "rollout"
    | "observability"
    | "rollback";
  content: string;
}

export interface PlanDraft {
  title: string;
  slug: string;
  tier: PlanningTier;
  mainIdea: string;
  outcome: string;
  acceptanceCriteria: string[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  findings: PlanFinding[];
  tasks: PlanTask[];
  validation: string[];
  risks: PlanRisk[];
  assumptions: PlanAssumption[];
  openQuestions: PlanOpenQuestion[];
  deepSections: DeepPlanSection[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_PATTERN =
  /^(?:tbd|todo|n\/?a|none|same as above|update (?:the )?code|implement (?:the )?(?:change|feature)|fix (?:the )?(?:issue|bug)|do it)[.!]?$/i;

function present(value: string, minimum = 1): boolean {
  const trimmed = value.trim();
  return trimmed.length >= minimum && !PLACEHOLDER_PATTERN.test(trimmed);
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validateTaskGraph(tasks: PlanTask[], errors: string[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency)) {
        errors.push(`Task ${task.id} depends on unknown task ${dependency}.`);
      }
      if (dependency === task.id) {
        errors.push(`Task ${task.id} cannot depend on itself.`);
      }
    }
  }

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Task dependency cycle includes ${id}.`);
      return;
    }
    visiting.add(id);
    const task = byId.get(id);
    for (const dependency of task?.dependsOn ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const task of tasks) visit(task.id);
}

export function validatePlanDraft(draft: PlanDraft): ValidationResult {
  const errors: string[] = [];

  if (!present(draft.title, 4)) errors.push("Plan title must be specific.");
  if (!SLUG_PATTERN.test(draft.slug))
    errors.push("Plan slug must be lowercase kebab-case.");
  if (!PLANNING_TIERS.includes(draft.tier))
    errors.push("Plan tier is invalid.");
  if (!present(draft.mainIdea, 12))
    errors.push("Main idea must state the decision or approach.");
  if (!present(draft.outcome, 12))
    errors.push("Outcome must describe observable target behavior.");
  if (
    draft.acceptanceCriteria.length === 0 ||
    draft.acceptanceCriteria.some((item) => !present(item, 8))
  ) {
    errors.push("At least one concrete acceptance criterion is required.");
  }
  if (draft.tasks.length === 0)
    errors.push("At least one implementation task is required.");
  if (!unique(draft.tasks.map((task) => task.id)))
    errors.push("Task IDs must be unique.");

  for (const task of draft.tasks) {
    const label = task.id || "<missing-id>";
    if (!ID_PATTERN.test(task.id))
      errors.push(`Task ${label} has an invalid stable ID.`);
    if (!present(task.title, 4))
      errors.push(`Task ${label} needs a specific title.`);
    if (!present(task.what, 12))
      errors.push(`Task ${label} must include concrete What detail.`);
    if (!present(task.why, 12))
      errors.push(`Task ${label} must include concrete Why detail.`);
    if (!present(task.how, 20))
      errors.push(
        `Task ${label} must include implementation-ready How detail.`,
      );
    if (task.files.length === 0)
      errors.push(
        `Task ${label} must name at least one affected file or module.`,
      );
    if (task.files.some((path) => !present(path)))
      errors.push(`Task ${label} contains an empty file path.`);
    if (
      task.validation.length === 0 ||
      task.validation.some((item) => !present(item, 8))
    ) {
      errors.push(
        `Task ${label} needs at least one concrete validation check.`,
      );
    }
    if (!unique(task.dependsOn))
      errors.push(`Task ${label} repeats a dependency.`);
  }

  validateTaskGraph(draft.tasks, errors);

  if (draft.openQuestions.some((item) => item.blocking)) {
    errors.push("Blocking open questions must be resolved before review.");
  }
  for (const assumption of draft.assumptions) {
    if (!assumption.acknowledged) {
      errors.push(`Assumption must be acknowledged: ${assumption.assumption}`);
    }
    if (!present(assumption.impactIfFalse, 8)) {
      errors.push(
        `Assumption needs impact-if-false detail: ${assumption.assumption}`,
      );
    }
  }
  for (const risk of draft.risks) {
    if (!present(risk.risk, 8) || !present(risk.mitigation, 8)) {
      errors.push("Each risk needs a concrete description and mitigation.");
    }
  }
  if (
    draft.validation.length === 0 ||
    draft.validation.some((item) => !present(item, 8))
  ) {
    errors.push("The plan needs an end-to-end validation strategy.");
  }

  if (draft.tier === "deep") {
    const required = ["architecture", "rollout", "rollback"] as const;
    const byName = new Map(
      draft.deepSections.map((section) => [section.name, section.content]),
    );
    for (const name of required) {
      if (!present(byName.get(name) ?? "", 12)) {
        errors.push(`Deep plans require a substantive ${name} section.`);
      }
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function plannedPaths(draft: PlanDraft): string[] {
  return [
    ...new Set(
      draft.tasks
        .flatMap((task) => task.files)
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ];
}
