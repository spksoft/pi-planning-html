# Pi `/plan` Project

## Purpose

This repository is a [Pi](https://pi.dev) package with two commands:

- `/plan <request>` researches a request and generates a detailed HTML plan.
- `/execute-plan [planning-file]` explicitly approves a plan, extracts it to Markdown, and starts normal implementation work.

## Pi integration

- Follow Pi's documented package conventions.
- `/plan` is the `prompts/plan.md` prompt template and must be declared by `pi.prompts` in `package.json`. Its decision-tree questioning workflow remains internal to the `/plan` prompt; do not expose it as a separate skill.
- `/execute-plan` and the planning tools live in `extensions/planning/`; keep the extension declared by `pi.extensions` and included in published package files.
- `/plan` is planning-only. Its final action is `plan_publish`, which writes one renderer-owned HTML artifact under the configured plan directory. It must not implement the request.
- `plan_question` must use Pi's native `ctx.ui.select()` and `ctx.ui.input()` APIs. Do not create custom question-rendering UI.
- The package intentionally has no permission-control, approval, lifecycle, or task-progress machinery. Do not describe its prompt guidance as an OS sandbox or a mechanical permission boundary.
- `/execute-plan` with no argument uses the most recently published plan in the active conversation as the user's explicit approval. Without that context, it accepts a full project path or a bare filename resolved from the configured plan directory. It extracts the generated HTML's embedded Markdown to an adjacent `.md` file, then starts normal implementation. Use an active `subagent` tool only for independent, bounded tasks; the primary agent keeps integration and validation.
- Every planned implementation task and subtask must include detailed What, Why, How, affected files/modules, dependencies, and validation. Plans must record the applicable engineering considerations, assumptions, risks, and end-to-end validation.

## Project structure

- `prompts/plan.md` — model-facing planning-only contract.
- `extensions/planning/index.ts` — Pi tools and `/execute-plan` command.
- `extensions/planning/schema.ts` — plan, task, subtask, and engineering-coverage validation.
- `extensions/planning/artifact.ts` — HTML rendering, contained writes, and embedded-Markdown extraction.
- `extensions/planning/config.ts` — optional plan-directory setting.
- `tests/` — Node test-runner coverage for artifacts, schema validation, and command wiring.

## Engineering guidelines

- Use TypeScript for executable code and keep strict type checking enabled.
- Prefer small, focused modules and avoid unnecessary dependencies.
- Do not commit credentials, local environment files, generated output, dependencies, or test artifacts.
- Add or update tests with behavior changes and run the relevant checks before completing work.
- Run `npm run typecheck` and `npm test` after executable changes.
- Run `npm pack --dry-run` after package-content changes.
- Update this file when the project structure, commands, or development workflow changes.
