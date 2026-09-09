import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { commentToThread } from "../src/commentManager";
import * as tagSearch from "../src/ui/views/indexTagSearch";
import type { IndexTagSearchResult } from "../src/ui/views/indexTagSearch";
import { buildAllCommentsNoteContent } from "../src/core/derived/allCommentsNote";

test("sidebar searches the same source and comment tags as the generated index", () => {
    class TFile {
        extension = "md";
        constructor(public path: string) {}
        get basename() { return this.path.replace(/\.md$/u, ""); }
    }
    const indexPath = "🐰 Aside Index.md";
    const files = ["A.md", "B.md", "C.md", "D.md", "E.md", "Unrepresented.md", indexPath]
        .map((path) => new TFile(path));
    const threads = files.filter((file) => file.path !== "Unrepresented.md").map((file, i) => commentToThread({
        id: `thread-${i}`, filePath: file.path, comment: file.path === "E.md" ? "#灵感" : "A comment",
        selectedText: "", startLine: 0, startChar: 0, endLine: 0, endChar: 0,
        selectedTextHash: "hash", timestamp: i,
    }));
    const getTags = (file: TFile) => file.path === "E.md" ? [] : ["#灵感"];
    const source = ts.createSourceFile("AsideView.ts", readFileSync("src/ui/views/AsideView.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const viewClass = source.statements.find((node): node is ts.ClassDeclaration =>
        ts.isClassDeclaration(node) && node.name?.text === "AsideView")!;
    const method = viewClass.members.find((node) => node.name?.getText(source) === "refreshIndexTagSearchResult")!;
    const code = ts.transpileModule(`class AsideView { ${method.getText(source)} }; new AsideView();`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const view = runInNewContext(code, { ...tagSearch, TFile, getAllTags: (cache: { tags: string[] }) => cache.tags });
    Object.assign(view, {
        indexTagSearchQuery: "灵感", indexTagSearchSelectedTagKey: null,
        app: {
            vault: { getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) },
            metadataCache: { getFileCache: (file: TFile) => ({ tags: getTags(file) }) },
        },
        plugin: {
            getAllIndexedThreads: () => threads,
            getAllCommentsNotePath: () => indexPath,
            isAllCommentsNotePath: (path: string) => path === indexPath,
            // Reproduce the stale vault-wide cache: it knows only one source note.
            getIndexedVaultTagUsage: () => [{ tag: "#灵感", usageCount: 2 }],
            getIndexedMarkdownFilesForTag: () => [files[0], files[6]],
        },
    });
    view.refreshIndexTagSearchResult();
    const result = view.indexTagSearchResult as IndexTagSearchResult;
    assert.deepEqual(result.files.map((file) => file.filePath), ["A.md", "B.md", "C.md", "D.md", "E.md"]);
    assert.equal(result.tags[0].fileCount, 5);
    const rendered = buildAllCommentsNoteContent("test", threads, {
        allCommentsNotePath: indexPath,
        getSourceFileTags: (path) => getTags(files.find((file) => file.path === path)!),
    });
    for (const file of result.files) assert.ok(rendered.includes(`data-aside-file-path="${file.filePath}"`));
    assert.equal(rendered.match(/#灵感/gu)?.length, 5);
});
