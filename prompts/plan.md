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
2. Ask only material user-owned decisions that remain after research. Use `plan_question` for an interactive question: it uses Pi's native selection/input UI. Do not build or simulate a separate question display.
3. Preserve explicit user constraints. State assumptions and non-blocking open questions plainly. Resolve blocking questions before publishing.
4. Produce a complete, dependency-aware plan. It must cover:
   - outcome, scope, acceptance criteria, findings, constraints, risks, assumptions, and end-to-end validation;
   - an architecture design with a concise summary and a valid Mermaid `flowchart` or `graph` declaration that shows primary actors, component boundaries, persisted or external dependencies, and directional interactions;
   - ordered tasks and implementation subtasks with stable IDs and dependency IDs;
   - for **every** task and subtask: detailed **What**, **Why**, **How**, affected files/modules, dependencies, and concrete validation;
   - engineering considerations for architecture, security, data/migrations, testing, rollout/rollback, observability, and performance/accessibility. Explain why an area is not applicable when appropriate.
5. Call `plan_publish` once with the full plan. It validates the plan and writes the single HTML file under `docs/plan/` by default (or `.pi/planning.json`'s `artifact.directory`). Do not use generic write/edit tools to create the plan.

After `plan_publish` succeeds, stop. Do not offer to execute the plan and do not implement any task. Execution is a separate explicit command:

```text
/execute-plan [planning-file]
```
