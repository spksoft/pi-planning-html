---
description: Research a request and publish one detailed HTML implementation plan
argument-hint: "<request>"
---

# Plan only

Create a detailed implementation plan for this request:

$@

This command is **planning only**. Do not implement the request, edit project source files, run migrations, install dependencies, commit, or start execution. The final outcome of this `/plan` run is exactly one generated HTML plan artifact, published with `plan_publish`.

## Process

1. Read applicable project instructions and investigate the repository. Discover facts yourself instead of asking the user for paths, versions, or current behavior that tools can reveal.
2. Establish a bounded destination for the plan, then use the built-in wayfinding workflow below to clear material uncertainty before writing implementation tasks. `plan_question` uses Pi's native selection/input UI. Do not build or simulate a separate question display.
3. Preserve explicit user constraints. State assumptions and non-blocking open questions plainly. Resolve every question that blocks an implementable plan before publishing.

### Built-in wayfinding workflow

This is a single-session adaptation of Wayfinder's destination, fog, and frontier model. It is part of `/plan`, not a separately exposed skill or issue-tracker workflow. Keep its map transient in the conversation: do not create tracker issues, local map files, prototypes, or product changes. The only durable output of `/plan` is the final HTML plan.

1. **Name the destination first.** State the bounded, end-to-end outcome that the implementation plan must reach and the scope boundary around it before mapping decisions. Derive it from the request and repository evidence when possible. If materially ambiguous, make destination scope the first user-owned decision; do not ask for ceremonial confirmation of an already explicit request.
2. **Chart the uncertainty, not the build.** Maintain a compact working map with:
   - **Decisions so far** — settled choices and the user answer or evidence supporting each one;
   - **Fog** — uncertainty toward the destination that is visible but cannot yet be phrased as a precise question;
   - **Frontier** — precise, open questions whose prerequisites are settled;
   - **Out of scope** — work explicitly beyond the destination.
   Every frontier item must read as a question whose answer removes uncertainty. Never put implementation slices such as “build X” on this map.
3. **Classify each frontier question before resolving it.** Use the Wayfinder ticket types only as internal reasoning labels:
   - `grilling` (HITL) for a material product, behavior, trade-off, or policy choice owned by the user;
   - `prototype` (HITL) when discussion alone cannot answer how something should look or behave;
   - `research` (AFK) when repository inspection, documentation, web research, or another factual source can answer it;
   - `task` (AFK or HITL) only for non-product prerequisite work that reveals information, never for delivering part of the destination.
   Facts are the agent's responsibility. A `task` that resembles an implementation step is misclassified and belongs only in the final plan.
4. **Burn down agent-owned questions first.** Resolve `research` questions with available tools and use subagents only for independent, bounded research when available. Do not ask the user for discoverable facts. Planning-only mode must not execute `prototype` or `task` work; if one is essential, ask for existing evidence or the prerequisite's result and pause rather than inventing a resolution or changing the project.
5. **Work the HITL frontier adaptively.** Ask one currently unblocked `grilling` question at a time with `plan_question`, then record the answer and recompute the map before asking another. This avoids pre-charting a long waterfall of questions that earlier answers may invalidate. Prefix each question with a stable `Q<number>` label, explain briefly why it matters, and mark a recommended answer with its rationale. Supply at least four concrete choices, including **Skip all remaining questions and apply your best judgment**. `plan_question` always adds a free-text answer choice, so do not add custom question UI. If skip-all is selected, stop questioning, resolve the remaining decisions with evidence-backed judgment, and record every consequential choice as an assumption.
6. **Advance the frontier incrementally.** Keep dependent questions blocked. When research or an answer makes a fog item precise, graduate it to the frontier and remove it from fog; never keep the same uncertainty in both places. When a settled answer invalidates a later question, delete or rewrite that question instead of designing around a stale decision. Prefer a bounded destination and cheap evidence over speculative comprehensiveness.
7. **Clear the map.** Wayfinding is complete only when no unresolved fog or frontier item blocks the destination. Summarize the destination, decisions, out-of-scope boundary, and consequential assumptions, then ask the user to confirm the shared understanding. Do not request this final confirmation after skip-all. If research finds no material uncertainty, skip questioning and proceed directly.

8. Produce a complete, dependency-aware plan. It must cover:
   - outcome, scope, acceptance criteria, findings, constraints, risks, assumptions, and end-to-end validation;
   - an architecture design with a concise summary and a valid Mermaid `flowchart` or `graph` declaration that shows primary actors, component boundaries, persisted or external dependencies, and directional interactions;
   - ordered tasks and implementation subtasks with stable IDs and dependency IDs. An ID must start with a letter and may contain only letters, digits, hyphens, underscores, and dots (for example `T1`, `T1.1`, or `extend-auth-contract`); dependencies must reuse the exact ID;
   - for **every** task and subtask: detailed **What**, **Why**, **How**, affected files/modules, dependencies, and concrete validation;
   - engineering considerations for architecture, security, data/migrations, testing, rollout/rollback, observability, and performance/accessibility. Explain why an area is not applicable when appropriate.
9. Call `plan_publish` once with the full plan. It validates the plan and writes the single HTML file under `docs/plan/` by default (or `.pi/planning.json`'s `artifact.directory`). Do not use generic write/edit tools to create the plan.

After `plan_publish` succeeds, stop. Do not offer to execute the plan and do not implement any task. Execution is a separate explicit command:

```text
/execute-plan [planning-file]
```
