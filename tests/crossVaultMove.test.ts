import * as assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
    assertCrossVaultTargetAsidePluginCompatible,
    CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION,
    ensureCrossVaultTargetAsidePluginCompatible,
    formatCrossVaultMoveExistingFileNotice,
    formatCrossVaultMoveSuccessNotice,
    getObsidianConfigRootCandidatesForMove,
    readCrossVaultMoveFileBytes,
    selectCrossVaultMoveThreads,
    writeCrossVaultTargetSidecars,
    writeCrossVaultTargetIndexFromSidecars,
} from "../src/core/move/crossVaultMove";
import { commentToThread, type Comment } from "../src/commentManager";

function createComment(filePath: string, id: string): Comment {
    return {
        id,
        filePath,
        startLine: 1,
        startChar: 0,
        endLine: 1,
        endChar: 5,
        selectedText: "hello",
        selectedTextHash: `hash-${id}`,
        comment: `body ${id}`,
        timestamp: 1710000000000,
    };
}

async function writeSidecar(vaultRoot: string, pluginId: string, shard: string, fileName: string, filePath: string): Promise<void> {
    const sidecarPath = path.join(vaultRoot, ".obsidian", "plugins", pluginId, "sidenotes", "by-note", shard, fileName);
    await mkdir(path.dirname(sidecarPath), { recursive: true });
    await writeFile(sidecarPath, `${JSON.stringify({
        version: 1,
        notePath: filePath,
        threads: [commentToThread(createComment(filePath, `${shard}-${fileName}`))],
    })}\n`, "utf8");
}

test("cross-vault move discovers the standard macOS Obsidian config path", () => {
    const roots = getObsidianConfigRootCandidatesForMove(path, {
        HOME: "/Users/alice",
    });

    assert.ok(roots.includes(path.join("/Users/alice", "Library", "Application Support", "obsidian")));
    assert.equal(roots.includes(path.join("/Users/alice", "Library", "Application", "Support", "obsidian")), false);
});

test("cross-vault move reads source files as bytes", async () => {
    const sourceFile = { path: "docs/paper.pdf" };
    const expectedBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xc3, 0x28]);
    const calls: unknown[] = [];

    const actualBytes = await readCrossVaultMoveFileBytes({
        async readBinary(file: unknown): Promise<ArrayBuffer> {
            calls.push(file);
            return expectedBytes.buffer.slice(
                expectedBytes.byteOffset,
                expectedBytes.byteOffset + expectedBytes.byteLength,
            ) as ArrayBuffer;
        },
    }, sourceFile);

    assert.deepEqual(Array.from(actualBytes), Array.from(expectedBytes));
    assert.equal(calls[0], sourceFile);
});

test("cross-vault move success notice is a short status", () => {
    assert.equal(
        formatCrossVaultMoveSuccessNotice("Long/Folder/Wallace Wattles.pdf", "vicky-main"),
        "Moved.",
    );
});

test("cross-vault move existing-file notice is a short status", () => {
    assert.equal(
        formatCrossVaultMoveExistingFileNotice("vicky-main"),
        "Already exists.",
    );
});

test("cross-vault move snapshots indexed PDF page-note threads when the live manager is empty", () => {
    const filePath = "docs/paper.pdf";
    const indexedThread = commentToThread(createComment(filePath, "pdf-thread"));

    const selectedThreads = selectCrossVaultMoveThreads([], [indexedThread]);

    assert.equal(selectedThreads.length, 1);
    assert.equal(selectedThreads[0].filePath, filePath);
    assert.equal(selectedThreads[0].entries[0].body, "body pdf-thread");
    assert.notEqual(selectedThreads[0], indexedThread);
});

test("cross-vault move keeps the pre-load PDF page-note snapshot if load clears the index", () => {
    const filePath = "docs/paper.pdf";
    const preLoadIndexedThread = commentToThread(createComment(filePath, "pdf-preload-thread"));

    const selectedThreads = selectCrossVaultMoveThreads([], [], [preLoadIndexedThread]);

    assert.equal(selectedThreads.length, 1);
    assert.equal(selectedThreads[0].filePath, filePath);
    assert.equal(selectedThreads[0].entries[0].body, "body pdf-preload-thread");
    assert.notEqual(selectedThreads[0], preLoadIndexedThread);
});

test("cross-vault move writes the target vault index from present sidecars only", async () => {
    const targetVaultPath = await mkdtemp(path.join(tmpdir(), "aside-target-vault-"));
    const pluginId = "aside";
    const movedFilePath = "docs/moved.md";
    const missingFilePath = "docs/old.md";
    await mkdir(path.join(targetVaultPath, "docs"), { recursive: true });
    await writeFile(path.join(targetVaultPath, movedFilePath), "# Moved\n", "utf8");
    await mkdir(path.join(targetVaultPath, ".obsidian", "plugins", pluginId), { recursive: true });
    await writeFile(path.join(targetVaultPath, ".obsidian", "plugins", pluginId, "data.json"), JSON.stringify({
        indexNotePath: "Custom Aside Index",
        indexHeaderImageCaption: "",
    }), "utf8");
    await writeSidecar(targetVaultPath, pluginId, "aa", "moved.json", movedFilePath);
    await writeSidecar(targetVaultPath, pluginId, "bb", "old.json", missingFilePath);

    const indexPath = await writeCrossVaultTargetIndexFromSidecars({
        fsPromises: {
            access,
            mkdir,
            readFile,
            readdir,
            writeFile,
        },
        path,
    }, {
        targetVaultPath,
        configDir: ".obsidian",
        pluginId,
        vaultName: "Target Vault",
    });

    assert.equal(indexPath, path.join(targetVaultPath, "Custom Aside Index.md"));
    const indexContent = await readFile(indexPath, "utf8");
    assert.match(indexContent, /docs\/moved\.md/);
    assert.doesNotMatch(indexContent, /docs\/old\.md/);
});

