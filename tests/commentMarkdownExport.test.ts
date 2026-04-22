import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    buildSideNoteMarkdownExport,
    buildSideNoteMarkdownExportPath,
} from "../src/core/export/commentMarkdownExport";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 4,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 4,
        endChar: overrides.endChar ?? 12,
        selectedText: overrides.selectedText ?? "Runtime abstraction",
        selectedTextHash: overrides.selectedTextHash ?? "hash-runtime",
        anchorKind: overrides.anchorKind ?? "selection",
        isBookmark: overrides.isBookmark ?? false,
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        entries: overrides.entries ?? [{
            id: overrides.id ?? "thread-1",
            body: "Initial note body",
            timestamp: 1713700000000,
        }],
        createdAt: overrides.createdAt ?? 1713700000000,
        updatedAt: overrides.updatedAt ?? 1713700000000,
    };
}

test("buildSideNoteMarkdownExportPath keeps exports flat under SideNote2 exports", () => {
    assert.deepEqual(
        buildSideNoteMarkdownExportPath("docs/deep/architecture.md"),
        {
            exportRootPath: "SideNote2/exports",
            exportDirectoryPath: "SideNote2/exports",
            exportFilePath: "SideNote2/exports/docs - deep - architecture side notes.md",
        },
    );
});

test("buildSideNoteMarkdownExport keeps minimal thread labels based on selected words or note body", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/architecture.md",
        exportedAt: 1713703600000,
        threads: [
            createThread({
                isBookmark: true,
                entries: [{
                    id: "thread-1",
                    body: "Initial note body",
                    timestamp: 1713700000000,
                }, {
                    id: "entry-2",
                    body: "Follow-up note with https://example.com/really/long/path?query=1",
                    timestamp: 1713701800000,
                }],
                updatedAt: 1713701800000,
            }),
            createThread({
                id: "thread-2",
                anchorKind: "page",
                selectedText: "Architecture",
                resolved: true,
                entries: [{
                    id: "thread-2",
                    body: "Page-wide observation",
                    timestamp: 1713702400000,
                }],
                createdAt: 1713702400000,
                updatedAt: 1713702400000,
            }),
        ],
    });

    assert.match(exportMarkdown, /^Source note: \[\[docs\/architecture\.md\|architecture\.md\]\]/u);
    assert.match(exportMarkdown, /- Runtime abstraction/u);
    assert.match(exportMarkdown, /- Runtime abstraction\n  - Initial note body/u);
    assert.match(exportMarkdown, /  - Follow-up note with/u);
    assert.match(exportMarkdown, /\[example\.com\/really\/long\/path\]\(https:\/\/example\.com\/really\/long\/path\?query=1\)/u);
    assert.match(exportMarkdown, /- Page-wide observation\n  - Page-wide observation/u);
    assert.doesNotMatch(exportMarkdown, /<!-- SideNote2 comments/u);
    assert.doesNotMatch(exportMarkdown, /"selectedText"/u);
    assert.doesNotMatch(exportMarkdown, /Exported:/u);
    assert.doesNotMatch(exportMarkdown, /Threads:/u);
    assert.doesNotMatch(exportMarkdown, /Entries:/u);
    assert.doesNotMatch(exportMarkdown, /Page note/u);
    assert.doesNotMatch(exportMarkdown, /\*\*\s*Selected words/u);
    assert.doesNotMatch(exportMarkdown, /^## /mu);
    assert.doesNotMatch(exportMarkdown, /^### /mu);
    assert.doesNotMatch(exportMarkdown, /Follow-up \d/u);
    assert.doesNotMatch(exportMarkdown, /\n  Initial note body/u);
});

