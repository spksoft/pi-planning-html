import { renderPlanMarkdown } from "./artifact.ts";
import type { PlanningState } from "./state.ts";

export function buildExecutionHandoff(state: PlanningState): string {
  if (!state.candidate || !state.approval)
    throw new Error("Execution handoff requires an approved candidate.");
  const paths = [
    ...new Set(state.candidate.draft.tasks.flatMap((task) => task.files)),
  ];
  return `[APPROVED PLAN — EXECUTION CONTRACT]
Plan revision: ${state.candidate.revision}
Plan digest: ${state.candidate.digest}
Execution posture: ${state.approval.posture}
Artifact: ${state.approval.artifactPath}

Implement only the approved snapshot below. Follow applicable AGENTS.md files. Execute tasks in dependency order. Use plan_step_status for active, blocked, skipped, and completed states; completion requires evidence. If implementation needs a path or material behavior outside this plan, stop and request a deviation decision instead of widening scope silently.

Planned mutation paths:
${paths.length > 0 ? paths.map((path) => `- ${path}`).join("\n") : "- No concrete paths were known; every mutation requires direct review."}

${renderPlanMarkdown(state.candidate)}`;
}

export function progressWidgetLines(state: PlanningState): string[] {
  if (!state.candidate || state.progress.length === 0) return [];
  const title = `Approved plan r${state.candidate.revision} · ${state.phase}`;
  return [
    title,
    ...state.progress.map((item) => {
      const marker =
        item.state === "completed"
          ? "✓"
          : item.state === "active"
            ? "▶"
            : item.state === "blocked"
              ? "!"
              : item.state === "skipped"
                ? "−"
                : "○";
      const task = state.candidate?.draft.tasks.find(
        (candidateTask) => candidateTask.id === item.taskId,
      );
      return `${marker} ${item.taskId} ${task?.title ?? ""}`.trimEnd();
    }),
  ];
}
