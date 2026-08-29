import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  withFileMutationQueue,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCandidate,
  digestValue,
  verifyPlanArtifact,
  writePlanArtifact,
  type PlanCandidate,
} from "./artifact.ts";
import { captureBaseline, createApprovalRecord } from "./approval.ts";
import {
  DEFAULT_CONFIG,
  loadPlanningConfig,
  type PlanningConfig,
} from "./config.ts";
import {
  answerDecision,
  decisionFrontier,
  remapDecisionTree,
  resetDecisionAnswers,
  summarizeDecisions,
  treeIsSettled,
  waitingDecisions,
  type DecisionNodeInput,
} from "./decision-tree.ts";
import { buildExecutionHandoff, progressWidgetLines } from "./handoff.ts";
import {
  INSPECTION_OPERATIONS,
  inspectProject,
  type InspectInput,
} from "./inspect-tool.ts";
import {
  PACKAGE_TOOL_NAMES,
  PLANNING_SAFE_BUILTINS,
  capturePlanningPolicy,
  createExactPermit,
  evaluatePlanningCall,
  executionIdentityMatches,
  isDependencyManifest,
  isKnownExecutionCommand,
  isMutationPathPlanned,
  mutationPathFromInput,
  mutationTargetEscapesProject,
  planningToolNames,
  toolIdentity,
  type PlanningPolicySnapshot,
  type ToolMetadata,
} from "./policy.ts";
import {
  PLANNING_TIERS,
  plannedPaths,
  validatePlanDraft,
  type DecisionAnswer,
  type PlanDraft,
} from "./schema.ts";
import {
  PLANNING_STATE_ENTRY,
  activeToolNames,
  approvePlan,
  beginFreshExecution,
  cancelPlanning,
  confirmSharedUnderstanding,
  consumePermit,
  enterPlanning,
  inactiveState,
  isExecution,
  isPlanning,
  replan,
  restorePlanningState,
  setPermit,
  submitForReview,
  updateStepProgress,
  withCandidate,
  withDecisionTree,
  type ExecutionPosture,
  type PlanningState,
  type StepState,
  type ToolIdentitySnapshot,
} from "./state.ts";

const PACKAGE_TOOL_SET = new Set<string>(PACKAGE_TOOL_NAMES);
const PLAN_COMMAND = /^\/plan(?:\s+|$)/;
const EXTENSION_PATH = fileURLToPath(import.meta.url);

const DecisionOptionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

const DecisionNodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  question: Type.String({ minLength: 8 }),
  description: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  factsReady: Type.Optional(Type.Boolean()),
  factEvidence: Type.Optional(Type.Array(Type.String())),
  options: Type.Array(DecisionOptionSchema, { minItems: 2 }),
  recommendation: Type.String({ minLength: 1 }),
  recommendationRationale: Type.String({ minLength: 8 }),
  impact: Type.String({ minLength: 8 }),
  material: Type.Optional(Type.Boolean()),
});

const PlanTaskSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 4 }),
  what: Type.String({ minLength: 1 }),
  why: Type.String({ minLength: 1 }),
  how: Type.String({ minLength: 1 }),
  files: Type.Array(Type.String(), { minItems: 1 }),
  dependsOn: Type.Array(Type.String()),
  validation: Type.Array(Type.String(), { minItems: 1 }),
});

const PlanDraftSchema = Type.Object({
  title: Type.String({ minLength: 4 }),
  slug: Type.String({ minLength: 1 }),
  tier: StringEnum(PLANNING_TIERS),
  mainIdea: Type.String({ minLength: 1 }),
  outcome: Type.String({ minLength: 1 }),
  acceptanceCriteria: Type.Array(Type.String(), { minItems: 1 }),
  inScope: Type.Array(Type.String()),
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
      acknowledged: Type.Boolean(),
    }),
  ),
  openQuestions: Type.Array(
    Type.Object({
      question: Type.String(),
      blocking: Type.Boolean(),
    }),
  ),
  deepSections: Type.Array(
    Type.Object({
      name: StringEnum([
        "architecture",
        "security",
        "migration",
        "rollout",
        "observability",
        "rollback",
      ] as const),
      content: Type.String(),
    }),
  ),
});

function message(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function currentMetadata(
  pi: ExtensionAPI,
  toolName: string,
): ToolMetadata | undefined {
  const tool = pi
    .getAllTools()
    .find((candidate) => candidate.name === toolName);
  if (!tool) return undefined;
  return {
    name: tool.name,
    sourceInfo: {
      source: tool.sourceInfo.source,
      path: tool.sourceInfo.path,
    },
  };
}

function stateFromSession(ctx: ExtensionContext): PlanningState | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === PLANNING_STATE_ENTRY) {
      return restorePlanningState(entry.data);
    }
  }
  return undefined;
}

