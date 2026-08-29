import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import planningExtension from "../extensions/planning/index.ts";
import { createHarness } from "./harness.ts";
import { validDraft } from "./helpers.ts";

const EXTENSION_PATH = fileURLToPath(
      new URL("../extensions/planning/index.ts", import.meta.url),
);

async function bootstrap(options: { hasUI?: boolean } = {}) {
      const cwd = await mkdtemp(join(tmpdir(), "pi-planning-integration-"));
      const { pi, harness } = createHarness({
            cwd,
            extensionPath: EXTENSION_PATH,
            ...options,
      });
      // SAFETY: the harness implements the ExtensionAPI surface this extension actually uses.
      planningExtension(pi as never);
      await harness.emit("session_start", { reason: "startup" });
      return { cwd, harness };
}

/** Drives the decision tree to a confirmed shared understanding. */
async function reachDrafting(
      harness: Awaited<ReturnType<typeof bootstrap>>["harness"],
) {
      await harness.callTool("plan_map_decisions", {
            nodes: [
                  {
                        id: "session-policy",
                        question: "Should existing sessions remain valid during rollout?",
                        options: [
                              {
                                    id: "preserve",
                                    label: "Preserve existing sessions",
                              },
                              {
                                    id: "reauth",
                                    label: "Require re-authentication",
                              },
                        ],
                        recommendation: "preserve",
                        recommendationRationale:
                              "It avoids unnecessary user disruption.",
                        impact: "This changes rollout and compatibility behavior.",
                  },
            ],
      });
      harness.queueSelect(
            "Recommended · Preserve existing sessions [preserve]",
      );
      await harness.callTool("plan_ask_frontier", {
            nodeIds: ["session-policy"],
      });
      harness.queueConfirm(true);
      await harness.callTool("plan_confirm_understanding", {
            summary: "Preserve existing sessions and reuse the authentication boundary.",
      });
}

test("/plan enters restricted mode and narrows the active tool surface", async () => {
      const { harness } = await bootstrap();
      assert.ok(harness.activeTools.includes("edit"));

      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });

      assert.equal(harness.activeTools.includes("edit"), false);
      assert.equal(harness.activeTools.includes("write"), false);
      assert.equal(harness.activeTools.includes("bash"), false);
      assert.ok(harness.activeTools.includes("plan_update"));
      assert.equal(harness.persistedState()?.phase, "discovering");
});

test("planning blocks mutating and unknown tools through the tool_call gate", async () => {
      const { harness } = await bootstrap();
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });

      const blockedWrite = await harness.emit("tool_call", {
            toolName: "write",
            input: { path: "src/x.ts" },
      });
      assert.equal((blockedWrite as { block?: boolean })?.block, true);

      const blockedBash = await harness.emit("tool_call", {
            toolName: "bash",
            input: { command: "ls" },
      });
      assert.equal((blockedBash as { block?: boolean })?.block, true);

      const allowedRead = await harness.emit("tool_call", {
            toolName: "read",
            input: { path: "README.md" },
      });
      assert.equal(allowedRead, undefined);
});

test("publishing requires confirmed shared understanding and complete What/Why/How tasks", async () => {
      const { cwd, harness } = await bootstrap();
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });

      await assert.rejects(
            () => harness.callTool("plan_update", validDraft()),
            /shared-understanding/i,
      );

      await reachDrafting(harness);
      assert.equal(harness.persistedState()?.phase, "drafting");

      const incomplete = validDraft();
      incomplete.tasks[0] = { ...incomplete.tasks[0]!, how: "TBD" };
      await assert.rejects(
            () => harness.callTool("plan_update", incomplete),
            /How detail/i,
      );

      const result = await harness.callTool("plan_update", validDraft());
      assert.match(result.content[0]!.text, /Published plan revision 1/);
      const html = await readFile(
            join(cwd, "docs/plan/add-passkey-authentication.html"),
            "utf8",
      );
      assert.match(html, /<dt>What<\/dt>/);
      assert.equal(
            harness.persistedState()?.artifact?.path,
            "docs/plan/add-passkey-authentication.html",
      );
});

