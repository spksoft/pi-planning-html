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

`/plan` investigates the project and runs a compact, single-session wayfinding phase before creating the final plan. It first bounds the destination, then maintains a transient map of decisions so far, fog, the currently answerable frontier, and out-of-scope work. The map contains decision questions rather than implementation steps: discoverable facts are researched, dependent questions stay blocked, and the map is recomputed after each material answer so stale speculative questions do not accumulate. This adaptation does not create issue-tracker tickets, local map files, or a separate `/wayfinder` skill.

Material user-owned frontier questions use Pi's native UI. Before the first material question, `plan_question` asks for the preferred question language: **English (default)** or a free-text language such as Thai. It then returns that choice so the planner can reissue the material question and all later options, recommendations, and rationales in that language. Every material question presents at least four concrete choices plus a free-text answer choice and briefly explains its recommendation. `plan_question` automatically adds **Skip all remaining questions and apply your best judgment**; that choice ends the interview and records consequential planner judgments as provisional decisions or assumptions with provenance, a resolution point, and fallback. `/plan` ends by creating an HTML file such as:

```text
docs/plan/add-passkey-authentication.html
```

The plan includes repository evidence that names the exact observed project seams (checked at publication), requirements, observable acceptance criteria, decisions, scope, constraints, findings, a typed architecture design, risks, assumptions, deferred unknowns, engineering considerations, validations, and dependency-aware tasks. Requirements (`REQ-*`) link to acceptance criteria (`AC-*`), implementation tasks, and validations (`VAL-*`); consequential decisions (`DEC-*`) preserve rationale, alternatives, consequences, and reversibility. Every task and detailed decomposition subtask has **What**, **Why**, **How**, observed/proposed files/modules, and validation IDs. Executable tasks additionally state expected behavior and parallel-safety guidance. Task dependencies describe executable ordering; subtasks are detailed decomposition notes rather than hidden dependency nodes.

`/plan` is evidence-backed guidance for choosing the smallest useful solution. Before proposing code, it investigates reuse, standard-library/native/installed-dependency options, affected callers and contracts, and credible regression checks. Consequential new dependencies, abstractions, services, or shared components use existing decisions to record the concrete need and simpler alternative considered. Bug fixes inspect callers and target the root cause rather than only the reported symptom; the guidance does not remove required security, validation, error handling, accessibility, compatibility, or requested behavior.

When a request materially affects UI, `/plan` also researches existing visual and interaction conventions, reusable components, the primary user task and information hierarchy, applicable interaction states, responsive and keyboard/accessibility expectations, and available references. It records only evidence it actually found. It separates automated checks, screenshots, and human design review, and does not impose UI requirements on non-UI work. For a greenfield UI with a consequential missing direction, the existing native question flow is used; skip-all records a provisional evidence-backed judgment or assumption with a fallback.

The guidance makes acceptance observable through the existing requirement → acceptance criterion → task → validation links. It does not add a quality score, a second approval ceremony, or runtime enforcement: unavailable validation stays an explicit limitation or planning unknown rather than a fabricated pass.

Each artifact remains a single readable, offline-first HTML file. It has no scripts, network dependencies, or browser-side diagram renderer. The renderer produces static inline SVG architecture and task-dependency views plus visible HTML relationship tables from the same validated plan data, with a table of contents, semantic headings, responsive layout, print styles, restrictive CSP, a BCP 47 document-language tag, an observed-seam/Git snapshot, and canonical Markdown embedded for execution.

Planning is guidance-driven rather than a sandbox: the prompt tells the agent not to make project changes while planning, and `plan_publish` is the only package-owned planning write. This package does not add a permission-control policy.

## Execute a plan

```text
/execute-plan [planning-file]
```

After a `/plan` run in the same conversation, `/execute-plan` with no argument explicitly approves and executes only the exact content-hash-verified artifact published in that conversation. It rejects a changed, overwritten, or mismatched artifact. Otherwise provide its full project path or just its filename; a bare filename is resolved from the configured plan directory. Explicit files are checked for valid embedded candidate and Markdown metadata, but must come from a trusted source: self-contained SHA-256 hashes do not authenticate a replaced artifact. Before execution, the command warns if the recorded Git commit or observed file seams have changed. The command extracts canonical Markdown to the adjacent file:

```text
docs/plan/add-passkey-authentication.md
```

It then starts a normal Pi implementation turn using that Markdown as the execution brief. The brief tells the implementing agent to follow approved scope, reuse decisions, non-goals, and applicable UI requirements; inspect current code before editing; avoid weakening tests or silently redefining acceptance; run planned final checks; and report actual evidence, deviations, and uncertainty. It requests user direction for material scope or acceptance changes without adding another approval state machine. These are execution instructions, not tool interception or mechanical freshness enforcement. If an active `subagent` tool is available, the agent is instructed to delegate only dependency-independent, well-bounded work; otherwise it implements the tasks directly. Integration and validation remain with the primary agent.

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

- `prompts/plan.md` — the planning-only `/plan` contract and internal wayfinding workflow.
- `extensions/planning/index.ts` — `plan_question`, `plan_publish`, and `/execute-plan`.
- `extensions/planning/schema.ts` — traceability, decisions, task hierarchy, architecture graph, and implementation-readiness validation.
- `extensions/planning/artifact.ts` — offline static HTML/SVG rendering, safe artifact writing, integrity metadata, and HTML-to-Markdown extraction.
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
