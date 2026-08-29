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
import type { PlanDraft, PlanSubtask, PlanTask } from "./schema.ts";

export interface PlanCandidate {
  digest: string;
  createdAt: string;
  draft: PlanDraft;
}

export interface ArtifactRecord {
  path: string;
  absolutePath: string;
  contentHash: string;
  candidateDigest: string;
  writtenAt: string;
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

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
): PlanCandidate {
  return { digest: digestValue(draft), createdAt: now, draft };
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

function workItemDetails(item: PlanSubtask): string {
  return `<dl>
    <dt>What</dt><dd>${escapeHtml(item.what)}</dd>
    <dt>Why</dt><dd>${escapeHtml(item.why)}</dd>
    <dt>How</dt><dd>${escapeHtml(item.how)}</dd>
  </dl>
  <h5>Files or modules</h5>${list(item.files)}
  <h5>Depends on</h5>${list(item.dependsOn, "No predecessor work items.")}
  <h5>Validation</h5>${list(item.validation)}`;
}

function taskCards(tasks: PlanTask[]): string {
  return tasks
    .map(
      (task, index) => `<article class="task" id="task-${escapeHtml(task.id)}">
        <div class="task-head"><span class="step">${index + 1}</span><div><p class="task-id">${escapeHtml(task.id)}</p><h3>${escapeHtml(task.title)}</h3></div></div>
        ${workItemDetails(task)}
        <h4>Implementation subtasks</h4>
        <ol class="subtasks">${task.subtasks.map((subtask) => `<li id="task-${escapeHtml(subtask.id)}"><article><p class="task-id">${escapeHtml(subtask.id)}</p><h5>${escapeHtml(subtask.title)}</h5>${workItemDetails(subtask)}</article></li>`).join("")}</ol>
      </article>`,
    )
    .join("");
}

export function renderPlanMarkdown(candidate: PlanCandidate): string {
  const { draft } = candidate;
  const lines = [
    `# ${draft.title}`,
    "",
    `> Generated ${candidate.createdAt} · sha256:${candidate.digest}`,
    "",
    "## Summary",
    "",
    draft.summary,
    "",
    "## Outcome",
    "",
    draft.outcome,
    "",
    "## Acceptance criteria",
    ...draft.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "## Scope",
    "",
    "### In scope",
    ...draft.inScope.map((item) => `- ${item}`),
    "",
    "### Out of scope",
    ...draft.outOfScope.map((item) => `- ${item}`),
    "",
    "## Constraints",
    ...draft.constraints.map((item) => `- ${item}`),
    "",
    "## Findings",
    ...draft.findings.flatMap((finding) => [
      `- **${finding.summary}**`,
      ...finding.evidence.map((item) => `  - ${item}`),
    ]),
    "",
    "## Implementation tasks",
    ...draft.tasks.flatMap((task) => [
      `### ${task.id} — ${task.title}`,
      "",
      `**What:** ${task.what}`,
      "",
      `**Why:** ${task.why}`,
      "",
      `**How:** ${task.how}`,
      "",
      `**Files/modules:** ${task.files.join(", ")}`,
      "",
      `**Depends on:** ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "None"}`,
      "",
      "**Validation:**",
      ...task.validation.map((item) => `- ${item}`),
      "",
      "#### Subtasks",
      ...task.subtasks.flatMap((subtask) => [
        `##### ${subtask.id} — ${subtask.title}`,
        "",
        `**What:** ${subtask.what}`,
        "",
        `**Why:** ${subtask.why}`,
        "",
        `**How:** ${subtask.how}`,
        "",
        `**Files/modules:** ${subtask.files.join(", ")}`,
        "",
        `**Depends on:** ${subtask.dependsOn.length > 0 ? subtask.dependsOn.join(", ") : task.id}`,
        "",
        "**Validation:**",
        ...subtask.validation.map((item) => `- ${item}`),
        "",
      ]),
    ]),
    "## Engineering considerations",
    ...draft.engineering.flatMap((item) => [
      `### ${item.area}`,
      "",
      item.assessment,
      "",
    ]),
    "## Risks",
    ...draft.risks.flatMap((risk) => [
      `- **${risk.severity}: ${risk.risk}**`,
      `  - Mitigation: ${risk.mitigation}`,
    ]),
    "",
    "## Assumptions",
    ...draft.assumptions.flatMap((item) => [
      `- ${item.assumption}`,
      `  - If false: ${item.impactIfFalse}`,
    ]),
    "",
    "## Open questions",
    ...draft.openQuestions.map(
      (item) => `- ${item.blocking ? "BLOCKING — " : ""}${item.question}`,
    ),
    "",
    "## End-to-end validation",
    ...draft.validation.map((item) => `- ${item}`),
  ];
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

export function renderPlanHtml(candidate: PlanCandidate): string {
  const { draft } = candidate;
  const markdown = renderPlanMarkdown(candidate);
  const findings = draft.findings
    .map(
      (finding) =>
        `<article class="card"><h3>${escapeHtml(finding.summary)}</h3>${list(finding.evidence)}</article>`,
    )
    .join("");
  const engineering = draft.engineering
    .map(
      (item) =>
        `<article class="card"><h3>${escapeHtml(item.area)}</h3><p>${escapeHtml(item.assessment)}</p></article>`,
    )
    .join("");
  const risks = draft.risks
    .map(
      (risk) =>
        `<tr><td><span class="tag ${risk.severity === "high" ? "bad" : risk.severity === "medium" ? "warn" : "good"}">${risk.severity}</span></td><td>${escapeHtml(risk.risk)}</td><td>${escapeHtml(risk.mitigation)}</td></tr>`,
    )
    .join("");
  const assumptions = draft.assumptions
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.assumption)}</td><td>${escapeHtml(item.confidence)}</td><td>${escapeHtml(item.impactIfFalse)}</td></tr>`,
    )
    .join("");
  const questions = draft.openQuestions.map(
    (item) => `${item.blocking ? "BLOCKING — " : ""}${item.question}`,
  );

  return `<!doctype html>
<html lang="en" data-plan-format="pi-plan-html-v1">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Implementation plan: ${escapeHtml(draft.title)}">
  <meta name="plan-digest" content="${candidate.digest}">
  <title>${escapeHtml(draft.title)} — Implementation Plan</title>
  <style>
    :root{color-scheme:light;--bg:#f5f7fb;--surface:#fff;--ink:#182235;--muted:#647087;--line:#dbe2ec;--brand:#4b3bc8;--soft:#efedff;--good:#08744b;--good-bg:#e8f7ef;--warn:#8a5900;--warn-bg:#fff3d7;--bad:#a12b34;--bad-bg:#fff0f1}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.62 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.shell{width:min(1040px,calc(100% - 2rem));margin:auto}header{padding:4rem 0 2.6rem;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#fff,#f0eeff)}main{padding:2.5rem 0 4rem}section{margin:0 0 3rem}h1{max-width:850px;margin:.2rem 0;font-size:clamp(2.2rem,6vw,4.2rem);line-height:1.05;letter-spacing:-.05em}h2{margin:0 0 1rem;font-size:1.75rem;letter-spacing:-.03em}h3{margin:.1rem 0 .5rem;line-height:1.25}h4{margin:1.2rem 0 .4rem}h5{margin:.8rem 0 .25rem}.eyebrow,.task-id{margin:0;color:var(--brand);font-size:.75rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.lede{max-width:780px;color:var(--muted);font-size:1.1rem}.meta{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}.tag{display:inline-block;padding:.15rem .5rem;border-radius:99px;background:var(--soft);color:var(--brand);font-size:.72rem;font-weight:800}.tag.good{background:var(--good-bg);color:var(--good)}.tag.warn{background:var(--warn-bg);color:var(--warn)}.tag.bad{background:var(--bad-bg);color:var(--bad)}.main-idea{padding:1.2rem 1.3rem;border:1px solid #d1cbff;border-left:5px solid var(--brand);border-radius:14px;background:var(--soft)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.card,.task,.subtasks article{padding:1.15rem;border:1px solid var(--line);border-radius:15px;background:var(--surface)}.task{margin-bottom:1rem;border-left:5px solid var(--brand)}.task-head{display:flex;gap:.8rem;align-items:flex-start}.step{display:grid;min-width:2rem;height:2rem;place-items:center;border-radius:50%;background:var(--soft);color:var(--brand);font-weight:800}dl{display:grid;grid-template-columns:5rem 1fr;gap:.5rem 1rem;margin:1rem 0}dt{color:var(--brand);font-weight:850}dd{margin:0}.muted,small{color:var(--muted)}.subtasks{display:grid;gap:1rem;padding-left:1.5rem}.subtasks li{padding-left:.25rem}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{padding:.75rem;border:1px solid var(--line);vertical-align:top;text-align:left}th{background:#f0f3f8;font-size:.75rem;text-transform:uppercase}code{padding:.1rem .3rem;border-radius:5px;background:#eef1f6}footer{padding:1.5rem 0;border-top:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:.82rem}@media(max-width:700px){.grid{grid-template-columns:1fr}dl{grid-template-columns:1fr}header{padding-top:2.5rem}}@media print{body{background:#fff}.card,.task,.subtasks article{break-inside:avoid}}
  </style>
</head>
<body>
<header><div class="shell"><p class="eyebrow">Implementation plan</p><h1>${escapeHtml(draft.title)}</h1><p class="lede">${escapeHtml(draft.summary)}</p><div class="meta"><span class="tag">${escapeHtml(draft.slug)}</span><span class="tag">sha256:${candidate.digest.slice(0, 12)}</span></div></div></header>
<main class="shell">
  <section><div class="main-idea"><h2>Outcome</h2><p>${escapeHtml(draft.outcome)}</p><h3>Acceptance criteria</h3>${list(draft.acceptanceCriteria)}</div></section>
  <section><h2>Scope and constraints</h2><div class="grid"><article class="card"><h3>In scope</h3>${list(draft.inScope)}</article><article class="card"><h3>Out of scope</h3>${list(draft.outOfScope)}</article></div><article class="card" style="margin-top:1rem"><h3>Constraints</h3>${list(draft.constraints)}</article></section>
  <section><h2>Research findings</h2><div class="grid">${findings || '<p class="muted">No additional findings recorded.</p>'}</div></section>
  <section><h2>Implementation tasks</h2>${taskCards(draft.tasks)}</section>
  <section><h2>Engineering considerations</h2><div class="grid">${engineering}</div></section>
  <section><h2>Risks</h2>${risks ? `<table><thead><tr><th>Severity</th><th>Risk</th><th>Mitigation</th></tr></thead><tbody>${risks}</tbody></table>` : '<p class="muted">No material risks recorded.</p>'}</section>
  <section><h2>Assumptions</h2>${assumptions ? `<table><thead><tr><th>Assumption</th><th>Confidence</th><th>Impact if false</th></tr></thead><tbody>${assumptions}</tbody></table>` : '<p class="muted">No assumptions recorded.</p>'}</section>
  <section><h2>Open questions</h2>${list(questions)}</section>
  <section><h2>End-to-end validation</h2>${list(draft.validation)}</section>
</main>
<template id="pi-plan-markdown" data-format="markdown-v1">${escapeHtml(markdown)}</template>
<footer><div class="shell">Generated by Pi Planning HTML. Run <code>/execute-plan &lt;this-file&gt;</code> to extract its Markdown and begin implementation.</div></footer>
</body>
</html>`;
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
  ) {
    throw new Error(message);
  }
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

  return {
    path: relative(projectRoot, target).split(sep).join("/"),
    absolutePath: target,
    contentHash: hashText(html),
    candidateDigest: candidate.digest,
    writtenAt: new Date().toISOString(),
  };
}

export function extractPlanMarkdown(html: string): string {
  const matches = [
    ...html.matchAll(
      /<template\s+id=["']pi-plan-markdown["']\s+data-format=["']markdown-v1["']\s*>([\s\S]*?)<\/template>/gi,
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      "The HTML file must contain exactly one Pi Planning Markdown payload.",
    );
  }
  const markdown = decodeHtml(matches[0]?.[1] ?? "").trim();
  if (!markdown.startsWith("# ")) {
    throw new Error("The embedded plan Markdown is missing or invalid.");
  }
  return `${markdown}\n`;
}

export async function readPlanMarkdown(htmlPath: string): Promise<string> {
  return extractPlanMarkdown(await readFile(htmlPath, "utf8"));
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
