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
  assert.match(prompt, /BCP 47 tag/i);
  assert.match(prompt, /exact project-relative `seams`/i);
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

// These assertions protect prompt coverage; they do not prove a model will follow the guidance.
test("/plan text contains evidence-backed code and conditional UI guidance without a second contract", async () => {
  const promptPath = fileURLToPath(
    new URL("../prompts/plan.md", import.meta.url),
  );
  const prompt = await readFile(promptPath, "utf8");

  assert.match(prompt, /Does the requested behavior need new code at all\?/i);
  assert.match(
    prompt,
    /existing implementation, helper, module, or pattern can be reused/i,
  );
  assert.match(
    prompt,
    /standard library, native platform, or installed dependencies/i,
  );
  assert.match(prompt, /inspect relevant callers.*root-cause/i);
  assert.match(prompt, /simpler evidence-backed alternative considered/i);
  assert.match(prompt, /only when the request materially affects UI/i);
  assert.match(
    prompt,
    /components, tokens, typography, spacing, layouts, navigation/i,
  );
  assert.match(prompt, /Do not infer reuse from similar names/i);
  assert.match(prompt, /loading, empty, error\/retry, success, or disabled/i);
  assert.match(prompt, /screenshots.*not design quality/i);
  assert.match(
    prompt,
    /For non-UI work, do not add irrelevant UI requirements/i,
  );
  assert.match(prompt, /greenfield UI.*material-question workflow/i);
  assert.match(prompt, /`REQ-\*`.*`AC-\*`.*`VAL-\*`/is);
  assert.match(prompt, /do not create a parallel contract/i);
});
