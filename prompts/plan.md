---
description: Research a request and publish one detailed HTML implementation plan
argument-hint: "<request>"
---

# Plan only

Create a detailed, implementation-ready plan for this request:

$@

This command is **planning only**. Do not implement the request, edit project source files, run migrations, install dependencies, commit, or start execution. The final outcome is exactly one generated HTML plan artifact, published with `plan_publish`.

## Evidence and precision rules

- Treat the current repository, project instructions, source, tests, commands, and configuration as the source of truth. Read them before making repository-specific claims.
- Mark facts through the plan's structured evidence: `repo`, `user`, or `external`, plus a source pointer and confidence. Existing paths/modules must be `observed` and cite repository evidence. New paths/modules must be `proposed`; never present a proposed filename, line number, API, version, target, or dependency as an observed fact.
- Earn detail from evidence. Do not use empty adjectives such as “robust”, “fast”, “intuitive”, “secure”, or “production-ready” as acceptance criteria. State observable behavior, an oracle, and expected evidence instead.
- Do not invent numeric goals. Use a user decision, source, existing baseline, or a measurement task when a threshold is necessary.

## Process

1. **Orient.** Read applicable instructions and restate the bounded destination: user value, observable outcome, in-scope work, explicit non-goals, and constraints. Ask about destination only if it is materially ambiguous.
2. **Inspect.** Investigate manifests/configuration, relevant modules, call sites, contracts, tests, docs/ADRs, analogous implementations, and validation commands. Record repository evidence before asking for facts that tools can discover.
3. **Coverage scan.** Classify scope, actors, data/lifecycle, UX states, integrations/failures, security/privacy, performance/reliability, compatibility/migration, observability, terminology, and completion signals as clear, partial, missing, or not applicable.
4. **Clarify.** Use the internal wayfinding workflow below to resolve only material user-owned decisions.
5. **Design.** Record meaningful decisions, interfaces/contracts, data changes, compatibility, risks, rollout/rollback, test seams, and architecture. Reuse established repository patterns unless evidence justifies divergence.
6. **Decompose.** Build dependency-aware executable tasks and detailed decomposition subtasks. Prefer independently verifiable vertical slices. For migrations/refactors, explicitly cover compatibility, rollout/backfill, rollback, and final contraction where relevant.
7. **Audit.** Before publishing, check traceability, contradictions, unsupported specifics, stale assumptions, scope creep, and validation feasibility. Publish only if every known requirement can be implemented and proven.
8. Call `plan_publish` once with the complete plan. Do not use generic write/edit tools to create the plan.

## Built-in wayfinding workflow

This is a single-session adaptation of Wayfinder's destination, fog, and frontier model. It is part of `/plan`, not a separately exposed skill or issue-tracker workflow. Do not create tracker issues, local map files, prototypes, or product changes. The only durable output is the final HTML plan and its canonical Markdown payload.

1. **Name the destination first.** State the bounded end-to-end outcome and scope boundary before mapping decisions. Do not ask for ceremonial confirmation of an already explicit request.
2. **Chart uncertainty, not build steps.** Keep a compact internal map of:
   - **Decisions so far** — settled choices and their user answer or evidence;
   - **Fog** — visible uncertainty that cannot yet be stated precisely;
   - **Frontier** — precise open questions whose prerequisites are settled;
   - **Out of scope** — work beyond the destination.
   Frontier entries must be questions, never implementation slices.
3. **Classify the frontier.** `grilling` (HITL) is a material product/behavior/trade-off/policy choice owned by the user. `research` (AFK) is discoverable through repository inspection, documentation, or factual research. `prototype` is HITL only when existing evidence cannot establish intended behavior. Never perform prototypes or implementation tasks while planning.
4. **Burn down agent-owned questions first.** Research facts; do not ask users for discoverable paths, versions, or behavior. Use subagents only for independent, bounded research when available.
5. **Ask only material user questions.** The first `plan_question` call opens a native language selector with **English (default)** and a free-text language option. It returns the selected language without showing the supplied material question; immediately reissue that question and every later question, options, recommendation, and rationale in the selected language. Then ask one currently unblocked `grilling` question at a time with `plan_question`, and recompute the map before asking another. Prefix it with a stable `Q<number>` label; explain why it matters; provide a recommendation and rationale; provide 2–5 mutually exclusive concrete options. `plan_question` always adds free text and the reserved **Skip all remaining questions and apply your best judgment** choice, so do not include either yourself.
6. **Handle skip responsibly.** When skip-all is selected, stop questioning. Resolve remaining consequential choices with evidence-backed judgment and publish them as `provisional` decisions and/or assumptions with provenance, resolution point, and fallback.
7. **Advance the frontier incrementally.** Keep dependent questions blocked. Promote fog only when it becomes precise. Remove or rewrite questions invalidated by a settled answer. Do not create speculative downstream tasks to make a plan look complete.
8. **Clear the map.** No blocking fog or frontier item may remain. If there is material uncertainty, either resolve it or represent it as a non-blocking deferred unknown with impact, owner, resolution point, and fallback. Do not request a final confirmation after skip-all.

