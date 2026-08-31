# Pi Planning HTML

A small [Pi](https://pi.dev) package with two commands:

- `/plan <request>` researches a request and creates one detailed HTML plan with an architecture diagram.
- `/execute-plan [planning-file]` approves a plan, extracts it to Markdown, and starts implementing it.

There is no approval lifecycle, task-progress system, permission gate, or automatic execution handoff.

## Install

```bash
pi install git:github.com/spksoft/pi-planning-html
```

For reproducible installs, pin a tag or commit:

```bash
pi install git:github.com/spksoft/pi-planning-html@<tag-or-commit>
```

## Plan

```text
/plan Add user authentication with passkeys
```

`/plan` investigates the project and, when material user-owned decisions remain, asks dependency-ordered decision-tree questions through Pi's native UI before creating the final plan. Each select-style question includes **Skip all remaining questions and apply your best judgment**; that choice ends the interview and records consequential decisions as assumptions. `/plan` ends by creating an HTML file such as:

```text
docs/plan/add-passkey-authentication.html
```

The plan includes outcome and acceptance criteria, scope, constraints, findings, a required architecture-design summary and Mermaid flowchart, risks, assumptions, engineering considerations, end-to-end validation, and dependency-aware tasks and subtasks. Every task and subtask has detailed **What**, **Why**, **How**, affected files/modules, dependencies, and validation.

Each artifact remains a single readable HTML file. When viewed with JavaScript and network access, it imports the version-pinned Mermaid `11.17.2` ESM module from jsDelivr to render the architecture flowchart as SVG. The architecture summary and Mermaid source stay in the document as the no-JavaScript, offline, or rendering-failure fallback, and the extracted Markdown retains the same source in a `mermaid` code fence.

Planning is guidance-driven rather than a sandbox: the prompt tells the agent not to make project changes while planning, and `plan_publish` is the only package-owned planning write. This package does not add a permission-control policy.

## Execute a plan

```text
/execute-plan [planning-file]
```

After a `/plan` run in the same conversation, `/execute-plan` with no argument explicitly approves and executes the most recently published plan. Otherwise provide its full project path or just its filename; a bare filename is resolved from the configured plan directory. The command reads the generated HTML, extracts its embedded canonical Markdown to the adjacent file:

```text
docs/plan/add-passkey-authentication.md
```

It then starts a normal Pi implementation turn using that Markdown as the execution brief. If an active `subagent` tool is available, the agent is instructed to delegate only dependency-independent, well-bounded work; otherwise it implements the tasks directly. Integration and validation remain with the primary agent.

## Configuration

The default plan directory is `docs/plan`. To change only that directory, create `.pi/planning.json`:

```json
{
  "artifact": {
    "directory": "docs/plans"
  }
}
```

The directory must be project-relative and cannot traverse outside the project.

## Package contents

- `prompts/plan.md` — the planning-only `/plan` contract and internal decision-tree questioning workflow.
- `extensions/planning/index.ts` — `plan_question`, `plan_publish`, and `/execute-plan`.
- `extensions/planning/schema.ts` — detailed plan and subtask validation.
- `extensions/planning/artifact.ts` — HTML and CDN Mermaid rendering, safe artifact writing, and HTML-to-Markdown extraction.
- `tests/` — unit and integration coverage.

## Development

Requires Node.js 22.19 or newer.

```bash
npm install --package-lock=false
npm run typecheck
npm test
npm pack --dry-run
```

Run all checks with:

```bash
npm run check
```
