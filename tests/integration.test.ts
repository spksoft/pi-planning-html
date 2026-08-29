import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import planningExtension from "../extensions/planning/index.ts";
import { createHarness } from "./harness.ts";
import { validDraft } from "./helpers.ts";

async function bootstrap(options: { hasUI?: boolean } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-integration-"));
  const { pi, harness } = createHarness({ cwd, ...options });
  planningExtension(pi as never);
  return { cwd, harness };
}

test("the package exposes only its planning tools and /execute-plan command", async () => {
  const { harness } = await bootstrap();
  assert.deepEqual([...harness.tools.keys()].sort(), [
    "plan_publish",
    "plan_question",
  ]);
  assert.deepEqual([...harness.commands.keys()], ["execute-plan"]);
  assert.equal(harness.commands.has("planning-approve"), false);
  assert.equal(harness.commands.has("planning-cancel"), false);
});

test("plan_publish creates one validated HTML artifact and terminates planning", async () => {
  const { cwd, harness } = await bootstrap();
  const published = await harness.callTool("plan_publish", validDraft());
  assert.equal(published.terminate, true);
  assert.match(
    published.content[0]!.text,
    /Planning is complete; do not implement/i,
  );

  const htmlPath = join(cwd, "docs/plan/add-passkey-authentication.html");
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /data-plan-format="pi-plan-html-v1"/);
  assert.match(html, /Implementation subtasks/);

  const invalid = validDraft();
  invalid.tasks[0] = { ...invalid.tasks[0]!, subtasks: [] };
  await assert.rejects(
    () => harness.callTool("plan_publish", invalid),
    /subtask/i,
  );
});

test("plan_question delegates presentation to Pi's native select and input UI", async () => {
  const { harness } = await bootstrap();
  harness.queueSelect("Other answer…");
  harness.queueInput("Use an account setting");
  const answer = await harness.callTool("plan_question", {
    question: "Where should the user enable passkeys?",
    options: ["During sign in", "In account settings"],
  });
  assert.match(answer.content[0]!.text, /Use an account setting/);

  harness.queueSelect("Other answer…");
  const literalOption = await harness.callTool("plan_question", {
    question: "Should the literal option be preserved?",
    options: ["Other answer…"],
    allowFreeText: false,
  });
  assert.match(literalOption.content[0]!.text, /User selected: Other answer…/);

  const noUi = await bootstrap({ hasUI: false });
  const unavailable = await noUi.harness.callTool("plan_question", {
    question: "Which rollout should this plan use?",
  });
  assert.match(unavailable.content[0]!.text, /Interactive UI is unavailable/);
});

test("/execute-plan extracts Markdown and starts implementation with subagent guidance", async () => {
  const { cwd, harness } = await bootstrap();
  await harness.callTool("plan_publish", validDraft());

  await harness.runCommand(
    "execute-plan",
    "docs/plan/add-passkey-authentication.html",
  );
  const markdown = await readFile(
    join(cwd, "docs/plan/add-passkey-authentication.md"),
    "utf8",
  );
  assert.match(markdown, /# Add passkey authentication/);
  assert.match(markdown, /#### Subtasks/);
  assert.match(
    harness.sentUserMessages.at(-1) ?? "",
    /Use the active subagent tool only for dependency-independent/i,
  );
  assert.match(
    harness.ctx.ui.notifications.at(-1)?.message ?? "",
    /Extracted docs\/plan\/add-passkey-authentication.html/i,
  );
});

test("/execute-plan reports invalid input without starting an implementation turn", async () => {
  const { harness } = await bootstrap();
  await harness.runCommand("execute-plan", "missing.txt");
  assert.equal(harness.sentUserMessages.length, 0);
  assert.match(
    harness.ctx.ui.notifications.at(-1)?.message ?? "",
    /\.html extension/i,
  );
});
