import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import planningExtension from "../extensions/planning/index.ts";
import {
  createCandidate,
  renderPlanHtml,
} from "../extensions/planning/artifact.ts";
import { createHarness } from "./harness.ts";
import { validDraft } from "./helpers.ts";

async function bootstrap(options: { hasUI?: boolean } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-planning-integration-"));
  await Promise.all([
    mkdir(join(cwd, "src/auth"), { recursive: true }),
    mkdir(join(cwd, "tests/auth"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(cwd, "src/auth/types.ts"), "export {};\n"),
    writeFile(join(cwd, "src/auth/service.ts"), "export {};\n"),
    writeFile(join(cwd, "src/auth/routes.ts"), "export {};\n"),
    writeFile(join(cwd, "tests/auth/routes.test.ts"), "export {};\n"),
  ]);
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

test("plan_publish creates one validated offline HTML artifact, stores integrity data, and terminates planning", async () => {
  const { cwd, harness } = await bootstrap();
  const published = await harness.callTool(
    "plan_publish",
    validDraft() as unknown as Record<string, unknown>,
  );
  assert.equal(published.terminate, true);
  assert.match(
    published.content[0]!.text,
    /Planning is complete; do not implement/i,
  );
  const details = published.details as Record<string, unknown>;
  assert.match(String(details.candidateDigest), /^[a-f0-9]{64}$/);
  assert.match(String(details.markdownHash), /^[a-f0-9]{64}$/);
  assert.match(String(details.contentHash), /^[a-f0-9]{64}$/);

  const htmlPath = join(cwd, "docs/plan/add-passkey-authentication.html");
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /data-plan-format="pi-plan-html-v2"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Task dependency order/);
  assert.match(html, /<svg /);
  assert.doesNotMatch(html, /mermaid|<script\b|https?:\/\//i);

  const invalidSubtask = validDraft();
  invalidSubtask.tasks[0] = { ...invalidSubtask.tasks[0]!, subtasks: [] };
  await assert.rejects(
    () =>
      harness.callTool(
        "plan_publish",
        invalidSubtask as unknown as Record<string, unknown>,
      ),
    /subtask/i,
  );

  const invalidArchitecture = validDraft();
  invalidArchitecture.architecture.nodes = [];
  await assert.rejects(
    () =>
      harness.callTool(
        "plan_publish",
        invalidArchitecture as unknown as Record<string, unknown>,
      ),
    /Architecture design/i,
  );
});

test("plan_question enforces unique choices, reserved skip behavior, and native free-text answers", async () => {
  const { harness } = await bootstrap();
  const options = [
    "During sign in",
    "In account settings",
    "After account recovery",
    "In an onboarding flow",
  ];

  await assert.rejects(
    () =>
      harness.callTool("plan_question", {
        question: "Where should the user enable passkeys?",
        options: options.slice(0, 3),
      }),
    /at least 4 choices/i,
  );
  await assert.rejects(
    () =>
      harness.callTool("plan_question", {
        question: "Where should the user enable passkeys?",
        options: [...options.slice(0, 3), ` ${options[0]!.toUpperCase()} `],
      }),
    /unique/i,
  );
  await assert.rejects(
    () =>
      harness.callTool("plan_question", {
        question: "Where should the user enable passkeys?",
        options: [...options, "In a security prompt", "At first purchase"],
      }),
    /at most 5 choices/i,
  );
  await assert.rejects(
    () =>
      harness.callTool("plan_question", {
        question: "Where should the user enable passkeys?",
        options: [
          ...options.slice(0, 3),
          "Skip all remaining questions and apply your best judgment",
        ],
      }),
    /reserved skip/i,
  );

  harness.queueSelect(
    "Skip all remaining questions and apply your best judgment",
  );
  const skipped = await harness.callTool("plan_question", {
    question: "Where should the user enable passkeys?",
    options,
  });
  assert.equal(
    (skipped.details as { skipRemaining: boolean; kind: string }).skipRemaining,
    true,
  );
  assert.equal((skipped.details as { kind: string }).kind, "skip-remaining");

  harness.queueSelect("Other answer…");
  harness.queueInput("Use an account setting");
  const answer = await harness.callTool("plan_question", {
    question: "Where should the user enable passkeys?",
    options,
  });
  assert.match(answer.content[0]!.text, /Use an account setting/);
  assert.equal(
    (answer.details as { skipRemaining: boolean; kind: string }).skipRemaining,
    false,
  );
  assert.equal((answer.details as { kind: string }).kind, "free-text");

  const noUi = await bootstrap({ hasUI: false });
  const unavailable = await noUi.harness.callTool("plan_question", {
    question: "Which rollout should this plan use?",
    options,
  });
  assert.match(unavailable.content[0]!.text, /Interactive UI is unavailable/);
});

test("/execute-plan explicitly resolves a plan file, validates it, extracts Markdown, and starts implementation", async () => {
  const { cwd, harness } = await bootstrap();
  await harness.callTool(
    "plan_publish",
    validDraft() as unknown as Record<string, unknown>,
  );

  await harness.runCommand("execute-plan", "add-passkey-authentication");
  const markdown = await readFile(
    join(cwd, "docs/plan/add-passkey-authentication.md"),
    "utf8",
  );
  assert.match(markdown, /# Add passkey authentication/);
  assert.match(markdown, /#### Detailed decomposition subtasks/);
  assert.match(
    harness.sentUserMessages.at(-1) ?? "",
    /The user explicitly approved this plan/i,
  );
  assert.match(
    harness.sentUserMessages.at(-1) ?? "",
    /verify that the named source seams/i,
  );
  assert.match(
    harness.sentUserMessages.at(-1) ?? "",
    /Use the active subagent tool only for dependency-independent/i,
  );
  assert.match(
    harness.ctx.ui.notifications.at(-1)?.message ?? "",
    /Extracted docs\/plan\/add-passkey-authentication.html/i,
  );
});

test("/execute-plan without a file approves only the exact latest integrity-verified artifact", async () => {
  const { cwd, harness } = await bootstrap();
  await harness.callTool(
    "plan_publish",
    validDraft() as unknown as Record<string, unknown>,
  );

  await harness.runCommand("execute-plan");
  assert.match(
    await readFile(
      join(cwd, "docs/plan/add-passkey-authentication.md"),
      "utf8",
    ),
    /# Add passkey authentication/,
  );
  assert.match(
    harness.sentUserMessages.at(-1) ?? "",
    /explicitly approved this plan/i,
  );

  const htmlPath = join(cwd, "docs/plan/add-passkey-authentication.html");
  const markdownPath = join(cwd, "docs/plan/add-passkey-authentication.md");
  const replacement = validDraft({
    summary:
      "A different self-consistent candidate replaces the approved artifact at the same slug.",
  });
  await writeFile(
    htmlPath,
    renderPlanHtml(createCandidate(replacement)),
    "utf8",
  );
  await writeFile(markdownPath, "must not be overwritten\n");
  const beforeMessages = harness.sentUserMessages.length;
  await harness.runCommand("execute-plan");
  assert.equal(harness.sentUserMessages.length, beforeMessages);
  assert.equal(
    await readFile(markdownPath, "utf8"),
    "must not be overwritten\n",
  );
  assert.match(
    harness.ctx.ui.notifications.at(-1)?.message ?? "",
    /changed after publication/i,
  );
});

test("/execute-plan without current v2 context reports how to supply a file", async () => {
  const { harness } = await bootstrap();
  await harness.runCommand("execute-plan");
  assert.equal(harness.sentUserMessages.length, 0);
  assert.match(
    harness.ctx.ui.notifications.at(-1)?.message ?? "",
    /integrity-verified planning artifact/i,
  );
});
