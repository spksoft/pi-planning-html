export const ENGINEERING_AREAS = [
  "architecture",
  "security",
  "data-and-migrations",
  "testing",
  "rollout-and-rollback",
  "observability",
  "performance-and-accessibility",
] as const;

export type EngineeringArea = (typeof ENGINEERING_AREAS)[number];

export interface PlanFinding {
  summary: string;
  evidence: string[];
}

export interface PlanSubtask {
  id: string;
  title: string;
  what: string;
  why: string;
  how: string;
  files: string[];
  dependsOn: string[];
  validation: string[];
}

export interface PlanTask extends PlanSubtask {
  subtasks: PlanSubtask[];
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
}

export interface PlanOpenQuestion {
  question: string;
  blocking: boolean;
}

export interface EngineeringConsideration {
  area: EngineeringArea;
  assessment: string;
}

export interface ArchitectureDesign {
  summary: string;
  diagram: string;
}

export interface PlanDraft {
  title: string;
  slug: string;
  summary: string;
  outcome: string;
  acceptanceCriteria: string[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  findings: PlanFinding[];
  architecture: ArchitectureDesign;
  tasks: PlanTask[];
  validation: string[];
  risks: PlanRisk[];
  assumptions: PlanAssumption[];
  openQuestions: PlanOpenQuestion[];
  engineering: EngineeringConsideration[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_PATTERN =
  /^(?:tbd|todo|n\/?a|none|same as above|update (?:the )?code|implement (?:the )?(?:change|feature)|fix (?:the )?(?:issue|bug)|do it)[.!]?$/i;
const FLOWCHART_PATTERN = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i;

function present(value: string, minimum = 1): boolean {
  const trimmed = value.trim();
  return trimmed.length >= minimum && !PLACEHOLDER_PATTERN.test(trimmed);
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validateWorkItem(
  item: PlanSubtask,
  knownIds: Set<string>,
  errors: string[],
  label: string,
): void {
  const id = item.id || "<missing-id>";
  if (!ID_PATTERN.test(item.id))
    errors.push(`${label} ${id} has an invalid stable ID.`);
  if (!present(item.title, 4))
    errors.push(`${label} ${id} needs a specific title.`);
  if (!present(item.what, 12))
    errors.push(`${label} ${id} must include concrete What detail.`);
  if (!present(item.why, 12))
    errors.push(`${label} ${id} must include concrete Why detail.`);
  if (!present(item.how, 20))
    errors.push(`${label} ${id} must include implementation-ready How detail.`);
  if (item.files.length === 0 || item.files.some((path) => !present(path))) {
    errors.push(`${label} ${id} must name affected files or modules.`);
  }
  if (
    item.validation.length === 0 ||
    item.validation.some((check) => !present(check, 8))
  ) {
    errors.push(`${label} ${id} needs at least one concrete validation check.`);
  }
  if (!unique(item.dependsOn))
    errors.push(`${label} ${id} repeats a dependency.`);
  for (const dependency of item.dependsOn) {
    if (!knownIds.has(dependency)) {
      errors.push(`${label} ${id} depends on unknown work item ${dependency}.`);
    }
    if (dependency === item.id)
      errors.push(`${label} ${id} cannot depend on itself.`);
  }
}

function validateDependencyCycles(
  items: PlanSubtask[],
  errors: string[],
): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Work-item dependency cycle includes ${id}.`);
      return;
    }
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const item of items) visit(item.id);
}

export function validatePlanDraft(draft: PlanDraft): ValidationResult {
  const errors: string[] = [];

  if (!present(draft.title, 4)) errors.push("Plan title must be specific.");
  if (!SLUG_PATTERN.test(draft.slug))
    errors.push("Plan slug must be lowercase kebab-case.");
  if (!present(draft.summary, 12))
    errors.push("Plan summary must explain the approach.");
  if (!present(draft.outcome, 12))
    errors.push("Outcome must describe observable target behavior.");
  if (
    draft.acceptanceCriteria.length === 0 ||
    draft.acceptanceCriteria.some((item) => !present(item, 8))
  ) {
    errors.push("At least one concrete acceptance criterion is required.");
  }
  if (
    draft.inScope.length === 0 ||
    draft.inScope.some((item) => !present(item, 4))
  ) {
    errors.push("The plan must state concrete in-scope work.");
  }
  if (draft.tasks.length === 0)
    errors.push("At least one implementation task is required.");
  if (!present(draft.architecture.summary, 20)) {
    errors.push(
      "Architecture design summary must explain component boundaries and flows.",
    );
  }
  if (
    !present(draft.architecture.diagram, 20) ||
    !FLOWCHART_PATTERN.test(draft.architecture.diagram.trim())
  ) {
    errors.push(
      "Architecture diagram must be a Mermaid flowchart with a direction such as flowchart LR.",
    );
  }

  const workItems = draft.tasks.flatMap((task) => [task, ...task.subtasks]);
  const ids = workItems.map((item) => item.id);
  const knownIds = new Set(ids);
  if (!unique(ids))
    errors.push("Task and subtask IDs must be unique across the plan.");

  for (const task of draft.tasks) {
    validateWorkItem(task, knownIds, errors, "Task");
    if (task.subtasks.length === 0) {
      errors.push(
        `Task ${task.id || "<missing-id>"} must include at least one implementation subtask.`,
      );
    }
    for (const subtask of task.subtasks) {
      validateWorkItem(subtask, knownIds, errors, "Subtask");
    }
  }
  validateDependencyCycles(workItems, errors);

  if (
    draft.validation.length === 0 ||
    draft.validation.some((item) => !present(item, 8))
  ) {
    errors.push("The plan needs an end-to-end validation strategy.");
  }
  if (draft.openQuestions.some((item) => item.blocking)) {
    errors.push("Blocking open questions must be resolved before publishing.");
  }
  for (const risk of draft.risks) {
    if (!present(risk.risk, 8) || !present(risk.mitigation, 8)) {
      errors.push("Each risk needs a concrete description and mitigation.");
    }
  }
  for (const assumption of draft.assumptions) {
    if (
      !present(assumption.assumption, 8) ||
      !present(assumption.impactIfFalse, 8)
    ) {
      errors.push("Each assumption needs its impact if false.");
    }
  }

  const areas = draft.engineering.map((item) => item.area);
  if (!unique(areas))
    errors.push("Engineering considerations must not repeat an area.");
  for (const area of ENGINEERING_AREAS) {
    const assessment =
      draft.engineering.find((item) => item.area === area)?.assessment ?? "";
    if (!present(assessment, 12)) {
      errors.push(`Engineering consideration is required for ${area}.`);
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function plannedPaths(draft: PlanDraft): string[] {
  return [
    ...new Set(
      draft.tasks
        .flatMap((task) => [task, ...task.subtasks])
        .flatMap((task) => task.files)
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ];
}
