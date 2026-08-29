import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCandidate,
  digestValue,
  renderPlanHtml,
  renderPlanMarkdown,
  verifyPlanArtifact,
  writePlanArtifact,
} from "../extensions/planning/artifact.ts";
import { settledTree, validDraft } from "./helpers.ts";

test("candidate digest is deterministic across object key order", () => {
  assert.equal(digestValue({ b: 2, a: 1 }), digestValue({ a: 1, b: 2 }));
  const first = createCandidate(
    validDraft(),
    settledTree(),
    1,
    "2026-08-28T00:00:00.000Z",
  );
  const second = createCandidate(
    validDraft(),
    settledTree(),
    1,
    "2026-08-28T00:00:00.000Z",
  );
  assert.equal(first.digest, second.digest);
});

test("HTML artifact is standalone, escaped, and renders What Why How", () => {
  const draft = validDraft({ title: "Auth <script>alert(1)</script>" });
  const candidate = createCandidate(draft, settledTree(), 2);
  const html = renderPlanHtml(candidate);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /Auth &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<dt>What<\/dt>/);
  assert.match(html, /<dt>Why<\/dt>/);
  assert.match(html, /<dt>How<\/dt>/);
  assert.doesNotMatch(html, /<link\b|<iframe\b|src="https?:/i);

  const markdown = renderPlanMarkdown(candidate);
  assert.match(markdown, /\*\*What:\*\*/);
  assert.match(markdown, /\*\*Why:\*\*/);
  assert.match(markdown, /\*\*How:\*\*/);
});

test("artifact writes atomically under the configured project directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-artifact-"));
  const candidate = createCandidate(validDraft(), settledTree(), 1);
  const record = await writePlanArtifact(cwd, "docs/plan", candidate);
  assert.equal(record.path, "docs/plan/add-passkey-authentication.html");
  assert.equal(await verifyPlanArtifact(record), true);
  assert.match(
    await readFile(record.absolutePath, "utf8"),
    new RegExp(candidate.digest),
  );

  await writeFile(record.absolutePath, "tampered", "utf8");
  assert.equal(await verifyPlanArtifact(record), false);
});

test("artifact path traversal and symlink escapes are rejected before writing outside", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-path-"));
  const candidate = createCandidate(validDraft(), settledTree(), 1);
  await assert.rejects(
    () => writePlanArtifact(cwd, "../outside", candidate),
    /traverse|outside/i,
  );

  const outside = await mkdtemp(join(tmpdir(), "pi-planning-outside-"));
  await mkdir(join(cwd, "docs"), { recursive: true });
  await symlink(outside, join(cwd, "docs", "plan"));
  await assert.rejects(
    () => writePlanArtifact(cwd, "docs/plan", candidate),
    /symlink/i,
  );

  const parentSymlinkProject = await mkdtemp(
    join(tmpdir(), "pi-planning-parent-link-"),
  );
  const parentOutside = await mkdtemp(
    join(tmpdir(), "pi-planning-parent-outside-"),
  );
  await symlink(parentOutside, join(parentSymlinkProject, "docs"));
  await assert.rejects(
    () => writePlanArtifact(parentSymlinkProject, "docs/plan", candidate),
    /symlink/i,
  );
  await assert.rejects(
    () =>
      readFile(join(parentOutside, "plan", "add-passkey-authentication.html")),
    /ENOENT/,
  );
});
