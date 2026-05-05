import * as assert from "node:assert/strict";
import test from "node:test";
import {
    ALL_COMMENTS_NOTE_PATH,
    ALL_COMMENTS_NOTE_IMAGE_ALT,
    ALL_COMMENTS_NOTE_IMAGE_CAPTION,
    ALL_COMMENTS_NOTE_IMAGE_URL,
    buildAllCommentsNoteContent,
    buildCommentLocationLineNumberMap,
    buildIndexCommentBlockId,
    buildIndexNoteNavigationMap,
    buildCommentLocationUrl,
    findCommentLocationLineNumber,
    findCommentLocationTargetInMarkdownLine,
    findFileHeadingPathInMarkdownLine,
    findIndexMarkdownLineTarget,
    isAllCommentsNotePath,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
    parseCommentLocationUrl,
    parseIndexFileOpenUrl,
} from "../src/core/derived/allCommentsNote";
import type { Comment } from "../src/commentManager";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "Folder/Note.md",
        startLine: 4,
        startChar: 2,
        endLine: 4,
        endChar: 7,
        selectedText: "hello",
        selectedTextHash: "hash-1",
        comment: "This is a side note.",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function expectedFileRow(filePath: string): string {
    const fileName = filePath.split("/").pop() ?? filePath;
    const escapedPath = escapeHtmlText(filePath);
    return `- <a href="#" class="sidenote2-index-file-filter-link sidenote2-index-heading-label" title="${escapedPath}" data-sidenote2-file-path="${escapedPath}">${escapeHtmlText(fileName)}</a>`;
}

function countOccurrences(value: string, needle: string): number {
    return value.split(needle).length - 1;
}

test("buildCommentLocationUrl encodes vault, file, and comment id", () => {
    const url = buildCommentLocationUrl("dev vault", createComment({
        filePath: "Folder/My Note.md",
        id: "comment 1",
    }));

    assert.equal(
        url,
        "obsidian://side-note2-comment?vault=dev%20vault&file=Folder%2FMy%20Note.md&commentId=comment%201"
    );
});

test("parseCommentLocationUrl extracts file path and comment id", () => {
    assert.deepEqual(
        parseCommentLocationUrl("obsidian://side-note2-comment?vault=dev&file=Folder%2FMy%20Note.md&commentId=comment%201"),
        {
            filePath: "Folder/My Note.md",
            commentId: "comment 1",
        },
    );
    assert.equal(parseCommentLocationUrl("obsidian://open?vault=dev&file=Folder%2FMy%20Note.md"), null);
});

test("findCommentLocationTargetInMarkdownLine finds the side note target in a generated markdown list row", () => {
    assert.deepEqual(
        findCommentLocationTargetInMarkdownLine('<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"></span> [hello](obsidian://side-note2-comment?vault=dev&file=Folder%2FNote.md&commentId=comment-1&kind=page)  #hi'),
        {
            filePath: "Folder/Note.md",
            commentId: "comment-1",
        },
    );
    assert.equal(findCommentLocationTargetInMarkdownLine("**Folder/Note.md**"), null);
});

test("findFileHeadingPathInMarkdownLine extracts the source file path from an index heading row", () => {
    assert.equal(
        findFileHeadingPathInMarkdownLine('##### <span class="sidenote2-index-heading-label" title="Folder/Note.md">Note.md</span>'),
        "Folder/Note.md",
    );
    assert.equal(
        findFileHeadingPathInMarkdownLine('##### <strong class="sidenote2-index-heading-label" title="Folder/Legacy.md">Legacy.md</strong>'),
        "Folder/Legacy.md",
    );
    assert.equal(
        findFileHeadingPathInMarkdownLine('- <a class="sidenote2-index-heading-label" title="Folder/Linked.md" href="obsidian://open?vault=dev&amp;file=Folder%2FLinked.md">Linked.md</a>'),
        "Folder/Linked.md",
    );
    assert.equal(
        findFileHeadingPathInMarkdownLine('- [Linked.md](obsidian://open?vault=dev&file=Folder%2FLinked.md)'),
        "Folder/Linked.md",
    );
    assert.equal(findFileHeadingPathInMarkdownLine("### Folder"), null);
});

test("parseIndexFileOpenUrl extracts file paths from generated file links", () => {
    assert.equal(
        parseIndexFileOpenUrl("obsidian://open?vault=dev&file=Folder%2FLinked.md"),
        "Folder/Linked.md",
    );
    assert.equal(parseIndexFileOpenUrl("obsidian://side-note2-comment?vault=dev&file=Folder%2FLinked.md"), null);
});

