import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("/plan contains its internal wayfinding workflow without exposing a skill", async () => {
  const packagePath = fileURLToPath(
    new URL("../package.json", import.meta.url),
  );
  const promptPath = fileURLToPath(
    new URL("../prompts/plan.md", import.meta.url),
  );
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
    files: string[];
    pi: Record<string, unknown>;
  };

  assert.equal(manifest.files.includes("skills"), false);
  assert.equal("skills" in manifest.pi, false);

  const prompt = await readFile(promptPath, "utf8");
  assert.match(prompt, /single-session adaptation of Wayfinder/i);
  assert.match(
    prompt,
    /part of `\/plan`, not a separately exposed skill or issue-tracker workflow/,
  );
  assert.match(prompt, /Name the destination first/);
  assert.match(prompt, /Decisions so far/);
  assert.match(prompt, /Fog/);
  assert.match(prompt, /Frontier/);
  assert.match(prompt, /Out of scope/);
  assert.match(prompt, /Every frontier item must read as a question/);
  assert.match(prompt, /`grilling` \(HITL\)/);
  assert.match(prompt, /`prototype` \(HITL\)/);
  assert.match(prompt, /`research` \(AFK\)/);
  assert.match(prompt, /`task` \(AFK or HITL\)/);
  assert.match(
    prompt,
    /Ask one currently unblocked `grilling` question at a time/,
  );
  assert.match(prompt, /recompute the map before asking another/);
  assert.match(
    prompt,
    /Skip all remaining questions and apply your best judgment/,
  );
  assert.match(prompt, /at least four concrete choices/i);
  assert.match(prompt, /always adds a free-text answer choice/i);
  assert.match(prompt, /do not create tracker issues, local map files/i);
});
