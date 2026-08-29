# pi-planning-html

A [Pi](https://pi.dev) package that provides `/plan`: a permission-backed, decision-grilling planning mode with revisioned HTML artifacts and explicit approval before implementation.

## What it adds

- a `/plan` prompt template for planner behavior;
- a TypeScript extension that mechanically narrows the planning tool surface;
- provenance-aware, deny-by-default tool-call enforcement;
- dependency-aware decision trees and frontier-based question rounds;
- explicit shared-understanding confirmation;
- deterministic plans at `docs/plan/<topic>.html`;
- mandatory detailed **What**, **Why**, and **How** for every task;
- revision hashes, artifact verification, baseline drift checks, and direct approval;
- guarded same-session or fresh-session execution handoff;
- structured task progress and out-of-plan mutation gates.

## Install

From a local checkout:

```bash
pi install /absolute/path/to/pi-planning-html
```

After publishing:

```bash
pi install npm:pi-planning-html
```

Or from a tagged Git revision:

```bash
pi install git:github.com/<owner>/pi-planning-html@<tag>
```

## Use

Start Pi in a trusted project and invoke:

```text
/plan Add user authentication with passkeys
```

The extension enters restricted Planning mode before Pi expands the prompt template. The planner then:

1. reads applicable project instructions and investigates repository facts;
2. maps user-owned decisions as a dependency tree;
3. asks each ready frontier in a numbered round with recommended answers;
4. confirms shared understanding;
5. publishes a complete renderer-owned HTML revision;
6. requests revision-bound review and approval; and
7. hands the exact approved snapshot to guarded execution.

Creating a plan never means approving it.

## Task detail contract

Every implementation task must include:

- **What** — the concrete change, expected result, and supported files/modules/symbols;
- **Why** — the user outcome, evidence, settled decision, dependency, or risk that requires it;
- **How** — the implementation approach, reuse points, data flow, errors, dependencies, and completion evidence.

`plan_update` rejects the complete candidate when any task omits one of these fields, uses placeholder text, or lacks validation.

## Commands

| Command | Purpose |
| --- | --- |
| `/plan <request>` | Enter restricted Planning mode and start a new plan. |
| `/planning-status` | Show lifecycle, decisions, revision, artifact, and execution status. |
| `/planning-review` | Return the current candidate to review. |
| `/planning-approve <digest> [guarded\|review\|fresh]` | Approve one exact revision. |
| `/planning-replan` | Return approved execution to restricted planning and invalidate approval. |
| `/planning-cancel` | Cancel and restore the original tool set. |

The model receives lifecycle tools for safe inspection, decision mapping, frontier rounds, understanding confirmation, exact evidence exceptions, plan publication, review, and task progress.

## Planning-time boundary

During Planning mode:

- built-in `edit`, `write`, Bash, PowerShell, and unknown tools are inactive;
- a universal `tool_call` gate independently verifies tool identity and provenance;
- fixed Git/package inspection is available through `plan_inspect` without shell interpolation;
- only `plan_update` may write, and only to the configured plan directory;
- an uncertain evidence action requires a direct, short-lived, single-use exact permit;
- delegated agents are not enabled unless a future adapter can mechanically attest to their read-only policy.

This is Pi tool-policy enforcement, **not an OS sandbox**. User shell commands, extension code, compromised dependencies, and external services remain separate trust boundaries.

## Configuration

Trusted projects may add `.pi/planning.json`:

```json
{
  "artifact": {
    "directory": "docs/plan"
  },
  "planning": {
    "defaultTier": "auto",
    "allowExactExceptions": true
  },
  "execution": {
    "askOnDependencyChange": true
  }
}
```

The artifact directory must remain relative to the project and cannot traverse outside it. Project configuration is ignored until the project is trusted.

## Package contents

- `prompts/plan.md` — planning and grilling contract.
- `extensions/planning/index.ts` — Pi integration and lifecycle composition.
- `extensions/planning/decision-tree.ts` — dependency graph and frontier rounds.
- `extensions/planning/policy.ts` — planning and guarded-execution policy.
- `extensions/planning/schema.ts` — plan/task types and validation.
- `extensions/planning/artifact.ts` — hashing, confined writes, and HTML/Markdown rendering.
- `extensions/planning/state.ts` — persisted lifecycle and task progress.
- `extensions/planning/approval.ts` — baseline and revision-bound approval records.
- `extensions/planning/handoff.ts` — approved execution contract.
- `extensions/planning/inspect-tool.ts` — fixed read-only inspection operations.
- `tests/` — unit and lifecycle tests; excluded from the published package.

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

