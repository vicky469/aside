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
    isAllCommentsNotePath,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
    parseCommentLocationUrl,
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

test("findCommentLocationLineNumber returns the generated index line for a comment id", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Folder/Note.md",
            selectedText: "alpha",
            startLine: 1,
        }),
        createComment({
            id: "comment-2",
            filePath: "Folder/Other.md",
            selectedText: "beta",
            startLine: 2,
        }),
    ]);

    const lineNumber = findCommentLocationLineNumber(content, "comment-2");
    assert.equal(lineNumber === null, false);
    assert.match(content.split("\n")[lineNumber ?? -1] ?? "", /commentId=comment-2/);
    assert.equal(findCommentLocationLineNumber(content, "missing-comment"), null);
});

test("buildCommentLocationLineNumberMap indexes generated comment rows once per comment id", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Folder/Note.md",
            selectedText: "alpha",
            startLine: 1,
        }),
        createComment({
            id: "comment-2",
            filePath: "Folder/Other.md",
            selectedText: "beta",
            startLine: 2,
        }),
    ]);

    const lineNumbersByCommentId = buildCommentLocationLineNumberMap(content);

    assert.equal(lineNumbersByCommentId.get("comment-1") === undefined, false);
    assert.equal(lineNumbersByCommentId.get("comment-2") === undefined, false);
    assert.equal(lineNumbersByCommentId.get("missing-comment"), undefined);
    assert.match(content.split("\n")[lineNumbersByCommentId.get("comment-1") ?? -1] ?? "", /commentId=comment-1/);
    assert.match(content.split("\n")[lineNumbersByCommentId.get("comment-2") ?? -1] ?? "", /commentId=comment-2/);
});

test("buildIndexNoteNavigationMap tracks file headings and comment rows by exact file path", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Projects/Alpha/Note A.md",
            selectedText: "alpha",
            startLine: 1,
        }),
        createComment({
            id: "comment-2",
            filePath: "Projects/Alpha/Note B.md",
            selectedText: "beta",
            startLine: 2,
        }),
    ]);

    const navigationMap = buildIndexNoteNavigationMap(content);
    const targetA = navigationMap.targetsByCommentId.get("comment-1");
    const targetB = navigationMap.targetsByCommentId.get("comment-2");

    assert.equal(navigationMap.fileLineByFilePath.get("Projects/Alpha/Note A.md") === undefined, false);
    assert.equal(navigationMap.fileLineByFilePath.get("Projects/Alpha/Note B.md") === undefined, false);
    assert.deepEqual(targetA, {
        commentId: "comment-1",
        filePath: "Projects/Alpha/Note A.md",
        fileLine: navigationMap.fileLineByFilePath.get("Projects/Alpha/Note A.md") ?? null,
        commentLine: targetA?.commentLine ?? -1,
    });
    assert.deepEqual(targetB, {
        commentId: "comment-2",
        filePath: "Projects/Alpha/Note B.md",
        fileLine: navigationMap.fileLineByFilePath.get("Projects/Alpha/Note B.md") ?? null,
        commentLine: targetB?.commentLine ?? -1,
    });
    assert.match(content.split("\n")[targetA?.fileLine ?? -1] ?? "", /title="Projects\/Alpha\/Note A\.md"/);
    assert.match(content.split("\n")[targetA?.commentLine ?? -1] ?? "", /commentId=comment-1/);
    assert.match(content.split("\n")[targetB?.fileLine ?? -1] ?? "", /title="Projects\/Alpha\/Note B\.md"/);
    assert.match(content.split("\n")[targetB?.commentLine ?? -1] ?? "", /commentId=comment-2/);
});

test("buildIndexCommentBlockId normalizes comment ids into stable block ids", () => {
    assert.equal(
        buildIndexCommentBlockId("Comment 01/alpha"),
        "sidenote2-index-comment-comment-01-alpha",
    );
});

