import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getManagedSectionEdit,
    getManagedSectionKind,
    getManagedSectionLineRange,
    getManagedSectionRange,
    getManagedSectionStartLine,
    getVisibleNoteContent,
    parseNoteComments,
    serializeNoteComments,
    serializeNoteCommentThreads,
} from "../src/core/storage/noteCommentStorage";
import type { Comment, CommentThread } from "../src/commentManager";

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
        comment: "This is a side note.",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: "thread-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "hello",
        selectedTextHash: "hash-1",
        entries: [{
            id: "entry-1",
            body: "Thread body",
            timestamp: 1710000000000,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
        ...overrides,
    };
}

test("serializeNoteComments stores comments inside a managed appendix", () => {
    const note = "# Title\n\nAlpha body.\n";
    const serialized = serializeNoteComments(note, [
        createComment(),
        createComment({
            id: "comment-2",
            startLine: 3,
            startChar: 0,
            endLine: 3,
            endChar: 5,
            comment: "Second comment",
            timestamp: 1710000001000,
        }),
    ]);

    assert.match(serialized, /^# Title\n\nAlpha body\.\n\n<!-- Aside comments\n\[/);
    assert.match(serialized, /\n-->\n$/);
    assert.doesNotMatch(serialized, /## Comments/);
    assert.doesNotMatch(serialized, /```json/);
    assert.match(serialized, /"startLine": 1/);
    assert.match(serialized, /"startChar": 2/);
    assert.match(serialized, /"endLine": 1/);
    assert.match(serialized, /"endChar": 7/);
    assert.match(serialized, /"entries": \[/);
    assert.match(serialized, /"body": "This is a side note\."/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.mainContent, "# Title\n\nAlpha body.");
    assert.equal(parsed.comments.length, 2);
    assert.equal(parsed.comments[0].comment, "This is a side note.");
    assert.equal(parsed.comments[1].comment, "Second comment");
});

test("parseNoteComments still reads legacy SideNote2 managed blocks", () => {
    const serialized = serializeNoteComments("Body", [createComment()]);
    const legacySerialized = serialized.replace("<!-- Aside comments", "<!-- SideNote2 comments");

    const parsed = parseNoteComments(legacySerialized, "note.md");

    assert.equal(parsed.mainContent, "Body");
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].comment, "This is a side note.");
});

test("serializeNoteComments keeps an empty note editable by leaving a blank line before the managed appendix", () => {
    const serialized = serializeNoteComments("", [createComment({
        anchorKind: "page",
        selectedText: "Note",
    })]);

    assert.match(serialized, /^\n<!-- Aside comments\n\[/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.mainContent, "");
    assert.equal(parsed.comments.length, 1);
});

test("serializeNoteComments stores multiline comment bodies as exact JSON strings", () => {
    const serialized = serializeNoteComments("Body", [
        createComment({
            comment: "First line\nSecond line\nThird line",
        }),
    ]);

    assert.match(serialized, /"body": "First line\\nSecond line\\nThird line"/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.comments[0].comment, "First line\nSecond line\nThird line");
});

test("serializeNoteComments escapes HTML comment delimiters inside JSON payload", () => {
    const serialized = serializeNoteComments("Body", [
        createComment({
            selectedText: "Contains <!-- opener",
            comment: "Arrow --> safe",
        }),
    ]);

    assert.match(serialized, /Contains \\u003c!-- opener/);
    assert.match(serialized, /Arrow --\\u003e safe/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.comments[0].selectedText, "Contains <!-- opener");
    assert.equal(parsed.comments[0].comment, "Arrow --> safe");
});

test("serializeNoteComments replaces an existing managed appendix instead of duplicating it", () => {
    const firstPass = serializeNoteComments("Body", [createComment()]);
    const secondPass = serializeNoteComments(firstPass, [
        createComment({
            comment: "Updated body",
            resolved: true,
        }),
    ]);

    assert.equal((secondPass.match(/<!-- Aside comments/g) || []).length, 1);
    assert.match(secondPass, /"resolved": true/);
    assert.match(secondPass, /"body": "Updated body"/);

    const parsed = parseNoteComments(secondPass, "note.md");
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].comment, "Updated body");
    assert.equal(parsed.comments[0].resolved, true);
});

test("serializeNoteComments preserves page-note and orphaned anchor metadata", () => {
    const serialized = serializeNoteComments("Body", [
        createComment({
            id: "comment-page",
            anchorKind: "page",
            selectedText: "Note",
            orphaned: false,
        }),
        createComment({
            id: "comment-orphaned",
            orphaned: true,
            timestamp: 1710000001000,
        }),
    ]);

    assert.match(serialized, /"anchorKind": "page"/);
    assert.match(serialized, /"orphaned": true/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.comments[0].anchorKind, "page");
    assert.equal(parsed.comments[0].orphaned, false);
    assert.equal(parsed.comments[1].orphaned, true);
});

test("serializeNoteComments preserves pinned thread metadata", () => {
    const serialized = serializeNoteComments("Body", [
        createComment({
            id: "comment-pinned",
            isPinned: true,
        }),
    ]);

    assert.match(serialized, /"isPinned": true/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.comments[0].isPinned, true);
    assert.equal(parsed.threads[0].isPinned, true);
});

test("parseNoteComments ignores legacy bookmark fields and drops them on rewrite", () => {
    const serialized = serializeNoteComments("Body", [
        createComment({
            id: "comment-bookmark",
        }),
    ]);
    const legacySerialized = serialized.replace(
        /"anchorKind": "selection",/,
        "\"anchorKind\": \"selection\",\n        \"isBookmark\": true,",
    );

    const parsedLegacy = parseNoteComments(legacySerialized, "note.md");
    assert.equal("isBookmark" in parsedLegacy.comments[0], false);
    assert.equal("isBookmark" in parsedLegacy.threads[0], false);

    const cleaned = serializeNoteCommentThreads(parsedLegacy.mainContent, parsedLegacy.threads);
    assert.doesNotMatch(cleaned, /"isBookmark":/);
});

test("serializeNoteCommentThreads preserves stored top-level thread order", () => {
    const threads: CommentThread[] = [{
        id: "thread-later",
        filePath: "note.md",
        startLine: 8,
        startChar: 0,
        endLine: 8,
        endChar: 5,
        selectedText: "later",
        selectedTextHash: "hash-later",
        entries: [{
            id: "thread-later",
            body: "Later thread",
            timestamp: 1710000001000,
        }],
        createdAt: 1710000001000,
        updatedAt: 1710000001000,
    }, {
        id: "thread-earlier",
        filePath: "note.md",
        startLine: 2,
        startChar: 0,
        endLine: 2,
        endChar: 5,
        selectedText: "earlier",
        selectedTextHash: "hash-earlier",
        entries: [{
            id: "thread-earlier",
            body: "Earlier thread",
            timestamp: 1710000000000,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
    }];

    const serialized = serializeNoteCommentThreads("Body\n", threads);
    const parsed = parseNoteComments(serialized, "note.md");

    assert.deepEqual(parsed.threads.map((thread) => thread.id), ["thread-later", "thread-earlier"]);
});

test("serializeNoteComments removes the managed appendix when there are no comments", () => {
    const withComments = serializeNoteComments("Body", [createComment()]);
    const withoutComments = serializeNoteComments(withComments, []);

    assert.equal(withoutComments, "Body\n");
    assert.equal(parseNoteComments(withoutComments, "note.md").comments.length, 0);
});

test("getManagedSectionKind distinguishes threaded, unsupported, and missing managed blocks", () => {
    const threaded = serializeNoteComments("Body\n", [createComment()]);
    assert.equal(getManagedSectionKind(threaded), "threaded");

    const legacyNote = [
        "# Title",
        "",
        "Visible body.",
        "",
        "<!-- Aside comments",
        "[",
        "  {",
        '    "id": "legacy-comment-1",',
        '    "startLine": 1,',
        '    "startChar": 0,',
        '    "endLine": 1,',
        '    "endChar": 6,',
        '    "selectedText": "Visible",',
        '    "selectedTextHash": "hash-visible",',
        '    "comment": "Legacy flat note body",',
        '    "timestamp": 1710000000000',
        "  }",
        "]",
        "-->",
        "",
    ].join("\n");

    assert.equal(getManagedSectionKind(legacyNote), "unsupported");

    const unsupported = [
        "Body",
        "",
        "<!-- Aside comments",
        "[",
        '  { "id": "bad", "comment": 1 }',
        "]",
        "-->",
        "",
    ].join("\n");
    assert.equal(getManagedSectionKind(unsupported), "unsupported");

    assert.equal(getManagedSectionKind("Body\n"), "none");
});

test("parseNoteComments recognizes legacy object-shaped Aside blocks as managed storage", () => {
    const legacyEnvelope = [
        "# Title",
        "",
        "Visible body.",
        "",
        "<!-- Aside comments",
        JSON.stringify({
            schemaVersion: 1,
            noteHash: "hash-note",
            notePath: "note.md",
            revisionId: "revision-1",
            appliedWatermark: {},
            threads: [createThread()],
        }, null, 2),
        "-->",
        "",
    ].join("\n");

    const parsed = parseNoteComments(legacyEnvelope, "note.md");

    assert.equal(getManagedSectionKind(legacyEnvelope), "threaded");
    assert.equal(parsed.mainContent, "# Title\n\nVisible body.");
    assert.equal(parsed.threads.length, 1);
    assert.equal(parsed.threads[0].id, "thread-1");
    assert.equal(parsed.threads[0].entries[0].body, "Thread body");
    assert.equal(serializeNoteCommentThreads(legacyEnvelope, []), "# Title\n\nVisible body.\n");
});

test("getManagedSectionKind rejects notes with two valid Aside managed blocks", () => {
    const first = serializeNoteComments("Body\n", [createComment()]);
    const second = serializeNoteComments("Body\n", [createComment({
        id: "comment-2",
        selectedText: "second",
        selectedTextHash: "hash-2",
        timestamp: 1710000001000,
    })]);
    const duplicateBlocks = `${first.trimEnd()}\n\n${second.slice(second.indexOf("<!-- Aside comments"))}`;

    assert.equal((duplicateBlocks.match(/<!-- Aside comments/g) || []).length, 2);
    assert.equal(getManagedSectionKind(duplicateBlocks), "unsupported");
});

test("duplicate Aside managed blocks are not partially parsed or hidden", () => {
    const first = serializeNoteComments("Body\n", [createComment()]);
    const second = serializeNoteComments("Body\n", [createComment({
        id: "comment-2",
        selectedText: "second",
        selectedTextHash: "hash-2",
        timestamp: 1710000001000,
    })]);
    const duplicateBlocks = `${first.trimEnd()}\n\n${second.slice(second.indexOf("<!-- Aside comments"))}`;
    const parsed = parseNoteComments(duplicateBlocks, "note.md");

    assert.equal(parsed.comments.length, 0);
    assert.equal(parsed.threads.length, 0);
    assert.equal(parsed.mainContent, duplicateBlocks.trimEnd());
    assert.equal(getManagedSectionRange(duplicateBlocks), null);
    assert.equal(getVisibleNoteContent(duplicateBlocks), duplicateBlocks);
});

test("parseNoteComments ignores Aside comment markers inside fenced code blocks", () => {
    const note = [
        "# Title",
        "",
        "```md",
        "<!-- Aside comments",
        "[",
        '  { "id": "legacy-comment-1", "comment": "Example only" }',
        "]",
        "-->",
        "```",
        "",
        "Visible body.",
        "",
    ].join("\n");

    const parsed = parseNoteComments(note, "note.md");
    assert.equal(parsed.comments.length, 0);
    assert.equal(parsed.mainContent, note.trimEnd());
    assert.equal(getManagedSectionKind(note), "none");
});

test("getManagedSectionKind ignores inline prose examples before a fenced Aside block sample", () => {
    const note = [
        "# Title",
        "",
        "Each note stores comments in a trailing hidden `<!-- Aside comments -->` block:",
        "",
        "```md",
        "<!-- Aside comments",
        "[",
        '  { "id": "legacy-comment-1", "comment": "Example only" }',
        "]",
        "-->",
        "```",
        "",
        "Visible body.",
        "",
    ].join("\n");

    assert.equal(getManagedSectionKind(note), "none");
    const parsed = parseNoteComments(note, "note.md");
    assert.equal(parsed.comments.length, 0);
    assert.equal(parsed.mainContent, note.trimEnd());
});

test("parseNoteComments still reads the real trailing managed block after a fenced example", () => {
    const realManagedBlock = serializeNoteComments("Visible body.\n", [createComment()]);
    const note = [
        "# Title",
        "",
        "```md",
        "<!-- Aside comments",
        "[",
        '  { "id": "legacy-comment-1", "comment": "Example only" }',
        "]",
        "-->",
        "```",
        "",
        realManagedBlock.trimEnd(),
        "",
    ].join("\n");

    const parsed = parseNoteComments(note, "note.md");
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].id, "comment-1");
    assert.equal(getManagedSectionKind(note), "threaded");
});