test("findIndexMarkdownLineTarget resolves both comment rows and file heading rows", () => {
    assert.deepEqual(
        findIndexMarkdownLineTarget('<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"></span> [hello](obsidian://side-note2-comment?vault=dev&file=Folder%2FNote.md&commentId=comment-1&kind=page)  #hi'),
        {
            kind: "comment",
            filePath: "Folder/Note.md",
            commentId: "comment-1",
        },
    );
    assert.deepEqual(
        findIndexMarkdownLineTarget('##### <span class="sidenote2-index-heading-label" title="Folder/Note.md">Note.md</span>'),
        {
            kind: "file",
            filePath: "Folder/Note.md",
        },
    );
});

test("findCommentLocationLineNumber returns null for the simplified generated index", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Folder/Note.md",
        }),
    ]);

    assert.equal(findCommentLocationLineNumber(content, "comment-1"), null);
});

test("buildCommentLocationLineNumberMap still indexes legacy comment rows", () => {
    const content = [
        '<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"></span> [alpha](obsidian://side-note2-comment?vault=dev&file=Folder%2FNote.md&commentId=comment-1&kind=anchored)',
        '<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"></span> [beta](obsidian://side-note2-comment?vault=dev&file=Folder%2FOther.md&commentId=comment-2&kind=anchored)',
    ].join("\n");

    const lineNumbersByCommentId = buildCommentLocationLineNumberMap(content);

    assert.equal(lineNumbersByCommentId.get("comment-1"), 0);
    assert.equal(lineNumbersByCommentId.get("comment-2"), 1);
    assert.equal(lineNumbersByCommentId.get("missing-comment"), undefined);
});

test("buildIndexNoteNavigationMap tracks simplified file link rows", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Projects/Alpha/Note A.md",
        }),
        createComment({
            id: "comment-2",
            filePath: "Projects/Alpha/Note B.md",
        }),
    ]);

    const navigationMap = buildIndexNoteNavigationMap(content);

    assert.equal(navigationMap.fileLineByFilePath.get("Projects/Alpha/Note A.md") === undefined, false);
    assert.equal(navigationMap.fileLineByFilePath.get("Projects/Alpha/Note B.md") === undefined, false);
    assert.equal(navigationMap.targetsByCommentId.size, 0);
    assert.equal(content.split("\n")[navigationMap.fileLineByFilePath.get("Projects/Alpha/Note A.md") ?? -1] ?? "", expectedFileRow("Projects/Alpha/Note A.md"));
    assert.equal(content.split("\n")[navigationMap.fileLineByFilePath.get("Projects/Alpha/Note B.md") ?? -1] ?? "", expectedFileRow("Projects/Alpha/Note B.md"));
});

test("buildIndexCommentBlockId normalizes comment ids into stable block ids", () => {
    assert.equal(
        buildIndexCommentBlockId("Comment 01/alpha"),
        "sidenote2-index-comment-comment-01-alpha",
    );
});

test("buildAllCommentsNoteContent lists unique files grouped by folder", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Projects/Alpha/Note B.md",
        }),
        createComment({
            id: "comment-2",
            filePath: "Projects/Alpha/Note A.md",
        }),
        createComment({
            id: "comment-3",
            filePath: "Projects/Alpha/Note A.md",
        }),
    ]);

    assert.equal(content.match(/^Projects\/Alpha$/gm)?.length ?? 0, 1);
    assert.equal(countOccurrences(content, expectedFileRow("Projects/Alpha/Note A.md")), 1);
    assert.equal(countOccurrences(content, expectedFileRow("Projects/Alpha/Note B.md")), 1);
    assert.equal(content.includes(`Projects/Alpha\n${expectedFileRow("Projects/Alpha/Note A.md")}\n${expectedFileRow("Projects/Alpha/Note B.md")}`), true);
    assert.doesNotMatch(content, /commentId=/);
    assert.doesNotMatch(content, /sidenote2-index-kind-dot/);
});

test("buildAllCommentsNoteContent keeps resolved visibility filtering", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            filePath: "B.md",
        }),
        createComment({
            id: "comment-2",
            filePath: "A.md",
            resolved: true,
        }),
    ], {
        showResolved: false,
    });

    assert.equal(content.includes(expectedFileRow("B.md")), true);
    assert.equal(content.includes('data-sidenote2-file-path="A.md"'), false);
});

