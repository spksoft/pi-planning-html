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
2. Identify whether material user-owned decisions remain after research. If they do, use the built-in decision-tree questioning workflow below before creating the final plan. `plan_question` uses Pi's native selection/input UI. Do not build or simulate a separate question display.
3. Preserve explicit user constraints. State assumptions and non-blocking open questions plainly. Resolve blocking questions before publishing.

### Built-in decision-tree questioning workflow

This workflow is part of `/plan`, not a separately exposed skill.

1. Map the remaining user-owned decisions as a design tree, where each decision branches into decisions that depend on it. Facts remain the agent's responsibility: investigate them with repository and available tools rather than asking the user.
2. Work in rounds. The frontier contains every decision whose prerequisites are settled. Ask all currently unblocked frontier questions before any question that depends on an answer from that round.
3. Ask every frontier item with `plan_question`. Prefix the question with a stable `Q<number>` label and include a clearly marked recommended answer in its text. Supply at least four concrete choices for every question, including **Skip all remaining questions and apply your best judgment**; if the user selects it, stop questioning, make well-supported choices for every remaining decision, and record consequential choices as assumptions in the plan. `plan_question` always adds a free-text answer choice, so do not omit it or create a custom question UI.
4. Wait for answers to the whole frontier before recomputing the tree. If fact-finding remains in progress, treat only its downstream decisions as blocked and continue with independent frontier questions.
5. The interview finishes when no user-owned decisions remain. Summarize the settled choices and ask the user to confirm the shared understanding before publishing the plan. Do not request this confirmation after the user selected the skip-all option.

6. Produce a complete, dependency-aware plan. It must cover:
   - outcome, scope, acceptance criteria, findings, constraints, risks, assumptions, and end-to-end validation;
   - an architecture design with a concise summary and a valid Mermaid `flowchart` or `graph` declaration that shows primary actors, component boundaries, persisted or external dependencies, and directional interactions;
   - ordered tasks and implementation subtasks with stable IDs and dependency IDs;
   - for **every** task and subtask: detailed **What**, **Why**, **How**, affected files/modules, dependencies, and concrete validation;
   - engineering considerations for architecture, security, data/migrations, testing, rollout/rollback, observability, and performance/accessibility. Explain why an area is not applicable when appropriate.
7. Call `plan_publish` once with the full plan. It validates the plan and writes the single HTML file under `docs/plan/` by default (or `.pi/planning.json`'s `artifact.directory`). Do not use generic write/edit tools to create the plan.

After `plan_publish` succeeds, stop. Do not offer to execute the plan and do not implement any task. Execution is a separate explicit command:

```text
/execute-plan [planning-file]
```
