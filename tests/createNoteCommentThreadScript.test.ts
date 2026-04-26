import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { serializeNoteCommentThreads } from "../src/core/storage/noteCommentStorage";
import type { CommentThread } from "../src/commentManager";

const execFile = promisify(execFileCallback);

function hashText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function getSidecarPath(vaultRoot: string, noteRelativePath: string): string {
    const hash = hashText(noteRelativePath);
    const shard = hash.slice(0, 2);
    return path.join(vaultRoot, ".obsidian", "plugins", "side-note2", "sidenotes", "by-note", shard, `${hash}.json`);
}

async function readSidecar(vaultRoot: string, noteRelativePath: string): Promise<{ version: number; notePath: string; threads: CommentThread[] } | null> {
    const sidecarPath = getSidecarPath(vaultRoot, noteRelativePath);
    try {
        const raw = await readFile(sidecarPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.threads)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function createVaultDir(tempDir: string): Promise<void> {
    await mkdir(path.join(tempDir, ".obsidian", "plugins", "side-note2"), { recursive: true });
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

    await createVaultDir(tempDir);
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

    const sidecar = await readSidecar(tempDir, "My Note.md");
    assert.ok(sidecar);
    assert.equal(sidecar!.threads.length, 1);
    assert.equal(sidecar!.threads[0].anchorKind, "page");
    assert.equal(sidecar!.threads[0].selectedText, "My Note");
    assert.equal(sidecar!.threads[0].selectedTextHash, hashText("My Note"));
    assert.equal(sidecar!.threads[0].startLine, 0);
    assert.equal(sidecar!.threads[0].entries.length, 1);
    assert.equal(sidecar!.threads[0].entries[0].body, "New page note\nSecond line");

    const noteContent = await readFile(notePath, "utf8");
    assert.equal(noteContent, "# Title\n\nBody text.\n");
});

test("create-note-comment-thread script creates an anchored thread without flattening existing replies", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-comment-create-anchor-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/create-note-comment-thread.mjs");
    const original = serializeNoteCommentThreads("# Title\n\nBody text.\n", [createThread()]);

    await createVaultDir(tempDir);
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

    const sidecar = await readSidecar(tempDir, "note.md");
    assert.ok(sidecar);
    assert.equal(sidecar!.threads.length, 2);
    assert.equal(sidecar!.threads[0].entries.length, 2);
    assert.equal(sidecar!.threads[0].entries[0].body, "Original body");
    assert.equal(sidecar!.threads[0].entries[1].body, "Follow-up reply");

    const nextThread = sidecar!.threads[1];
    assert.equal(nextThread.anchorKind, "selection");
    assert.equal(nextThread.selectedText, "Priority conflicts");
    assert.equal(nextThread.selectedTextHash, hashText("Priority conflicts"));
    assert.equal(nextThread.startLine, 3);
    assert.equal(nextThread.startChar, 2);
    assert.equal(nextThread.endLine, 3);
    assert.equal(nextThread.endChar, 20);
    assert.equal(nextThread.entries.length, 1);
    assert.equal(nextThread.entries[0].body, "New anchored note\nSecond line");

    const noteContent = await readFile(notePath, "utf8");
    assert.equal(noteContent, "# Title\n\nBody text.\n");
});

test("create-note-comment-thread script rejects unsupported legacy flat payloads", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-comment-create-legacy-"));
    const notePath = path.join(tempDir, "note.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/create-note-comment-thread.mjs");

    await createVaultDir(tempDir);
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

test("create-note-comment-thread script rejects notes with two SideNote2 managed blocks", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-comment-create-duplicate-"));
    const notePath = path.join(tempDir, "note.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/create-note-comment-thread.mjs");
    const first = serializeNoteCommentThreads("# Title\n\nBody text.\n", [createThread()]);
    const second = serializeNoteCommentThreads("# Title\n\nBody text.\n", [createThread({
        id: "thread-2",
        selectedText: "next",
        selectedTextHash: hashText("next"),
        entries: [{
            id: "entry-3",
            body: "Different thread",
            timestamp: 1710000002000,
        }],
        createdAt: 1710000002000,
        updatedAt: 1710000002000,
    })]);

    await createVaultDir(tempDir);
    await writeFile(
        notePath,
        `${first.trimEnd()}\n\n${second.slice(second.indexOf("<!-- SideNote2 comments"))}\n`,
        "utf8",
    );

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
    assert.match(failure.stderr, /multiple SideNote2 comments blocks/);
});
