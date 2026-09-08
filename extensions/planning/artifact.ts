import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  planCoverageReport,
  type ArchitectureEdge,
  type ArchitectureNode,
  type PlanDraft,
} from "./schema.ts";
import type {
  PlanAcceptanceCriterion,
  PlanFileReference,
  PlanSubtask,
  PlanTask,
  PlanValidation,
} from "./schema.ts";

const execFile = promisify(execFileCallback);

export interface RepositorySnapshot {
  gitHead?: string;
  observedFiles: Array<{ path: string; hash: string }>;
}

export interface RepositorySnapshotComparison {
  gitHeadChanged: boolean;
  changedPaths: string[];
}

export interface PlanCandidate {
  digest: string;
  createdAt: string;
  draft: PlanDraft;
  snapshot: RepositorySnapshot;
}

export interface ArtifactRecord {
  path: string;
  absolutePath: string;
  contentHash: string;
  markdownHash: string;
  candidateDigest: string;
  writtenAt: string;
}

export interface VerifiedPlanArtifact {
  candidateDigest: string;
  markdownHash: string;
  markdown: string;
  snapshot?: RepositorySnapshot;
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

type GraphNode = { id: string; label: string; detail: string };
type GraphEdge = { from: string; to: string; label: string };

const STYLES = `
:root{color-scheme:light;--bg:#f4f6fb;--surface:#fff;--ink:#172033;--muted:#536079;--line:#d9dfeb;--brand:#2457c5;--brand-soft:#eaf0ff;--good:#08774d;--good-soft:#e8f7ef;--warn:#875000;--warn-soft:#fff3d8;--bad:#a52e39;--bad-soft:#ffedf0}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.62 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1120px,calc(100% - 2rem));margin:auto}header{padding:4.5rem 0 3rem;background:linear-gradient(135deg,#fff,#e9efff);border-bottom:1px solid var(--line)}main{padding:2.5rem 0 4rem}section{margin:0 0 3rem;scroll-margin-top:1rem}h1,h2,h3,h4,h5{line-height:1.2;letter-spacing:-.025em}h1{max-width:900px;margin:.2rem 0;font-size:clamp(2.25rem,6vw,4.35rem);line-height:1.04;letter-spacing:-.055em}h2{margin:0 0 1rem;font-size:clamp(1.5rem,3vw,2rem)}h3{margin:.1rem 0 .5rem;font-size:1.16rem}h4{margin:1.2rem 0 .45rem}h5{margin:.8rem 0 .3rem}p{margin:.1rem 0 1rem}.eyebrow,.item-id{margin:0;color:var(--brand);font-size:.75rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.lede{max-width:800px;color:var(--muted);font-size:1.12rem}.meta{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.2rem}.tag{display:inline-block;padding:.16rem .5rem;border-radius:999px;background:var(--brand-soft);color:var(--brand);font-size:.73rem;font-weight:800}.tag.good{background:var(--good-soft);color:var(--good)}.tag.warn{background:var(--warn-soft);color:var(--warn)}.tag.bad{background:var(--bad-soft);color:var(--bad)}.toc,.callout,.card,.task,.subtasks article,.figure-wrap{border:1px solid var(--line);border-radius:14px;background:var(--surface)}.toc{padding:1.1rem 1.25rem;margin-bottom:2rem}.toc ol{display:flex;flex-wrap:wrap;gap:.35rem 2rem;margin:.6rem 0 0;padding-left:1.2rem}.callout{padding:1.2rem 1.3rem;border-left:5px solid var(--brand);background:var(--brand-soft)}.callout h2{margin-bottom:.4rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.card{padding:1.15rem}.task{margin-bottom:1.1rem;padding:1.2rem;border-left:5px solid var(--brand)}.task-head{display:flex;gap:.8rem;align-items:flex-start}.step{display:grid;min-width:2rem;height:2rem;place-items:center;border-radius:50%;background:var(--brand-soft);color:var(--brand);font-weight:850}.prose{white-space:pre-line}dl{display:grid;grid-template-columns:5.5rem minmax(0,1fr);gap:.55rem 1rem;margin:1rem 0}dt{color:var(--brand);font-weight:850}dd{margin:0}.subtasks{display:grid;gap:1rem;padding-left:1.5rem}.subtasks li{padding-left:.2rem}.figure-wrap{padding:1rem;overflow-x:auto;background:#fbfcff}figure{margin:0}figcaption{margin:0 0 .8rem;color:var(--muted);font-size:.9rem;font-weight:750}svg{display:block;min-width:720px;width:100%;height:auto}table{width:100%;border-collapse:collapse;background:var(--surface)}caption{padding:.65rem .75rem;text-align:left;color:var(--muted);font-size:.9rem;font-weight:750}th,td{padding:.75rem;border:1px solid var(--line);vertical-align:top;text-align:left}th{background:#f0f3f8;color:#2c3e63;font-size:.74rem;letter-spacing:.04em;text-transform:uppercase}ul,ol{padding-left:1.25rem}li{margin:.38rem 0}.muted{color:var(--muted)}.table-wrap{overflow-x:auto}code{padding:.1rem .32rem;border-radius:4px;background:#edf1f8;font:inherit}a{color:var(--brand);text-decoration-thickness:.08em;text-underline-offset:.15em}a:focus-visible{outline:3px solid #f4b000;outline-offset:3px}@media(max-width:720px){.grid{grid-template-columns:1fr}dl{grid-template-columns:1fr}.shell{width:min(100% - 1rem,1120px)}header{padding:2.8rem 0 2rem}svg{min-width:650px}}@media print{@page{margin:15mm}body{background:#fff;font-size:10.5pt}.shell{width:100%}header{padding:0 0 1rem;background:#fff}.toc,.callout,.card,.task,.subtasks article,.figure-wrap{box-shadow:none;break-inside:avoid}.figure-wrap{overflow:visible}svg{min-width:0}a{color:inherit;text-decoration:none}h2,h3{break-after:avoid}}
`;
const STYLE_CSP_HASH = createHash("sha256").update(STYLES).digest("base64");

function canonicalize(value: unknown): CanonicalValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return null;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function digestValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createCandidate(
  draft: PlanDraft,
  now = new Date().toISOString(),
  snapshot: RepositorySnapshot = { observedFiles: [] },
): PlanCandidate {
  return { digest: digestValue(draft), createdAt: now, draft, snapshot };
}

async function gitHead(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      { cwd, maxBuffer: 1024 },
    );
    const head = stdout.trim();
    return /^[a-f0-9]{40,64}$/i.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

/** Captures only the repository seams the plan claims to have observed. */
export async function captureRepositorySnapshot(
  cwd: string,
  draft: PlanDraft,
): Promise<RepositorySnapshot> {
  const projectRoot = await realpath(cwd);
  const paths = [
    ...new Set(
      draft.tasks
        .flatMap((task) => [task, ...task.subtasks])
        .flatMap((item) => item.files)
        .filter((file) => file.status === "observed")
        .map((file) => file.path.trim()),
    ),
  ];
  const observedFiles = (
    await Promise.all(
      paths.map(async (path) => {
        try {
          return {
            path,
            hash: hashText(await readFile(resolve(projectRoot, path), "utf8")),
          };
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((file): file is { path: string; hash: string } => Boolean(file));
  const head = await gitHead(projectRoot);
  return head ? { gitHead: head, observedFiles } : { observedFiles };
}

/** Compares the current repository only with the seams recorded in a plan. */
export async function compareRepositorySnapshot(
  cwd: string,
  snapshot: RepositorySnapshot,
): Promise<RepositorySnapshotComparison> {
  const projectRoot = await realpath(cwd);
  const currentHead = snapshot.gitHead ? await gitHead(projectRoot) : undefined;
  const changedPaths = (
    await Promise.all(
      snapshot.observedFiles.map(async ({ path, hash }) => {
        try {
          return hashText(
            await readFile(resolve(projectRoot, path), "utf8"),
          ) === hash
            ? undefined
            : path;
        } catch {
          return path;
        }
      }),
    )
  ).filter((path): path is string => Boolean(path));
  return {
    gitHeadChanged: Boolean(
      snapshot.gitHead && currentHead !== snapshot.gitHead,
    ),
    changedPaths,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function list(items: string[], empty = "None."): string {
  if (items.length === 0) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function fileList(files: PlanFileReference[]): string {
  if (files.length === 0)
    return `<p class="muted">No files or modules recorded.</p>`;
  return `<ul>${files
    .map(
      (file) =>
        `<li><code>${escapeHtml(file.path)}</code> <span class="tag ${file.status === "observed" ? "good" : "warn"}">${escapeHtml(file.status)}</span>${file.evidenceId ? ` <a href="#evidence-${escapeHtml(file.evidenceId)}">${escapeHtml(file.evidenceId)}</a>` : ""}</li>`,
    )
    .join("")}</ul>`;
}

function validationList(ids: string[]): string {
  return list(
    ids.map((id) => `Validation ${id}`),
    "No validation recorded.",
  );
}

function workItemDetails(item: PlanSubtask): string {
  return `<dl>
    <dt>What</dt><dd class="prose">${escapeHtml(item.what)}</dd>
    <dt>Why</dt><dd class="prose">${escapeHtml(item.why)}</dd>
    <dt>How</dt><dd class="prose">${escapeHtml(item.how)}</dd>
  </dl>
  <h5>Files or modules</h5>${fileList(item.files)}
  <h5>Validation</h5>${validationList(item.validationIds)}`;
}

function topologicalTasks(tasks: PlanTask[]): PlanTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const order: PlanTask[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(task: PlanTask): void {
    if (visited.has(task.id) || visiting.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependsOn) {
      const dependencyTask = byId.get(dependency);
      if (dependencyTask) visit(dependencyTask);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    order.push(task);
  }
  for (const task of tasks) visit(task);
  return order;
}

function taskCards(tasks: PlanTask[]): string {
  return topologicalTasks(tasks)
    .map(
      (task, index) => `<article class="task" id="task-${escapeHtml(task.id)}">
        <div class="task-head"><span class="step">${index + 1}</span><div><p class="item-id">${escapeHtml(task.id)} · ${escapeHtml(task.kind)}</p><h3>${escapeHtml(task.title)}</h3></div></div>
        ${workItemDetails(task)}
        <h4>Expected behavior</h4><p class="prose">${escapeHtml(task.expectedBehavior)}</p>
        <h4>Parallel safety</h4><p class="prose">${escapeHtml(task.parallelSafety)}</p>
        <h4>Requirement and decision links</h4>
        <p>${task.requirementIds.map((id) => `<a href="#requirement-${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ") || "No direct requirement link."}</p>
        <p>${task.acceptanceCriteriaIds.map((id) => `<a href="#acceptance-${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ") || "No direct acceptance link."}</p>
        <p>${task.decisionIds.map((id) => `<a href="#decision-${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ") || "No decision link."}</p>
        <h4>Depends on</h4>${list(
          task.dependsOn.map((id) => `Task ${id}`),
          "No predecessor tasks.",
        )}
        ${task.kind === "foundation" ? `<h4>Foundation for</h4>${list(task.foundationFor.map((id) => `Task ${id}`))}` : ""}
        <h4>Detailed decomposition subtasks</h4>
        <ol class="subtasks">${task.subtasks.map((subtask) => `<li id="task-${escapeHtml(subtask.id)}"><article><p class="item-id">${escapeHtml(subtask.id)} · detail within ${escapeHtml(task.id)}</p><h5>${escapeHtml(subtask.title)}</h5>${workItemDetails(subtask)}</article></li>`).join("")}</ol>
      </article>`,
    )
    .join("");
}

function markdownFileReferences(files: PlanFileReference[]): string {
  return files
    .map(
      (file) =>
        `- \`${file.path}\` (${file.status}${file.evidenceId ? `; evidence: ${file.evidenceId}` : ""})`,
    )
    .join("\n");
}

function markdownCriterion(criterion: PlanAcceptanceCriterion): string[] {
  return [
    `### ${criterion.id}`,
    "",
    `**Requirements:** ${criterion.requirementIds.join(", ")}`,
    "",
    `**Precondition:** ${criterion.precondition}`,
    "",
    `**Action:** ${criterion.action}`,
    "",
    `**Observable outcome:** ${criterion.outcome}`,
    "",
    `**Edge or failure case:** ${criterion.edgeCase}`,
    "",
    `**Validated by:** ${criterion.validationIds.join(", ")}`,
    "",
  ];
}

function markdownTraceability(draft: PlanDraft): string[] {
  return draft.requirements.flatMap((requirement) => {
    const criteria = draft.acceptanceCriteria.filter((criterion) =>
      criterion.requirementIds.includes(requirement.id),
    );
    const criterionIds = criteria.map((criterion) => criterion.id);
    const taskIds = draft.tasks
      .filter(
        (task) =>
          task.requirementIds.includes(requirement.id) ||
          task.acceptanceCriteriaIds.some((id) => criterionIds.includes(id)),
      )
      .map((task) => task.id);
    const validationIds = [
      ...new Set(criteria.flatMap((criterion) => criterion.validationIds)),
    ];
    return [
      `- **${requirement.id}**`,
      `  - Acceptance criteria: ${criterionIds.join(", ") || "None"}`,
      `  - Implementation tasks: ${taskIds.join(", ") || "None"}`,
      `  - Validations: ${validationIds.join(", ") || "None"}`,
      `  - Evidence: ${requirement.evidenceIds.join(", ") || "None"}`,
    ];
  });
}

function markdownCoverageAudit(draft: PlanDraft): string[] {
  const coverage = planCoverageReport(draft);
  const checks: Array<[string, string[]]> = [
    [
      "Requirements without acceptance criteria",
      coverage.uncoveredRequirementIds,
    ],
    [
      "Acceptance criteria without task or validation",
      coverage.uncoveredAcceptanceCriteriaIds,
    ],
    ["Tasks without validation", coverage.unvalidatedTaskIds],
    ["Implementation tasks without rationale", coverage.orphanTaskIds],
    ["Unresolved publication blockers", coverage.unresolvedBlockerIds],
    ["Dependency contradictions", coverage.contradictions],
    ["Unsupported observed file claims", coverage.unsupportedSpecifics],
  ];
  return checks.map(
    ([label, values]) =>
      `- **${label}:** ${values.length ? `BLOCK — ${values.join(", ")}` : "Clear"}`,
  );
}

function markdownValidation(validation: PlanValidation): string[] {
  return [
    `### ${validation.id} — ${validation.level}`,
    "",
    `**Procedure:** ${validation.procedure}`,
    "",
    `**Preconditions:** ${validation.preconditions.join("; ") || "None"}`,
    "",
    `**Expected evidence:** ${validation.expectedEvidence}`,
    "",
    `**Acceptance criteria:** ${validation.acceptanceCriteriaIds.join(", ")}`,
    "",
  ];
}

export function renderPlanMarkdown(candidate: PlanCandidate): string {
  const { draft } = candidate;
  const lines = [
    `# ${draft.title}`,
    "",
    `> Generated ${candidate.createdAt} · candidate-sha256:${candidate.digest}`,
    `> Language: ${draft.language}`,
    "",
    "## Summary",
    "",
    draft.summary,
    "",
    "## Outcome",
    "",
    draft.outcome,
    "",
    "## Repository snapshot",
    candidate.snapshot.gitHead
      ? `- Git commit: ${candidate.snapshot.gitHead}`
      : "- Git commit: unavailable (not a Git checkout).",
    ...(candidate.snapshot.observedFiles.length
      ? candidate.snapshot.observedFiles.map(
          (file) => `- Observed seam: \`${file.path}\` · sha256:${file.hash}`,
        )
      : ["- No readable observed file seams were captured."]),
    "",
    "## Repository evidence",
    ...draft.repositoryEvidence.flatMap((evidence) => [
      `### ${evidence.id} — ${evidence.sourceType} (${evidence.confidence})`,
      "",
      `**Claim:** ${evidence.claim}`,
      "",
      `**Source:** ${evidence.source}`,
      "",
      `**Observed seams:** ${evidence.seams?.map((path) => `\`${path}\``).join(", ") || "None"}`,
      "",
      `**Notes:** ${evidence.notes}`,
      "",
    ]),
    "## Requirements",
    ...draft.requirements.flatMap((requirement) => [
      `### ${requirement.id} — ${requirement.priority}`,
      "",
      requirement.statement,
      "",
      `**Rationale:** ${requirement.rationale}`,
      "",
      `**Evidence:** ${requirement.evidenceIds.join(", ")}`,
      "",
    ]),
    "## Acceptance criteria",
    ...draft.acceptanceCriteria.flatMap(markdownCriterion),
    "## Traceability matrix",
    ...markdownTraceability(draft),
    "",
    "## Decisions",
    ...draft.decisions.flatMap((decision) => [
      `### ${decision.id} — ${decision.status}`,
      "",
      `**Context:** ${decision.context}`,
      "",
      `**Choice:** ${decision.choice}`,
      "",
      `**Alternatives:** ${decision.alternatives.join("; ") || "Established pattern; no material alternative."}`,
      "",
      `**Rationale/evidence:** ${decision.rationale} (${decision.evidenceIds.join(", ")})`,
      "",
      `**Consequences:** ${decision.consequences}`,
      "",
      `**Reversibility:** ${decision.reversibility}`,
      "",
      `**Affected modules/interfaces:** ${decision.affectedModules.join(", ")}`,
      "",
    ]),
    "## Scope",
    "",
    "### In scope",
    ...draft.inScope.map((item) => `- ${item}`),
    "",
    "### Out of scope",
    ...(draft.outOfScope.length
      ? draft.outOfScope.map((item) => `- ${item}`)
      : ["- None."]),
    "",
    "## Constraints",
    ...(draft.constraints.length
      ? draft.constraints.map((item) => `- ${item}`)
      : ["- None."]),
    "",
    "## Findings",
    ...(draft.findings.length
      ? draft.findings.flatMap((finding) => [
          `- **${finding.summary}**`,
          ...finding.evidenceIds.map((id) => `  - Evidence: ${id}`),
        ])
      : ["- None."]),
    "",
    "## Architecture design",
    "",
    draft.architecture.summary,
    "",
    "### Components",
    ...draft.architecture.nodes.map(
      (node) =>
        `- **${node.id} (${node.kind}):** ${node.label} — ${node.responsibility}${node.taskIds.length ? ` (tasks: ${node.taskIds.join(", ")})` : ""}`,
    ),
    "",
    "### Directional interactions",
    ...draft.architecture.edges.map(
      (edge) => `- ${edge.from} → ${edge.to}: ${edge.label}`,
    ),
    "",
    "## Task dependency order",
    ...topologicalTasks(draft.tasks).map(
      (task, index) => `${index + 1}. ${task.id} — ${task.title}`,
    ),
    "",
    "## Implementation tasks",
    ...topologicalTasks(draft.tasks).flatMap((task) => [
      `### ${task.id} — ${task.title}`,
      "",
      `**Kind:** ${task.kind}`,
      "",
      `**What:** ${task.what}`,
      "",
      `**Why:** ${task.why}`,
      "",
      `**How:** ${task.how}`,
      "",
      `**Expected behavior:** ${task.expectedBehavior}`,
      "",
      `**Parallel safety:** ${task.parallelSafety}`,
      "",
      "**Files/modules:",
      markdownFileReferences(task.files),
      "",
      `**Requirements:** ${task.requirementIds.join(", ") || "Foundation task"}`,
      "",
      `**Acceptance criteria:** ${task.acceptanceCriteriaIds.join(", ") || "Foundation task"}`,
      "",
      `**Decisions:** ${task.decisionIds.join(", ") || "None"}`,
      "",
      `**Depends on:** ${task.dependsOn.join(", ") || "None"}`,
      "",
      `**Foundation for:** ${task.kind === "foundation" ? task.foundationFor.join(", ") || "None" : "Not a foundation task"}`,
      "",
      `**Validation:** ${task.validationIds.join(", ")}`,
      "",
      "#### Detailed decomposition subtasks",
      ...task.subtasks.flatMap((subtask) => [
        `##### ${subtask.id} — ${subtask.title}`,
        "",
        `**What:** ${subtask.what}`,
        "",
        `**Why:** ${subtask.why}`,
        "",
        `**How:** ${subtask.how}`,
        "",
        "**Files/modules:**",
        markdownFileReferences(subtask.files),
        "",
        `**Validation:** ${subtask.validationIds.join(", ")}`,
        "",
      ]),
    ]),
    "## Validation plan",
    ...draft.validations.flatMap(markdownValidation),
    "## End-to-end validation",
    ...draft.endToEndValidationIds.map((id) => `- ${id}`),
    "",
    "## Engineering considerations",
    ...draft.engineering.flatMap((item) => [
      `### ${item.area}`,
      "",
      item.assessment,
      "",
    ]),
    "## Risks",
    ...(draft.risks.length
      ? draft.risks.flatMap((risk) => [
          `- **${risk.severity}: ${risk.risk}**`,
          `  - Mitigation: ${risk.mitigation}`,
        ])
      : ["- None."]),
    "",
    "## Assumptions",
    ...(draft.assumptions.length
      ? draft.assumptions.flatMap((item) => [
          `- **${item.id}:** ${item.assumption}`,
          `  - Confidence: ${item.confidence}; provenance: ${item.provenance}`,
          `  - If false: ${item.impactIfFalse}`,
          `  - Resolution point: ${item.resolutionPoint}`,
          `  - Fallback: ${item.fallback}`,
        ])
      : ["- None."]),
    "",
    "## Unknowns and deferrals",
    ...(draft.unknowns.length
      ? draft.unknowns.flatMap((item) => [
          `- **${item.id} (${item.status}; ${item.severity}${item.blocking ? ", BLOCKING" : ""}${item.deferredWithUserApproval ? ", user-approved deferral" : ""}):** ${item.statement}`,
          `  - Impact: ${item.impact}; evidence: ${item.evidenceIds.join(", ") || "None"}; owner: ${item.resolutionOwner}; resolution point: ${item.resolutionPoint}; trigger: ${item.trigger}; fallback: ${item.fallback}`,
        ])
      : ["- None."]),
    "",
    "## Publication coverage audit",
    ...markdownCoverageAudit(draft),
  ];
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

function splitLabel(value: string, maxLength = 22): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function graphDepths(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const parents = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) parents.get(edge.to)?.push(edge.from);
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  function visit(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const depth = Math.max(
      0,
      ...(parents.get(id) ?? []).map((parent) => visit(parent) + 1),
    );
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }
  for (const node of nodes) visit(node.id);
  return depths;
}

function renderGraphSvg(
  title: string,
  description: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): string {
  const markerId = `graph-arrow-${digestValue({ title, nodes, edges }).slice(0, 12)}`;
  const depths = graphDepths(nodes, edges);
  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    const column = columns.get(depth) ?? [];
    column.push(node);
    columns.set(depth, column);
  }
  const maxDepth = Math.max(0, ...columns.keys());
  const maxRows = Math.max(
    1,
    ...[...columns.values()].map((column) => column.length),
  );
  const width = 120 + (maxDepth + 1) * 250;
  const height = 110 + maxRows * 145;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, column] of columns) {
    column.forEach((node, row) => {
      positions.set(node.id, { x: 45 + depth * 250, y: 45 + row * 145 });
    });
  }
  const arrows = edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return "";
      const labelX = (from.x + 180 + to.x) / 2;
      const labelY = (from.y + 48 + to.y + 48) / 2 - 8;
      return `<path d="M ${from.x + 180} ${from.y + 48} L ${to.x} ${to.y + 48}" stroke="#59677f" stroke-width="2" fill="none" marker-end="url(#${markerId})"/><text x="${labelX}" y="${labelY}" fill="#536079" font-size="11" text-anchor="middle">${escapeHtml(edge.label)}</text>`;
    })
    .join("");
  const boxes = nodes
    .map((node) => {
      const position = positions.get(node.id)!;
      const lines = [node.id, ...splitLabel(node.label)];
      return `<g><rect x="${position.x}" y="${position.y}" width="180" height="96" rx="12" fill="#ffffff" stroke="#97add9" stroke-width="1.5"/><text x="${position.x + 90}" y="${position.y + 26}" fill="#2457c5" font-size="11" font-family="ui-sans-serif,system-ui" font-weight="800" text-anchor="middle">${escapeHtml(lines[0] ?? "")}</text>${lines
        .slice(1)
        .map(
          (line, index) =>
            `<text x="${position.x + 90}" y="${position.y + 50 + index * 17}" fill="#172033" font-size="13" font-family="ui-sans-serif,system-ui" font-weight="700" text-anchor="middle">${escapeHtml(line)}</text>`,
        )
        .join("")}</g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#59677f"/></marker></defs><title>${escapeHtml(title)}</title><desc>${escapeHtml(description)}</desc>${arrows}${boxes}</svg>`;
}

function graphHasCycle(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  const parents = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) parents.get(edge.to)?.push(edge.from);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle = (parents.get(id) ?? []).some((parent) => visit(parent));
    visiting.delete(id);
    visited.add(id);
    return cycle;
  }
  return nodes.some((node) => visit(node.id));
}

function graphProjection(
  title: string,
  description: string,
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  tableDescription: string,
  rejectCycles = false,
): string {
  if (
    graph.nodes.length > 40 ||
    graph.edges.length > 80 ||
    (rejectCycles && graphHasCycle(graph.nodes, graph.edges))
  ) {
    return `<p class="muted">The diagram is omitted because the graph is oversized or invalid. The complete ${escapeHtml(tableDescription)} remains below.</p>`;
  }
  return renderGraphSvg(title, description, graph.nodes, graph.edges);
}

function taskGraphProjection(graph: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}): string {
  return graphProjection(
    "Implementation task dependency map",
    "A visual projection of the task relationship table below.",
    graph,
    "relationship table",
    true,
  );
}