test("buildAllCommentsNoteContent groups comments by file and shows selected text and comment", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            filePath: "B.md",
            selectedText: "beta",
            comment: "Comment B",
            startLine: 8,
        }),
        createComment({
            id: "comment-2",
            filePath: "A.md",
            selectedText: "alpha",
            comment: "Comment A",
            startLine: 2,
            resolved: true,
        }),
    ], {
        showResolved: true,
    });

    assert.match(content, new RegExp(`!\\[${ALL_COMMENTS_NOTE_IMAGE_ALT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\(${ALL_COMMENTS_NOTE_IMAGE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
    assert.match(content, new RegExp(`<div class="sidenote2-index-header-caption">${ALL_COMMENTS_NOTE_IMAGE_CAPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</div>`));
    assert.match(content, /<div class="sidenote2-index-visibility-label">Showing: Resolved comments only<\/div>/);
    assert.doesNotMatch(content, /# Side comments/);
    assert.doesNotMatch(content, /Generated by SideNote2/);
    assert.doesNotMatch(content, /Total comments:/);
    assert.doesNotMatch(content, /## Connected Notes/);
    assert.doesNotMatch(content, /Page notes/);
    assert.doesNotMatch(content, /Anchored notes/);
    assert.match(content, /<strong class="sidenote2-index-heading-label" title="A\.md">A\.md<\/strong>[\s\S]*<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[~~alpha~~\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=A\.md&commentId=comment-2&kind=anchored\)/);
    assert.doesNotMatch(content, /<strong class="sidenote2-index-heading-label" title="B\.md">B\.md<\/strong>/);
    assert.doesNotMatch(content, /Comment A/);
    assert.doesNotMatch(content, /\[\[[^\]]+\]\]/);
    assert.doesNotMatch(content, /sidenote2-index-heading-link/);
});

test("buildAllCommentsNoteContent active mode hides resolved comments without adding a mode label", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            filePath: "B.md",
            selectedText: "beta",
            startLine: 8,
        }),
        createComment({
            id: "comment-2",
            filePath: "A.md",
            selectedText: "alpha",
            startLine: 2,
            resolved: true,
        }),
    ], {
        showResolved: false,
    });

    assert.doesNotMatch(content, /<div class="sidenote2-index-visibility-label">/);
    assert.match(content, /<strong class="sidenote2-index-heading-label" title="B\.md">B\.md<\/strong>[\s\S]*commentId=comment-1/);
    assert.doesNotMatch(content, /commentId=comment-2/);
});

test("buildAllCommentsNoteContent renders an empty file when there are no comments", () => {
    const content = buildAllCommentsNoteContent("dev", []);

    assert.equal(
        content,
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${ALL_COMMENTS_NOTE_IMAGE_URL})\n<div class="sidenote2-index-header-caption">${ALL_COMMENTS_NOTE_IMAGE_CAPTION}</div>\n`,
    );
});

test("buildAllCommentsNoteContent uses a custom header image URL when provided", () => {
    const customImageUrl = "https://example.com/relativity.webp";
    const customCaption = "Custom caption";
    const content = buildAllCommentsNoteContent("dev", [], {
        headerImageUrl: customImageUrl,
        headerImageCaption: customCaption,
    });

    assert.equal(
        content,
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${customImageUrl})\n<div class="sidenote2-index-header-caption">${customCaption}</div>\n`,
    );
});

test("buildAllCommentsNoteContent omits the figcaption when the custom caption is blank", () => {
    const content = buildAllCommentsNoteContent("dev", [], {
        headerImageCaption: "",
    });

    assert.equal(
        content,
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${ALL_COMMENTS_NOTE_IMAGE_URL})\n`,
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

    assert.doesNotMatch(content, /\[\[SideNote2 comments\.md\]\]/);
    assert.match(content, /<strong class="sidenote2-index-heading-label" title="Z\.md">Z\.md<\/strong>/);
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
    assert.match(content, /<strong class="sidenote2-index-heading-label" title="Real\.md">Real\.md<\/strong>/);
});