test("serializeNoteCommentThreads refuses to write threaded data into an unsupported managed block", () => {
    const legacyNote = [
        "# Title",
        "",
        "Visible body.",
        "",
        "<!-- Aside comments",
        "[",
        "  {",
        '    "id": "legacy-comment-1",',
        '    "startLine": 1,',
        '    "startChar": 0,',
        '    "endLine": 1,',
        '    "endChar": 6,',
        '    "selectedText": "Visible",',
        '    "selectedTextHash": "hash-visible",',
        '    "comment": "Legacy flat note body",',
        '    "timestamp": 1710000000000',
        "  }",
        "]",
        "-->",
        "",
    ].join("\n");

    assert.throws(() => serializeNoteCommentThreads(legacyNote, [{
        id: "thread-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 0,
        endLine: 1,
        endChar: 6,
        selectedText: "Visible",
        selectedTextHash: "hash-visible",
        entries: [{
            id: "entry-1",
            body: "Threaded body",
            timestamp: 1710000001000,
        }],
        createdAt: 1710000001000,
        updatedAt: 1710000001000,
    }]), /unsupported Aside or legacy SideNote2 comments block/);
});

test("serializeNoteCommentThreads refuses to write when a note contains two Aside managed blocks", () => {
    const first = serializeNoteComments("# Title\n\nVisible body.\n", [createComment()]);
    const second = serializeNoteComments("# Title\n\nVisible body.\n", [createComment({
        id: "comment-2",
        selectedText: "second",
        selectedTextHash: "hash-2",
        timestamp: 1710000001000,
    })]);
    const duplicateBlocks = `${first.trimEnd()}\n\n${second.slice(second.indexOf("<!-- Aside comments"))}\n`;

    assert.throws(() => serializeNoteCommentThreads(duplicateBlocks, [{
        id: "thread-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 0,
        endLine: 1,
        endChar: 6,
        selectedText: "Visible",
        selectedTextHash: "hash-visible",
        entries: [{
            id: "entry-1",
            body: "Threaded body",
            timestamp: 1710000001000,
        }],
        createdAt: 1710000001000,
        updatedAt: 1710000001000,
    }]), /multiple Aside or legacy SideNote2 comments blocks/);
});

