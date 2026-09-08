import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  withFileMutationQueue,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  captureRepositorySnapshot,
  compareRepositorySnapshot,
  createCandidate,
  hashText,
  markdownPathForPlan,
  verifyPlanArtifact,
  writeExtractedMarkdown,
  writePlanArtifact,
  type RepositorySnapshot,
} from "./artifact.ts";
import { loadPlanningConfig } from "./config.ts";
import {
  ARCHITECTURE_NODE_KINDS,
  ENGINEERING_AREAS,
  EVIDENCE_SOURCE_TYPES,
  VALIDATION_LEVELS,
  auditPlanDraft,
  type PlanDraft,
} from "./schema.ts";

const PLAN_FILE_HINT = "docs/plan/<plan>.html";
const MINIMUM_QUESTION_OPTIONS = 4;
const MAXIMUM_QUESTION_OPTIONS = 5;
const SKIP_REMAINING_CHOICE =
  "Skip all remaining questions and apply your best judgment";
const DEFAULT_QUESTION_LANGUAGE = "English";
const ENGLISH_LANGUAGE_CHOICE = "English (default)";
const OTHER_LANGUAGE_CHOICE = "Other language…";
const ID = Type.String({ minLength: 1, maxLength: 128 });
const TEXT = Type.String({ minLength: 1 });

const EvidenceSchema = Type.Object({
  id: ID,
  claim: TEXT,
  sourceType: StringEnum(EVIDENCE_SOURCE_TYPES),
  source: TEXT,
  seams: Type.Optional(Type.Array(TEXT, { minItems: 1 })),
  confidence: StringEnum(["low", "medium", "high"] as const),
  notes: TEXT,
});

const FileReferenceSchema = Type.Object({
  path: TEXT,
  status: StringEnum(["observed", "proposed"] as const),
  evidenceId: Type.Optional(ID),
});

const WorkItemSchema = Type.Object({
  id: ID,
  title: Type.String({ minLength: 4 }),
  what: TEXT,
  why: TEXT,
  how: TEXT,
  files: Type.Array(FileReferenceSchema, { minItems: 1 }),
  validationIds: Type.Array(ID, { minItems: 1 }),
});

const PlanTaskSchema = Type.Intersect([
  WorkItemSchema,
  Type.Object({
    kind: StringEnum(["implementation", "foundation"] as const),
    expectedBehavior: TEXT,
    parallelSafety: TEXT,
    requirementIds: Type.Array(ID),
    acceptanceCriteriaIds: Type.Array(ID),
    decisionIds: Type.Array(ID),
    dependsOn: Type.Array(ID),
    foundationFor: Type.Array(ID),
    subtasks: Type.Array(WorkItemSchema, { minItems: 1 }),
  }),
]);

