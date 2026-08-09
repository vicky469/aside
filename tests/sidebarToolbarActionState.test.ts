import * as assert from "node:assert/strict";
import test from "node:test";
import {
    resolveNoteToolbarActionState,
    resolveSidebarSecondaryToolbarPlan,
} from "../src/ui/views/sidebarToolbarState";

test("secondary toolbar plan shares valid controls across note and index surfaces", () => {
    const base = {
        hasNestedComments: true,
        hasFileFilterOptions: true,
        hasAddPageCommentAction: true,
    };

    assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "index",
        mode: "list",
    }), {
        showRow: true,
        showFileFilter: true,
        showSearch: true,
        showPinned: true,
        showNested: true,
        showDeleted: true,
        showAddPageComment: false,
    });

    for (const mode of ["todo", "agent"] as const) {
        assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
            ...base,
            surface: "index",
            mode,
        }), {
            showRow: true,
            showFileFilter: true,
            showSearch: false,
            showPinned: true,
            showNested: true,
            showDeleted: true,
            showAddPageComment: false,
        });
    }

    assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "index",
        mode: "thought-trail",
    }), {
        showRow: true,
        showFileFilter: true,
        showSearch: false,
        showPinned: false,
        showNested: false,
        showDeleted: false,
        showAddPageComment: false,
    });

    assert.equal(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "note",
        mode: "list",
    }).showAddPageComment, true);

    assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "note",
        mode: "todo",
    }), {
        showRow: true,
        showFileFilter: false,
        showSearch: true,
        showPinned: false,
        showNested: true,
        showDeleted: false,
        showAddPageComment: false,
    });
});

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