test("buildSideNoteMarkdownExport keeps anchored selected words in full without ellipses", () => {
    const selectedText = "This is a deliberately long anchored selection that should stay fully visible in the export without being shortened at all";
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/long-selection.md",
        threads: [
            createThread({
                selectedText,
                entries: [{
                    id: "thread-1",
                    body: "Supporting note body",
                    timestamp: 1713700000000,
                }],
            }),
        ],
    });

    assert.match(exportMarkdown, new RegExp(`- ${selectedText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
    assert.doesNotMatch(exportMarkdown, /This is a deliberately long anchored selection.*\.\.\./u);
});

test("buildSideNoteMarkdownExport renders an empty-state note when a file has no side notes", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/empty.md",
        exportedAt: 1713703600000,
        threads: [],
    });

    assert.match(exportMarkdown, /^Source note: \[\[docs\/empty\.md\|empty\.md\]\]/u);
    assert.match(exportMarkdown, /_No side notes in this file\._/u);
});

test("buildSideNoteMarkdownExport keeps root-level source notes as plain wiki links", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "test.md",
        threads: [],
    });

    assert.match(exportMarkdown, /^Source note: \[\[test\.md\]\]/u);
    assert.doesNotMatch(exportMarkdown, /\[\[[^|\]]+\|test\.md\]\]/u);
});

test("buildSideNoteMarkdownExport strips trailing Mentioned blocks from exported note content", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/references.md",
        threads: [
            createThread({
                selectedText: "Reference-heavy note",
                entries: [{
                    id: "thread-1",
                    body: [
                        "Keep this explanation.",
                        "",
                        "Mentioned:",
                        "- [target](obsidian://side-note2-comment?vault=dev&file=docs%2Ftarget.md&commentId=target-1)",
                    ].join("\n"),
                    timestamp: 1713700000000,
                }],
            }),
        ],
    });

    assert.match(exportMarkdown, /Keep this explanation\./u);
    assert.doesNotMatch(exportMarkdown, /Mentioned:/u);
    assert.doesNotMatch(exportMarkdown, /obsidian:\/\/side-note2-comment/u);
});

test("buildSideNoteMarkdownExport includes connected side notes with wiki-linked file names and content", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/references.md",
        referenceThreads: [
            createThread({
                id: "target-thread",
                filePath: "docs/target.md",
                selectedText: "Target note",
                entries: [{
                    id: "target-entry",
                    body: "Target note body",
                    timestamp: 1713700600000,
                }, {
                    id: "target-entry-2",
                    body: "Second connected note body",
                    timestamp: 1713701200000,
                }],
            }),
        ],
        threads: [
            createThread({
                selectedText: "Reference-heavy note",
                entries: [{
                    id: "thread-1",
                    body: [
                        "Keep this explanation.",
                        "",
                        "Mentioned:",
                        "- [target](obsidian://side-note2-comment?vault=dev&file=docs%2Ftarget.md&commentId=target-entry)",
                    ].join("\n"),
                    timestamp: 1713700000000,
                }],
            }),
        ],
    });

    assert.match(exportMarkdown, /- Keep this explanation\./u);
    assert.match(exportMarkdown, /    - \[\[docs\/target\.md\|target\.md\]\]/u);
    assert.match(exportMarkdown, /      - Target note body/u);
    assert.match(exportMarkdown, /      - Second connected note body/u);
    assert.doesNotMatch(exportMarkdown, /Mentioned:/u);
    assert.doesNotMatch(exportMarkdown, /obsidian:\/\/side-note2-comment/u);
});

test("buildSideNoteMarkdownExport keeps connected note file links and uses the first real page-note body as the label", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/references.md",
        threads: [
            createThread({
                id: "thread-page",
                anchorKind: "page",
                selectedText: "",
                entries: [{
                    id: "thread-page",
                    body: "- Mentioned: - [What is the right working-directory mapping:](obsidian://side-note2-comment?vault=dev&file=docs%2Ftarget.md&commentId=target-1)",
                    timestamp: 1713700000000,
                }, {
                    id: "thread-page-2",
                    body: "fdafd",
                    timestamp: 1713700600000,
                }],
            }),
        ],
    });

    assert.match(exportMarkdown, /- fdafd\n  - \[\[docs\/target\.md\|target\.md\]\]\n  - fdafd/u);
    assert.doesNotMatch(exportMarkdown, /Mentioned:/u);
    assert.doesNotMatch(exportMarkdown, /obsidian:\/\/side-note2-comment/u);
    assert.doesNotMatch(exportMarkdown, /_\(empty note\)_/u);
});

test("buildSideNoteMarkdownExport keeps connected note file links when a thread only contains side-note references", () => {
    const exportMarkdown = buildSideNoteMarkdownExport({
        filePath: "docs/references.md",
        threads: [
            createThread({
                selectedText: "Only references",
                entries: [{
                    id: "thread-1",
                    body: [
                        "Mentioned:",
                        "- [target](obsidian://side-note2-comment?vault=dev&file=docs%2Ftarget.md&commentId=target-1)",
                    ].join("\n"),
                    timestamp: 1713700000000,
                }],
            }),
        ],
    });

    assert.match(exportMarkdown, /- Only references\n  - \[\[docs\/target\.md\|target\.md\]\]/u);
    assert.doesNotMatch(exportMarkdown, /Mentioned:/u);
});