const PlanDraftSchema = Type.Object({
  title: Type.String({ minLength: 4 }),
  slug: Type.String({ minLength: 1 }),
  language: Type.String({
    minLength: 2,
    maxLength: 35,
    pattern: "^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$",
  }),
  summary: TEXT,
  outcome: TEXT,
  repositoryEvidence: Type.Array(EvidenceSchema),
  requirements: Type.Array(
    Type.Object({
      id: ID,
      statement: TEXT,
      rationale: TEXT,
      priority: StringEnum(["must", "should", "could"] as const),
      evidenceIds: Type.Array(ID, { minItems: 1 }),
    }),
    { minItems: 1 },
  ),
  acceptanceCriteria: Type.Array(
    Type.Object({
      id: ID,
      requirementIds: Type.Array(ID, { minItems: 1 }),
      precondition: TEXT,
      action: TEXT,
      outcome: TEXT,
      edgeCase: TEXT,
      validationIds: Type.Array(ID, { minItems: 1 }),
    }),
    { minItems: 1 },
  ),
  decisions: Type.Array(
    Type.Object({
      id: ID,
      context: TEXT,
      choice: TEXT,
      alternatives: Type.Array(TEXT),
      rationale: TEXT,
      evidenceIds: Type.Array(ID, { minItems: 1 }),
      consequences: TEXT,
      reversibility: StringEnum(["easy", "moderate", "hard"] as const),
      affectedModules: Type.Array(TEXT, { minItems: 1 }),
      status: StringEnum(["decided", "provisional"] as const),
    }),
  ),
  inScope: Type.Array(TEXT, { minItems: 1 }),
  outOfScope: Type.Array(TEXT),
  constraints: Type.Array(TEXT),
  findings: Type.Array(
    Type.Object({
      summary: TEXT,
      evidenceIds: Type.Array(ID, { minItems: 1 }),
    }),
  ),
  architecture: Type.Object({
    summary: TEXT,
    nodes: Type.Array(
      Type.Object({
        id: ID,
        label: TEXT,
        kind: StringEnum(ARCHITECTURE_NODE_KINDS),
        responsibility: TEXT,
        taskIds: Type.Array(ID),
      }),
      { minItems: 1 },
    ),
    edges: Type.Array(Type.Object({ from: ID, to: ID, label: TEXT }), {
      minItems: 1,
    }),
  }),
  tasks: Type.Array(PlanTaskSchema, { minItems: 1 }),
  validations: Type.Array(
    Type.Object({
      id: ID,
      level: StringEnum(VALIDATION_LEVELS),
      procedure: TEXT,
      preconditions: Type.Array(TEXT),
      expectedEvidence: TEXT,
      acceptanceCriteriaIds: Type.Array(ID, { minItems: 1 }),
    }),
    { minItems: 1 },
  ),
  endToEndValidationIds: Type.Array(ID, { minItems: 1 }),
  risks: Type.Array(
    Type.Object({
      risk: TEXT,
      severity: StringEnum(["low", "medium", "high"] as const),
      mitigation: TEXT,
    }),
  ),
  assumptions: Type.Array(
    Type.Object({
      id: ID,
      assumption: TEXT,
      confidence: StringEnum(["low", "medium", "high"] as const),
      impactIfFalse: TEXT,
      provenance: StringEnum([
        "user",
        "planner-judgment",
        "repository-evidence",
      ] as const),
      resolutionPoint: TEXT,
      fallback: TEXT,
    }),
  ),
  unknowns: Type.Array(
    Type.Object({
      id: ID,
      statement: TEXT,
      impact: TEXT,
      severity: StringEnum(["low", "medium", "high"] as const),
      status: StringEnum(["needs-decision", "deferred"] as const),
      blocking: Type.Boolean(),
      deferredWithUserApproval: Type.Boolean(),
      evidenceIds: Type.Array(ID),
      resolutionOwner: TEXT,
      resolutionPoint: TEXT,
      trigger: TEXT,
      fallback: TEXT,
    }),
  ),
  engineering: Type.Array(
    Type.Object({
      area: StringEnum(ENGINEERING_AREAS),
      assessment: TEXT,
    }),
    { minItems: ENGINEERING_AREAS.length },
  ),
});

interface PublishedPlanReference {
  artifact: string;
  candidateDigest: string;
  markdownHash: string;
  contentHash: string;
}

interface ResolvedPlanFile {
  absolutePath: string;
  relativePath: string;
}

interface ExecutionPlan {
  plan: ResolvedPlanFile;
  markdown: string;
  snapshot?: RepositorySnapshot;
}

function result(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function normalizeUserPath(value: string): string {
  return value.trim().replace(/^@/, "");
}

function normalizedChoice(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizedLanguage(value: string | undefined): string {
  const language = value?.trim().replace(/\s+/g, " ") ?? "";
  return language.slice(0, 80) || DEFAULT_QUESTION_LANGUAGE;
}

function freeTextChoice(options: string[]): string {
  const base = "Other answer…";
  let candidate = base;
  let index = 2;
  const normalized = new Set(options.map(normalizedChoice));
  while (normalized.has(normalizedChoice(candidate))) {
    candidate = `${base} (${index})`;
    index += 1;
  }
  return candidate;
}

function assertInsideProject(projectRoot: string, target: string): void {
  const fromRoot = relative(projectRoot, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error("Planning file must be inside the current project.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

/** Returns the language chosen by the user for this active planning branch. */
function planQuestionLanguageFromContext(
  ctx: ExtensionContext,
): string | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      !isRecord(entry) ||
      entry.type !== "message" ||
      !isRecord(entry.message)
    )
      continue;
    const message = entry.message;
    if (
      message.role !== "toolResult" ||
      message.toolName !== "plan_question" ||
      !isRecord(message.details)
    )
      continue;
    const language = message.details.language;
    if (typeof language === "string" && language.trim())
      return normalizedLanguage(language);
  }
  return undefined;
}

/** Returns the most recently published v2 plan on the active conversation branch. */
function planArtifactFromContext(
  ctx: ExtensionCommandContext,
): PublishedPlanReference | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      !isRecord(entry) ||
      entry.type !== "message" ||
      !isRecord(entry.message)
    )
      continue;
    const message = entry.message;
    if (
      message.role !== "toolResult" ||
      message.toolName !== "plan_publish" ||
      !isRecord(message.details)
    )
      continue;
    const { artifact, candidateDigest, markdownHash, contentHash } =
      message.details;
    if (
      typeof artifact === "string" &&
      artifact.trim() &&
      isSha256(candidateDigest) &&
      isSha256(markdownHash) &&
      isSha256(contentHash)
    ) {
      return { artifact, candidateDigest, markdownHash, contentHash };
    }
  }
  return undefined;
}