test("getManagedSectionEdit patches only the managed comments block", () => {
    const original = [
        "# Title",
        "",
        "Alpha beta gamma.",
        "",
        "<!-- Aside comments",
        "[]",
        "-->",
        "",
    ].join("\n");

    const replacement = createComment({
        comment: "Updated",
        selectedText: "beta",
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 10,
    });

    const edit = getManagedSectionEdit(original, [replacement]);
    const patched = original.slice(0, edit.fromOffset) + edit.replacement + original.slice(edit.toOffset);

    assert.equal(patched, serializeNoteComments(original, [replacement]));
    assert.match(patched, /"selectedText": "beta"/);
    assert.match(patched, /"body": "Updated"/);
    assert.match(patched, /Alpha beta gamma\./);
});

test("getManagedSectionEdit removes trailing managed block without touching note body", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    const edit = getManagedSectionEdit(withComments, []);
    const patched = withComments.slice(0, edit.fromOffset) + edit.replacement + withComments.slice(edit.toOffset);

    assert.equal(patched, "# Title\n\nAlpha beta gamma.\n");
});

test("getManagedSectionEdit keeps a blank leading line when adding comments to an empty note", () => {
    const edit = getManagedSectionEdit("", [createComment({
        anchorKind: "page",
        selectedText: "Note",
    })]);

    assert.equal(edit.fromOffset, 0);
    assert.equal(edit.toOffset, 0);
    assert.match(edit.replacement, /^\n<!-- Aside comments\n\[/);
});

test("getManagedSectionRange returns the trailing hidden block offsets", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    const range = getManagedSectionRange(withComments);

    assert.ok(range);
    assert.equal(withComments.slice(range.fromOffset, range.toOffset).trimStart().startsWith("<!-- Aside comments"), true);
});