## Required published plan shape

Supply every field required by `plan_publish`. In particular, the plan must include:

- **Repository evidence** with stable IDs, claims, sources, confidence, and notes.
- **Requirements** (`REQ-*`) that state observable behavior, rationale, priority, and evidence IDs.
- **Acceptance criteria** (`AC-*`) linked to requirements, with precondition, action, observable outcome, edge/failure case, and validation IDs.
- **Decisions** (`DEC-*`) for consequential choices: context, choice, evidence/rationale, consequences, reversibility, affected modules, status, and alternatives for hard-to-reverse choices. A user choice is not an assumption and must not disappear after questioning.
- **Findings** linked to evidence IDs.
- **Architecture** as a concise summary plus typed actor, component, store/external nodes and directional interactions. Name responsibilities and related task IDs. Do not supply Mermaid, raw SVG, HTML, or a freehand diagram; the renderer generates safe, synchronized diagrams.
- **Executable tasks** with stable IDs and task-level dependencies only. Each task has kind, requirement/acceptance/decision links, detailed What/Why/How, expected behavior, parallel-safety guidance, observed/proposed file references, validation IDs, and foundation targets when applicable. A foundation task must be a dependency of every task it enables.
- **Detailed decomposition subtasks** inside each task. They contain What/Why/How, file references, and validation IDs, but are not separately executable dependency nodes. Never invent an implicit parent/subtask dependency in prose or Markdown.
- **Validations** (`VAL-*`) with level, exact command or manual procedure, preconditions, expected evidence, and covered acceptance IDs. Name one or more end-to-end validation IDs.
- **Risks, assumptions, and unknowns.** Assumptions need confidence, provenance, impact if false, resolution point, and fallback. Deferred unknowns need a severity, impact, owner, resolution point, trigger, fallback, and evidence IDs. A high-severity deferral requires explicit user-approval evidence; anything blocking correctness, public contracts, data safety, compliance, or acceptance evidence must block publication.
- **Engineering considerations** for architecture, security, data/migrations, testing, rollout/rollback, observability, and performance/accessibility. If an area is not applicable, explain why; do not write only “N/A”.

## Pre-publication coverage audit

Before calling `plan_publish`, verify all of the following and correct the plan rather than describing a gap away:

1. Every `REQ-*` has an `AC-*`; every `AC-*` has a `VAL-*`; every `AC-*` is implemented by a task; every validation has expected evidence.
2. Every implementation task links to a requirement or acceptance criterion. Every task/subtask has precise What, Why, How, files/modules, and validation.
3. Every existing file/module claim has repository evidence and identifies a current project-relative seam that will pass the publish-time repository audit. Proposed files are labeled proposed. No unsupported line numbers, commands, paths, versions, or thresholds remain.
4. Dependencies are exact task IDs, acyclic, and reflect executable ordering. No task is duplicated by a subtask.
5. Hard-to-reverse architecture/data/security decisions include alternatives. The architecture nodes/edges, task dependency map, HTML sections, and Markdown will all derive from the same structured data.
6. Scope is not contradictory; all blocking questions are resolved; every deferred unknown has an owner, trigger, and fallback.
7. Validation commands/procedures are believable for the inspected repository and include expected evidence. The end-to-end gate covers the outcome.

After `plan_publish` succeeds, stop. Do not offer to execute the plan and do not implement any task. Execution is a separate explicit command:

```text
/execute-plan [planning-file]
```
