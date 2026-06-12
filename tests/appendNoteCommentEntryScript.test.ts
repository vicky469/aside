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

async function writeSidecar(vaultRoot: string, noteRelativePath: string, threads: CommentThread[]): Promise<void> {
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

test("append-note-comment-entry script appends a new entry to the targeted thread", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-append-script-"));
    const notePath = path.join(tempDir, "note.md");
    const commentPath = path.join(tempDir, "reply.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/append-note-comment-entry.mjs");

    await createVaultDir(tempDir);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(tempDir, "note.md", [commentToThread(createComment())]);
    await writeFile(commentPath, "Reply body\nSecond line\n", "utf8");

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

    assert.match(stdout, /Appended a new entry to comment comment-1/);

    const sidecar = await readSidecar(tempDir, "note.md");
    assert.ok(sidecar);
    assert.equal(sidecar!.threads.length, 1);
    assert.equal(sidecar!.threads[0].entries.length, 2);
    assert.equal(sidecar!.threads[0].entries[0].body, "Original body");
    assert.equal(sidecar!.threads[0].entries[1].body, "Reply body\nSecond line");

    const noteContent = await readFile(notePath, "utf8");
    assert.equal(noteContent, "# Title\n\nBody text.\n");
});

test("append-note-comment-entry script can target a thread by obsidian Aside URI", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-comment-uri-append-script-"));
    const homeDir = path.join(tempDir, "home");
    const vaultRoot = path.join(tempDir, "Public Vault");
    const notePath = path.join(vaultRoot, "Folder", "Note.md");
    const commentPath = path.join(tempDir, "reply.md");
    const scriptPath = path.resolve(process.cwd(), "scripts/append-note-comment-entry.mjs");
    const noteFilePath = "Folder/Note.md";

    await mkdir(path.dirname(notePath), { recursive: true });
    await createVaultDir(vaultRoot);
    await writeObsidianVaultConfig(homeDir, vaultRoot);
    await writeFile(notePath, "# Title\n\nBody text.\n", "utf8");
    await writeSidecar(vaultRoot, noteFilePath, [commentToThread(createComment({
        filePath: noteFilePath,
    }))]);
    await writeFile(commentPath, "Reply from URI\nSecond line\n", "utf8");

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

    assert.match(stdout, /Appended a new entry to comment comment-1/);

    const sidecar = await readSidecar(vaultRoot, noteFilePath);
    assert.ok(sidecar);
    assert.equal(sidecar!.threads[0].entries.length, 2);
    assert.equal(sidecar!.threads[0].entries[1].body, "Reply from URI\nSecond line");
});
