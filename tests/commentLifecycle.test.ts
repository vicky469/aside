import * as assert from "node:assert/strict";
import test from "node:test";
import { buildAllCommentsNoteContent } from "../src/core/allCommentsNote";
import { parseNoteComments, serializeNoteComments } from "../src/core/noteCommentStorage";
import type { Comment } from "../src/commentManager";
import { CommentManager } from "../src/commentManager";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "Folder/Note.md",
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 10,
        selectedText: "beta",
        selectedTextHash: "hash-beta",
        comment: "First comment",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

test("note-backed comment lifecycle stays aligned with aggregate output", () => {
    const filePath = "Folder/Note.md";
    const noteBody = "# Title\n\nAlpha beta gamma.\n";
    const manager = new CommentManager([]);

    manager.addComment(createComment());
    let note = serializeNoteComments(noteBody, manager.getCommentsForFile(filePath));
    let parsed = parseNoteComments(note, filePath);

    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].selectedText, "beta");
    assert.equal(parsed.comments[0].comment, "First comment");

    manager.replaceCommentsForFile(filePath, parsed.comments);
    manager.editComment("comment-1", "Updated comment");
    manager.resolveComment("comment-1");
    note = serializeNoteComments(note, manager.getCommentsForFile(filePath));
    parsed = parseNoteComments(note, filePath);

    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].comment, "Updated comment");
    assert.equal(parsed.comments[0].resolved, true);

    const aggregateWhenResolved = buildAllCommentsNoteContent("dev", parsed.comments);
    assert.match(
        aggregateWhenResolved,
        /-\s+\[~~beta~~\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=comment-1\)/
    );

    manager.replaceCommentsForFile(filePath, parsed.comments);
    manager.unresolveComment("comment-1");
    note = serializeNoteComments(note, manager.getCommentsForFile(filePath));
    parsed = parseNoteComments(note, filePath);

    assert.equal(parsed.comments[0].resolved, false);

    const aggregateWhenReopened = buildAllCommentsNoteContent("dev", parsed.comments);
    assert.match(
        aggregateWhenReopened,
        /-\s+\[beta\]\(obsidian:\/\/side-note2-comment\?vault=dev&file=Folder%2FNote\.md&commentId=comment-1\)/
    );

    manager.replaceCommentsForFile(filePath, parsed.comments);
    manager.deleteComment("comment-1");
    note = serializeNoteComments(note, manager.getCommentsForFile(filePath));
    parsed = parseNoteComments(note, filePath);

    assert.equal(parsed.comments.length, 0);
    assert.equal(note, noteBody);
    assert.equal(buildAllCommentsNoteContent("dev", parsed.comments), "");
});
