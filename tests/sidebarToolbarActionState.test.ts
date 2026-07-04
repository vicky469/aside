import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveNoteToolbarActionState } from "../src/ui/views/sidebarToolbarState";

test("note toolbar actions stay enabled when no exclusive mode is active", () => {
    assert.deepEqual(
        resolveNoteToolbarActionState({
            hasDeletedComments: true,
            hasPinnedThreads: true,
            noteSidebarMode: "list",
            showDeletedComments: false,
            showPinnedThreadsOnly: false,
        }),
        {
            addPageCommentDisabled: false,
            deletedDisabled: false,
            fileActionsVisible: true,
            pinnedDisabled: false,
        },
    );
});

test("note toolbar deleted mode disables every inactive row action", () => {
    assert.deepEqual(
        resolveNoteToolbarActionState({
            hasDeletedComments: true,
            hasPinnedThreads: true,
            noteSidebarMode: "list",
            showDeletedComments: true,
            showPinnedThreadsOnly: false,
        }),
        {
            addPageCommentDisabled: true,
            deletedDisabled: false,
            fileActionsVisible: true,
            pinnedDisabled: true,
        },
    );
});

test("note toolbar pinned mode disables deleted and add page note actions", () => {
    assert.deepEqual(
        resolveNoteToolbarActionState({
            hasDeletedComments: true,
            hasPinnedThreads: true,
            noteSidebarMode: "list",
            showDeletedComments: false,
            showPinnedThreadsOnly: true,
        }),
        {
            addPageCommentDisabled: true,
            deletedDisabled: true,
            fileActionsVisible: true,
            pinnedDisabled: false,
        },
    );
});

test("note toolbar file actions are hidden outside list mode", () => {
    for (const noteSidebarMode of ["todo", "agent", "tags", "thought-trail"] as const) {
        assert.equal(
            resolveNoteToolbarActionState({
                hasDeletedComments: true,
                hasPinnedThreads: true,
                noteSidebarMode,
                showDeletedComments: false,
                showPinnedThreadsOnly: false,
            }).fileActionsVisible,
            false,
        );
    }
});