test("a no-UI session can plan but cannot approve or gain execution permissions", async () => {
      const { harness } = await bootstrap({ hasUI: false });
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });
      await assert.rejects(
            () => harness.callTool("plan_ask_frontier", { nodeIds: ["x"] }),
            /interactive or RPC UI/i,
      );
      assert.equal(harness.persistedState()?.phase, "discovering");
      assert.equal(harness.activeTools.includes("edit"), false);
});

test("approval is revision-bound and guarded execution restores the original tools", async () => {
      const { harness } = await bootstrap();
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });
      await reachDrafting(harness);
      await harness.callTool("plan_update", validDraft());
      const digest = harness.persistedState()?.candidate?.digest ?? "";

      await harness.runCommand("planning-approve", "deadbeef guarded");
      assert.match(
            harness.ctx.ui.notifications.at(-1)?.message ?? "",
            /does not match/i,
      );
      assert.equal(harness.persistedState()?.approval, undefined);

      await harness.runCommand("planning-approve", `${digest} bogus-mode`);
      assert.match(
            harness.ctx.ui.notifications.at(-1)?.message ?? "",
            /guarded, review, or fresh/i,
      );
      assert.equal(harness.persistedState()?.approval, undefined);

      await harness.runCommand("planning-approve", `${digest} guarded`);
      const approved = harness.persistedState();
      assert.equal(approved?.phase, "executing");
      assert.equal(approved?.approval?.candidateDigest, digest);
      assert.ok(harness.activeTools.includes("edit"));
      assert.ok(harness.activeTools.includes("plan_step_status"));
});

test("fresh approval remains locked until the child execution handoff", async () => {
      const { harness } = await bootstrap();
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });
      await reachDrafting(harness);
      await harness.callTool("plan_update", validDraft());
      await harness.runCommand(
            "planning-approve",
            `${harness.persistedState()?.candidate?.digest} fresh`,
      );

      assert.equal(harness.persistedState()?.phase, "approved");
      assert.equal(harness.activeTools.includes("edit"), false);
      const blocked = await harness.emit("tool_call", {
            toolName: "edit",
            input: { path: "src/auth/types.ts" },
      });
      assert.equal((blocked as { block?: boolean })?.block, true);

      await harness.emit("session_start", { reason: "resume" });
      assert.equal(harness.activeTools.includes("edit"), false);
      assert.equal(harness.persistedState()?.phase, "approved");
});

test("guarded execution allows planned paths and gates out-of-plan mutation", async () => {
      const { harness } = await bootstrap();
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });
      await reachDrafting(harness);
      await harness.callTool("plan_update", validDraft());
      await harness.runCommand(
            "planning-approve",
            `${harness.persistedState()?.candidate?.digest} guarded`,
      );

      const planned = await harness.emit("tool_call", {
            toolName: "edit",
            input: { path: "src/auth/types.ts" },
      });
      assert.equal(planned, undefined);

      harness.queueSelect("Block");
      const outOfPlan = await harness.emit("tool_call", {
            toolName: "edit",
            input: { path: "src/unrelated.ts" },
      });
      assert.equal((outOfPlan as { block?: boolean })?.block, true);

      // package.json is planned nowhere and is a dependency manifest: always ask.
      harness.queueSelect("Block");
      const manifest = await harness.emit("tool_call", {
            toolName: "write",
            input: { path: "package.json" },
      });
      assert.equal((manifest as { block?: boolean })?.block, true);
});

test("cancelling an inactive session leaves its tool set unchanged", async () => {
      const { harness } = await bootstrap();
      const before = [...harness.activeTools];
      await harness.runCommand("planning-cancel");
      assert.deepEqual(harness.activeTools, before);
      assert.equal(harness.persistedState(), undefined);
});

test("session restore reapplies branch state and cancel restores the original tools", async () => {
      const { harness } = await bootstrap();
      await harness.emit("input", {
            text: "/plan Add passkeys",
            source: "interactive",
      });
      assert.equal(harness.activeTools.includes("edit"), false);

      await harness.emit("session_start", { reason: "resume" });
      assert.equal(harness.activeTools.includes("edit"), false);
      assert.equal(harness.persistedState()?.phase, "discovering");

      await harness.runCommand("planning-cancel");
      assert.ok(harness.activeTools.includes("edit"));
      assert.equal(harness.persistedState()?.phase, "cancelled");
});
