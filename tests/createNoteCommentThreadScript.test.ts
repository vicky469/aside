import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseNoteComments, serializeNoteCommentThreads } from "../src/core/storage/noteCommentStorage";
import type { CommentThread } from "../src/commentManager";

const execFile = promisify(execFileCallback);

function hashText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: "thread-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "hello",
        selectedTextHash: "hash-1",
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
        entries: [
            {
                id: "entry-1",
                body: "Original body",
                timestamp: 1710000000000,
            },
            {
                id: "entry-2",
                body: "Follow-up reply",
                timestamp: 1710000001000,
            },
        ],
        createdAt: 1710000000000,
        updatedAt: 1710000001000,
        ...overrides,
    };
}

test("create-note-comment-thread script creates a page note thread", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-comment-create-page-"));
    const notePath = path.join(tempDir, "My Note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/create-note-comment-thread.mjs");

    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeFile(commentPath, "New page note\nSecond line\n", "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--page",
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Created page note thread/);

    const updated = await readFile(notePath, "utf8");
    const parsed = parseNoteComments(updated, notePath);
    assert.equal(parsed.threads.length, 1);
    assert.equal(parsed.threads[0].anchorKind, "page");
    assert.equal(parsed.threads[0].selectedText, "My Note");
    assert.equal(parsed.threads[0].selectedTextHash, hashText("My Note"));
    assert.equal(parsed.threads[0].startLine, 0);
    assert.equal(parsed.threads[0].entries.length, 1);
    assert.equal(parsed.threads[0].entries[0].body, "New page note\nSecond line");
    assert.equal(parsed.mainContent, "# Title\n\nBody text.");
});

test("create-note-comment-thread script creates an anchored thread without flattening existing replies", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-comment-create-anchor-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/create-note-comment-thread.mjs");
    const original = serializeNoteCommentThreads("# Title\n\nBody text.\n", [createThread()]);

    await writeFile(notePath, original, "utf8");
    await writeFile(commentPath, "New anchored note\nSecond line\n", "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--selected-text",
        "Priority conflicts",
        "--start-line",
        "3",
        "--start-char",
        "2",
        "--end-line",
        "3",
        "--end-char",
        "20",
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Created anchored note thread/);

    const updated = await readFile(notePath, "utf8");
    const parsed = parseNoteComments(updated, notePath);
    assert.equal(parsed.threads.length, 2);
    assert.equal(parsed.threads[0].entries.length, 2);
    assert.equal(parsed.threads[0].entries[0].body, "Original body");
    assert.equal(parsed.threads[0].entries[1].body, "Follow-up reply");

    const nextThread = parsed.threads[1];
    assert.equal(nextThread.anchorKind, "selection");
    assert.equal(nextThread.selectedText, "Priority conflicts");
    assert.equal(nextThread.selectedTextHash, hashText("Priority conflicts"));
    assert.equal(nextThread.startLine, 3);
    assert.equal(nextThread.startChar, 2);
    assert.equal(nextThread.endLine, 3);
    assert.equal(nextThread.endChar, 20);
    assert.equal(nextThread.entries.length, 1);
    assert.equal(nextThread.entries[0].body, "New anchored note\nSecond line");
});

test("create-note-comment-thread script rejects unsupported legacy flat payloads", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-comment-create-legacy-"));
    const notePath = path.join(tempDir, "note.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/create-note-comment-thread.mjs");

    await writeFile(notePath, [
        "# Title",
        "",
        "Body text.",
        "",
        "<!-- SideNote2 comments",
        "[",
        "  {",
        "    \"id\": \"comment-1\",",
        "    \"startLine\": 1,",
        "    \"startChar\": 2,",
        "    \"endLine\": 1,",
        "    \"endChar\": 7,",
        "    \"selectedText\": \"hello\",",
        "    \"selectedTextHash\": \"hash-1\",",
        "    \"comment\": \"Original body\",",
        "    \"timestamp\": 1710000000000",
        "  }",
        "]",
        "-->",
        "",
    ].join("\n"), "utf8");

    let failure: { stderr: string } | null = null;
    try {
        await execFile("node", [
            scriptPath,
            "--file",
            notePath,
            "--page",
            "--comment",
            "New page note",
        ], {
            cwd: process.cwd(),
        });
    } catch (error) {
        failure = error as { stderr: string };
    }

    assert.ok(failure);
    assert.match(failure.stderr, /not a supported threaded entries\[\] payload/);
});