async function resolvePlanFile(
  cwd: string,
  value: string,
  artifactDirectory: string,
): Promise<ResolvedPlanFile> {
  const original = normalizeUserPath(value);
  if (!original)
    throw new Error(`Specify a planning file, for example ${PLAN_FILE_HINT}.`);
  const requested = original.toLowerCase().endsWith(".html")
    ? original
    : `${original}.html`;
  const projectRoot = await realpath(cwd);
  const isBareName =
    !isAbsolute(requested) &&
    !requested.includes("/") &&
    !requested.includes("\\");
  const candidates = [
    ...(isBareName ? [resolve(projectRoot, artifactDirectory, requested)] : []),
    resolve(projectRoot, requested),
  ];
  for (const candidate of [...new Set(candidates)]) {
    assertInsideProject(projectRoot, candidate);
    try {
      const absolutePath = await realpath(candidate);
      assertInsideProject(projectRoot, absolutePath);
      return {
        absolutePath,
        relativePath: relative(projectRoot, absolutePath).split(sep).join("/"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `Could not find ${requested}. Use a project-relative or absolute path, or a plan filename from ${artifactDirectory}.`,
  );
}

function executionPrompt(
  htmlPath: string,
  markdownPath: string,
  hasSubagent: boolean,
  staleSnapshotWarning?: string,
): string {
  const delegation = hasSubagent
    ? "Use the active subagent tool only for dependency-independent, well-bounded implementation tasks; keep integration, validation, and final decisions in this session."
    : "No subagent tool is active, so implement the dependency-ordered tasks directly in this session.";
  const snapshotWarning = staleSnapshotWarning
    ? `\n\nRepository snapshot warning: ${staleSnapshotWarning} Reinspect affected seams before editing.`
    : "";
  return `The user explicitly approved this plan by running /execute-plan. Implement the plan extracted from ${htmlPath}.

The canonical execution brief is now available at ${markdownPath}. Before editing, reread the project instructions and verify that the named source seams, observed evidence, assumptions, and constraints still match the current repository. If a verified seam has changed, report the deviation and update the implementation approach deliberately rather than blindly following stale paths.${snapshotWarning}

Read the brief, implement tasks in dependency order, preserve stated constraints, and produce the validation evidence named by each task and acceptance criterion. Run the end-to-end validation gate before reporting completion. Report deviations, unresolved unknowns, or blockers clearly.

${delegation}`;
}

async function loadExecutionPlan(
  ctx: ExtensionCommandContext,
  requested: string,
  reference: PublishedPlanReference | undefined,
): Promise<ExecutionPlan> {
  const config = await loadPlanningConfig(ctx.cwd);
  const plan = await resolvePlanFile(
    ctx.cwd,
    requested,
    config.artifactDirectory,
  );
  if (reference && plan.relativePath !== reference.artifact) {
    throw new Error(
      "The plan path no longer matches the artifact approved in this conversation.",
    );
  }
  const html = await readFile(plan.absolutePath, "utf8");
  if (reference && hashText(html) !== reference.contentHash) {
    throw new Error(
      "The HTML plan changed after publication; republish it or approve this exact file explicitly.",
    );
  }
  const verified = verifyPlanArtifact(html, reference?.candidateDigest);
  if (reference && hashText(verified.markdown) !== reference.markdownHash) {
    throw new Error(
      "The embedded plan Markdown changed after publication; republish it or approve this exact file explicitly.",
    );
  }
  return verified.snapshot
    ? { plan, markdown: verified.markdown, snapshot: verified.snapshot }
    : { plan, markdown: verified.markdown };
}

async function snapshotWarning(
  cwd: string,
  snapshot: RepositorySnapshot | undefined,
): Promise<string | undefined> {
  if (!snapshot) return undefined;
  const comparison = await compareRepositorySnapshot(cwd, snapshot);
  const changes = [
    ...(comparison.gitHeadChanged ? ["Git commit changed"] : []),
    ...comparison.changedPaths.map((path) => `changed seam ${path}`),
  ];
  return changes.length > 0 ? changes.join("; ") : undefined;
}

async function startPlanImplementation(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  execution: ExecutionPlan,
  staleSnapshotWarning: string | undefined,
): Promise<void> {
  const markdownPath = markdownPathForPlan(execution.plan.absolutePath);
  await withFileMutationQueue(markdownPath, () =>
    writeExtractedMarkdown(markdownPath, execution.markdown),
  );
  const projectRoot = await realpath(ctx.cwd);
  const relativeMarkdownPath = relative(projectRoot, markdownPath)
    .split(sep)
    .join("/");
  const hasSubagent = pi.getActiveTools().includes("subagent");
  ctx.ui.notify(
    `Extracted ${execution.plan.relativePath} to ${relativeMarkdownPath}. Starting implementation.`,
    "info",
  );
  pi.sendUserMessage(
    executionPrompt(
      execution.plan.relativePath,
      relativeMarkdownPath,
      hasSubagent,
      staleSnapshotWarning,
    ),
  );
}

async function executePlan(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  requested: string,
  reference: PublishedPlanReference | undefined,
): Promise<void> {
  const execution = await loadExecutionPlan(ctx, requested, reference);
  const staleSnapshotWarning = await snapshotWarning(
    ctx.cwd,
    execution.snapshot,
  );
  if (staleSnapshotWarning) {
    ctx.ui.notify(
      `Plan snapshot differs from the current repository: ${staleSnapshotWarning}.`,
      "warning",
    );
  }
  await startPlanImplementation(pi, ctx, execution, staleSnapshotWarning);
}

export default function planningExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "plan_question",
    label: "Plan Question",
    description:
      "Ask one material planning question with at least four choices, an enforced skip-remaining choice, and an always-available free-text answer through Pi's native select/input UI. Use only after researching discoverable facts.",
    promptSnippet:
      "Ask material planning questions with four choices, an enforced skip option, and free-text answers through Pi's native UI",
    parameters: Type.Object({
      question: Type.String({ minLength: 8 }),
      options: Type.Array(Type.String({ minLength: 1 }), {
        minItems: MINIMUM_QUESTION_OPTIONS,
      }),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const options = params.options.map((option) => option.trim());
      if (options.length < MINIMUM_QUESTION_OPTIONS)
        throw new Error(
          `Plan questions need at least ${MINIMUM_QUESTION_OPTIONS} choices.`,
        );
      if (options.length > MAXIMUM_QUESTION_OPTIONS)
        throw new Error(
          `Plan questions allow at most ${MAXIMUM_QUESTION_OPTIONS} choices.`,
        );
      if (
        options.some((option) => !option) ||
        new Set(options.map(normalizedChoice)).size !== options.length
      ) {
        throw new Error(
          "Plan question choices must be unique, non-empty text (ignoring case and surrounding whitespace).",
        );
      }
      if (
        options.some(
          (option) =>
            normalizedChoice(option) ===
            normalizedChoice(SKIP_REMAINING_CHOICE),
        )
      ) {
        throw new Error(
          "Do not supply the reserved skip-remaining choice; plan_question adds it automatically.",
        );
      }
      const selectedLanguage = planQuestionLanguageFromContext(ctx);
      if (!selectedLanguage) {
        let language = DEFAULT_QUESTION_LANGUAGE;
        if (ctx.hasUI) {
          const languageChoice = await ctx.ui.select(
            "What language do you prefer for planning questions?",
            [ENGLISH_LANGUAGE_CHOICE, OTHER_LANGUAGE_CHOICE],
          );
          if (languageChoice === OTHER_LANGUAGE_CHOICE) {
            language = normalizedLanguage(
              await ctx.ui.input(
                "Preferred planning-question language",
                "For example: Thai",
              ),
            );
          }
        }
        return result(
          `Planning-question language set to ${language}. Reissue this question and all remaining planning questions in ${language}.`,
          {
            language,
            languageSelected: true,
            answer: null,
            kind: "language-selection",
            skipRemaining: false,
          },
        );
      }
      const language = selectedLanguage;
      if (!ctx.hasUI) {
        return result(
          `Interactive UI is unavailable. Ask this material question in ${language} in the conversation instead: ${params.question}`,
          {
            question: params.question,
            answer: null,
            kind: "unavailable",
            language,
            skipRemaining: false,
          },
        );
      }
      const other = freeTextChoice([...options, SKIP_REMAINING_CHOICE]);
      const choices = [...options, SKIP_REMAINING_CHOICE, other];
      const selected = await ctx.ui.select(params.question, choices);
      if (!selected)
        return result("User cancelled the question.", {
          question: params.question,
          answer: null,
          kind: "cancelled",
          language,
          skipRemaining: false,
        });
      if (selected === SKIP_REMAINING_CHOICE) {
        return result(
          "User skipped remaining questions and requested best judgment.",
          {
            question: params.question,
            answer: selected,
            kind: "skip-remaining",
            language,
            skipRemaining: true,
          },
        );
      }
      if (selected !== other)
        return result(`User selected: ${selected}`, {
          question: params.question,
          answer: selected,
          kind: "option",
          language,
          skipRemaining: false,
        });
      const answer = await ctx.ui.input(
        params.question,
        "State the preferred answer",
      );
      return result(
        answer?.trim()
          ? `User answered: ${answer.trim()}`
          : "User cancelled the question.",
        {
          question: params.question,
          answer: answer?.trim() || null,
          kind: answer?.trim() ? "free-text" : "cancelled",
          language,
          skipRemaining: false,
        },
      );
    },
  });

  pi.registerTool({
    name: "plan_publish",
    label: "Publish HTML Plan",
    description:
      "Validate and write the complete standalone, offline-first HTML implementation plan. Call once as the final action of /plan; it does not execute the plan.",
    promptSnippet:
      "Publish the final detailed plan as its single HTML artifact",
    parameters: PlanDraftSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const draft = params as PlanDraft;
      const validation = await auditPlanDraft(draft, ctx.cwd);
      if (!validation.valid)
        throw new Error(
          `Plan candidate rejected:\n- ${validation.errors.join("\n- ")}`,
        );
      const config = await loadPlanningConfig(ctx.cwd);
      const snapshot = await captureRepositorySnapshot(ctx.cwd, draft);
      const candidate = createCandidate(
        draft,
        new Date().toISOString(),
        snapshot,
      );
      const target = resolve(
        ctx.cwd,
        config.artifactDirectory,
        `${draft.slug}.html`,
      );
      const artifact = await withFileMutationQueue(target, () =>
        writePlanArtifact(ctx.cwd, config.artifactDirectory, candidate),
      );
      return {
        ...result(
          `Created the planning artifact at ${artifact.path}. Planning is complete; do not implement this plan in the current /plan run.`,
          {
            artifact: artifact.path,
            candidateDigest: artifact.candidateDigest,
            markdownHash: artifact.markdownHash,
            contentHash: artifact.contentHash,
            repositorySnapshot: candidate.snapshot,
            coverage: validation.coverage,
          },
        ),
        terminate: true,
      };
    },
  });

  pi.registerCommand("execute-plan", {
    description:
      "Extract a planning HTML file to Markdown and begin implementing it",
    handler: async (args, ctx) => {
      const reference = args.trim() ? undefined : planArtifactFromContext(ctx);
      const requested = args.trim() || reference?.artifact;
      if (!requested) {
        ctx.ui.notify(
          `No integrity-verified planning artifact is available in this conversation. Use /execute-plan ${PLAN_FILE_HINT}.`,
          "error",
        );
        return;
      }
      try {
        await executePlan(pi, ctx, requested, reference);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
}
