import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const ENGINEERING_AREAS = [
  "architecture",
  "security",
  "data-and-migrations",
  "testing",
  "rollout-and-rollback",
  "observability",
  "performance-and-accessibility",
] as const;

export const EVIDENCE_SOURCE_TYPES = ["repo", "user", "external"] as const;
export const VALIDATION_LEVELS = [
  "unit",
  "integration",
  "contract",
  "e2e",
  "manual",
  "operational",
] as const;
export const ARCHITECTURE_NODE_KINDS = [
  "actor",
  "component",
  "store",
  "external",
] as const;

export type EngineeringArea = (typeof ENGINEERING_AREAS)[number];
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];
export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];
export type ArchitectureNodeKind = (typeof ARCHITECTURE_NODE_KINDS)[number];
export type Confidence = "low" | "medium" | "high";

export interface PlanEvidence {
  id: string;
  claim: string;
  sourceType: EvidenceSourceType;
  source: string;
  confidence: Confidence;
  notes: string;
}

export interface PlanFinding {
  summary: string;
  evidenceIds: string[];
}

export interface PlanFileReference {
  path: string;
  status: "observed" | "proposed";
  evidenceId?: string;
}

export interface PlanRequirement {
  id: string;
  statement: string;
  rationale: string;
  priority: "must" | "should" | "could";
  evidenceIds: string[];
}

export interface PlanAcceptanceCriterion {
  id: string;
  requirementIds: string[];
  precondition: string;
  action: string;
  outcome: string;
  edgeCase: string;
  validationIds: string[];
}

export interface PlanDecision {
  id: string;
  context: string;
  choice: string;
  alternatives: string[];
  rationale: string;
  evidenceIds: string[];
  consequences: string;
  reversibility: "easy" | "moderate" | "hard";
  affectedModules: string[];
  status: "decided" | "provisional";
}

export interface PlanValidation {
  id: string;
  level: ValidationLevel;
  procedure: string;
  preconditions: string[];
  expectedEvidence: string;
  acceptanceCriteriaIds: string[];
}

/**
 * Tasks are executable units. Subtasks are detailed decomposition notes within
 * their parent task, so all ordering belongs to task.dependsOn.
 */
export interface PlanSubtask {
  id: string;
  title: string;
  what: string;
  why: string;
  how: string;
  files: PlanFileReference[];
  validationIds: string[];
}

export interface PlanTask extends PlanSubtask {
  kind: "implementation" | "foundation";
  expectedBehavior: string;
  parallelSafety: string;
  requirementIds: string[];
  acceptanceCriteriaIds: string[];
  decisionIds: string[];
  dependsOn: string[];
  foundationFor: string[];
  subtasks: PlanSubtask[];
}

export interface PlanRisk {
  risk: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
}

export interface PlanAssumption {
  id: string;
  assumption: string;
  confidence: Confidence;
  impactIfFalse: string;
  provenance: "user" | "planner-judgment" | "repository-evidence";
  resolutionPoint: string;
  fallback: string;
}

export interface PlanUnknown {
  id: string;
  statement: string;
  impact: string;
  severity: "low" | "medium" | "high";
  status: "needs-decision" | "deferred";
  blocking: boolean;
  deferredWithUserApproval: boolean;
  evidenceIds: string[];
  resolutionOwner: string;
  resolutionPoint: string;
  trigger: string;
  fallback: string;
}

export interface EngineeringConsideration {
  area: EngineeringArea;
  assessment: string;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  kind: ArchitectureNodeKind;
  responsibility: string;
  taskIds: string[];
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  label: string;
}

