import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
    commentToThread,
    type Comment,
    type CommentThread,
    type CommentThreadEntry,
    type CommentThreadEntryAnchor,
} from "../src/commentManager";

const execFile = promisify(execFileCallback);

function hashText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function getSidecarPath(vaultRoot: string, noteRelativePath: string): string {
    const hash = hashText(noteRelativePath);
    const shard = hash.slice(0, 2);
    return path.join(vaultRoot, ".obsidian", "plugins", "aside", "sidenotes", "by-note", shard, `${hash}.json`);
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

async function writeSidecar(vaultRoot: string, noteRelativePath: string, threads: unknown[]): Promise<void> {
    const sidecarPath = getSidecarPath(vaultRoot, noteRelativePath);
    await mkdir(path.dirname(sidecarPath), { recursive: true });
    await writeFile(sidecarPath, `${JSON.stringify({
        version: 1,
        notePath: noteRelativePath,
        threads,
    })}\n`, "utf8");
}

async function createVaultDir(tempDir: string): Promise<void> {
    await mkdir(path.join(tempDir, ".obsidian", "plugins", "aside"), { recursive: true });
}

async function writeObsidianVaultConfig(homeDir: string, vaultRoot: string): Promise<void> {
    const configPath = path.join(homeDir, ".config", "obsidian", "obsidian.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
        vaults: {
            "vault-1": {
                path: vaultRoot,
            },
        },
    }, null, 2), "utf8");
}

function buildCommentLocationUri(vaultName: string, filePath: string, commentId: string): string {
    return `obsidian://aside-comment?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}&commentId=${encodeURIComponent(commentId)}`;
}

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
        ...overrides,
    };
}

test("update-note-comment script replaces the targeted comment body", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-script-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/update-note-comment.mjs");

    await createVaultDir(tempDir);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(tempDir, "note.md", [commentToThread(createComment())]);
    await writeFile(commentPath, "Updated body\nSecond line\n", "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--id",
        "comment-1",
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Updated comment comment-1/);

    const sidecar = await readSidecar(tempDir, "note.md");
    assert.ok(sidecar);
    assert.equal(sidecar.threads.length, 1);
    assert.equal(sidecar.threads[0].entries.length, 1);
    assert.equal(sidecar.threads[0].entries[0].body, "Updated body\nSecond line");

    const noteContent = await readFile(notePath, "utf8");
    assert.equal(noteContent, "# Title\n\nBody text.\n");
});

test("update-note-comment canonicalizes legacy sidecars and skips malformed threads", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-update-legacy-script-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/update-note-comment.mjs");
    const thread = commentToThread(createComment());

    await createVaultDir(tempDir);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(tempDir, "note.md", [
        null,
        { id: "missing-entries" },
        {
            ...thread,
            resolved: true,
            legacyOnly: "remove me",
            entries: thread.entries.map((entry) => ({
                ...entry,
                legacyOnly: "remove me too",
            })),
        },
        42,
    ]);
    await writeFile(commentPath, "Canonical update\n", "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--id",
        "comment-1",
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Updated comment comment-1/);

    const sidecar = await readSidecar(tempDir, "note.md");
    assert.ok(sidecar);
    assert.deepEqual(sidecar.threads.map((candidate) => candidate.id), ["comment-1"]);
    assert.equal(sidecar.threads[0].entries[0].body, "Canonical update");
    assert.equal(Object.prototype.hasOwnProperty.call(sidecar.threads[0], "resolved"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(sidecar.threads[0], "legacyOnly"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(sidecar.threads[0].entries[0], "legacyOnly"), false);
});

test("update-note-comment repairs a genuinely empty thread without converting corrupt entries", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-update-empty-script-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/update-note-comment.mjs");
    const emptyThread = {
        ...commentToThread(createComment({
            id: "empty-thread",
            timestamp: 1710000000100,
        })),
        entries: [],
        updatedAt: 1710000000200,
    };
    const corruptThread = {
        ...commentToThread(createComment({
            id: "corrupt-thread",
            timestamp: 1710000000300,
        })),
        entries: [null, { id: "broken-entry" }],
    };

    await createVaultDir(tempDir);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(tempDir, "note.md", [emptyThread, corruptThread]);
    await writeFile(commentPath, "Recovered update\n", "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--id",
        "empty-thread",
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Updated comment empty-thread/);

    const sidecar = await readSidecar(tempDir, "note.md");
    assert.ok(sidecar);
    assert.deepEqual(sidecar.threads.map((thread) => thread.id), ["empty-thread"]);
    assert.deepEqual(sidecar.threads[0].entries, [{
        id: "empty-thread",
        body: "Recovered update",
        timestamp: 1710000000200,
    }]);
});

test("update-note-comment preserves every current canonical thread field", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-update-field-parity-script-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/update-note-comment.mjs");
    const anchor = {
        filePath: "note.md",
        startLine: 4,
        startChar: 1,
        endLine: 4,
        endChar: 8,
        selectedText: "anchored",
        selectedTextHash: "hash-anchored",
        anchorKind: "selection" as const,
        orphaned: false,
    } satisfies Record<keyof CommentThreadEntryAnchor, unknown>;
    const entry = {
        id: "entry-1",
        body: "Original child body",
        timestamp: 1710000000200,
        deletedAt: 1710000000250,
        anchor,
    } satisfies Record<keyof CommentThreadEntry, unknown>;
    const thread = {
        id: "thread-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "thread target",
        selectedTextHash: "hash-thread",
        anchorKind: "selection" as const,
        orphaned: true,
        isPinned: true,
        deletedAt: 1710000000300,
        entries: [entry],
        createdAt: 1710000000000,
        updatedAt: 1710000000200,
    } satisfies Record<keyof CommentThread, unknown>;

    await createVaultDir(tempDir);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(tempDir, "note.md", [thread]);
    await writeFile(commentPath, "Updated child body\n", "utf8");

    await execFile("node", [
        scriptPath,
        "--file",
        notePath,
        "--id",
        "entry-1",
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
    });

    const sidecar = await readSidecar(tempDir, "note.md");
    assert.ok(sidecar);
    assert.deepEqual(sidecar.threads, [{
        ...thread,
        entries: [{
            ...entry,
            body: "Updated child body",
        }],
    }]);
});

test("update-note-comment script can target a stored comment by obsidian Aside URI", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-uri-script-"));
    const homeDir = path.join(tempDir, "home");
    const vaultRoot = path.join(tempDir, "Public Vault");
    const notePath = path.join(vaultRoot, "Folder", "Note.md");
    const commentPath = path.join(tempDir, "comment.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/update-note-comment.mjs");
    const noteFilePath = "Folder/Note.md";

    await mkdir(path.dirname(notePath), { recursive: true });
    await createVaultDir(vaultRoot);
    await writeObsidianVaultConfig(homeDir, vaultRoot);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(vaultRoot, noteFilePath, [commentToThread(createComment({
        filePath: noteFilePath,
    }))]);
    await writeFile(commentPath, "Updated from URI\nSecond line\n", "utf8");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--uri",
        buildCommentLocationUri("Public Vault", noteFilePath, "comment-1"),
        "--comment-file",
        commentPath,
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            HOME: homeDir,
        },
    });

    assert.match(stdout, /Updated comment comment-1/);

    const sidecar = await readSidecar(vaultRoot, noteFilePath);
    assert.ok(sidecar);
    assert.equal(sidecar.threads[0].entries.length, 1);
    assert.equal(sidecar.threads[0].entries[0].body, "Updated from URI\nSecond line");
});
