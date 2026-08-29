import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCandidate,
  digestValue,
  extractPlanMarkdown,
  hashText,
  markdownPathForPlan,
  readPlanMarkdown,
  renderPlanHtml,
  renderPlanMarkdown,
  writeExtractedMarkdown,
  writePlanArtifact,
} from "../extensions/planning/artifact.ts";
import { validDraft } from "./helpers.ts";

test("candidate digest is deterministic across object key order", () => {
  assert.equal(digestValue({ b: 2, a: 1 }), digestValue({ a: 1, b: 2 }));
  const first = createCandidate(validDraft(), "2026-08-28T00:00:00.000Z");
  const second = createCandidate(validDraft(), "2026-08-28T00:00:00.000Z");
  assert.equal(first.digest, second.digest);
});

test("HTML is standalone, escaped, and round-trips its canonical Markdown", () => {
  const draft = validDraft({
    title: "Auth <script>alert(1)</script> </template>",
  });
  const candidate = createCandidate(draft, "2026-08-28T00:00:00.000Z");
  const html = renderPlanHtml(candidate);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(
    html,
    /Auth &lt;script&gt;alert\(1\)&lt;\/script&gt; &lt;\/template&gt;/,
  );
  assert.match(html, /Implementation subtasks/);
  assert.match(html, /<dt>What<\/dt>/);
  assert.match(html, /<dt>Why<\/dt>/);
  assert.match(html, /<dt>How<\/dt>/);
  assert.doesNotMatch(html, /<link\b|<iframe\b|src="https?:/i);
  assert.equal(extractPlanMarkdown(html), renderPlanMarkdown(candidate));
});

test("extractor rejects a missing, duplicate, or malformed Markdown payload", () => {
  assert.throws(() => extractPlanMarkdown("<html></html>"), /exactly one/i);
  const html = renderPlanHtml(createCandidate(validDraft()));
  const payload =
    '<template id="pi-plan-markdown" data-format="markdown-v1"># duplicate</template>';
  assert.throws(() => extractPlanMarkdown(`${html}${payload}`), /exactly one/i);
  assert.throws(
    () =>
      extractPlanMarkdown(
        '<template id="pi-plan-markdown" data-format="markdown-v1">not markdown</template>',
      ),
    /missing or invalid/i,
  );
});

test("artifact writes atomically, then the extracted Markdown can be written beside it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-artifact-"));
  const candidate = createCandidate(validDraft());
  const record = await writePlanArtifact(cwd, "docs/plan", candidate);
  assert.equal(record.path, "docs/plan/add-passkey-authentication.html");
  assert.equal(
    hashText(await readFile(record.absolutePath, "utf8")),
    record.contentHash,
  );

  const markdown = await readPlanMarkdown(record.absolutePath);
  const markdownPath = markdownPathForPlan(record.absolutePath);
  await writeExtractedMarkdown(markdownPath, markdown);
  assert.equal(await readFile(markdownPath, "utf8"), markdown);

  await writeFile(record.absolutePath, "tampered", "utf8");
  assert.notEqual(
    hashText(await readFile(record.absolutePath, "utf8")),
    record.contentHash,
  );
});

test("artifact path traversal and symlink escapes are rejected before writing outside", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-path-"));
  const candidate = createCandidate(validDraft());
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
  await assert.rejects(
    () => readFile(join(outside, "add-passkey-authentication.html")),
    /ENOENT/,
  );
});
