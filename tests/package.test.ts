import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("/plan contains its internal wayfinding and implementation-readiness contract without exposing a skill", async () => {
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
    /part of `\/plan`, not a separately exposed skill or issue-tracker workflow/i,
  );
  assert.match(prompt, /Decisions so far/);
  assert.match(prompt, /Fog/);
  assert.match(prompt, /Frontier/);
  assert.match(prompt, /Out of scope/);
  assert.match(
    prompt,
    /first `plan_question` call opens a native language selector/i,
  );
  assert.match(prompt, /English \(default\).*free-text language option/i);
  assert.match(
    prompt,
    /reissue that question and every later question.*selected language/i,
  );
  assert.match(
    prompt,
    /Ask one currently unblocked `grilling` question at a time/i,
  );
  assert.match(prompt, /recompute the map before asking another/i);
  assert.match(
    prompt,
    /Skip all remaining questions and apply your best judgment/i,
  );
  assert.match(
    prompt,
    /`plan_question` always adds free text and the reserved/i,
  );
  assert.match(prompt, /do not create tracker issues, local map files/i);
  assert.match(prompt, /\*\*Requirements\*\* \(`REQ-\*`\)/i);
  assert.match(prompt, /\*\*Acceptance criteria\*\* \(`AC-\*`\)/i);
  assert.match(prompt, /\*\*Decisions\*\* \(`DEC-\*`\)/i);
  assert.match(prompt, /\*\*Validations\*\* \(`VAL-\*`\)/i);
  assert.match(prompt, /Pre-publication coverage audit/i);
  assert.match(
    prompt,
    /Do not supply Mermaid, raw SVG, HTML, or a freehand diagram/i,
  );
});
