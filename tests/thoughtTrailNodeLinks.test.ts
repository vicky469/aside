import * as assert from "node:assert/strict";
import test from "node:test";
import {
    extractThoughtTrailClickTargets,
    parseThoughtTrailOpenFilePath,
    resolveThoughtTrailNodeId,
} from "../src/ui/views/thoughtTrailNodeLinks";

test("extractThoughtTrailClickTargets maps mermaid click directives to URLs", () => {
    const targets = extractThoughtTrailClickTargets([
        "flowchart TD",
        "    click n0 href \"obsidian://open?vault=dev&file=file1.md\" \"Open file1\"",
        "    click n1 href \"obsidian://open?vault=dev&file=Folder%2FNote.md\" \"Open note\"",
    ]);

    assert.equal(targets.get("n0"), "obsidian://open?vault=dev&file=file1.md");
    assert.equal(targets.get("n1"), "obsidian://open?vault=dev&file=Folder%2FNote.md");
});

test("resolveThoughtTrailNodeId prefers data-id and falls back to mermaid element ids", () => {
    assert.equal(resolveThoughtTrailNodeId("n3", null), "n3");
    assert.equal(resolveThoughtTrailNodeId(null, "flowchart-n7-0"), "n7");
    assert.equal(resolveThoughtTrailNodeId(null, "n2"), "n2");
    assert.equal(resolveThoughtTrailNodeId(null, "edge-L1"), null);
});

test("parseThoughtTrailOpenFilePath extracts the file path from obsidian open URLs", () => {
    assert.equal(
        parseThoughtTrailOpenFilePath("obsidian://open?vault=dev&file=Folder%2FNote.md"),
        "Folder/Note.md",
    );
    assert.equal(parseThoughtTrailOpenFilePath("obsidian://side-note2-comment?vault=dev&file=Folder%2FNote.md"), null);
    assert.equal(parseThoughtTrailOpenFilePath("not a url"), null);
});
