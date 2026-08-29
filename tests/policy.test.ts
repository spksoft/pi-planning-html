import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capturePlanningPolicy,
  createExactPermit,
  evaluatePlanningCall,
  executionIdentityMatches,
  isDependencyManifest,
  isKnownExecutionCommand,
  isMutationPathPlanned,
  isRiskyShell,
  mutationTargetEscapesProject,
  planningToolNames,
} from "../extensions/planning/policy.ts";
import { inactiveState, setPermit } from "../extensions/planning/state.ts";

const tools = [
  { name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } },
  { name: "write", sourceInfo: { source: "builtin", path: "<builtin:write>" } },
  {
    name: "plan_update",
    sourceInfo: { source: "package", path: "/pkg/index.ts" },
  },
  {
    name: "mcp_mutate",
    sourceInfo: { source: "extension", path: "/other/mcp.ts" },
  },
];

const CWD = "/project";

test("planning policy exposes only captured safe and lifecycle tools", () => {
  const snapshot = capturePlanningPolicy(tools);
  assert.deepEqual(planningToolNames(snapshot).sort(), ["plan_update", "read"]);
  assert.equal(
    evaluatePlanningCall(
      inactiveState(),
      snapshot,
      tools[0],
      "read",
      { path: "x" },
      CWD,
    ).allowed,
    true,
  );
  assert.equal(
    evaluatePlanningCall(
      inactiveState(),
      snapshot,
      tools[1],
      "write",
      { path: "x" },
      CWD,
    ).allowed,
    false,
  );
});

test("same-name tool with changed provenance is blocked", () => {
  const snapshot = capturePlanningPolicy(tools, "/pkg/index.ts");
  const spoofed = {
    name: "read",
    sourceInfo: { source: "extension", path: "/malicious/read.ts" },
  };
  const decision = evaluatePlanningCall(
    inactiveState(),
    snapshot,
    spoofed,
    "read",
    { path: "x" },
    CWD,
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /provenance changed/);

  const spoofedLifecycle = [
    {
      name: "plan_update",
      sourceInfo: { source: "extension", path: "/malicious/plan.ts" },
    },
  ];
  assert.deepEqual(
    planningToolNames(capturePlanningPolicy(spoofedLifecycle, "/pkg/index.ts")),
    [],
  );
});

test("execution identity rejects same-name replacements of pre-plan tools", () => {
  const captured = [
    { name: "read", source: "builtin", path: "<builtin:read>" },
  ];
  assert.equal(executionIdentityMatches(captured, tools[0], "read"), true);
  assert.equal(
    executionIdentityMatches(
      captured,
      {
        name: "read",
        sourceInfo: { source: "extension", path: "/evil/read.ts" },
      },
      "read",
    ),
    false,
  );
  assert.equal(executionIdentityMatches(captured, undefined, "read"), false);
});

test("exact permit is bound to identity, arguments, cwd, revision, and expiry", () => {
  const snapshot = capturePlanningPolicy(tools);
  const now = Date.parse("2026-08-28T00:00:00.000Z");
  const permit = createExactPermit(
    tools[1]!,
    { path: "scratch.txt", content: "evidence" },
    "Create explicit evidence",
    "Writes one scratch file",
    CWD,
    null,
    now,
    1_000,
  );
  const state = setPermit({ ...inactiveState(), phase: "discovering" }, permit);

  const allowed = evaluatePlanningCall(
    state,
    snapshot,
    tools[1],
    "write",
    { content: "evidence", path: "scratch.txt" },
    CWD,
    now + 500,
  );
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.consumePermit, true);

  // Different arguments, different cwd, expired, spoofed identity, and a newer revision all fail closed.
  assert.equal(
    evaluatePlanningCall(
      state,
      snapshot,
      tools[1],
      "write",
      { path: "other.txt" },
      CWD,
      now + 500,
    ).allowed,
    false,
  );
  assert.equal(
    evaluatePlanningCall(
      state,
      snapshot,
      tools[1],
      "write",
      { path: "scratch.txt", content: "evidence" },
      "/elsewhere",
      now + 500,
    ).allowed,
    false,
  );
  assert.equal(
    evaluatePlanningCall(
      state,
      snapshot,
      tools[1],
      "write",
      { path: "scratch.txt", content: "evidence" },
      CWD,
      now + 2_000,
    ).allowed,
    false,
  );
  assert.equal(
    evaluatePlanningCall(
      state,
      snapshot,
      {
        name: "write",
        sourceInfo: { source: "extension", path: "/evil/write.ts" },
      },
      "write",
      { path: "scratch.txt", content: "evidence" },
      CWD,
      now + 500,
    ).allowed,
    false,
  );

  const laterRevision = {
    ...state,
    // SAFETY: only the digest is read by permit evaluation in this assertion.
    candidate: { digest: "a".repeat(64) } as never,
  };
  assert.equal(
    evaluatePlanningCall(
      laterRevision,
      snapshot,
      tools[1],
      "write",
      { path: "scratch.txt", content: "evidence" },
      CWD,
      now + 500,
    ).allowed,
    false,
  );
});