function taskGraph(tasks: PlanTask[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  return {
    nodes: topologicalTasks(tasks).map((task) => ({
      id: task.id,
      label: task.title,
      detail: task.kind,
    })),
    edges: tasks.flatMap((task) =>
      task.dependsOn.map((dependency) => ({
        from: dependency,
        to: task.id,
        label: "precedes",
      })),
    ),
  };
}

function architectureGraph(
  nodes: ArchitectureNode[],
  edges: ArchitectureEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.label,
      detail: node.kind,
    })),
    edges,
  };
}

function dependencyTable(tasks: PlanTask[]): string {
  const order = topologicalTasks(tasks);
  const downstream = new Map(tasks.map((task) => [task.id, [] as string[]]));
  for (const task of tasks)
    for (const dependency of task.dependsOn)
      downstream.get(dependency)?.push(task.id);
  return `<div class="table-wrap"><table><caption>Task dependency relationships and execution order</caption><thead><tr><th scope="col">Order</th><th scope="col">Task</th><th scope="col">Predecessors</th><th scope="col">Downstream work</th></tr></thead><tbody>${order.map((task, index) => `<tr><td>${index + 1}</td><td><a href="#task-${escapeHtml(task.id)}">${escapeHtml(task.id)} — ${escapeHtml(task.title)}</a></td><td>${escapeHtml(task.dependsOn.join(", ") || "None")}</td><td>${escapeHtml((downstream.get(task.id) ?? []).join(", ") || "None")}</td></tr>`).join("")}</tbody></table></div>`;
}