function planningReminder(state: PlanningState): string {
  const frontier = decisionFrontier(state.decisionTree);
  const waiting = waitingDecisions(state.decisionTree);
  return `[PLANNING MODE ACTIVE — ${state.phase}]
This is mechanically restricted planning, not implementation.
- Research repository facts yourself. Never ask the user for discoverable facts.
- Map user-owned choices with plan_map_decisions.
- Ask the complete ready frontier with plan_ask_frontier. Every question needs a recommendation and rationale.
- Confirm shared understanding before drafting.
- Every task must include concrete What, Why, How, files/modules, dependencies, and validation.
- Publish only through plan_update; never write the artifact directly.
- Approval is revision-bound and must happen through plan_submit or /planning-approve.

Decision status: ${state.decisionTree.nodes.filter((node) => node.answer).length} settled, ${frontier.length} ready, ${waiting.length} waiting.
Current candidate: ${state.candidate ? `revision ${state.candidate.revision} (${state.candidate.digest.slice(0, 12)})` : "none"}.`;
}

export default function planningExtension(pi: ExtensionAPI): void {
  let state = inactiveState();
  let policy: PlanningPolicySnapshot = { allowed: {} };
  let config: PlanningConfig = DEFAULT_CONFIG;

  function persist(): void {
    pi.appendEntry(PLANNING_STATE_ENTRY, state);
  }

  function packageToolsRemoved(tools: string[]): string[] {
    return tools.filter((name) => !PACKAGE_TOOL_SET.has(name));
  }

  function captureToolIdentities(): ToolIdentitySnapshot[] {
    const active = new Set(packageToolsRemoved(pi.getActiveTools()));
    return pi.getAllTools().flatMap((tool) =>
      active.has(tool.name)
        ? [
            toolIdentity({
              name: tool.name,
              sourceInfo: {
                source: tool.sourceInfo.source,
                path: tool.sourceInfo.path,
              },
            }),
          ]
        : [],
    );
  }

  function activatePlanningTools(): void {
    policy = capturePlanningPolicy(pi.getAllTools(), EXTENSION_PATH);
    pi.setActiveTools(planningToolNames(policy));
  }

  function restoreOriginalTools(executing = false): void {
    const original = packageToolsRemoved(activeToolNames(state));
    pi.setActiveTools(
      executing ? [...new Set([...original, "plan_step_status"])] : original,
    );
  }

  function applyStateTools(ctx: ExtensionContext): void {
    if (state.permit) {
      state = consumePermit(state);
      persist();
    }
    // A fresh-session approval is a locked handoff, not execution in this session.
    // Keep its restricted planning surface until the child calls planning-resume-execution.
    if (isPlanning(state) || state.phase === "approved")
      activatePlanningTools();
    else if (isExecution(state)) restoreOriginalTools(true);
    else pi.setActiveTools(packageToolsRemoved(pi.getActiveTools()));
    updateUi(ctx);
  }

  function updateUi(ctx: ExtensionContext): void {
    if (isPlanning(state)) {
      const settled = state.decisionTree.nodes.filter(
        (node) => node.answer,
      ).length;
      const ready = decisionFrontier(state.decisionTree).length;
      ctx.ui.setStatus(
        "planning-mode",
        `PLAN · ${state.phase}${state.candidate ? ` · r${state.candidate.revision}` : ""}`,
      );
      ctx.ui.setWidget("planning-mode", [
        `${settled}/${state.decisionTree.nodes.length} decisions settled · ${ready} ready`,
        state.artifact
          ? `Plan: ${state.artifact.path}`
          : "Plan artifact: not published",
      ]);
      return;
    }
    if (isExecution(state)) {
      ctx.ui.setStatus(
        "planning-mode",
        `PLAN EXEC · ${state.phase}${state.candidate ? ` · r${state.candidate.revision}` : ""}`,
      );
      const lines = progressWidgetLines(state);
      ctx.ui.setWidget("planning-mode", lines.length > 0 ? lines : undefined);
      return;
    }
    ctx.ui.setStatus("planning-mode", undefined);
    ctx.ui.setWidget("planning-mode", undefined);
  }

  async function enterMode(
    rawInput: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    const request = rawInput.replace(PLAN_COMMAND, "").trim();
    const originalTools =
      isPlanning(state) || isExecution(state)
        ? state.toolsBeforePlanning
        : captureToolIdentities();
    const baseline = await captureBaseline(pi, ctx.cwd);
    state = enterPlanning(request, originalTools, baseline.digest);
    activatePlanningTools();
    persist();
    updateUi(ctx);
    ctx.ui.notify(
      "Planning mode enabled. Source writes, arbitrary shell, and unknown tools are blocked.",
      "info",
    );
  }

  async function currentBaseline(ctx: ExtensionContext): Promise<string> {
    return (await captureBaseline(pi, ctx.cwd, state.artifact?.path)).digest;
  }

  /**
   * Revalidates every approval anchor immediately before the record is persisted so a
   * concurrent artifact edit, revision change, or baseline change cannot be approved.
   */
  async function assertApprovalStillValid(
    ctx: ExtensionContext,
    baseline: string,
  ): Promise<void> {
    if (state.phase !== "reviewing" || !state.candidate || !state.artifact) {
      throw new Error("The plan is no longer in a reviewable state.");
    }
    const validation = validatePlanDraft(state.candidate.draft);
    if (!validation.valid) {
      throw new Error(
        `The candidate is invalid: ${validation.errors.join("; ")}`,
      );
    }
    if (
      state.candidate.digest !==
      digestValue({
        draft: state.candidate.draft,
        decisionTree: state.candidate.decisionTree,
      })
    ) {
      throw new Error(
        "The candidate digest no longer matches its plan content.",
      );
    }
    if (
      digestValue(state.decisionTree) !==
        digestValue(state.candidate.decisionTree) ||
      !treeIsSettled(state.decisionTree) ||
      !state.decisionTree.sharedUnderstanding ||
      state.decisionTree.sharedUnderstanding.treeDigest !==
        digestValue(state.decisionTree.nodes)
    ) {
      throw new Error(
        "The reviewed decision record no longer matches the candidate.",
      );
    }
    if (state.artifact.candidateDigest !== state.candidate.digest) {
      throw new Error(
        "The stored artifact does not belong to the current revision.",
      );
    }
    if (!(await verifyPlanArtifact(state.artifact))) {
      throw new Error(
        "The plan artifact changed during review. Publish a new revision before approval.",
      );
    }
    const current = await currentBaseline(ctx);
    if (current !== baseline) {
      throw new Error(
        "The project changed during approval. Re-investigate and publish a new revision.",
      );
    }
  }

  async function approveCurrent(
    ctx: ExtensionContext,
    posture: Exclude<ExecutionPosture, "fresh-session">,
    source: "review-ui" | "explicit-command",
    baseline: string,
  ): Promise<string> {
    await assertApprovalStillValid(ctx, baseline);
    const approval = createApprovalRecord(
      state,
      baseline,
      ctx.sessionManager.getLeafId() ?? undefined,
      ctx.sessionManager.getSessionId(),
      posture,
      source,
    );
    state = approvePlan(state, approval);
    persist();
    restoreOriginalTools(true);
    updateUi(ctx);
    return buildExecutionHandoff(state);
  }

  async function queueFreshExecution(
    ctx: ExtensionContext,
    baseline: string,
  ): Promise<void> {
    await assertApprovalStillValid(ctx, baseline);
    const approval = createApprovalRecord(
      state,
      baseline,
      ctx.sessionManager.getLeafId() ?? undefined,
      ctx.sessionManager.getSessionId(),
      "fresh-session",
      "review-ui",
    );
    state = approvePlan(state, approval);
    persist();
    updateUi(ctx);
    pi.sendUserMessage(`/planning-fresh ${approval.candidateDigest}`, {
      deliverAs: "followUp",
      expandPromptTemplates: true,
    });
  }

  pi.registerTool({
    name: "plan_inspect",
    label: "Plan Inspect",
    description:
      "Run one schema-driven, read-only project inspection without arbitrary shell syntax.",
    promptSnippet:
      "Inspect Git/package facts through fixed read-only operations",
    parameters: Type.Object({
      operation: StringEnum(INSPECTION_OPERATIONS),
      path: Type.Optional(Type.String()),
      ref: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      staged: Type.Optional(Type.Boolean()),
      command: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isPlanning(state))
        throw new Error("plan_inspect is only available while planning.");
      const output = await inspectProject(
        (command, args, options) => pi.exec(command, args, options),
        ctx.cwd,
        params as InspectInput,
      );
      return message(output, { operation: params.operation });
    },
  });

  pi.registerTool({
    name: "plan_map_decisions",
    label: "Map Plan Decisions",
    description:
      "Create or replace the dependency-aware tree of user-owned decisions. Preserve facts as evidence; do not turn discoverable facts into questions.",
    promptSnippet:
      "Map user decisions and their prerequisites before asking questions",
    parameters: Type.Object({
      nodes: Type.Array(DecisionNodeSchema),
      resetAnswers: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params) {
      if (!isPlanning(state))
        throw new Error("Decision mapping is only available while planning.");
      let tree = remapDecisionTree(
        params.nodes as DecisionNodeInput[],
        state.decisionTree,
      );
      if (params.resetAnswers?.length)
        tree = resetDecisionAnswers(tree, params.resetAnswers);
      state = withDecisionTree(state, tree);
      persist();
      const frontier = decisionFrontier(tree);
      return message(
        `Decision tree mapped: ${tree.nodes.length} nodes, ${frontier.length} ready now, ${waitingDecisions(tree).length} waiting. Ask the complete frontier next.`,
        { frontier: frontier.map((node) => node.id) },
      );
    },
  });

  pi.registerTool({
    name: "plan_ask_frontier",
    label: "Ask Decision Frontier",
    description:
      "Ask every currently ready decision in one round. Each mapped decision already carries options, a recommendation, and rationale.",
    promptSnippet:
      "Ask the whole ready design-tree frontier as one user decision round",
    parameters: Type.Object({
      nodeIds: Type.Array(Type.String(), { minItems: 1 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isPlanning(state))
        throw new Error("Decision rounds are only available while planning.");
      if (!ctx.hasUI)
        throw new Error(
          "Decision grilling requires interactive or RPC UI; Planning mode remains active.",
        );
      const frontier = decisionFrontier(state.decisionTree);
      const expected = frontier.map((node) => node.id).sort();
      const received = [...new Set(params.nodeIds)].sort();
      if (
        expected.length !== received.length ||
        expected.some((id, index) => id !== received[index])
      ) {
        throw new Error(
          `Ask the complete frontier in one round. Expected: ${expected.join(", ") || "<empty>"}.`,
        );
      }

      const roundText = frontier
        .map((node, index) => {
          const recommended =
            node.options.find((option) => option.id === node.recommendation)
              ?.label ?? node.recommendation;
          return `Q${index + 1} — ${node.question}\nRecommended: ${recommended} — ${node.recommendationRationale}`;
        })
        .join("\n\n");
      ctx.ui.notify(
        `Decision frontier (${frontier.length})\n\n${roundText}`,
        "info",
      );

      let tree = state.decisionTree;
      for (let index = 0; index < frontier.length; index += 1) {
        const node = frontier[index];
        if (!node) continue;
        const choices = node.options.map(
          (option) =>
            `${option.id === node.recommendation ? "Recommended · " : ""}${option.label} [${option.id}]`,
        );
        choices.push("Other answer…", "Defer as an acknowledged assumption…");
        const selected = await ctx.ui.select(
          `Q${index + 1}/${frontier.length}: ${node.question}\nRecommendation: ${node.recommendationRationale}`,
          choices,
        );
        if (!selected)
          throw new Error("Decision round cancelled; no answers were saved.");

        let answer: DecisionAnswer;
        if (selected === "Other answer…") {
          const custom = await ctx.ui.input(
            "Custom decision",
            "State the decision and any important rationale",
          );
          if (!custom?.trim())
            throw new Error("Decision round cancelled; no answers were saved.");
          answer = {
            value: custom.trim(),
            label: custom.trim(),
            kind: "custom",
            answeredAt: new Date().toISOString(),
          };
        } else if (selected === "Defer as an acknowledged assumption…") {
          const assumption = await ctx.ui.input(
            "Acknowledged assumption",
            "State the temporary assumption and impact",
          );
          if (!assumption?.trim())
            throw new Error("Decision round cancelled; no answers were saved.");
          answer = {
            value: assumption.trim(),
            label: assumption.trim(),
            kind: "assumption",
            answeredAt: new Date().toISOString(),
          };
        } else {
          const option = node.options.find((candidate) =>
            selected.endsWith(`[${candidate.id}]`),
          );
          if (!option)
            throw new Error(
              `Could not resolve the selected answer for ${node.id}.`,
            );
          answer = {
            value: option.id,
            label: option.label,
            kind: "option",
            answeredAt: new Date().toISOString(),
          };
        }
        tree = answerDecision(tree, node.id, answer);
      }

      state = withDecisionTree(state, tree);
      persist();
      const next = decisionFrontier(tree);
      return message(
        next.length > 0
          ? `Round saved. Next frontier: ${next.map((node) => node.id).join(", ")}.`
          : waitingDecisions(tree).length > 0
            ? `Round saved. No decisions are ready; ${waitingDecisions(tree).length} depend on unsettled facts or prerequisites.`
            : "Round saved. The decision tree is settled; call plan_confirm_understanding.",
        { nextFrontier: next.map((node) => node.id) },
      );
    },
  });

  pi.registerTool({
    name: "plan_confirm_understanding",
    label: "Confirm Shared Understanding",
    description:
      "Show the settled decision summary to the user and record explicit shared understanding.",
    parameters: Type.Object({ summary: Type.String({ minLength: 8 }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isPlanning(state))
        throw new Error("Understanding can only be confirmed while planning.");
      if (!treeIsSettled(state.decisionTree))
        throw new Error(
          "All material decision branches must be settled first.",
        );
      if (!ctx.hasUI)
        throw new Error(
          "Shared-understanding confirmation requires interactive or RPC UI.",
        );
      const decisionSummary = summarizeDecisions(state.decisionTree);
      const confirmed = await ctx.ui.confirm(
        "Shared understanding reached?",
        `${params.summary}\n\n${decisionSummary}\n\nConfirm that this captures the decisions and assumptions needed to draft the plan.`,
      );
      if (!confirmed)
        return message(
          "Not confirmed. Remain in decision grilling and reshape the tree or summary.",
        );
      const treeDigest = digestValue(state.decisionTree.nodes);
      state = confirmSharedUnderstanding(state, params.summary, treeDigest);
      persist();
      updateUi(ctx);
      return message(
        "Shared understanding confirmed. Draft the complete plan with plan_update.",
        { treeDigest },
      );
    },
  });

  pi.registerTool({
    name: "plan_request_exception",
    label: "Request Exact Plan Exception",
    description:
      "Request one short-lived, single-use permit for an exact tool call needed as planning evidence. This does not approve the plan.",
    parameters: Type.Object({
      toolName: Type.String({ minLength: 1 }),
      inputJson: Type.String({ minLength: 2 }),
      reason: Type.String({ minLength: 8 }),
      expectedEffects: Type.String({ minLength: 4 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isPlanning(state))
        throw new Error("Exact exceptions are only available while planning.");
      if (!config.allowExactExceptions)
        throw new Error(
          "Exact planning exceptions are disabled by configuration.",
        );
      if (!ctx.hasUI)
        throw new Error("Exact exceptions require direct user confirmation.");
      if (PACKAGE_TOOL_SET.has(params.toolName))
        throw new Error(
          "Planning lifecycle tools cannot receive exception permits.",
        );
      const permitMetadata = currentMetadata(pi, params.toolName);
      if (!permitMetadata) throw new Error(`Unknown tool ${params.toolName}.`);
      let input: unknown;
      try {
        input = JSON.parse(params.inputJson);
      } catch {
        throw new Error(
          "inputJson must be valid JSON for the exact retry call.",
        );
      }
      const confirmed = await ctx.ui.confirm(
        `Allow one exact ${params.toolName} call?`,
        `Reason: ${params.reason}\nExpected effects: ${params.expectedEffects}\nArguments: ${JSON.stringify(input)}\n\nThis permit is consumed once, expires in five minutes, and does not approve the plan.`,
      );
      if (!confirmed)
        return message("Exception denied. Planning mode remains active.");
      const permit = createExactPermit(
        permitMetadata,
        input,
        params.reason,
        params.expectedEffects,
        ctx.cwd,
        state.candidate?.digest ?? null,
      );
      state = setPermit(state, permit);
      pi.setActiveTools([
        ...new Set([...pi.getActiveTools(), params.toolName]),
      ]);
      persist();
      return message(
        `One exact ${params.toolName} call permitted until ${permit.expiresAt}. Retry it with identical arguments.`,
        {
          inputDigest: permit.inputDigest,
        },
      );
    },
  });

  pi.registerTool({
    name: "plan_update",
    label: "Publish Plan Revision",
    description:
      "Validate and publish a complete replacement plan revision. Every task requires concrete What, Why, How, affected paths, dependencies, and validation.",
    promptSnippet:
      "Publish the complete typed plan through the renderer-owned HTML artifact",
    parameters: PlanDraftSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isPlanning(state))
        throw new Error("Plan revisions can only be published while planning.");
      const shared = state.decisionTree.sharedUnderstanding;
      if (
        !shared ||
        shared.treeDigest !== digestValue(state.decisionTree.nodes)
      ) {
        throw new Error(
          "The current decision tree needs explicit shared-understanding confirmation.",
        );
      }
      const draft = params as PlanDraft;
      const validation = validatePlanDraft(draft);
      if (!validation.valid)
        throw new Error(
          `Plan candidate rejected:\n- ${validation.errors.join("\n- ")}`,
        );
      const revision = (state.candidate?.revision ?? 0) + 1;
      const candidate: PlanCandidate = createCandidate(
        draft,
        state.decisionTree,
        revision,
      );
      const target = resolve(
        ctx.cwd,
        config.artifactDirectory,
        `${draft.slug}.html`,
      );
      const artifact = await withFileMutationQueue(target, () =>
        writePlanArtifact(ctx.cwd, config.artifactDirectory, candidate),
      );
      state = withCandidate(state, candidate, artifact);
      persist();
      updateUi(ctx);
      return message(
        `Published plan revision ${revision} to ${artifact.path}. Digest: ${candidate.digest}. Review the rendered artifact, then call plan_submit.`,
        { revision, digest: candidate.digest, artifact: artifact.path },
      );
    },
  });

  pi.registerTool({
    name: "plan_submit",
    label: "Submit Plan for Review",
    description:
      "Freeze the current revision, verify its artifact and baseline, then request direct user review and approval.",
    promptSnippet:
      "Request revision-bound review only after the complete plan is ready",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!isPlanning(state))
        throw new Error("Only a planning candidate can be submitted.");
      if (!state.candidate || !state.artifact)
        throw new Error("Publish a candidate with plan_update first.");
      const candidate = state.candidate;
      const artifact = state.artifact;
      if (
        !treeIsSettled(state.decisionTree) ||
        !state.decisionTree.sharedUnderstanding
      ) {
        throw new Error(
          "The decision frontier must be empty and shared understanding confirmed.",
        );
      }
      const validation = validatePlanDraft(candidate.draft);
      if (!validation.valid)
        throw new Error(
          `Candidate is no longer valid:\n- ${validation.errors.join("\n- ")}`,
        );
      if (!(await verifyPlanArtifact(artifact))) {
        throw new Error(
          "The plan artifact changed or is missing. Publish a new revision before approval.",
        );
      }
      state = submitForReview(state);
      persist();
      updateUi(ctx);

      if (!ctx.hasUI) {
        return {
          ...message(
            `Approval required for ${candidate.digest}. Run /planning-approve ${candidate.digest} guarded in an interactive session.`,
          ),
          terminate: true,
        };
      }

      const choice = await ctx.ui.select(
        `Review ${artifact.path} · revision ${candidate.revision}`,
        [
          "Approve · guarded here (recommended)",
          "Approve · review every mutation",
          "Approve · fresh execution session",
          "Edit / request changes",
          "Stay in Planning mode",
          "Cancel Planning mode",
        ],
      );
      if (!choice || choice === "Stay in Planning mode")
        return message(
          "No approval recorded. Planning restrictions remain active.",
        );
      if (choice === "Cancel Planning mode") {
        state = cancelPlanning(state);
        persist();
        restoreOriginalTools(false);
        updateUi(ctx);
        return {
          ...message("Planning mode cancelled. No implementation started."),
          terminate: true,
        };
      }
      if (choice === "Edit / request changes") {
        const feedback = await ctx.ui.editor("Plan revision feedback", "");
        if (feedback?.trim())
          pi.sendUserMessage(feedback.trim(), { deliverAs: "followUp" });
        state = { ...state, phase: "drafting" };
        persist();
        updateUi(ctx);
        return {
          ...message(
            "Feedback queued. Publish a complete replacement revision before requesting approval again.",
          ),
          terminate: true,
        };
      }

      const baseline = await currentBaseline(ctx);
      if (state.baseline && baseline !== state.baseline) {
        const acceptDrift = await ctx.ui.confirm(
          "Project changed during planning",
          "The project baseline no longer matches entry. Approve this exact plan against the current baseline anyway?",
        );
        if (!acceptDrift)
          return {
            ...message(
              "Approval stopped because the project baseline drifted. Re-investigate and publish a new revision.",
            ),
            terminate: true,
          };
      }

      if (choice === "Approve · fresh execution session") {
        await queueFreshExecution(ctx, baseline);
        return {
          ...message(
            "Fresh-session approval recorded. Queued the revision-bound session handoff.",
          ),
          terminate: true,
        };
      }
      const posture =
        choice === "Approve · review every mutation"
          ? "review-every-mutation"
          : "guarded";
      return message(
        await approveCurrent(ctx, posture, "review-ui", baseline),
        {
          approved: true,
          posture,
        },
      );
    },
  });

  pi.registerTool({
    name: "plan_step_status",
    label: "Plan Step Status",
    description:
      "Update one approved task's execution state. Completed tasks require concrete evidence.",
    promptSnippet:
      "Track approved plan execution using stable task IDs and evidence",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      state: StringEnum([
        "pending",
        "active",
        "blocked",
        "skipped",
        "completed",
      ] as const),
      evidence: Type.Array(Type.String()),
      blocker: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      state = updateStepProgress(
        state,
        params.taskId,
        params.state as StepState,
        params.evidence,
        params.blocker,
      );
      persist();
      updateUi(ctx);
      return message(`Task ${params.taskId} is now ${params.state}.`, {
        progress: state.progress,
        phase: state.phase,
      });
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "extension" && PLAN_COMMAND.test(event.text)) {
      await enterMode(event.text, ctx);
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", async () => {
    if (isPlanning(state)) {
      return {
        message: {
          customType: "planning-mode-context",
          content: planningReminder(state),
          display: false,
        },
      };
    }
    if (
      (state.phase === "executing" || state.phase === "blocked") &&
      state.approval
    ) {
      return {
        message: {
          customType: "planning-execution-context",
          content: buildExecutionHandoff(state),
          display: false,
        },
      };
    }
    if (state.phase === "completed") {
      return {
        message: {
          customType: "planning-execution-context",
          content:
            "[APPROVED PLAN COMPLETE]\nDo not make further changes under the completed approval. Summarize implemented tasks, validation evidence, deviations, and residual risks. The user may start a new request or run /planning-cancel to return to normal mode.",
          display: false,
        },
      };
    }
  });

  pi.on("context", async (event) => {
    const contextTypes = new Set([
      "planning-mode-context",
      "planning-execution-context",
    ]);
    let latestContextIndex = -1;
    if (isPlanning(state) || isExecution(state)) {
      for (let index = event.messages.length - 1; index >= 0; index -= 1) {
        const candidate = event.messages[index] as
          | { customType?: string }
          | undefined;
        if (candidate?.customType && contextTypes.has(candidate.customType)) {
          latestContextIndex = index;
          break;
        }
      }
    }
    return {
      messages: event.messages.filter((entry, index) => {
        const candidate = entry as { customType?: string };
        return (
          !candidate.customType ||
          !contextTypes.has(candidate.customType) ||
          index === latestContextIndex
        );
      }),
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isPlanning(state)) {
      const decision = evaluatePlanningCall(
        state,
        policy,
        currentMetadata(pi, event.toolName),
        event.toolName,
        event.input,
        ctx.cwd,
      );
      if (!decision.allowed)
        return decision.reason
          ? { block: true, reason: decision.reason }
          : { block: true };
      if (decision.consumePermit) {
        state = consumePermit(state);
        persist();
        activatePlanningTools();
      }
      return;
    }

    if (state.phase === "approved") {
      return {
        block: true,
        reason:
          "Fresh-session approval is locked pending its verified execution handoff; this session cannot run tools.",
      };
    }
    if (
      state.phase !== "executing" &&
      state.phase !== "blocked" &&
      state.phase !== "completed"
    )
      return;
    const metadata = currentMetadata(pi, event.toolName);
    if (event.toolName === "plan_step_status") {
      return executionIdentityMatches(
        [{ name: "plan_step_status", source: "cli", path: EXTENSION_PATH }],
        metadata,
        event.toolName,
      ) || resolve(metadata?.sourceInfo?.path ?? "") === resolve(EXTENSION_PATH)
        ? undefined
        : {
            block: true,
            reason: "plan_step_status provenance does not match this package.",
          };
    }
    const isTrustedReadOnly =
      (PLANNING_SAFE_BUILTINS as readonly string[]).includes(event.toolName) &&
      metadata?.sourceInfo?.source === "builtin" &&
      executionIdentityMatches(
        state.toolsBeforePlanning,
        metadata,
        event.toolName,
      );
    if (isTrustedReadOnly) return;
    if (state.phase === "completed") {
      return {
        block: true,
        reason:
          "The approved plan is complete; further mutation requires a new request or explicit mode cancellation.",
      };
    }

    const posture = state.approval?.posture;
    const mutationPath = mutationPathFromInput(event.toolName, event.input);
    if (mutationPath) {
      if (
        !executionIdentityMatches(
          state.toolsBeforePlanning,
          metadata,
          event.toolName,
        )
      ) {
        return {
          block: true,
          reason: `Guarded execution blocked ${event.toolName}: tool provenance changed since the plan was approved.`,
        };
      }
      if (await mutationTargetEscapesProject(ctx.cwd, mutationPath)) {
        return {
          block: true,
          reason: `Guarded execution blocked ${mutationPath}: the resolved target is a symlink or lies outside the project.`,
        };
      }
      const paths = state.candidate ? plannedPaths(state.candidate.draft) : [];
      const dependencyChange =
        config.askOnDependencyChange && isDependencyManifest(mutationPath);
      const withinPlan =
        isMutationPathPlanned(ctx.cwd, paths, mutationPath) &&
        !dependencyChange;
      if (posture === "review-every-mutation" || !withinPlan) {
        if (!ctx.hasUI)
          return {
            block: true,
            reason: `Guarded execution blocked mutation of ${mutationPath}; direct review is unavailable.`,
          };
        const action = await ctx.ui.select(
          dependencyChange
            ? `Dependency manifest change: ${mutationPath}`
            : withinPlan
              ? `Review planned mutation: ${mutationPath}`
              : `Out-of-plan mutation: ${mutationPath}`,
          ["Allow this call once", "Return to Planning mode", "Block"],
        );
        if (action === "Allow this call once") return;
        if (action === "Return to Planning mode") {
          state = replan(state);
          activatePlanningTools();
          persist();
          updateUi(ctx);
          return {
            block: true,
            reason: "Returned to Planning mode. Revise and reapprove the plan.",
          };
        }
        return {
          block: true,
          reason: `Mutation blocked: ${mutationPath} is not approved for this call.`,
        };
      }
      return;
    }

    if (event.toolName === "bash" || event.toolName === "powershell") {
      const command = (event.input as { command?: unknown }).command;
      const trustedShell = executionIdentityMatches(
        state.toolsBeforePlanning,
        metadata,
        event.toolName,
      );
      const mustAsk =
        posture === "review-every-mutation" ||
        !trustedShell ||
        typeof command !== "string" ||
        !isKnownExecutionCommand(command);
      if (!mustAsk) return;
      if (!ctx.hasUI)
        return {
          block: true,
          reason:
            "Guarded execution requires direct confirmation for this shell command.",
        };
      const approved = await ctx.ui.confirm(
        "Approve execution command?",
        typeof command === "string" ? command : JSON.stringify(event.input),
      );
      if (!approved)
        return { block: true, reason: "Execution command was not approved." };
      return;
    }

    if (!ctx.hasUI)
      return {
        block: true,
        reason: `Guarded execution cannot classify ${event.toolName}; direct review is unavailable.`,
      };
    const approved = await ctx.ui.confirm(
      `Allow unclassified tool ${event.toolName}?`,
      `Arguments: ${JSON.stringify(event.input)}\n\nThe tool is outside the package's built-in mutation classification.`,
    );
    if (!approved)
      return {
        block: true,
        reason: `Unclassified tool ${event.toolName} was not approved.`,
      };
  });

  pi.registerCommand("planning-status", {
    description:
      "Show planning lifecycle, decision, artifact, and execution status",
    handler: async (_args, ctx) => {
      const settled = state.decisionTree.nodes.filter(
        (node) => node.answer,
      ).length;
      ctx.ui.notify(
        `Phase: ${state.phase}\nRequest: ${state.request ?? "(none)"}\nDecisions: ${settled}/${state.decisionTree.nodes.length}\nCandidate: ${state.candidate ? `r${state.candidate.revision} ${state.candidate.digest}` : "none"}\nArtifact: ${state.artifact?.path ?? "none"}`,
        "info",
      );
    },
  });

  pi.registerCommand("planning-review", {
    description: "Return the current candidate to the model for direct review",
    handler: async (_args, ctx) => {
      if (!isPlanning(state) || !state.candidate) {
        ctx.ui.notify(
          state.candidate
            ? "Execution must return through /planning-replan before review."
            : "No plan candidate is available.",
          "warning",
        );
        return;
      }
      state = { ...state, phase: "reviewing" };
      persist();
      updateUi(ctx);
      pi.sendUserMessage(
        "Review the current plan artifact and call plan_submit when it is ready for my decision.",
      );
    },
  });

  pi.registerCommand("planning-approve", {
    description:
      "Approve an exact plan revision: /planning-approve <digest> [guarded|review|fresh]",
    handler: async (args, ctx) => {
      const [digest, mode = "guarded"] = args.trim().split(/\s+/);
      if (mode !== "guarded" && mode !== "review" && mode !== "fresh") {
        ctx.ui.notify(
          "Approval mode must be guarded, review, or fresh.",
          "error",
        );
        return;
      }
      if (!digest || state.candidate?.digest !== digest || !state.artifact) {
        ctx.ui.notify(
          "Approval digest does not match the current candidate.",
          "error",
        );
        return;
      }
      const artifact = state.artifact;
      if (state.phase !== "reviewing") state = submitForReview(state);
      if (!(await verifyPlanArtifact(artifact))) {
        ctx.ui.notify(
          "Plan artifact changed or is missing. Publish a new revision.",
          "error",
        );
        return;
      }
      const baseline = await currentBaseline(ctx);
      if (state.baseline && baseline !== state.baseline) {
        ctx.ui.notify(
          "Project baseline changed after Planning mode started. Re-investigate and publish a new revision, or use the interactive plan_submit review to acknowledge the drift.",
          "error",
        );
        return;
      }
      try {
        if (mode === "fresh") {
          await assertApprovalStillValid(ctx, baseline);
          const approval = createApprovalRecord(
            state,
            baseline,
            ctx.sessionManager.getLeafId() ?? undefined,
            ctx.sessionManager.getSessionId(),
            "fresh-session",
            "explicit-command",
          );
          state = approvePlan(state, approval);
          persist();
          await startFreshSession(ctx, digest);
          return;
        }
        const posture = mode === "review" ? "review-every-mutation" : "guarded";
        const handoff = await approveCurrent(
          ctx,
          posture,
          "explicit-command",
          baseline,
        );
        pi.sendMessage(
          { customType: "planning-approved", content: handoff, display: true },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  async function startFreshSession(
    ctx: ExtensionCommandContext,
    digest: string,
  ): Promise<void> {
    if (
      state.phase !== "approved" ||
      state.approval?.posture !== "fresh-session" ||
      state.candidate?.digest !== digest
    ) {
      ctx.ui.notify(
        "Fresh-session handoff is not approved for this revision.",
        "error",
      );
      return;
    }
    const nextState = beginFreshExecution(state);
    const handoff = buildExecutionHandoff(nextState);
    const parentSession = ctx.sessionManager.getSessionFile();
    const result = await ctx.newSession({
      ...(parentSession ? { parentSession } : {}),
      setup: async (sessionManager) => {
        sessionManager.appendCustomEntry(PLANNING_STATE_ENTRY, nextState);
        sessionManager.appendCustomMessageEntry(
          "planning-execution-context",
          handoff,
          true,
          {
            candidateDigest: digest,
          },
        );
      },
      withSession: async (replacement) => {
        await replacement.sendUserMessage(
          `/planning-resume-execution ${digest}`,
          { expandPromptTemplates: true },
        );
        await replacement.sendUserMessage(
          "Begin executing the approved plan. Start with the first dependency-ready task.",
        );
      },
    });
    if (result.cancelled)
      ctx.ui.notify(
        "Fresh-session handoff was cancelled; the approved plan remains locked.",
        "warning",
      );
  }

  pi.registerCommand("planning-fresh", {
    description: "Internal revision-bound fresh-session handoff",
    handler: async (args, ctx) => startFreshSession(ctx, args.trim()),
  });

  pi.registerCommand("planning-resume-execution", {
    description:
      "Internal restoration step for a revision-bound fresh execution session",
    handler: async (args, ctx) => {
      const restored = stateFromSession(ctx);
      const digest = args.trim();
      if (
        !restored ||
        restored.phase !== "executing" ||
        restored.approval?.posture !== "fresh-session" ||
        restored.candidate?.digest !== digest
      ) {
        ctx.ui.notify(
          "Fresh execution state could not be verified. No execution permissions were restored.",
          "error",
        );
        return;
      }
      state = restored;
      restoreOriginalTools(true);
      updateUi(ctx);
      ctx.ui.notify(
        `Fresh execution restored for plan ${digest.slice(0, 12)}.`,
        "info",
      );
    },
  });

  pi.registerCommand("planning-cancel", {
    description:
      "Cancel planning or approved execution and restore the original tool set",
    handler: async (_args, ctx) => {
      if (!isPlanning(state) && !isExecution(state)) {
        ctx.ui.notify(
          "No active planning or execution session to cancel.",
          "info",
        );
        return;
      }
      state = cancelPlanning(state);
      persist();
      restoreOriginalTools(false);
      updateUi(ctx);
      ctx.ui.notify(
        "Planning mode cancelled. Original tools restored.",
        "info",
      );
    },
  });

  pi.registerCommand("planning-replan", {
    description:
      "Return approved execution to restricted planning and invalidate approval",
    handler: async (_args, ctx) => {
      try {
        state = replan(state);
        activatePlanningTools();
        persist();
        updateUi(ctx);
        ctx.ui.notify(
          "Returned to Planning mode. Publish and approve a new complete revision.",
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      config = await loadPlanningConfig(ctx.cwd, ctx.isProjectTrusted());
    } catch (error) {
      config = DEFAULT_CONFIG;
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "warning",
      );
    }
    state = stateFromSession(ctx) ?? inactiveState();
    applyStateTools(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    state = stateFromSession(ctx) ?? inactiveState();
    applyStateTools(ctx);
  });

  pi.on("session_shutdown", async () => {
    if (state.permit) {
      state = consumePermit(state);
      persist();
    }
  });
}
