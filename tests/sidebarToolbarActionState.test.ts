import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveNoteToolbarActionState } from "../src/ui/views/sidebarToolbarState";

test("note toolbar actions stay enabled when no exclusive mode is active", () => {
    assert.deepEqual(
        resolveNoteToolbarActionState({
            hasDeletedComments: true,
            hasPinnedThreads: true,
            showDeletedComments: false,
            showPinnedThreadsOnly: false,
        }),
        {
            addPageCommentDisabled: false,
            deletedDisabled: false,
            pinnedDisabled: false,
        },
    );
});

test("note toolbar deleted mode disables every inactive row action", () => {
    assert.deepEqual(
        resolveNoteToolbarActionState({
            hasDeletedComments: true,
            hasPinnedThreads: true,
            showDeletedComments: true,
            showPinnedThreadsOnly: false,
        }),
        {
            addPageCommentDisabled: true,
            deletedDisabled: false,
            pinnedDisabled: true,
        },
    );
});

test("note toolbar pinned mode disables deleted and add page note actions", () => {
    assert.deepEqual(
        resolveNoteToolbarActionState({
            hasDeletedComments: true,
            hasPinnedThreads: true,
            showDeletedComments: false,
            showPinnedThreadsOnly: true,
        }),
        {
            addPageCommentDisabled: true,
            deletedDisabled: true,
            pinnedDisabled: false,
        },
    );
});