function architectureTable(
  nodes: ArchitectureNode[],
  edges: ArchitectureEdge[],
): string {
  return `<div class="table-wrap"><table><caption>Architecture components and task relationships</caption><thead><tr><th scope="col">Node</th><th scope="col">Kind</th><th scope="col">Responsibility</th><th scope="col">Related tasks</th></tr></thead><tbody>${nodes.map((node) => `<tr><td>${escapeHtml(node.id)} — ${escapeHtml(node.label)}</td><td>${escapeHtml(node.kind)}</td><td>${escapeHtml(node.responsibility)}</td><td>${escapeHtml(node.taskIds.join(", ") || "None")}</td></tr>`).join("")}</tbody></table></div><h4>Directional interactions</h4>${list(edges.map((edge) => `${edge.from} → ${edge.to}: ${edge.label}`))}`;
}

function traceabilityTable(draft: PlanDraft): string {
  return `<div class="table-wrap"><table><caption>Requirement-to-proof traceability</caption><thead><tr><th scope="col">Requirement</th><th scope="col">Acceptance criteria</th><th scope="col">Implementation tasks</th><th scope="col">Validations</th><th scope="col">Evidence</th></tr></thead><tbody>${draft.requirements
    .map((requirement) => {
      const criteria = draft.acceptanceCriteria.filter((criterion) =>
        criterion.requirementIds.includes(requirement.id),
      );
      const criterionIds = criteria.map((criterion) => criterion.id);
      const tasks = draft.tasks.filter(
        (task) =>
          task.requirementIds.includes(requirement.id) ||
          task.acceptanceCriteriaIds.some((id) => criterionIds.includes(id)),
      );
      const validationIds = [
        ...new Set(criteria.flatMap((criterion) => criterion.validationIds)),
      ];
      return `<tr><td><a href="#requirement-${escapeHtml(requirement.id)}">${escapeHtml(requirement.id)}</a></td><td>${escapeHtml(criterionIds.join(", ") || "None")}</td><td>${tasks.map((task) => `<a href="#task-${escapeHtml(task.id)}">${escapeHtml(task.id)}</a>`).join(", ") || "None"}</td><td>${validationIds.map((id) => `<a href="#validation-${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ") || "None"}</td><td>${escapeHtml(requirement.evidenceIds.join(", ") || "None")}</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function severityClass(severity: "low" | "medium" | "high"): string {
  if (severity === "high") return "bad";
  if (severity === "medium") return "warn";
  return "good";
}

function snapshotHtml(snapshot: RepositorySnapshot): string {
  const commit = snapshot.gitHead
    ? `<p><strong>Git commit:</strong> <code>${escapeHtml(snapshot.gitHead)}</code></p>`
    : "<p>Git commit: unavailable (not a Git checkout).</p>";
  return `<article class="card">${commit}<h3>Observed file seams</h3>${list(
    snapshot.observedFiles.map(
      (file) => `<code>${file.path}</code> · sha256:${file.hash}`,
    ),
    "No readable observed file seams were captured.",
  )}</article>`;
}

function coverageAuditTable(draft: PlanDraft): string {
  const coverage = planCoverageReport(draft);
  const checks: Array<[string, string[]]> = [
    [
      "Requirements without acceptance criteria",
      coverage.uncoveredRequirementIds,
    ],
    [
      "Acceptance criteria without task or validation",
      coverage.uncoveredAcceptanceCriteriaIds,
    ],
    ["Tasks without validation", coverage.unvalidatedTaskIds],
    ["Implementation tasks without rationale", coverage.orphanTaskIds],
    ["Unresolved publication blockers", coverage.unresolvedBlockerIds],
    ["Dependency contradictions", coverage.contradictions],
    ["Unsupported observed file claims", coverage.unsupportedSpecifics],
  ];
  return `<div class="table-wrap"><table><caption>Publication coverage results</caption><thead><tr><th scope="col">Audit check</th><th scope="col">Result</th></tr></thead><tbody>${checks.map(([label, values]) => `<tr><td>${escapeHtml(label)}</td><td>${values.length ? `<span class="tag bad">Block</span> ${escapeHtml(values.join(", "))}` : '<span class="tag good">Clear</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}

export function renderPlanHtml(candidate: PlanCandidate): string {
  const { draft } = candidate;
  const markdown = renderPlanMarkdown(candidate);
  const markdownHash = hashText(markdown);
  const taskDependencyGraph = taskGraph(draft.tasks);
  const typedArchitectureGraph = architectureGraph(
    draft.architecture.nodes,
    draft.architecture.edges,
  );
  const findings = draft.findings
    .map(
      (finding) =>
        `<article class="card"><h3>${escapeHtml(finding.summary)}</h3>${list(finding.evidenceIds.map((id) => `Evidence ${id}`))}</article>`,
    )
    .join("");
  const decisions = draft.decisions
    .map(
      (decision) =>
        `<article class="card" id="decision-${escapeHtml(decision.id)}"><p class="item-id">${escapeHtml(decision.id)} · ${escapeHtml(decision.status)} · ${escapeHtml(decision.reversibility)} to reverse</p><h3>${escapeHtml(decision.choice)}</h3><p><strong>Context:</strong> ${escapeHtml(decision.context)}</p><p><strong>Rationale:</strong> ${escapeHtml(decision.rationale)}</p><p><strong>Evidence:</strong> ${escapeHtml(decision.evidenceIds.join(", "))}</p><p><strong>Alternatives:</strong> ${escapeHtml(decision.alternatives.join("; ") || "Established pattern; no material alternative.")}</p><p><strong>Consequences:</strong> ${escapeHtml(decision.consequences)}</p><p><strong>Affected modules/interfaces:</strong> ${escapeHtml(decision.affectedModules.join(", "))}</p></article>`,
    )
    .join("");
  const evidence = draft.repositoryEvidence
    .map(
      (item) =>
        `<article class="card" id="evidence-${escapeHtml(item.id)}"><p class="item-id">${escapeHtml(item.id)} · ${escapeHtml(item.sourceType)} · ${escapeHtml(item.confidence)} confidence</p><h3>${escapeHtml(item.claim)}</h3><p><strong>Source:</strong> ${escapeHtml(item.source)}</p><p><strong>Observed seams:</strong> ${escapeHtml(item.seams?.join(", ") || "None")}</p><p>${escapeHtml(item.notes)}</p></article>`,
    )
    .join("");
  const requirements = draft.requirements
    .map(
      (item) =>
        `<article class="card" id="requirement-${escapeHtml(item.id)}"><p class="item-id">${escapeHtml(item.id)} · ${escapeHtml(item.priority)}</p><h3>${escapeHtml(item.statement)}</h3><p><strong>Rationale:</strong> ${escapeHtml(item.rationale)}</p><p><strong>Evidence:</strong> ${escapeHtml(item.evidenceIds.join(", "))}</p></article>`,
    )
    .join("");
  const acceptance = draft.acceptanceCriteria
    .map(
      (item) =>
        `<article class="card" id="acceptance-${escapeHtml(item.id)}"><p class="item-id">${escapeHtml(item.id)}</p><h3>Observable acceptance scenario</h3><p><strong>Requirements:</strong> ${escapeHtml(item.requirementIds.join(", "))}</p><p><strong>Precondition:</strong> ${escapeHtml(item.precondition)}</p><p><strong>Action:</strong> ${escapeHtml(item.action)}</p><p><strong>Outcome:</strong> ${escapeHtml(item.outcome)}</p><p><strong>Edge/failure case:</strong> ${escapeHtml(item.edgeCase)}</p><p><strong>Validated by:</strong> ${escapeHtml(item.validationIds.join(", "))}</p></article>`,
    )
    .join("");
  const validations = draft.validations
    .map(
      (item) =>
        `<article class="card" id="validation-${escapeHtml(item.id)}"><p class="item-id">${escapeHtml(item.id)} · ${escapeHtml(item.level)}</p><h3>${escapeHtml(item.procedure)}</h3><p><strong>Preconditions:</strong> ${escapeHtml(item.preconditions.join("; ") || "None")}</p><p><strong>Expected evidence:</strong> ${escapeHtml(item.expectedEvidence)}</p><p><strong>Acceptance criteria:</strong> ${escapeHtml(item.acceptanceCriteriaIds.join(", "))}</p></article>`,
    )
    .join("");
  const engineering = draft.engineering
    .map(
      (item) =>
        `<article class="card"><h3>${escapeHtml(item.area)}</h3><p class="prose">${escapeHtml(item.assessment)}</p></article>`,
    )
    .join("");
  const risks = draft.risks
    .map(
      (risk) =>
        `<tr><td><span class="tag ${severityClass(risk.severity)}">${escapeHtml(risk.severity)}</span></td><td>${escapeHtml(risk.risk)}</td><td>${escapeHtml(risk.mitigation)}</td></tr>`,
    )
    .join("");
  const assumptions = draft.assumptions
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.assumption)}</td><td>${escapeHtml(item.confidence)}</td><td>${escapeHtml(item.provenance)}</td><td>${escapeHtml(item.impactIfFalse)}</td><td>${escapeHtml(item.resolutionPoint)}</td><td>${escapeHtml(item.fallback)}</td></tr>`,
    )
    .join("");
  const unknowns = draft.unknowns
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.status)}${item.blocking ? " · BLOCKING" : ""}</td><td>${escapeHtml(item.severity)}</td><td>${item.deferredWithUserApproval ? "Yes" : "No"}</td><td>${escapeHtml(item.statement)}</td><td>${escapeHtml(item.impact)}</td><td>${escapeHtml(item.evidenceIds.join(", ") || "None")}</td><td>${escapeHtml(item.resolutionOwner)}</td><td>${escapeHtml(item.resolutionPoint)}</td><td>${escapeHtml(item.trigger)}</td><td>${escapeHtml(item.fallback)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${escapeHtml(draft.language)}" data-plan-format="pi-plan-html-v2">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${STYLE_CSP_HASH}'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="description" content="Implementation plan: ${escapeHtml(draft.title)}">
  <meta name="plan-language" content="${escapeHtml(draft.language)}">
  <meta name="plan-candidate-digest" content="${candidate.digest}">
  <meta name="plan-markdown-sha256" content="${markdownHash}">
  <title>${escapeHtml(draft.title)} — Implementation Plan</title>
  <style>${STYLES}</style>
</head>
<body>
<header><div class="shell"><p class="eyebrow">Implementation plan</p><h1>${escapeHtml(draft.title)}</h1><p class="lede">${escapeHtml(draft.summary)}</p><div class="meta"><span class="tag">${escapeHtml(draft.slug)}</span><span class="tag">${escapeHtml(draft.language)}</span><span class="tag">candidate ${escapeHtml(candidate.digest)}</span><span class="tag">generated ${escapeHtml(candidate.createdAt)}</span><span class="tag">offline-first</span></div></div></header>
<main class="shell">
  <nav class="toc" aria-label="Plan contents"><strong>Contents</strong><ol><li><a href="#outcome">Outcome</a></li><li><a href="#snapshot">Snapshot</a></li><li><a href="#evidence">Evidence</a></li><li><a href="#requirements">Requirements</a></li><li><a href="#traceability">Traceability</a></li><li><a href="#decisions">Decisions</a></li><li><a href="#architecture">Architecture</a></li><li><a href="#dependencies">Dependencies</a></li><li><a href="#tasks">Tasks</a></li><li><a href="#validation">Validation</a></li><li><a href="#audit">Publication audit</a></li><li><a href="#risks">Risks and unknowns</a></li></ol></nav>
  <section id="outcome"><div class="callout"><h2>Outcome</h2><p class="prose">${escapeHtml(draft.outcome)}</p><h3>Acceptance criteria</h3>${list(draft.acceptanceCriteria.map((item) => `${item.id}: ${item.outcome}`))}</div></section>
  <section id="snapshot"><h2>Repository snapshot</h2><p class="muted">Execution compares this commit and these observed files to warn when a plan may be stale.</p>${snapshotHtml(candidate.snapshot)}</section>
  <section id="scope"><h2>Scope and constraints</h2><div class="grid"><article class="card"><h3>In scope</h3>${list(draft.inScope)}</article><article class="card"><h3>Out of scope</h3>${list(draft.outOfScope)}</article></div><article class="card"><h3>Constraints</h3>${list(draft.constraints)}</article></section>
  <section id="evidence"><h2>Repository and source evidence</h2><div class="grid">${evidence}</div></section>
  <section id="requirements"><h2>Requirements and acceptance criteria</h2><div class="grid">${requirements}</div><h3>Observable acceptance scenarios</h3><div class="grid">${acceptance}</div></section>
  <section id="traceability"><h2>Traceability matrix</h2><p class="muted">Each requirement is linked to its observable acceptance criteria, implementing tasks, validations, and supporting evidence.</p>${traceabilityTable(draft)}</section>
  <section id="decisions"><h2>Settled decisions</h2><div class="grid">${decisions || '<p class="muted">No consequential decisions recorded.</p>'}</div></section>
  <section><h2>Research findings</h2><div class="grid">${findings || '<p class="muted">No additional findings recorded.</p>'}</div></section>
  <section id="architecture"><h2>Architecture design</h2><article class="card"><p class="prose">${escapeHtml(draft.architecture.summary)}</p><div class="figure-wrap"><figure><figcaption>Architecture component and interaction map</figcaption>${graphProjection("Architecture component and interaction map", "A visual projection of the component and directional interaction table below.", typedArchitectureGraph, "component and interaction table")}</figure></div>${architectureTable(draft.architecture.nodes, draft.architecture.edges)}</article></section>
  <section id="dependencies"><h2>Task dependency order</h2><div class="figure-wrap"><figure><figcaption>Implementation task dependency map</figcaption>${taskGraphProjection(taskDependencyGraph)}</figure></div>${dependencyTable(draft.tasks)}</section>
  <section id="tasks"><h2>Implementation tasks</h2>${taskCards(draft.tasks)}</section>
  <section id="validation"><h2>Validation plan</h2><div class="grid">${validations}</div><h3>End-to-end validation gate</h3>${list(draft.endToEndValidationIds.map((id) => `Validation ${id}`))}</section>
  <section id="audit"><h2>Publication coverage audit</h2><p class="muted">The renderer recomputes these structural quality gates from the embedded plan data.</p>${coverageAuditTable(draft)}</section>
  <section><h2>Engineering considerations</h2><div class="grid">${engineering}</div></section>
  <section id="risks"><h2>Risks, assumptions, and unknowns</h2><h3>Risks</h3>${risks ? `<div class="table-wrap"><table><thead><tr><th scope="col">Severity</th><th scope="col">Risk</th><th scope="col">Mitigation</th></tr></thead><tbody>${risks}</tbody></table></div>` : '<p class="muted">No material risks recorded.</p>'}<h3>Assumptions</h3>${assumptions ? `<div class="table-wrap"><table><thead><tr><th scope="col">ID</th><th scope="col">Assumption</th><th scope="col">Confidence</th><th scope="col">Provenance</th><th scope="col">Impact if false</th><th scope="col">Resolution point</th><th scope="col">Fallback</th></tr></thead><tbody>${assumptions}</tbody></table></div>` : '<p class="muted">No assumptions recorded.</p>'}<h3>Unknowns and deferrals</h3>${unknowns ? `<div class="table-wrap"><table><thead><tr><th scope="col">ID</th><th scope="col">Status</th><th scope="col">Severity</th><th scope="col">User-approved deferral</th><th scope="col">Unknown</th><th scope="col">Impact</th><th scope="col">Evidence</th><th scope="col">Owner</th><th scope="col">Resolution point</th><th scope="col">Trigger</th><th scope="col">Fallback</th></tr></thead><tbody>${unknowns}</tbody></table></div>` : '<p class="muted">No unresolved unknowns recorded.</p>'}</section>
</main>
<template id="pi-plan-markdown" data-format="markdown-v2">${escapeHtml(markdown)}</template>
<template id="pi-plan-snapshot" data-format="repository-snapshot-v1">${escapeHtml(JSON.stringify(candidate.snapshot))}</template>
<footer><div class="shell">Generated by Pi Planning HTML. Execute only after explicit approval with <code>/execute-plan &lt;this-file&gt;</code>.</div></footer>
</body>
</html>`;
}

function metaValue(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...html.matchAll(
      new RegExp(
        `<meta\\s+name=["']${escaped}["']\\s+content=["']([^"']+)["']\\s*\\/?>`,
        "gi",
      ),
    ),
  ];
  if (matches.length !== 1)
    throw new Error(
      `The HTML file must contain exactly one ${name} metadata value.`,
    );
  return matches[0]?.[1] ?? "";
}

function parseSnapshot(html: string): RepositorySnapshot | undefined {
  const matches = [
    ...html.matchAll(
      /<template\s+id=["']pi-plan-snapshot["']\s+data-format=["']repository-snapshot-v1["']\s*>([\s\S]*?)<\/template>/gi,
    ),
  ];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1)
    throw new Error(
      "The HTML file must contain at most one repository snapshot.",
    );
  let value: unknown;
  try {
    value = JSON.parse(decodeHtml(matches[0]?.[1] ?? ""));
  } catch {
    throw new Error("The repository snapshot is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The repository snapshot is invalid.");
  const snapshot = value as {
    gitHead?: unknown;
    observedFiles?: unknown;
  };
  if (
    (snapshot.gitHead !== undefined &&
      (typeof snapshot.gitHead !== "string" ||
        !/^[a-f0-9]{40,64}$/i.test(snapshot.gitHead))) ||
    !Array.isArray(snapshot.observedFiles)
  ) {
    throw new Error("The repository snapshot is invalid.");
  }
  const observedFiles = snapshot.observedFiles.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file))
      throw new Error("The repository snapshot is invalid.");
    const entry = file as { path?: unknown; hash?: unknown };
    if (
      typeof entry.path !== "string" ||
      !entry.path.trim() ||
      isAbsolute(entry.path) ||
      entry.path.replaceAll("\\", "/").split("/").includes("..") ||
      typeof entry.hash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(entry.hash)
    ) {
      throw new Error("The repository snapshot is invalid.");
    }
    return { path: entry.path, hash: entry.hash };
  });
  return snapshot.gitHead
    ? { gitHead: snapshot.gitHead, observedFiles }
    : { observedFiles };
}

