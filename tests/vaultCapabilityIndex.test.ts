import * as assert from "node:assert/strict";
import test from "node:test";
import type { TAbstractFile, TFile, TFolder } from "obsidian";
import { VaultCapabilityIndex } from "../src/core/vault/vaultCapabilityIndex";

function createFile(path: string): TFile {
    const name = path.split("/").pop() ?? path;
    return {
        path,
        name,
        basename: name.replace(/\.[^.]+$/u, ""),
        extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
    } as TFile;
}

function createFolder(path: string, children: TAbstractFile[]): TFolder {
    return {
        path,
        name: path.split("/").pop() ?? path,
        children,
    } as TFolder;
}

test("vault capability index seeds once and returns immutable sorted note queries", () => {
    const index = new VaultCapabilityIndex();
    const files = [createFile("Zeta.md"), createFile("docs/Alpha.md")];
    let seedReads = 0;

    index.seed(files, (file) => {
        seedReads += 1;
        return file.path === "Zeta.md" ? ["#work"] : ["#work", "#alpha"];
    });
    const first = index.listMarkdownFiles();
    first.pop();

    assert.equal(seedReads, 2);
    assert.deepEqual(index.listMarkdownFiles().map((file) => file.path), ["docs/Alpha.md", "Zeta.md"]);
    assert.deepEqual(index.listTagUsage(), [
        { tag: "#alpha", usageCount: 1 },
        { tag: "#work", usageCount: 2 },
    ]);
});

test("vault capability index stays current after create, metadata, rename, and delete events", () => {
    const index = new VaultCapabilityIndex();
    const alpha = createFile("Alpha.md");
    index.seed([alpha], () => ["#old"]);

    const beta = createFile("Beta.md");
    index.upsert(beta, ["#new"]);
    index.upsert(alpha, ["#new", "#shared"]);
    const renamed = createFile("Archive/Beta.md");
    index.rename(renamed, "Beta.md", ["#new"]);
    index.remove("Alpha.md");

    assert.deepEqual(index.listMarkdownFiles().map((file) => file.path), ["Archive/Beta.md"]);
    assert.deepEqual(index.listTagUsage(), [{ tag: "#new", usageCount: 1 }]);
});

test("vault capability index removes every indexed note under a deleted folder", () => {
    const index = new VaultCapabilityIndex();
    index.seed([
        createFile("docs/A.md"),
        createFile("docs/nested/B.md"),
        createFile("Other.md"),
    ], () => []);

    index.remove("docs");

    assert.deepEqual(index.listMarkdownFiles().map((file) => file.path), ["Other.md"]);
});

test("publishing traversal visits only the supplied folder subtree", () => {
    const index = new VaultCapabilityIndex();
    const markdown = createFile("public/A.md");
    const html = createFile("public/A.html");
    const nestedMarkdown = createFile("public/nested/B.md");
    const nested = createFolder("public/nested", [nestedMarkdown]);
    const root = createFolder("public", [markdown, html, nested]);

    assert.deepEqual(
        index.listMarkdownFilesInFolder(root).map((file) => file.path),
        ["public/A.md", "public/nested/B.md"],
    );
});
