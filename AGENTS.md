# Pi `/plan` Project

## Purpose

This repository is a [Pi](https://pi.dev) package that provides a planning command named `/plan`. The command should help an agent inspect a task, clarify its scope, and produce an actionable implementation plan before making changes.

## Pi integration

- Follow Pi's documented package conventions.
- The `/plan` prompt template belongs in `prompts/` and must be declared by the `pi.prompts` manifest in `package.json`.
- The permission boundary and lifecycle live in `extensions/planning/`; keep the extension declared by `pi.extensions` and included in published package files.
- Keep the `/plan` workflow read-only by default. It must not modify project files, run destructive commands, or make commits unless the user explicitly asks. The sole default planning-time write is the renderer-owned HTML artifact under the configured plan directory.
- Preserve user-provided constraints, surface assumptions and unresolved questions, and include validation steps in each plan.
- Treat prompts as behavioral guidance and extension tool policy as enforcement; never describe the package as an OS sandbox.
- Every planned implementation task must include detailed What, Why, How, affected files/modules, dependencies, and validation.
- User-owned decisions must pass through the dependency-aware grilling frontier and explicit shared-understanding confirmation before review.

## Project structure

- `prompts/plan.md` — model-facing planning and grilling contract.
- `extensions/planning/` — lifecycle, policy, decisions, artifact, approval, and handoff modules.
- `tests/` — Node test-runner coverage for pure modules and lifecycle invariants.

## Engineering guidelines

- Use TypeScript for executable code and keep strict type checking enabled.
- Prefer small, focused modules and avoid unnecessary dependencies.
- Do not commit credentials, local environment files, generated output, dependencies, or test artifacts.
- Add or update tests with behavior changes and run the relevant checks before completing work.
- Run `npm run typecheck` and `npm test` after executable changes.
- Run `npm pack --dry-run` after package-content changes.
- Update this file when the project structure, commands, or development workflow changes.
