import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { commentToThread, type Comment } from "../src/commentManager";
import { serializeNoteCommentThreads } from "../src/core/storage/noteCommentStorage";

const execFile = promisify(execFileCallback);

function hashText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function getSidecarPath(vaultRoot: string, noteRelativePath: string): string {
    const hash = hashText(noteRelativePath);
    const shard = hash.slice(0, 2);
    return path.join(vaultRoot, ".obsidian", "plugins", "aside", "sidenotes", "by-note", shard, `${hash}.json`);
}

async function readSidecar(vaultRoot: string, noteRelativePath: string): Promise<{ version: number; notePath: string; threads: Array<{ id: string; resolved: boolean; entries: Array<{ id: string; body: string; timestamp: number }> }> } | null> {
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
    await mkdir(path.join(tempDir, ".obsidian", "plugins", "aside"), { recursive: true });
}

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "note.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "note",
        selectedTextHash: overrides.selectedTextHash ?? "hash:note",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 1710000000000,
        anchorKind: overrides.anchorKind ?? "page",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("generate-large-graph-fixture preserves existing Aside threads in fixture notes", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-graph-fixture-"));
    const scriptPath = path.resolve(process.cwd(), "scripts/generate-large-graph-fixture.mjs");
    const noteRelativePath = "Aside Graph Fixtures/graph-1000/size-30/chain/g30-chain-c01-n01.md";
    const notePath = path.join(tempDir, noteRelativePath);

    await mkdir(path.dirname(notePath), { recursive: true });
    await createVaultDir(tempDir);

    const syntheticThread = commentToThread(createComment({
        id: "lg-g30-chain-c01-n01",
        filePath: noteRelativePath,
        selectedText: "g30-chain-c01-n01",
        selectedTextHash: "hash:g30-chain-c01-n01",
        comment: "Old synthetic body",
        resolved: true,
        timestamp: 1710000000000,
    }));
    syntheticThread.entries.push({
        id: "reply-1",
        body: "Keep this reply",
        timestamp: 1710000001000,
    });
    syntheticThread.updatedAt = 1710000001000;

    const manualThread = commentToThread(createComment({
        id: "manual-1",
        filePath: noteRelativePath,
        selectedText: "g30-chain-c01-n01",
        selectedTextHash: "hash:manual",
        comment: "Manual extra note",
        timestamp: 1710000002000,
    }));

    await writeFile(
        notePath,
        serializeNoteCommentThreads("Old fixture body\n", [syntheticThread, manualThread]),
        "utf8",
    );

    await execFile("node", [
        scriptPath,
        "--vault-root",
        tempDir,
        "--limit",
        "1",
    ], {
        cwd: process.cwd(),
    });

    const updatedNote = await readFile(notePath, "utf8");
    assert.match(updatedNote, /^# g30-chain-c01-n01/m);
    assert.doesNotMatch(updatedNote, /<!-- Aside comments/);

    const sidecar = await readSidecar(tempDir, noteRelativePath);
    assert.ok(sidecar);
    assert.equal(sidecar!.threads.length, 2);

    const updatedSyntheticThread = sidecar!.threads.find((thread) => thread.id === "lg-g30-chain-c01-n01");
    assert.ok(updatedSyntheticThread);
    assert.equal(updatedSyntheticThread.resolved, true);
    assert.equal(updatedSyntheticThread.entries.length, 2);
    assert.match(updatedSyntheticThread.entries[0].body, /Synthetic graph fixture for chain-size-30-component-01\./);
    assert.match(updatedSyntheticThread.entries[0].body, /\[\[g30-chain-c01-n02\]\]/);
    assert.equal(updatedSyntheticThread.entries[1].body, "Keep this reply");

    const preservedManualThread = sidecar!.threads.find((thread) => thread.id === "manual-1");
    assert.ok(preservedManualThread);
    assert.equal(preservedManualThread.entries[0].body, "Manual extra note");
});