test("buildAllCommentsNoteContent escapes markdown-heavy selections and truncates long previews", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            selectedText: "Use `/path/to/SideNote2`, `[Vault]`, and `<tag>` placeholders instead of machine-local paths in docs.",
        }),
    ]);

    assert.match(content, /\[Use \\`\/path\/to\/SideNote2\\`, \\`\\\[Vault\\\]\\`, and \\`\\<tag\\>\\` placeholders instead of mach\.\.\.\]/);
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
        /### Clippings\n\n  <strong class="sidenote2-index-heading-label" title="Clippings\/Vlad Tenev and Tudor Achim on mathematical superintelligence and the end of buggy software\.md">Vlad Tenev and Tudor Achim on mathematical superintelligence and the end of buggy software\.md<\/strong>/,
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

    assert.equal(content.match(/### Projects\/Alpha/g)?.length ?? 0, 1);
    assert.match(content, /### Projects\/Alpha\n\n  <strong class="sidenote2-index-heading-label" title="Projects\/Alpha\/Note A\.md">Note A\.md<\/strong>/);
    assert.match(content, /  <strong class="sidenote2-index-heading-label" title="Projects\/Alpha\/Note B\.md">Note B\.md<\/strong>/);
});

test("buildAllCommentsNoteContent includes extracted comment tags for search", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            comment: "Track this with #hi and #follow/up next.",
        }),
    ]);

    assert.match(content, /<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[hello\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=comment-1&kind=anchored\)  #hi #follow\/up/);
});

test("buildAllCommentsNoteContent labels page notes and orphaned notes", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "page-note",
            anchorKind: "page",
            selectedText: "Note",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
        }),
        createComment({
            id: "orphan-note",
            orphaned: true,
            selectedText: "missing text",
            startLine: 10,
        }),
    ]);

    assert.equal(content.match(/### Folder/g)?.length ?? 0, 1);
    assert.match(content, /### Folder\n\n  <strong class="sidenote2-index-heading-label" title="Folder\/Note\.md">Note\.md<\/strong>[\s\S]*<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"><\/span> \[This is a side note\.\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note&kind=page\) \^sidenote2-index-comment-page-note\n\n<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[orphaned · missing text\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=orphan-note&kind=anchored\) \^sidenote2-index-comment-orphan-note/);
});

test("buildAllCommentsNoteContent uses page note comment previews and truncates them to 10 words", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "page-note-1",
            filePath: "Folder/Note.md",
            anchorKind: "page",
            selectedText: "Note",
            comment: "Page note preview one from the comment body.",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            timestamp: 1,
        }),
        createComment({
            id: "page-note-2",
            filePath: "Folder/Note.md",
            anchorKind: "page",
            selectedText: "Note",
            comment: "one two three four five six seven eight nine ten eleven twelve",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            timestamp: 2,
        }),
        createComment({
            id: "page-note-other-file",
            filePath: "Folder/Other.md",
            anchorKind: "page",
            selectedText: "Other",
            comment: "Other file page note body.",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            timestamp: 3,
        }),
    ]);

    assert.equal(content.match(/### Folder/g)?.length ?? 0, 1);
    assert.match(content, /### Folder[\s\S]*  <strong class="sidenote2-index-heading-label" title="Folder\/Note\.md">Note\.md<\/strong>[\s\S]*\[Page note preview one from the comment body\.\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note-1&kind=page\)/);
    assert.match(content, /### Folder[\s\S]*  <strong class="sidenote2-index-heading-label" title="Folder\/Note\.md">Note\.md<\/strong>[\s\S]*\[one two three four five six seven eight nine ten\.\.\.\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note-2&kind=page\)/);
    assert.match(content, /### Folder[\s\S]*  <strong class="sidenote2-index-heading-label" title="Folder\/Other\.md">Other\.md<\/strong>[\s\S]*\[Other file page note body\.\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FOther\.md&commentId=page-note-other-file&kind=page\)/);
});

test("buildAllCommentsNoteContent shows markdown link labels in page note previews", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "page-note-1",
            filePath: "Folder/Note.md",
            anchorKind: "page",
            selectedText: "Note",
            comment: "Read [shipmonk.com/resources/.../dropshipping-with-a-fulfillment-company](https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer) later.",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            timestamp: 1,
        }),
    ]);

    assert.match(content, /\[Read shipmonk\.com\/resources\/\.\.\.\/dropshipping-with-a-fulfillment-company later\.\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note-1&kind=page\)/);
    assert.doesNotMatch(content, /\[Read \[shipmonk\.com/);
});

