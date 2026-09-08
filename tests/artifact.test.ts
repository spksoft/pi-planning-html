import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    captureRepositorySnapshot,
    compareRepositorySnapshot,
    createCandidate,
    digestValue,
    extractPlanMarkdown,
    hashText,
    markdownPathForPlan,
    readPlanMarkdown,
    renderPlanHtml,
    renderPlanMarkdown,
    verifyPlanArtifact,
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

test("HTML is offline, script-free, escaped, accessible, and round-trips canonical Markdown", () => {
    const draft = validDraft({
        title: "Auth <script>alert(1)</script> </template>",
        architecture: {
            summary:
                "The architecture <script>alert(1)</script> keeps browser requests inside the authentication service boundary.",
            nodes: [
                {
                    id: "browser",
                    label: "<script>alert(1)</script>",
                    kind: "actor",
                    responsibility:
                        "Submit a credential to the route boundary.",
                    taskIds: ["wire-passkey-route"],
                },
                ...validDraft().architecture.nodes.slice(1),
            ],
            edges: validDraft().architecture.edges,
        },
    });
    const candidate = createCandidate(draft, "2026-08-28T00:00:00.000Z");
    const markdown = renderPlanMarkdown(candidate);
    const html = renderPlanHtml(candidate);

    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/i);
    assert.match(
        html,
        /Auth &lt;script&gt;alert\(1\)&lt;\/script&gt; &lt;\/template&gt;/,
    );
    assert.match(html, /data-plan-format="pi-plan-html-v2"/);
    assert.match(html, /<html lang="en"/);
    assert.match(html, /<meta name="plan-language" content="en">/);
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /<nav class="toc"/);
    assert.match(html, /<svg /);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /Task dependency order/);
    assert.match(html, /Task dependency relationships and execution order/);
    assert.match(html, /<th scope="col">Order<\/th>/);
    assert.match(html, /Downstream work/);
    assert.match(html, /Traceability matrix/);
    assert.match(html, /Publication coverage audit/);
    assert.match(html, /Expected behavior/);
    assert.match(html, /Parallel safety/);
    assert.match(html, /Settled decisions/);
    assert.match(html, /Repository and source evidence/);
    assert.match(
        html,
        /<strong>Observed seams:<\/strong> src\/auth\/types\.ts/,
    );
    assert.match(html, /Unknowns and deferrals/);
    assert.match(html, /@media print/);
    assert.doesNotMatch(
        html,
        /<script\b|<link\b|<iframe\b|<foreignObject\b|\son[a-z]+\s*=|https?:\/\//i,
    );
    assert.doesNotMatch(html, /mermaid/i);
    assert.match(html, /<template id="pi-plan-snapshot"/);
    assert.match(markdown, /## Repository snapshot/);
    assert.match(markdown, /## Architecture design[\s\S]*### Components/);
    assert.match(markdown, /## Traceability matrix/);
    assert.match(markdown, /## Publication coverage audit/);
    assert.match(markdown, /\*\*Expected behavior:\*\*/);
    assert.match(markdown, /## Decisions/);
    assert.match(markdown, /candidate-sha256:/);
    assert.equal(extractPlanMarkdown(html), markdown);
    assert.equal(
        verifyPlanArtifact(html, candidate.digest).markdownHash,
        hashText(markdown),
    );
});

test("oversized graphs fall back to their canonical relationship tables", () => {
    const source = validDraft().tasks[0]!;
    const architectureNode = validDraft().architecture.nodes[1]!;
    const draft = validDraft({
        architecture: {
            summary: validDraft().architecture.summary,
            nodes: Array.from({ length: 41 }, (_, index) => ({
                ...architectureNode,
                id: `component-${index + 1}`,
                label: `Component ${index + 1}`,
            })),
            edges: [],
        },
        tasks: Array.from({ length: 41 }, (_, index) => ({
            ...source,
            id: `task-${index + 1}`,
            title: `Independent implementation task ${index + 1}`,
            dependsOn: [],
            subtasks: source.subtasks.map((subtask) => ({
                ...subtask,
                id: `task-${index + 1}.detail`,
            })),
        })),
    });
    const html = renderPlanHtml(createCandidate(draft));
    assert.match(html, /diagram is omitted because the graph is oversized/i);
    assert.match(html, /Task dependency relationships and execution order/);
    assert.match(html, /Architecture components and task relationships/);
    assert.match(html, /task-41/);
});

test("extractor rejects missing, duplicate, malformed, mismatched, and unexpected-candidate payloads", () => {
    assert.throws(
        () => extractPlanMarkdown("<html></html>"),
        /supported Pi Planning v2|metadata value/i,
    );
    const candidate = createCandidate(validDraft());
    const html = renderPlanHtml(candidate);
    const duplicate = html.replace(
        "</head>",
        `<meta name="plan-candidate-digest" content="${candidate.digest}"></head>`,
    );
    assert.throws(() => extractPlanMarkdown(duplicate), /exactly one/i);
    const changedPayload = html.replace(
        "# Add passkey authentication",
        "# Tampered plan",
    );
    assert.throws(() => extractPlanMarkdown(changedPayload), /integrity hash/i);
    assert.throws(
        () => verifyPlanArtifact(html, "a".repeat(64)),
        /does not match the candidate/i,
    );
    const unsafeSnapshot = html.replace(
        /<template id="pi-plan-snapshot"[^>]*>[\s\S]*?<\/template>/,
        `<template id="pi-plan-snapshot" data-format="repository-snapshot-v1">{&quot;observedFiles&quot;:[{&quot;path&quot;:&quot;../outside.txt&quot;,&quot;hash&quot;:&quot;${"a".repeat(64)}&quot;}]}</template>`,
    );
    assert.throws(
        () => extractPlanMarkdown(unsafeSnapshot),
        /snapshot is invalid/i,
    );
    const legacyArtifact = html.replace(
        /\n<template id="pi-plan-snapshot"[^>]*>[\s\S]*?<\/template>/,
        "",
    );
    assert.equal(verifyPlanArtifact(legacyArtifact).snapshot, undefined);
});

test("repository snapshots identify changed observed seams", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-planning-snapshot-"));
    await mkdir(join(cwd, "src/auth"), { recursive: true });
    await Promise.all([
        writeFile(join(cwd, "src/auth/types.ts"), "types\n"),
        writeFile(join(cwd, "src/auth/service.ts"), "service\n"),
        writeFile(join(cwd, "src/auth/routes.ts"), "routes\n"),
        mkdir(join(cwd, "tests/auth"), { recursive: true }),
    ]);
    await writeFile(join(cwd, "tests/auth/routes.test.ts"), "tests\n");
    const snapshot = await captureRepositorySnapshot(cwd, validDraft());
    assert.equal(snapshot.observedFiles.length, 4);
    await writeFile(join(cwd, "src/auth/service.ts"), "changed\n");
    const comparison = await compareRepositorySnapshot(cwd, snapshot);
    assert.deepEqual(comparison.changedPaths, ["src/auth/service.ts"]);
    assert.equal(comparison.gitHeadChanged, false);
});

test("artifact writes atomically, records integrity digests, and writes extracted Markdown beside it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-planning-artifact-"));
    const candidate = createCandidate(validDraft());
    const record = await writePlanArtifact(cwd, "docs/plan", candidate);
    assert.equal(record.path, "docs/plan/add-passkey-authentication.html");
    const html = await readFile(record.absolutePath, "utf8");
    assert.equal(hashText(html), record.contentHash);
    assert.equal(
        verifyPlanArtifact(html, candidate.digest).markdownHash,
        record.markdownHash,
    );

    const markdown = await readPlanMarkdown(
        record.absolutePath,
        candidate.digest,
    );
    const markdownPath = markdownPathForPlan(record.absolutePath);
    await writeExtractedMarkdown(markdownPath, markdown);
    assert.equal(await readFile(markdownPath, "utf8"), markdown);

    await writeFile(
        record.absolutePath,
        html.replace("# Add passkey authentication", "# Tampered"),
        "utf8",
    );
    await assert.rejects(
        () => readPlanMarkdown(record.absolutePath, candidate.digest),
        /integrity hash/i,
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
