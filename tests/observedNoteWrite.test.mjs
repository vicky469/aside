import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createContentFingerprint, writeObservedNoteSafely } from "../scripts/lib/asideRepoScripts.mjs";

test("writeObservedNoteSafely atomically replaces an unchanged note", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-safe-write-"));
    const notePath = path.join(tempDir, "note.md");
    const original = "# Title\n\nOriginal body.\n";
    const nextContent = "# Title\n\nMigrated body.\n";

    await writeFile(notePath, original, "utf8");

    const result = await writeObservedNoteSafely(
        notePath,
        createContentFingerprint(original),
        nextContent,
        { settleMs: 0 },
    );

    assert.deepEqual(result, { kind: "written" });
    assert.equal(await readFile(notePath, "utf8"), nextContent);

    const tempFiles = (await readdir(tempDir)).filter((entry) => entry.includes(".aside-") && entry.endsWith(".tmp"));
    assert.deepEqual(tempFiles, []);
});

test("writeObservedNoteSafely skips a note that changed after it was read", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-safe-skip-"));
    const notePath = path.join(tempDir, "note.md");
    const original = "# Title\n\nOriginal body.\n";
    const concurrentContent = "# Title\n\nRemote sync body.\n";
    const nextContent = "# Title\n\nMigrated body.\n";

    await writeFile(notePath, original, "utf8");
    await writeFile(notePath, concurrentContent, "utf8");

    const result = await writeObservedNoteSafely(
        notePath,
        createContentFingerprint(original),
        nextContent,
        { settleMs: 0 },
    );

    assert.equal(result.kind, "changed");
    assert.equal(result.reason, "content changed after the script read it");
    assert.equal(await readFile(notePath, "utf8"), concurrentContent);
});
