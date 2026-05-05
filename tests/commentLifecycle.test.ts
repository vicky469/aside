import * as assert from "node:assert/strict";
import test from "node:test";
import {
    ALL_COMMENTS_NOTE_IMAGE_ALT,
    ALL_COMMENTS_NOTE_IMAGE_CAPTION,
    ALL_COMMENTS_NOTE_IMAGE_URL,
    buildAllCommentsNoteContent,
} from "../src/core/derived/allCommentsNote";
import { SOFT_DELETE_RETENTION_MS } from "../src/core/rules/deletedCommentVisibility";
import { parseNoteComments, serializeNoteComments, serializeNoteCommentThreads } from "../src/core/storage/noteCommentStorage";
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
    const deletedAt = Date.now();

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

    const aggregateWhenResolved = buildAllCommentsNoteContent("dev", parsed.comments, {
        showResolved: true,
    });
    assert.match(
        aggregateWhenResolved,
        /- \[Note\.md\]\(obsidian:\/\/open\?vault=dev&file=Folder%2FNote\.md\)/
    );

    manager.replaceCommentsForFile(filePath, parsed.comments);
    manager.unresolveComment("comment-1");
    note = serializeNoteComments(note, manager.getCommentsForFile(filePath));
    parsed = parseNoteComments(note, filePath);

    assert.equal(parsed.comments[0].resolved, false);

    const aggregateWhenReopened = buildAllCommentsNoteContent("dev", parsed.comments, {
        showResolved: false,
    });
    assert.match(
        aggregateWhenReopened,
        /- \[Note\.md\]\(obsidian:\/\/open\?vault=dev&file=Folder%2FNote\.md\)/
    );

    manager.replaceCommentsForFile(filePath, parsed.comments);
    manager.deleteComment("comment-1", deletedAt);
    note = serializeNoteComments(note, manager.getCommentsForFile(filePath, { includeDeleted: true }));
    parsed = parseNoteComments(note, filePath);

    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].deletedAt, deletedAt);
    assert.match(note, new RegExp(`"deletedAt": ${deletedAt}`));
    assert.equal(
        buildAllCommentsNoteContent("dev", manager.getCommentsForFile(filePath)),
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${ALL_COMMENTS_NOTE_IMAGE_URL})\n<div class="sidenote2-index-header-caption" style="display: block; color: #8a8a8a; font-size: 12px; line-height: 1.2; text-align: center;">${ALL_COMMENTS_NOTE_IMAGE_CAPTION}</div>\n`,
    );

    note = note.replace(String(deletedAt), String(deletedAt - SOFT_DELETE_RETENTION_MS - 1));
    parsed = parseNoteComments(note, filePath);
    assert.equal(parsed.comments.length, 0);
});

test("note-backed comments preserve deleted child entries through storage while hiding them from normal queries", () => {
    const filePath = "Folder/ChildDelete.md";
    const baseTimestamp = Date.now();
    const manager = new CommentManager([{
        id: "thread-1",
        filePath,
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 5,
        selectedText: "Alpha",
        selectedTextHash: "hash-alpha",
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
        entries: [
            {
                id: "thread-1",
                body: "Parent",
                timestamp: baseTimestamp,
            },
            {
                id: "entry-2",
                body: "Child",
                timestamp: baseTimestamp + 1,
            },
        ],
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp + 1,
    }]);

    manager.deleteComment("entry-2", baseTimestamp + 2);

    const note = serializeNoteCommentThreads("# Title\n", manager.getThreadsForFile(filePath, { includeDeleted: true }));
    const parsed = parseNoteComments(note, filePath);
    const reloaded = new CommentManager(parsed.threads);

    assert.deepEqual(
        parsed.threads[0]?.entries.map((entry) => ({
            id: entry.id,
            deletedAt: entry.deletedAt,
        })),
        [
            { id: "thread-1", deletedAt: undefined },
            { id: "entry-2", deletedAt: baseTimestamp + 2 },
        ],
    );
    assert.deepEqual(
        reloaded.getThreadsForFile(filePath)[0]?.entries.map((entry) => entry.id),
        ["thread-1"],
    );
    assert.deepEqual(
        reloaded.getThreadsForFile(filePath, { includeDeleted: true })[0]?.entries.map((entry) => ({
            id: entry.id,
            deletedAt: entry.deletedAt,
        })),
        [
            { id: "thread-1", deletedAt: undefined },
            { id: "entry-2", deletedAt: baseTimestamp + 2 },
        ],
    );
});