test("getManagedSectionStartLine returns the opener line index", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    assert.equal(getManagedSectionStartLine(withComments), 4);
});

test("getManagedSectionLineRange covers the trailing managed block", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    assert.deepEqual(getManagedSectionLineRange(withComments), {
        startLine: 4,
        endLine: 26,
    });
});

test("getManagedSectionRange returns null when no managed block exists", () => {
    assert.equal(getManagedSectionRange("# Title\n\nAlpha beta gamma.\n"), null);
});

test("parseNoteComments still recognizes a managed block after visible text is typed before it", () => {
    const inlineManagedBlock = [
        "a<!-- Aside comments",
        "[",
        "  {",
        '    "id": "comment-1",',
        '    "startLine": 0,',
        '    "startChar": 0,',
        '    "endLine": 0,',
        '    "endChar": 0,',
        '    "selectedText": "Note",',
        '    "selectedTextHash": "hash-1",',
        '    "entries": [',
        "      {",
        '        "id": "comment-1",',
        '        "body": "Page note",',
        '        "timestamp": 1710000000000',
        "      }",
        "    ],",
        '    "createdAt": 1710000000000,',
        '    "updatedAt": 1710000000000,',
        '    "anchorKind": "page"',
        "  }",
        "]",
        "-->",
        "",
    ].join("\n");

    const parsed = parseNoteComments(inlineManagedBlock, "note.md");
    assert.equal(parsed.mainContent, "a");
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].anchorKind, "page");
    assert.equal(parsed.comments[0].comment, "Page note");
});