export function verifyPlanArtifact(
  html: string,
  expectedCandidateDigest?: string,
): VerifiedPlanArtifact {
  if (
    !/<html\s+[^>]*data-plan-format=["']pi-plan-html-v2["'][^>]*>/i.test(html)
  ) {
    throw new Error(
      "The HTML file is not a supported Pi Planning v2 artifact.",
    );
  }
  const candidateDigest = metaValue(html, "plan-candidate-digest");
  const markdownHash = metaValue(html, "plan-markdown-sha256");
  if (
    !/^[a-f0-9]{64}$/i.test(candidateDigest) ||
    !/^[a-f0-9]{64}$/i.test(markdownHash)
  ) {
    throw new Error("The HTML plan metadata is invalid.");
  }
  if (expectedCandidateDigest && candidateDigest !== expectedCandidateDigest) {
    throw new Error(
      "The HTML plan does not match the candidate approved in this conversation.",
    );
  }
  const matches = [
    ...html.matchAll(
      /<template\s+id=["']pi-plan-markdown["']\s+data-format=["']markdown-v2["']\s*>([\s\S]*?)<\/template>/gi,
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      "The HTML file must contain exactly one Pi Planning Markdown payload.",
    );
  }
  const markdown = `${decodeHtml(matches[0]?.[1] ?? "").trim()}\n`;
  if (
    !markdown.startsWith("# ") ||
    !markdown.includes(`candidate-sha256:${candidateDigest}`)
  ) {
    throw new Error(
      "The embedded plan Markdown is missing or does not match the candidate metadata.",
    );
  }
  if (hashText(markdown) !== markdownHash) {
    throw new Error(
      "The embedded plan Markdown does not match its integrity hash.",
    );
  }
  const snapshot = parseSnapshot(html);
  return snapshot
    ? { candidateDigest, markdownHash, markdown, snapshot }
    : { candidateDigest, markdownHash, markdown };
}

export function extractPlanMarkdown(
  html: string,
  expectedCandidateDigest?: string,
): string {
  return verifyPlanArtifact(html, expectedCandidateDigest).markdown;
}

function assertRelativeArtifactDirectory(directory: string): void {
  if (!directory || isAbsolute(directory))
    throw new Error("Workspace artifact directory must be relative.");
  if (
    directory
      .replaceAll("\\", "/")
      .split("/")
      .some((segment) => segment === "..")
  ) {
    throw new Error(
      "Workspace artifact directory cannot traverse outside the project.",
    );
  }
}

function assertInside(base: string, target: string, message: string): void {
  const pathFromBase = relative(base, target);
  if (
    pathFromBase === ".." ||
    pathFromBase.startsWith(`..${sep}`) ||
    isAbsolute(pathFromBase)
  )
    throw new Error(message);
}

async function createConfinedDirectory(
  projectRoot: string,
  directory: string,
): Promise<string> {
  let current = projectRoot;
  for (const segment of directory
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)) {
    const next = resolve(current, segment);
    assertInside(projectRoot, next, "Artifact directory escapes the project.");
    try {
      const stat = await lstat(next);
      if (stat.isSymbolicLink())
        throw new Error(`Artifact directory cannot contain symlinks: ${next}`);
      if (!stat.isDirectory())
        throw new Error(
          `Artifact directory component is not a directory: ${next}`,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(next);
    }
    current = next;
  }
  return realpath(current);
}

export async function writePlanArtifact(
  cwd: string,
  directory: string,
  candidate: PlanCandidate,
): Promise<ArtifactRecord> {
  assertRelativeArtifactDirectory(directory);
  const projectRoot = await realpath(cwd);
  const base = await createConfinedDirectory(projectRoot, directory);
  const target = resolve(base, `${candidate.draft.slug}.html`);
  assertInside(
    base,
    target,
    "Artifact path escapes the configured plan directory.",
  );
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new Error("Refusing to replace a symlinked plan artifact.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const html = renderPlanHtml(candidate);
  const temporary = resolve(
    base,
    `.${candidate.draft.slug}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, html, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  const verified = verifyPlanArtifact(html, candidate.digest);
  return {
    path: relative(projectRoot, target).split(sep).join("/"),
    absolutePath: target,
    contentHash: hashText(html),
    markdownHash: verified.markdownHash,
    candidateDigest: candidate.digest,
    writtenAt: new Date().toISOString(),
  };
}

export async function readPlanMarkdown(
  htmlPath: string,
  expectedCandidateDigest?: string,
): Promise<string> {
  return extractPlanMarkdown(
    await readFile(htmlPath, "utf8"),
    expectedCandidateDigest,
  );
}

export function markdownPathForPlan(htmlPath: string): string {
  if (!htmlPath.toLowerCase().endsWith(".html"))
    throw new Error("Planning file must use the .html extension.");
  return `${htmlPath.slice(0, -5)}.md`;
}

export async function writeExtractedMarkdown(
  markdownPath: string,
  markdown: string,
): Promise<void> {
  const temporary = `${markdownPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, markdown, { encoding: "utf8", flag: "wx" });
    await rename(temporary, markdownPath);
  } finally {
    await rm(temporary, { force: true });
  }
}
