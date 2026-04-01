import * as assert from "node:assert/strict";
import test from "node:test";
import { getManagedSectionEdit, getManagedSectionLineRange, getManagedSectionRange, getManagedSectionStartLine, parseNoteComments, replaceNoteCommentBodyById, serializeNoteComments } from "../src/core/storage/noteCommentStorage";
import type { Comment } from "../src/commentManager";

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

    assert.match(serialized, /^# Title\n\nAlpha body\.\n\n<!-- SideNote2 comments\n\[/);
    assert.match(serialized, /\n-->\n$/);
    assert.doesNotMatch(serialized, /## Comments/);
    assert.doesNotMatch(serialized, /```json/);
    assert.match(serialized, /"startLine": 1/);
    assert.match(serialized, /"startChar": 2/);
    assert.match(serialized, /"endLine": 1/);
    assert.match(serialized, /"endChar": 7/);
    assert.match(serialized, /"comment": "This is a side note\."/);

    const parsed = parseNoteComments(serialized, "note.md");
    assert.equal(parsed.mainContent, "# Title\n\nAlpha body.");
    assert.equal(parsed.comments.length, 2);
    assert.equal(parsed.comments[0].comment, "This is a side note.");
    assert.equal(parsed.comments[1].comment, "Second comment");
});

test("serializeNoteComments keeps an empty note editable by leaving a blank line before the managed appendix", () => {
    const serialized = serializeNoteComments("", [createComment({
        anchorKind: "page",
        selectedText: "Note",
    })]);

    assert.match(serialized, /^\n<!-- SideNote2 comments\n\[/);

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

    assert.match(serialized, /"comment": "First line\\nSecond line\\nThird line"/);

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

    assert.equal((secondPass.match(/<!-- SideNote2 comments/g) || []).length, 1);
    assert.match(secondPass, /"resolved": true/);
    assert.match(secondPass, /"comment": "Updated body"/);

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

test("serializeNoteComments removes the managed appendix when there are no comments", () => {
    const withComments = serializeNoteComments("Body", [createComment()]);
    const withoutComments = serializeNoteComments(withComments, []);

    assert.equal(withoutComments, "Body\n");
    assert.equal(parseNoteComments(withoutComments, "note.md").comments.length, 0);
});

test("replaceNoteCommentBodyById updates only the targeted stored comment", () => {
    const original = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [
        createComment({
            id: "comment-1",
            comment: "Original alpha",
        }),
        createComment({
            id: "comment-2",
            comment: "Original beta",
            timestamp: 1710000001000,
        }),
    ]);

    const updated = replaceNoteCommentBodyById(original, "note.md", "comment-2", "Updated beta\n");
    assert.ok(updated);

    const parsed = parseNoteComments(updated, "note.md");
    assert.equal(parsed.comments[0].comment, "Original alpha");
    assert.equal(parsed.comments[1].comment, "Updated beta");
    assert.match(updated, /Alpha beta gamma\./);
});

test("replaceNoteCommentBodyById returns null when the target id is missing", () => {
    const original = serializeNoteComments("Body\n", [createComment()]);
    assert.equal(replaceNoteCommentBodyById(original, "note.md", "missing-id", "Updated"), null);
});

test("getManagedSectionEdit patches only the managed comments block", () => {
    const original = [
        "# Title",
        "",
        "Alpha beta gamma.",
        "",
        "<!-- SideNote2 comments",
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
    assert.match(patched, /"comment": "Updated"/);
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
    assert.match(edit.replacement, /^\n<!-- SideNote2 comments\n\[/);
});

test("getManagedSectionRange returns the trailing hidden block offsets", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    const range = getManagedSectionRange(withComments);

    assert.ok(range);
    assert.equal(withComments.slice(range.fromOffset, range.toOffset).trimStart().startsWith("<!-- SideNote2 comments"), true);
});

test("getManagedSectionStartLine returns the opener line index", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    assert.equal(getManagedSectionStartLine(withComments), 4);
});

test("getManagedSectionLineRange covers the trailing managed block", () => {
    const withComments = serializeNoteComments("# Title\n\nAlpha beta gamma.\n", [createComment()]);
    assert.deepEqual(getManagedSectionLineRange(withComments), {
        startLine: 4,
        endLine: 19,
    });
});

test("getManagedSectionRange returns null when no managed block exists", () => {
    assert.equal(getManagedSectionRange("# Title\n\nAlpha beta gamma.\n"), null);
});

test("parseNoteComments still recognizes a managed block after visible text is typed before it", () => {
    const inlineManagedBlock = [
        "a<!-- SideNote2 comments",
        "[",
        "  {",
        '    "id": "comment-1",',
        '    "startLine": 0,',
        '    "startChar": 0,',
        '    "endLine": 0,',
        '    "endChar": 0,',
        '    "selectedText": "Note",',
        '    "selectedTextHash": "hash-1",',
        '    "comment": "Page note",',
        '    "timestamp": 1710000000000,',
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
        "a<!-- SideNote2 comments",
        "[]",
        "-->",
        "",
    ].join("\n");

    const range = getManagedSectionRange(inlineManagedBlock);
    assert.ok(range);
    assert.equal(inlineManagedBlock.slice(0, range.fromOffset), "a");
    assert.equal(inlineManagedBlock.slice(range.fromOffset, range.toOffset).startsWith("<!-- SideNote2 comments"), true);
});

test("parseNoteComments ignores non-JSON comment sections", () => {
    const invalidNote = [
        "Body",
        "",
        "<!-- SideNote2 comments",
        "This is not JSON.",
        "-->",
        "",
    ].join("\n");

    const parsed = parseNoteComments(invalidNote, "note.md");
    assert.equal(parsed.comments.length, 0);
    assert.equal(parsed.mainContent, invalidNote.trimEnd());
});