test("guarded mutation envelope accepts exact files and explicit directories only", () => {
  assert.equal(
    isMutationPathPlanned("/project", ["src/auth.ts"], "src/auth.ts"),
    true,
  );
  assert.equal(
    isMutationPathPlanned("/project", ["src/auth.ts"], "src/other.ts"),
    false,
  );
  assert.equal(
    isMutationPathPlanned("/project", ["src/auth/"], "src/auth/service.ts"),
    true,
  );
  assert.equal(
    isMutationPathPlanned("/project", ["src/auth/**"], "src/auth/service.ts"),
    false,
  );
  assert.equal(
    isMutationPathPlanned("/project", ["src/"], "../outside.ts"),
    false,
  );
});

test("symlinked mutation targets are treated as escaping the project", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-planning-mutation-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-planning-mutation-out-"));
  await mkdir(join(project, "src"), { recursive: true });
  await writeFile(
    join(project, "src", "real.ts"),
    "export const ok = 1;\n",
    "utf8",
  );
  await writeFile(
    join(outside, "target.ts"),
    "export const evil = 1;\n",
    "utf8",
  );
  await symlink(join(outside, "target.ts"), join(project, "src", "linked.ts"));
  await symlink(outside, join(project, "linkeddir"));

  assert.equal(
    await mutationTargetEscapesProject(project, "src/real.ts"),
    false,
  );
  assert.equal(
    await mutationTargetEscapesProject(project, "src/new-file.ts"),
    false,
  );
  assert.equal(
    await mutationTargetEscapesProject(project, "src/linked.ts"),
    true,
  );
  assert.equal(
    await mutationTargetEscapesProject(project, "linkeddir/new-file.ts"),
    true,
  );
  assert.equal(
    await mutationTargetEscapesProject(project, "../escape.ts"),
    true,
  );
});

test("dependency manifests are always classified for a deviation decision", () => {
  for (const path of [
    "package.json",
    "nested/pnpm-lock.yaml",
    "Cargo.toml",
    "go.sum",
  ]) {
    assert.equal(isDependencyManifest(path), true, path);
  }
  assert.equal(isDependencyManifest("src/package.ts"), false);
});

test("execution shell allowlist rejects expansion, substitution, and unknown commands", () => {
  for (const command of [
    "rm -rf build",
    "npm install foo",
    "git commit -am x",
    "echo data > file.txt",
  ]) {
    assert.equal(isRiskyShell(command), true, command);
  }
  assert.equal(
    isKnownExecutionCommand("tsc --noEmit && git status --short"),
    true,
  );
  assert.equal(isKnownExecutionCommand("git status --short"), true);

  for (const command of [
    "npm run typecheck && npm test",
    "npm test $(touch owned)",
    "npm test `touch owned`",
    "npm test\ntouch owned",
    "npm test & touch owned",
    "npm test > out.txt",
    "npm test; rm -rf build",
    'python -c \'open("file", "w").write("x")\'',
    "make deploy",
    "npm test ${EVIL}",
  ]) {
    assert.equal(isKnownExecutionCommand(command), false, command);
  }
});
