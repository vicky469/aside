import * as assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseNoteComments, serializeNoteComments } from "../src/core/storage/noteCommentStorage";
import type { Comment } from "../src/commentManager";

const execFile = promisify(execFileCallback);

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "hello",
        selectedTextHash: "hash-1",
        comment: "Original body",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

function buildLegacyNote(overrides: Partial<Comment> = {}): string {
    const comment = createComment(overrides);
    return [
        "# Title",
        "",
        "Body text.",
        "",
        "<!-- SideNote2 comments",
        "[",
        "  {",
        `    "id": ${JSON.stringify(comment.id)},`,
        `    "startLine": ${comment.startLine},`,
        `    "startChar": ${comment.startChar},`,
        `    "endLine": ${comment.endLine},`,
        `    "endChar": ${comment.endChar},`,
        `    "selectedText": ${JSON.stringify(comment.selectedText)},`,
        `    "selectedTextHash": ${JSON.stringify(comment.selectedTextHash)},`,
        `    "comment": ${JSON.stringify(comment.comment)},`,
        `    "timestamp": ${comment.timestamp}`,
        "  }",
        "]",
        "-->",
        "",
    ].join("\n");
}

test("migrate-legacy-note-comments script reports a dry run without rewriting the note", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-migrate-legacy-"));
    const notePath = path.join(tempDir, "note.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/migrate-legacy-note-comments.mjs");
    const original = buildLegacyNote();

    await writeFile(notePath, original, "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--dry-run",
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Dry run: would migrate 1 legacy comments to threaded storage/);
    assert.equal(await readFile(notePath, "utf8"), original);
});

test("migrate-legacy-note-comments script rewrites legacy flat comments into threaded storage", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-migrate-legacy-write-"));
    const notePath = path.join(tempDir, "note.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/migrate-legacy-note-comments.mjs");
    const original = buildLegacyNote();

    await writeFile(notePath, original, "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Migrated 1 legacy comments to threaded storage/);

    const updated = await readFile(notePath, "utf8");
    assert.equal((updated.match(/<!-- SideNote2 comments/g) || []).length, 1);
    assert.match(updated, /"entries": \[/);
    assert.doesNotMatch(updated, /"comment":/);

    const parsed = parseNoteComments(updated, notePath);
    assert.equal(parsed.mainContent, "# Title\n\nBody text.");
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].comment, "Original body");
    assert.equal(parsed.threads[0].entries.length, 1);
    assert.equal(parsed.threads[0].entries[0].id, "comment-1");
});

test("migrate-legacy-note-comments script is a no-op for notes already using threaded storage", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-migrate-legacy-threaded-"));
    const notePath = path.join(tempDir, "note.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/migrate-legacy-note-comments.mjs");
    const original = serializeNoteComments("# Title\n\nBody text.\n", [createComment()]);

    await writeFile(notePath, original, "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Note already uses threaded SideNote2 comments/);
    assert.equal(await readFile(notePath, "utf8"), original);
});

test("migrate-legacy-note-comments script can dry-run a whole vault root and list legacy notes outside the repo subtree", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-migrate-legacy-root-dry-"));
    const scriptPath = path.resolve(process.cwd(), "scripts/migrate-legacy-note-comments.mjs");
    const legacyAPath = path.join(tempDir, "Folder A", "note-a.md");
    const legacyBPath = path.join(tempDir, "Folder B", "Nested", "note-b.md");
    const threadedPath = path.join(tempDir, "Folder C", "note-c.md");

    await mkdir(path.dirname(legacyAPath), { recursive: true });
    await mkdir(path.dirname(legacyBPath), { recursive: true });
    await mkdir(path.dirname(threadedPath), { recursive: true });

    await writeFile(legacyAPath, buildLegacyNote({ id: "legacy-a", filePath: legacyAPath }), "utf8");
    await writeFile(legacyBPath, buildLegacyNote({ id: "legacy-b", filePath: legacyBPath }), "utf8");
    await writeFile(threadedPath, serializeNoteComments("# Title\n\nBody text.\n", [
        createComment({ id: "threaded-c", filePath: threadedPath }),
    ]), "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--root",
        tempDir,
        "--dry-run",
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Dry run: found 2 legacy note\(s\) under/);
    assert.match(stdout, /Folder A\/note-a\.md/);
    assert.match(stdout, /Folder B\/Nested\/note-b\.md/);
    assert.equal((await readFile(legacyAPath, "utf8")).includes('"comment"'), true);
    assert.equal((await readFile(legacyBPath, "utf8")).includes('"comment"'), true);
});

test("migrate-legacy-note-comments script can migrate a whole vault root", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-migrate-legacy-root-write-"));
    const scriptPath = path.resolve(process.cwd(), "scripts/migrate-legacy-note-comments.mjs");
    const legacyAPath = path.join(tempDir, "Folder A", "note-a.md");
    const legacyBPath = path.join(tempDir, "Folder B", "Nested", "note-b.md");

    await mkdir(path.dirname(legacyAPath), { recursive: true });
    await mkdir(path.dirname(legacyBPath), { recursive: true });

    await writeFile(legacyAPath, buildLegacyNote({ id: "legacy-a", filePath: legacyAPath }), "utf8");
    await writeFile(legacyBPath, buildLegacyNote({ id: "legacy-b", filePath: legacyBPath }), "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--root",
        tempDir,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Migrated 2 legacy note\(s\) under/);

    const migratedA = await readFile(legacyAPath, "utf8");
    const migratedB = await readFile(legacyBPath, "utf8");
    assert.match(migratedA, /"entries": \[/);
    assert.match(migratedB, /"entries": \[/);
    assert.doesNotMatch(migratedA, /"comment":/);
    assert.doesNotMatch(migratedB, /"comment":/);
});