test("buildAllCommentsNoteContent renders only the header when there are no comments", () => {
    const content = buildAllCommentsNoteContent("dev", []);

    assert.equal(
        content,
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${ALL_COMMENTS_NOTE_IMAGE_URL})\n<div class="sidenote2-index-header-caption" style="display: block; color: #8a8a8a; font-size: 12px; line-height: 1.2; text-align: center;">${ALL_COMMENTS_NOTE_IMAGE_CAPTION}</div>\n`,
    );
});

test("buildAllCommentsNoteContent ignores comments attached to the generated aggregate note", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            filePath: ALL_COMMENTS_NOTE_PATH,
            selectedText: "self",
        }),
        createComment({
            id: "comment-2",
            filePath: "Z.md",
            selectedText: "real",
        }),
    ]);

    assert.doesNotMatch(content, /SideNote2 index\.md/);
    assert.equal(content.includes(expectedFileRow("Z.md")), true);
});

test("buildAllCommentsNoteContent ignores comments whose source file no longer exists", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "missing-note",
            filePath: "Missing.md",
            selectedText: "gone",
        }),
        createComment({
            id: "real-note",
            filePath: "Real.md",
            selectedText: "still here",
        }),
    ], {
        hasSourceFile: (filePath) => filePath === "Real.md",
    });

    assert.doesNotMatch(content, /Missing\.md/);
    assert.equal(content.includes(expectedFileRow("Real.md")), true);
});

test("buildAllCommentsNoteContent escapes folder and file link HTML", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            filePath: "A&B/<Note>.md",
        }),
    ]);

    assert.match(content, /^A&B$/m);
    assert.equal(content.includes(expectedFileRow("A&B/<Note>.md")), true);
});

test("buildAllCommentsNoteContent groups files under a shared folder heading", () => {
    const longPath = "Clippings/Vlad Tenev and Tudor Achim on mathematical superintelligence and the end of buggy software.md";
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            filePath: longPath,
        }),
    ]);

    assert.match(
        content,
        new RegExp(`Clippings\\n${expectedFileRow(longPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
});

test("buildAllCommentsNoteContent groups multiple files under the same path heading", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Projects/Alpha/Note A.md",
            anchorKind: "page",
        }),
        createComment({
            id: "comment-2",
            filePath: "Projects/Alpha/Note B.md",
            selectedText: "beta",
        }),
    ]);

    assert.equal(content.match(/^Projects\/Alpha$/gm)?.length ?? 0, 1);
    assert.equal(content.includes(`Projects/Alpha\n${expectedFileRow("Projects/Alpha/Note A.md")}`), true);
    assert.equal(content.includes(expectedFileRow("Projects/Alpha/Note B.md")), true);
});

test("isAllCommentsNotePath matches the generated note path", () => {
    assert.equal(isAllCommentsNotePath(ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(isAllCommentsNotePath(LEGACY_ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(isAllCommentsNotePath("notes/custom index.md", "notes/custom index.md"), true);
    assert.equal(isAllCommentsNotePath("Random.md"), false);
});

test("normalizeAllCommentsNotePath keeps the default and adds md when needed", () => {
    assert.equal(normalizeAllCommentsNotePath(""), ALL_COMMENTS_NOTE_PATH);
    assert.equal(normalizeAllCommentsNotePath("notes/custom index"), "notes/custom index.md");
    assert.equal(normalizeAllCommentsNotePath("notes/custom index.md"), "notes/custom index.md");
});

test("normalizeAllCommentsNoteImageUrl keeps the default when blank", () => {
    assert.equal(normalizeAllCommentsNoteImageUrl(""), ALL_COMMENTS_NOTE_IMAGE_URL);
    assert.equal(normalizeAllCommentsNoteImageUrl(" https://example.com/header.webp "), "https://example.com/header.webp");
});

test("normalizeAllCommentsNoteImageCaption keeps the default when missing and allows blank", () => {
    assert.equal(normalizeAllCommentsNoteImageCaption(null), ALL_COMMENTS_NOTE_IMAGE_CAPTION);
    assert.equal(normalizeAllCommentsNoteImageCaption(" Custom caption "), "Custom caption");
    assert.equal(normalizeAllCommentsNoteImageCaption(" "), "");
});