test("buildAllCommentsNoteContent keeps anchored index rows to the selected text only", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "page-note",
            anchorKind: "page",
            selectedText: "Folder/Note",
            comment: "Page note preview body",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
        }),
        createComment({
            id: "anchored-note",
            selectedText: "hello",
            comment: "Track [[note_French School of Programming, B-Method, and Line 14]] for this",
            startLine: 4,
        }),
    ], {
        getMentionedPageLabels: (comment) => {
            if (comment.id === "page-note") {
                return ["Another page", "Another page", "Third page"];
            }

            if (comment.id === "anchored-note") {
                return ["note_French School of Programming, B-Method, and Line 14"];
            }

            return [];
        },
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.match(content, /<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"><\/span> \[Page note preview body\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note&kind=page\)/);
    assert.equal(
        content.match(/\[Page note preview body\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note&kind=page\)/g)?.length ?? 0,
        1,
    );
    assert.match(
        content,
        /<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[hello\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=anchored-note&kind=anchored\)/,
    );
    assert.equal(
        content.match(/\[hello\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=anchored-note&kind=anchored\)/g)?.length ?? 0,
        1,
    );
    assert.doesNotMatch(content, /note\\_French School of Programming/);
    assert.doesNotMatch(content, />Another page<\/a>/);
    assert.doesNotMatch(content, />Third page<\/a>/);
    assert.doesNotMatch(content, /sidenote2-index-target-link/);
    assert.doesNotMatch(content, / -> /);
});

test("buildAllCommentsNoteContent separates index comment rows into distinct markdown blocks", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "comment-1",
            filePath: "Folder/Note.md",
            selectedText: "alpha",
            startLine: 1,
        }),
        createComment({
            id: "comment-2",
            filePath: "Folder/Note.md",
            selectedText: "beta",
            startLine: 2,
        }),
    ]);

    assert.match(
        content,
        /### Folder\n\n  <strong class="sidenote2-index-heading-label" title="Folder\/Note\.md">Note\.md<\/strong>\n\n<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[alpha\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=comment-1&kind=anchored\) \^sidenote2-index-comment-comment-1\n\n<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[beta\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=comment-2&kind=anchored\) \^sidenote2-index-comment-comment-2/,
    );
});

test("buildAllCommentsNoteContent keeps page notes first within the same file without splitting sections", () => {
    const content = buildAllCommentsNoteContent("dev", [
        createComment({
            id: "anchored-note",
            filePath: "Folder/Note.md",
            selectedText: "alpha",
            anchorKind: "selection",
            startLine: 2,
        }),
        createComment({
            id: "page-note",
            filePath: "Folder/Note.md",
            selectedText: "Page",
            anchorKind: "page",
            startLine: 8,
            startChar: 0,
            endLine: 8,
            endChar: 0,
        }),
        createComment({
            id: "anchored-note-2",
            filePath: "Folder/Note.md",
            selectedText: "beta",
            anchorKind: "selection",
            startLine: 10,
        }),
    ]);

    assert.match(
        content,
        /### Folder\n\n  <strong class="sidenote2-index-heading-label" title="Folder\/Note\.md">Note\.md<\/strong>\n\n<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"><\/span> \[This is a side note\.\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=page-note&kind=page\) \^sidenote2-index-comment-page-note\n\n<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[alpha\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=anchored-note&kind=anchored\) \^sidenote2-index-comment-anchored-note\n\n<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"><\/span> \[beta\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=anchored-note-2&kind=anchored\) \^sidenote2-index-comment-anchored-note-2/,
    );
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
