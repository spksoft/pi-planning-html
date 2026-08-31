import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("/plan contains its internal decision-tree workflow without exposing a skill", async () => {
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
  assert.match(
    prompt,
    /This workflow is part of `\/plan`, not a separately exposed skill/,
  );
  assert.match(prompt, /Ask every frontier item with `plan_question`/);
  assert.match(
    prompt,
    /Skip all remaining questions and apply your best judgment/,
  );
  assert.match(prompt, /Wait for answers to the whole frontier/);
});