test("getManagedSectionRange still finds a managed block after visible text is typed before it", () => {
    const inlineManagedBlock = [
        "a<!-- Aside comments",
        "[]",
        "-->",
        "",
    ].join("\n");

    const range = getManagedSectionRange(inlineManagedBlock);
    assert.ok(range);
    assert.equal(inlineManagedBlock.slice(0, range.fromOffset), "a");
    assert.equal(inlineManagedBlock.slice(range.fromOffset, range.toOffset).startsWith("<!-- Aside comments"), true);
});

test("parseNoteComments still recognizes a managed block after visible text is typed after it", () => {
    const trailingVisibleContent = [
        "# Title",
        "",
        "<!-- Aside comments",
        "[",
        "  {",
        '    "id": "comment-1",',
        '    "startLine": 0,',
        '    "startChar": 0,',
        '    "endLine": 0,',
        '    "endChar": 0,',
        '    "selectedText": "Note",',
        '    "selectedTextHash": "hash-1",',
        '    "entries": [',
        "      {",
        '        "id": "comment-1",',
        '        "body": "Page note",',
        '        "timestamp": 1710000000000',
        "      }",
        "    ],",
        '    "createdAt": 1710000000000,',
        '    "updatedAt": 1710000000000,',
        '    "anchorKind": "page"',
        "  }",
        "]",
        "-->",
        "Trailing text",
        "",
    ].join("\n");

    const parsed = parseNoteComments(trailingVisibleContent, "note.md");
    assert.equal(parsed.mainContent, "# Title\nTrailing text");
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].anchorKind, "page");
    assert.equal(parsed.comments[0].comment, "Page note");
});

test("getManagedSectionEdit moves visible trailing text back before the managed block", () => {
    const original = [
        "# Title",
        "",
        "<!-- Aside comments",
        "[]",
        "-->",
        "Trailing text",
        "",
    ].join("\n");
    const replacement = createComment({
        comment: "Updated",
        selectedText: "Title",
        startLine: 0,
        startChar: 2,
        endLine: 0,
        endChar: 7,
    });

    const edit = getManagedSectionEdit(original, [replacement]);
    const patched = original.slice(0, edit.fromOffset) + edit.replacement + original.slice(edit.toOffset);

    assert.equal(patched, serializeNoteComments(original, [replacement]));
    assert.match(patched, /^# Title\nTrailing text\n\n<!-- Aside comments/m);
    assert.doesNotMatch(patched, /-->\nTrailing text/);
});

test("getVisibleNoteContent preserves visible whitespace around the hidden block", () => {
    const content = [
        "Body line",
        "",
        "<!-- Aside comments",
        "[]",
        "-->",
        "Trailing text",
        "",
    ].join("\n");

    assert.equal(getVisibleNoteContent(content), "Body line\n\n\nTrailing text\n");
});

test("parseNoteComments ignores non-JSON comment sections", () => {
    const invalidNote = [
        "Body",
        "",
        "<!-- Aside comments",
        "This is not JSON.",
        "-->",
        "",
    ].join("\n");

    const parsed = parseNoteComments(invalidNote, "note.md");
    assert.equal(parsed.comments.length, 0);
    assert.equal(parsed.mainContent, invalidNote.trimEnd());
});