test("cross-vault move rejects missing or incompatible target Aside versions for side notes", async () => {
    const targetVaultPath = await mkdtemp(path.join(tmpdir(), "aside-target-vault-"));
    const pluginId = "aside";
    const modules = {
        fsPromises: {
            access,
            readFile,
        },
        path,
    };
    const options = {
        targetVaultPath,
        configDir: ".obsidian",
        pluginId,
        minimumVersion: CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION,
    };

    await assert.rejects(
        () => assertCrossVaultTargetAsidePluginCompatible(modules, options),
        /Target vault does not have Aside installed/,
    );

    await mkdir(path.join(targetVaultPath, ".obsidian", "plugins", pluginId), { recursive: true });
    await writeFile(path.join(targetVaultPath, ".obsidian", "plugins", pluginId, "manifest.json"), JSON.stringify({
        id: pluginId,
        version: "2.0.87",
    }), "utf8");

    await assert.rejects(
        () => assertCrossVaultTargetAsidePluginCompatible(modules, options),
        /requires Aside 2\.0\.88 or newer/,
    );

    await writeFile(path.join(targetVaultPath, ".obsidian", "plugins", pluginId, "manifest.json"), JSON.stringify({
        id: pluginId,
        version: CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION,
    }), "utf8");

    await assert.doesNotReject(() => assertCrossVaultTargetAsidePluginCompatible(modules, options));
});

test("cross-vault move updates an older target Aside install before moving side notes", async () => {
    const targetVaultPath = await mkdtemp(path.join(tmpdir(), "aside-target-vault-"));
    const sourcePluginRoot = await mkdtemp(path.join(tmpdir(), "aside-source-plugin-"));
    const pluginId = "aside";
    const targetPluginRoot = path.join(targetVaultPath, ".obsidian", "plugins", pluginId);
    await mkdir(targetPluginRoot, { recursive: true });
    await writeFile(path.join(targetPluginRoot, "main.js"), "old-main", "utf8");
    await writeFile(path.join(targetPluginRoot, "styles.css"), "old-styles", "utf8");
    await writeFile(path.join(targetPluginRoot, "manifest.json"), JSON.stringify({
        id: pluginId,
        version: "2.0.87",
    }), "utf8");
    await writeFile(path.join(sourcePluginRoot, "main.js"), "new-main", "utf8");
    await writeFile(path.join(sourcePluginRoot, "styles.css"), "new-styles", "utf8");
    await writeFile(path.join(sourcePluginRoot, "manifest.json"), JSON.stringify({
        id: pluginId,
        version: CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION,
    }), "utf8");

    await ensureCrossVaultTargetAsidePluginCompatible({
        fsPromises: {
            access,
            copyFile,
            readFile,
        },
        path,
    }, {
        targetVaultPath,
        sourcePluginRoot,
        configDir: ".obsidian",
        pluginId,
        minimumVersion: CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION,
    });

    assert.equal(await readFile(path.join(targetPluginRoot, "main.js"), "utf8"), "new-main");
    assert.equal(await readFile(path.join(targetPluginRoot, "styles.css"), "utf8"), "new-styles");
    assert.equal(JSON.parse(await readFile(path.join(targetPluginRoot, "manifest.json"), "utf8")).version, CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION);
});

test("cross-vault move writes both path and source sidecars in the target vault", async () => {
    const targetVaultPath = await mkdtemp(path.join(tmpdir(), "aside-target-sidecars-"));
    const pluginId = "aside";
    const notePath = "docs/moved.md";
    const sourceId = "src-cross-vault";
    const thread = commentToThread(createComment(notePath, "thread-a"));

    const writtenPaths = await writeCrossVaultTargetSidecars({
        fsPromises: {
            mkdir,
            writeFile,
        },
        path,
    }, {
        targetVaultPath,
        configDir: ".obsidian",
        pluginId,
        notePath,
        sourceId,
        threads: [thread],
    });

    assert.equal(writtenPaths.length, 2);
    const pathSidecar = JSON.parse(await readFile(writtenPaths[0], "utf8")) as {
        notePath?: string;
        sourceId?: string;
        threads?: Comment[];
    };
    const sourceSidecar = JSON.parse(await readFile(writtenPaths[1], "utf8")) as {
        notePath?: string;
        sourceId?: string;
        threads?: Comment[];
    };

    assert.equal(pathSidecar.notePath, notePath);
    assert.equal(pathSidecar.sourceId, undefined);
    assert.equal(pathSidecar.threads?.[0]?.filePath, notePath);
    assert.equal(sourceSidecar.notePath, notePath);
    assert.equal(sourceSidecar.sourceId, sourceId);
    assert.equal(sourceSidecar.threads?.[0]?.filePath, notePath);
});