export interface ArchitectureDesign {
  summary: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

export interface PlanDraft {
  title: string;
  slug: string;
  summary: string;
  outcome: string;
  repositoryEvidence: PlanEvidence[];
  requirements: PlanRequirement[];
  acceptanceCriteria: PlanAcceptanceCriterion[];
  decisions: PlanDecision[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  findings: PlanFinding[];
  architecture: ArchitectureDesign;
  tasks: PlanTask[];
  validations: PlanValidation[];
  endToEndValidationIds: string[];
  risks: PlanRisk[];
  assumptions: PlanAssumption[];
  unknowns: PlanUnknown[];
  engineering: EngineeringConsideration[];
}

export interface PlanCoverageReport {
  uncoveredRequirementIds: string[];
  uncoveredAcceptanceCriteriaIds: string[];
  unvalidatedTaskIds: string[];
  orphanTaskIds: string[];
  unresolvedBlockerIds: string[];
  contradictions: string[];
  unsupportedSpecifics: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  coverage: PlanCoverageReport;
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_PATTERN =
  /^(?:tbd|todo|n\/?a|none|same as above|update (?:the )?code|implement (?:the )?(?:change|feature)|fix (?:the )?(?:issue|bug)|do it)[.!]?$/i;
const UNEXPLAINED_NOT_APPLICABLE_PATTERN = /^(?:n\/?a|not applicable)[.!]?$/i;
const GENERIC_IMPLEMENTATION_PATTERN =
  /^(?:update|change|modify|fix|implement|add)\s+(?:the\s+)?(?:code|feature|application|system)(?:\s+(?:to|for|as)\s+.*)?[.!]?$/i;

function present(value: string, minimum = 1): boolean {
  const trimmed = value.trim();
  return trimmed.length >= minimum && !PLACEHOLDER_PATTERN.test(trimmed);
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function requireText(
  value: string,
  minimum: number,
  message: string,
  errors: string[],
): void {
  if (!present(value, minimum)) errors.push(message);
}

function validateIds(
  ids: string[],
  knownIds: Set<string>,
  label: string,
  errors: string[],
  minimum = 0,
): void {
  if (ids.length < minimum)
    errors.push(`${label} must reference at least one item.`);
  if (!unique(ids)) errors.push(`${label} repeats a reference.`);
  for (const id of ids) {
    if (!knownIds.has(id)) errors.push(`${label} references unknown ID ${id}.`);
  }
}

function validateFileReferences(
  files: PlanFileReference[],
  evidenceById: Map<string, PlanEvidence>,
  label: string,
  errors: string[],
): void {
  if (files.length === 0) {
    errors.push(`${label} must name affected files or modules.`);
    return;
  }
  const paths = files.map((file) => file.path.trim());
  if (!unique(paths))
    errors.push(`${label} repeats an affected file or module.`);
  for (const file of files) {
    if (!present(file.path, 2))
      errors.push(`${label} has an invalid file or module path.`);
    const evidence = file.evidenceId
      ? evidenceById.get(file.evidenceId)
      : undefined;
    if (file.status === "observed" && !file.evidenceId) {
      errors.push(
        `${label} must cite repository evidence for observed file ${file.path}.`,
      );
    }
    if (file.evidenceId && !evidence) {
      errors.push(`${label} references unknown evidence ${file.evidenceId}.`);
    }
    if (
      file.status === "observed" &&
      evidence &&
      evidence.sourceType !== "repo"
    ) {
      errors.push(
        `${label} must cite repository evidence for observed file ${file.path}.`,
      );
    }
  }
}

function validateDetailItem(
  item: PlanSubtask,
  evidenceById: Map<string, PlanEvidence>,
  validationIds: Set<string>,
  label: string,
  errors: string[],
): void {
  const id = item.id || "<missing-id>";
  if (!ID_PATTERN.test(item.id)) {
    errors.push(
      `${label} ${id} has an invalid stable ID. IDs must start with a letter and use only letters, digits, hyphens, underscores, or dots.`,
    );
  }
  requireText(item.title, 4, `${label} ${id} needs a specific title.`, errors);
  requireText(
    item.what,
    12,
    `${label} ${id} must include concrete What detail.`,
    errors,
  );
  requireText(
    item.why,
    12,
    `${label} ${id} must include concrete Why detail.`,
    errors,
  );
  requireText(
    item.how,
    20,
    `${label} ${id} must include implementation-ready How detail.`,
    errors,
  );
  if (GENERIC_IMPLEMENTATION_PATTERN.test(item.how.trim())) {
    errors.push(
      `${label} ${id} must name concrete interfaces, behavior, or test seams instead of generic implementation prose.`,
    );
  }
  validateFileReferences(item.files, evidenceById, `${label} ${id}`, errors);
  validateIds(
    item.validationIds,
    validationIds,
    `${label} ${id} validation`,
    errors,
    1,
  );
}

function validateTaskCycles(tasks: PlanTask[], errors: string[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Task dependency cycle includes ${id}.`);
      return;
    }
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }

  for (const task of tasks) visit(task.id);
}

export function planCoverageReport(draft: PlanDraft): PlanCoverageReport {
  const taskIds = new Set(draft.tasks.map((task) => task.id));
  const linkedRequirementIds = new Set(
    draft.acceptanceCriteria.flatMap((criterion) => criterion.requirementIds),
  );
  const taskCriterionIds = new Set(
    draft.tasks.flatMap((task) => task.acceptanceCriteriaIds),
  );
  const validatedCriterionIds = new Set(
    draft.validations.flatMap((validation) => validation.acceptanceCriteriaIds),
  );
  const unvalidatedTaskIds = draft.tasks.flatMap((task) =>
    task.validationIds.length === 0 ||
    task.subtasks.some((subtask) => subtask.validationIds.length === 0)
      ? [task.id]
      : [],
  );
  const orphanTaskIds = draft.tasks.flatMap((task) =>
    task.kind === "implementation" &&
    task.requirementIds.length === 0 &&
    task.acceptanceCriteriaIds.length === 0
      ? [task.id]
      : [],
  );
  const unsupportedSpecifics = draft.tasks.flatMap((task) =>
    [...task.files, ...task.subtasks.flatMap((subtask) => subtask.files)]
      .filter((file) => file.status === "observed" && !file.evidenceId)
      .map((file) => `${task.id}:${file.path}`),
  );

  return {
    uncoveredRequirementIds: draft.requirements.flatMap((requirement) =>
      linkedRequirementIds.has(requirement.id) ? [] : [requirement.id],
    ),
    uncoveredAcceptanceCriteriaIds: draft.acceptanceCriteria.flatMap(
      (criterion) =>
        taskCriterionIds.has(criterion.id) &&
        validatedCriterionIds.has(criterion.id)
          ? []
          : [criterion.id],
    ),
    unvalidatedTaskIds,
    orphanTaskIds,
    unresolvedBlockerIds: draft.unknowns.flatMap((unknown) =>
      unknown.blocking || unknown.status === "needs-decision"
        ? [unknown.id]
        : [],
    ),
    contradictions: draft.tasks.flatMap((task) =>
      task.kind === "foundation" &&
      task.foundationFor.some((id) => !taskIds.has(id))
        ? [`${task.id} has an unknown foundation target.`]
        : [],
    ),
    unsupportedSpecifics: [...new Set(unsupportedSpecifics)],
  };
}

export function validatePlanDraft(draft: PlanDraft): ValidationResult {
  const errors: string[] = [];
  const coverage = planCoverageReport(draft);

  requireText(draft.title, 4, "Plan title must be specific.", errors);
  if (!SLUG_PATTERN.test(draft.slug))
    errors.push("Plan slug must be lowercase kebab-case.");
  requireText(
    draft.summary,
    12,
    "Plan summary must explain the approach.",
    errors,
  );
  requireText(
    draft.outcome,
    12,
    "Outcome must describe observable target behavior.",
    errors,
  );
  if (
    draft.inScope.length === 0 ||
    draft.inScope.some((item) => !present(item, 4))
  ) {
    errors.push("The plan must state concrete in-scope work.");
  }
  if (draft.repositoryEvidence.length === 0)
    errors.push(
      "At least one repository or source evidence record is required.",
    );
  if (draft.findings.length === 0)
    errors.push("At least one evidence-backed finding is required.");
  if (
    draft.tasks.length === 0 ||
    !draft.tasks.some((task) => task.kind === "implementation")
  ) {
    errors.push("At least one implementation task is required.");
  }

  const allIds = [
    ...draft.repositoryEvidence.map((item) => item.id),
    ...draft.requirements.map((item) => item.id),
    ...draft.acceptanceCriteria.map((item) => item.id),
    ...draft.decisions.map((item) => item.id),
    ...draft.validations.map((item) => item.id),
    ...draft.assumptions.map((item) => item.id),
    ...draft.unknowns.map((item) => item.id),
    ...draft.tasks.flatMap((task) => [
      task.id,
      ...task.subtasks.map((subtask) => subtask.id),
    ]),
  ];
  if (!unique(allIds))
    errors.push("Stable IDs must be unique across the plan.");
  for (const id of allIds) {
    if (!ID_PATTERN.test(id))
      errors.push(`Stable ID ${id || "<missing-id>"} is invalid.`);
  }

  const evidenceIds = new Set(draft.repositoryEvidence.map((item) => item.id));
  const evidenceById = new Map(
    draft.repositoryEvidence.map((item) => [item.id, item]),
  );
  const requirementIds = new Set(draft.requirements.map((item) => item.id));
  const criterionIds = new Set(draft.acceptanceCriteria.map((item) => item.id));
  const decisionIds = new Set(draft.decisions.map((item) => item.id));
  const validationIds = new Set(draft.validations.map((item) => item.id));
  const taskIds = new Set(draft.tasks.map((item) => item.id));

  for (const evidence of draft.repositoryEvidence) {
    requireText(
      evidence.claim,
      12,
      `Evidence ${evidence.id} needs a concrete claim.`,
      errors,
    );
    requireText(
      evidence.source,
      3,
      `Evidence ${evidence.id} needs a source pointer.`,
      errors,
    );
    requireText(
      evidence.notes,
      3,
      `Evidence ${evidence.id} needs source notes.`,
      errors,
    );
  }
  for (const finding of draft.findings) {
    requireText(
      finding.summary,
      12,
      "Each finding needs a concrete summary.",
      errors,
    );
    validateIds(
      finding.evidenceIds,
      evidenceIds,
      "Finding evidence",
      errors,
      1,
    );
  }
  for (const requirement of draft.requirements) {
    requireText(
      requirement.statement,
      12,
      `Requirement ${requirement.id} needs an observable statement.`,
      errors,
    );
    requireText(
      requirement.rationale,
      12,
      `Requirement ${requirement.id} needs rationale.`,
      errors,
    );
    validateIds(
      requirement.evidenceIds,
      evidenceIds,
      `Requirement ${requirement.id} evidence`,
      errors,
      1,
    );
  }
  for (const criterion of draft.acceptanceCriteria) {
    validateIds(
      criterion.requirementIds,
      requirementIds,
      `Acceptance criterion ${criterion.id} requirements`,
      errors,
      1,
    );
    validateIds(
      criterion.validationIds,
      validationIds,
      `Acceptance criterion ${criterion.id} validation`,
      errors,
      1,
    );
    requireText(
      criterion.precondition,
      8,
      `Acceptance criterion ${criterion.id} needs a precondition.`,
      errors,
    );
    requireText(
      criterion.action,
      8,
      `Acceptance criterion ${criterion.id} needs an action.`,
      errors,
    );
    requireText(
      criterion.outcome,
      12,
      `Acceptance criterion ${criterion.id} needs an observable outcome.`,
      errors,
    );
    requireText(
      criterion.edgeCase,
      8,
      `Acceptance criterion ${criterion.id} needs an edge or failure case.`,
      errors,
    );
  }
  for (const decision of draft.decisions) {
    requireText(
      decision.context,
      12,
      `Decision ${decision.id} needs context.`,
      errors,
    );
    requireText(
      decision.choice,
      8,
      `Decision ${decision.id} needs a choice.`,
      errors,
    );
    requireText(
      decision.rationale,
      12,
      `Decision ${decision.id} needs rationale.`,
      errors,
    );
    requireText(
      decision.consequences,
      12,
      `Decision ${decision.id} needs consequences.`,
      errors,
    );
    if (
      decision.affectedModules.length === 0 ||
      decision.affectedModules.some((item) => !present(item, 2))
    ) {
      errors.push(
        `Decision ${decision.id} must name affected modules or interfaces.`,
      );
    }
    if (
      decision.reversibility === "hard" &&
      decision.alternatives.length === 0
    ) {
      errors.push(
        `Hard-to-reverse decision ${decision.id} must record alternatives considered.`,
      );
    }
    validateIds(
      decision.evidenceIds,
      evidenceIds,
      `Decision ${decision.id} evidence`,
      errors,
      1,
    );
  }
  for (const validation of draft.validations) {
    requireText(
      validation.procedure,
      12,
      `Validation ${validation.id} needs a command or manual procedure.`,
      errors,
    );
    requireText(
      validation.expectedEvidence,
      8,
      `Validation ${validation.id} needs expected evidence.`,
      errors,
    );
    validateIds(
      validation.acceptanceCriteriaIds,
      criterionIds,
      `Validation ${validation.id} acceptance criteria`,
      errors,
      1,
    );
  }
  for (const criterion of draft.acceptanceCriteria) {
    for (const validationId of criterion.validationIds) {
      if (
        !draft.validations
          .find((validation) => validation.id === validationId)
          ?.acceptanceCriteriaIds.includes(criterion.id)
      ) {
        errors.push(
          `Acceptance criterion ${criterion.id} and validation ${validationId} must link to each other.`,
        );
      }
    }
  }
  for (const validation of draft.validations) {
    for (const criterionId of validation.acceptanceCriteriaIds) {
      if (
        !draft.acceptanceCriteria
          .find((criterion) => criterion.id === criterionId)
          ?.validationIds.includes(validation.id)
      ) {
        errors.push(
          `Validation ${validation.id} and acceptance criterion ${criterionId} must link to each other.`,
        );
      }
    }
  }
  validateIds(
    draft.endToEndValidationIds,
    validationIds,
    "End-to-end validation",
    errors,
    1,
  );
  for (const id of draft.endToEndValidationIds) {
    if (
      draft.validations.find((validation) => validation.id === id)?.level !==
      "e2e"
    ) {
      errors.push(
        `End-to-end validation ${id} must use the e2e validation level.`,
      );
    }
  }

  requireText(
    draft.architecture.summary,
    20,
    "Architecture design summary must explain component boundaries and flows.",
    errors,
  );
  if (
    draft.architecture.nodes.length === 0 ||
    draft.architecture.edges.length === 0
  ) {
    errors.push(
      "Architecture design needs typed nodes and directional interactions.",
    );
  }
  const architectureNodeIds = new Set(
    draft.architecture.nodes.map((node) => node.id),
  );
  if (!unique(draft.architecture.nodes.map((node) => node.id))) {
    errors.push("Architecture node IDs must be unique.");
  }
  if (!draft.architecture.nodes.some((node) => node.kind === "actor"))
    errors.push("Architecture design must include a primary actor.");
  if (!draft.architecture.nodes.some((node) => node.kind === "component"))
    errors.push("Architecture design must include a component boundary.");
  if (
    !draft.architecture.nodes.some(
      (node) => node.kind === "store" || node.kind === "external",
    )
  ) {
    errors.push(
      "Architecture design must include a persisted or external dependency.",
    );
  }
  for (const node of draft.architecture.nodes) {
    if (!ID_PATTERN.test(node.id))
      errors.push(
        `Architecture node ${node.id || "<missing-id>"} has an invalid ID.`,
      );
    requireText(
      node.label,
      3,
      `Architecture node ${node.id} needs a label.`,
      errors,
    );
    requireText(
      node.responsibility,
      8,
      `Architecture node ${node.id} needs a responsibility.`,
      errors,
    );
    validateIds(
      node.taskIds,
      taskIds,
      `Architecture node ${node.id} tasks`,
      errors,
    );
  }
  for (const edge of draft.architecture.edges) {
    if (
      !architectureNodeIds.has(edge.from) ||
      !architectureNodeIds.has(edge.to)
    ) {
      errors.push(
        `Architecture interaction ${edge.from} → ${edge.to} must reference known nodes.`,
      );
    }
    requireText(
      edge.label,
      3,
      "Architecture interaction needs a directional label.",
      errors,
    );
  }

  for (const task of draft.tasks) {
    validateDetailItem(task, evidenceById, validationIds, "Task", errors);
    requireText(
      task.expectedBehavior,
      12,
      `Task ${task.id} needs expected behavior.`,
      errors,
    );
    requireText(
      task.parallelSafety,
      12,
      `Task ${task.id} needs parallel-safety guidance.`,
      errors,
    );
    validateIds(task.dependsOn, taskIds, `Task ${task.id} dependency`, errors);
    if (task.dependsOn.includes(task.id))
      errors.push(`Task ${task.id} cannot depend on itself.`);
    validateIds(
      task.requirementIds,
      requirementIds,
      `Task ${task.id} requirements`,
      errors,
    );
    validateIds(
      task.acceptanceCriteriaIds,
      criterionIds,
      `Task ${task.id} acceptance criteria`,
      errors,
    );
    validateIds(
      task.decisionIds,
      decisionIds,
      `Task ${task.id} decisions`,
      errors,
    );
    if (
      task.kind === "implementation" &&
      task.requirementIds.length === 0 &&
      task.acceptanceCriteriaIds.length === 0
    ) {
      errors.push(
        `Implementation task ${task.id} must link requirements or acceptance criteria.`,
      );
    }
    if (task.acceptanceCriteriaIds.length > 0) {
      const coveredByTaskValidation = task.validationIds.some((validationId) =>
        draft.validations
          .find((validation) => validation.id === validationId)
          ?.acceptanceCriteriaIds.some((criterionId) =>
            task.acceptanceCriteriaIds.includes(criterionId),
          ),
      );
      if (!coveredByTaskValidation) {
        errors.push(
          `Task ${task.id} needs a linked validation that covers one of its acceptance criteria.`,
        );
      }
    }
    if (task.kind === "foundation") {
      validateIds(
        task.foundationFor,
        taskIds,
        `Foundation task ${task.id} targets`,
        errors,
        1,
      );
      for (const targetId of task.foundationFor) {
        const target = draft.tasks.find(
          (candidate) => candidate.id === targetId,
        );
        if (target && !target.dependsOn.includes(task.id)) {
          errors.push(
            `Foundation task ${task.id} must be a dependency of ${targetId}.`,
          );
        }
      }
    } else if (task.foundationFor.length > 0) {
      errors.push(
        `Implementation task ${task.id} cannot declare foundation targets.`,
      );
    }
    if (task.subtasks.length === 0)
      errors.push(
        `Task ${task.id || "<missing-id>"} must include detailed decomposition subtasks.`,
      );
    for (const subtask of task.subtasks) {
      validateDetailItem(
        subtask,
        evidenceById,
        validationIds,
        "Subtask",
        errors,
      );
    }
  }
  validateTaskCycles(draft.tasks, errors);

  for (const risk of draft.risks) {
    if (!present(risk.risk, 8) || !present(risk.mitigation, 8))
      errors.push("Each risk needs a concrete description and mitigation.");
  }
  for (const assumption of draft.assumptions) {
    requireText(
      assumption.assumption,
      8,
      `Assumption ${assumption.id} needs a statement.`,
      errors,
    );
    requireText(
      assumption.impactIfFalse,
      8,
      `Assumption ${assumption.id} needs impact if false.`,
      errors,
    );
    requireText(
      assumption.resolutionPoint,
      8,
      `Assumption ${assumption.id} needs a resolution point.`,
      errors,
    );
    requireText(
      assumption.fallback,
      8,
      `Assumption ${assumption.id} needs a fallback.`,
      errors,
    );
  }
  for (const unknown of draft.unknowns) {
    requireText(
      unknown.statement,
      8,
      `Unknown ${unknown.id} needs a statement.`,
      errors,
    );
    requireText(
      unknown.impact,
      8,
      `Unknown ${unknown.id} needs an impact.`,
      errors,
    );
    requireText(
      unknown.resolutionOwner,
      3,
      `Unknown ${unknown.id} needs an owner.`,
      errors,
    );
    requireText(
      unknown.resolutionPoint,
      8,
      `Unknown ${unknown.id} needs a resolution point.`,
      errors,
    );
    requireText(
      unknown.trigger,
      8,
      `Unknown ${unknown.id} needs a trigger.`,
      errors,
    );
    requireText(
      unknown.fallback,
      8,
      `Unknown ${unknown.id} needs a fallback.`,
      errors,
    );
    validateIds(
      unknown.evidenceIds,
      evidenceIds,
      `Unknown ${unknown.id} evidence`,
      errors,
      unknown.deferredWithUserApproval ? 1 : 0,
    );
    if (
      unknown.severity === "high" &&
      unknown.status === "deferred" &&
      !unknown.deferredWithUserApproval
    ) {
      errors.push(
        `High-severity deferred unknown ${unknown.id} needs explicit user approval.`,
      );
    }
    if (unknown.deferredWithUserApproval) {
      if (unknown.status !== "deferred") {
        errors.push(
          `Unknown ${unknown.id} can record user deferral approval only when deferred.`,
        );
      }
      if (
        !unknown.evidenceIds.some(
          (id) => evidenceById.get(id)?.sourceType === "user",
        )
      ) {
        errors.push(
          `Unknown ${unknown.id} needs user evidence for deferred approval.`,
        );
      }
    }
  }

  const areas = draft.engineering.map((item) => item.area);
  if (!unique(areas))
    errors.push("Engineering considerations must not repeat an area.");
  for (const area of ENGINEERING_AREAS) {
    const assessment =
      draft.engineering.find((item) => item.area === area)?.assessment ?? "";
    if (UNEXPLAINED_NOT_APPLICABLE_PATTERN.test(assessment.trim())) {
      errors.push(
        `Engineering consideration for ${area} must explain why it is not applicable.`,
      );
    } else if (!present(assessment, 12)) {
      errors.push(`Engineering consideration is required for ${area}.`);
    }
  }

  if (coverage.uncoveredRequirementIds.length > 0)
    errors.push(
      `Requirements lack acceptance coverage: ${coverage.uncoveredRequirementIds.join(", ")}.`,
    );
  if (coverage.uncoveredAcceptanceCriteriaIds.length > 0)
    errors.push(
      `Acceptance criteria lack task or validation coverage: ${coverage.uncoveredAcceptanceCriteriaIds.join(", ")}.`,
    );
  if (coverage.unvalidatedTaskIds.length > 0)
    errors.push(
      `Tasks lack validation coverage: ${coverage.unvalidatedTaskIds.join(", ")}.`,
    );
  if (coverage.orphanTaskIds.length > 0)
    errors.push(
      `Implementation tasks lack requirement rationale: ${coverage.orphanTaskIds.join(", ")}.`,
    );
  if (coverage.unresolvedBlockerIds.length > 0)
    errors.push(
      `Blocking or undecided unknowns must be resolved before publishing: ${coverage.unresolvedBlockerIds.join(", ")}.`,
    );
  if (coverage.contradictions.length > 0)
    errors.push(...coverage.contradictions);
  if (coverage.unsupportedSpecifics.length > 0)
    errors.push(
      `Observed file claims need repository evidence: ${coverage.unsupportedSpecifics.join(", ")}.`,
    );

  return { valid: errors.length === 0, errors: [...new Set(errors)], coverage };
}

function isInside(base: string, target: string): boolean {
  const fromBase = relative(base, target);
  return (
    fromBase !== ".." &&
    !fromBase.startsWith(`..${sep}`) &&
    !isAbsolute(fromBase)
  );
}

/**
 * Validates plan-internal links and verifies that every observed repository
 * seam exists below the active project root. Publication calls this in addition
 * to the synchronous structural validator so an invented existing path cannot
 * become an approved implementation instruction.
 */
export async function auditPlanDraft(
  draft: PlanDraft,
  cwd: string,
): Promise<ValidationResult> {
  const structural = validatePlanDraft(draft);
  const errors = [...structural.errors];
  let projectRoot: string;
  try {
    projectRoot = await realpath(cwd);
  } catch {
    return {
      valid: false,
      errors: [
        ...errors,
        "Could not resolve the project root for repository-evidence auditing.",
      ],
      coverage: structural.coverage,
    };
  }

  const observed = draft.tasks
    .flatMap((task) => [task, ...task.subtasks])
    .flatMap((item) => item.files)
    .filter((file) => file.status === "observed");
  for (const file of observed) {
    const value = file.path.trim();
    if (!value || isAbsolute(value)) {
      errors.push(
        `Observed file ${file.path} must be a project-relative path.`,
      );
      continue;
    }
    const requested = resolve(projectRoot, value);
    if (!isInside(projectRoot, requested)) {
      errors.push(`Observed file ${file.path} escapes the current project.`);
      continue;
    }
    try {
      const resolved = await realpath(requested);
      if (!isInside(projectRoot, resolved)) {
        errors.push(
          `Observed file ${file.path} resolves outside the current project.`,
        );
        continue;
      }
      await lstat(resolved);
    } catch {
      errors.push(
        `Observed file ${file.path} was not found in the current project.`,
      );
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    coverage: structural.coverage,
  };
}

export function plannedPaths(draft: PlanDraft): string[] {
  return [
    ...new Set(
      draft.tasks
        .flatMap((task) => [task, ...task.subtasks])
        .flatMap((task) => task.files)
        .flatMap((file) => {
          const path = file.path.trim();
          return path ? [path] : [];
        }),
    ),
  ];
}
