import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  withFileMutationQueue,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  createCandidate,
  markdownPathForPlan,
  readPlanMarkdown,
  writeExtractedMarkdown,
  writePlanArtifact,
} from "./artifact.ts";
import { loadPlanningConfig } from "./config.ts";
import {
  ENGINEERING_AREAS,
  validatePlanDraft,
  type PlanDraft,
} from "./schema.ts";

const PLAN_FILE_HINT = "docs/plan/<plan>.html";

const WorkItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 4 }),
  what: Type.String({ minLength: 1 }),
  why: Type.String({ minLength: 1 }),
  how: Type.String({ minLength: 1 }),
  files: Type.Array(Type.String(), { minItems: 1 }),
  dependsOn: Type.Array(Type.String()),
  validation: Type.Array(Type.String(), { minItems: 1 }),
});

const PlanTaskSchema = Type.Intersect([
  WorkItemSchema,
  Type.Object({
    subtasks: Type.Array(WorkItemSchema, { minItems: 1 }),
  }),
]);

const PlanDraftSchema = Type.Object({
  title: Type.String({ minLength: 4 }),
  slug: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  outcome: Type.String({ minLength: 1 }),
  acceptanceCriteria: Type.Array(Type.String(), { minItems: 1 }),
  inScope: Type.Array(Type.String(), { minItems: 1 }),
  outOfScope: Type.Array(Type.String()),
  constraints: Type.Array(Type.String()),
  findings: Type.Array(
    Type.Object({
      summary: Type.String(),
      evidence: Type.Array(Type.String()),
    }),
  ),
  tasks: Type.Array(PlanTaskSchema, { minItems: 1 }),
  validation: Type.Array(Type.String(), { minItems: 1 }),
  risks: Type.Array(
    Type.Object({
      risk: Type.String(),
      severity: StringEnum(["low", "medium", "high"] as const),
      mitigation: Type.String(),
    }),
  ),
  assumptions: Type.Array(
    Type.Object({
      assumption: Type.String(),
      confidence: StringEnum(["low", "medium", "high"] as const),
      impactIfFalse: Type.String(),
    }),
  ),
  openQuestions: Type.Array(
    Type.Object({
      question: Type.String(),
      blocking: Type.Boolean(),
    }),
  ),
  engineering: Type.Array(
    Type.Object({
      area: StringEnum(ENGINEERING_AREAS),
      assessment: Type.String(),
    }),
    { minItems: ENGINEERING_AREAS.length },
  ),
});

function result(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function normalizeUserPath(value: string): string {
  return value.trim().replace(/^@/, "");
}

function freeTextChoice(options: string[]): string {
  const base = "Other answer…";
  let candidate = base;
  let index = 2;
  while (options.includes(candidate)) {
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

/** Returns the most recently published plan on the active Pi conversation branch. */
function planArtifactFromContext(ctx: ExtensionCommandContext): string | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role !== "toolResult" || message.toolName !== "plan_publish" || !isRecord(message.details)) {
      continue;
    }
    const artifact = message.details.artifact;
    if (typeof artifact === "string" && artifact.trim()) return artifact;
  }
  return undefined;
}

async function resolvePlanFile(
  cwd: string,
  value: string,
  artifactDirectory: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const original = normalizeUserPath(value);
  if (!original) throw new Error(`Specify a planning file, for example ${PLAN_FILE_HINT}.`);
  const requested = original.toLowerCase().endsWith(".html") ? original : `${original}.html`;
  const projectRoot = await realpath(cwd);
  const isBareName = !isAbsolute(requested) && !requested.includes("/") && !requested.includes("\\");
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
  throw new Error(`Could not find ${requested}. Use a project-relative or absolute path, or a plan filename from ${artifactDirectory}.`);
}

function executionPrompt(
  htmlPath: string,
  markdownPath: string,
  hasSubagent: boolean,
): string {
  const delegation = hasSubagent
    ? "Use the active subagent tool only for dependency-independent, well-bounded implementation tasks; keep integration, validation, and final decisions in this session."
    : "No subagent tool is active, so implement the dependency-ordered tasks directly in this session.";
  return `The user explicitly approved this plan by running /execute-plan. Implement the plan extracted from ${htmlPath}.

The canonical execution brief is now available at ${markdownPath}. Read it before changing files, then implement its tasks and subtasks in dependency order. Preserve stated constraints, run the task and end-to-end validation, and report deviations or blockers clearly.

${delegation}`;
}

export default function planningExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "plan_question",
    label: "Plan Question",
    description:
      "Ask one material planning question using Pi's native select/input UI. Use only after researching discoverable facts.",
    promptSnippet: "Ask material planning questions through Pi's native UI",
    parameters: Type.Object({
      question: Type.String({ minLength: 8 }),
      options: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      ),
      allowFreeText: Type.Optional(Type.Boolean()),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return result(
          "Interactive UI is unavailable. Ask this material question in the conversation instead: " +
            params.question,
          { question: params.question, answer: null },
        );
      }

      const options = [...(params.options ?? [])];
      const allowFreeText = params.allowFreeText !== false;
      if (options.length === 0) {
        const answer = await ctx.ui.input(params.question, "Your answer");
        return result(
          answer?.trim()
            ? `User answered: ${answer.trim()}`
            : "User cancelled the question.",
          { question: params.question, answer: answer?.trim() || null },
        );
      }

      const other = allowFreeText ? freeTextChoice(options) : undefined;
      const choices = other ? [...options, other] : options;
      const selected = await ctx.ui.select(params.question, choices);
      if (!selected)
        return result("User cancelled the question.", {
          question: params.question,
          answer: null,
        });
      if (selected !== other)
        return result(`User selected: ${selected}`, {
          question: params.question,
          answer: selected,
        });

      const answer = await ctx.ui.input(
        params.question,
        "State the preferred answer",
      );
      return result(
        answer?.trim()
          ? `User answered: ${answer.trim()}`
          : "User cancelled the question.",
        { question: params.question, answer: answer?.trim() || null },
      );
    },
  });

  pi.registerTool({
    name: "plan_publish",
    label: "Publish HTML Plan",
    description:
      "Validate and write the complete standalone HTML implementation plan. Call once as the final action of /plan; it does not execute the plan.",
    promptSnippet:
      "Publish the final detailed plan as its single HTML artifact",
    parameters: PlanDraftSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const draft = params as PlanDraft;
      const validation = validatePlanDraft(draft);
      if (!validation.valid) {
        throw new Error(
          `Plan candidate rejected:\n- ${validation.errors.join("\n- ")}`,
        );
      }
      const config = await loadPlanningConfig(ctx.cwd);
      const candidate = createCandidate(draft);
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
          { artifact: artifact.path, digest: candidate.digest },
        ),
        terminate: true,
      };
    },
  });

  pi.registerCommand("execute-plan", {
    description:
      "Extract a planning HTML file to Markdown and begin implementing it",
    handler: async (args, ctx) => {
      const requested = args.trim() || planArtifactFromContext(ctx);
      if (!requested) {
        ctx.ui.notify(
          `No planning artifact is available in this conversation. Use /execute-plan ${PLAN_FILE_HINT}.`,
          "error",
        );
        return;
      }

      try {
        const config = await loadPlanningConfig(ctx.cwd);
        const plan = await resolvePlanFile(
          ctx.cwd,
          requested,
          config.artifactDirectory,
        );
        const markdown = await readPlanMarkdown(plan.absolutePath);
        const markdownPath = markdownPathForPlan(plan.absolutePath);
        await withFileMutationQueue(markdownPath, () =>
          writeExtractedMarkdown(markdownPath, markdown),
        );

        const projectRoot = await realpath(ctx.cwd);
        const relativeMarkdownPath = relative(projectRoot, markdownPath)
          .split(sep)
          .join("/");
        const hasSubagent = pi.getActiveTools().includes("subagent");
        ctx.ui.notify(
          `Extracted ${plan.relativePath} to ${relativeMarkdownPath}. Starting implementation.`,
          "info",
        );
        pi.sendUserMessage(
          executionPrompt(plan.relativePath, relativeMarkdownPath, hasSubagent),
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
}
