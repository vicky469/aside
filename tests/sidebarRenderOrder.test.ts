import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import type { DraftComment } from "../src/domain/drafts";
import type { SidebarRenderableItem } from "../src/ui/views/sidebarRenderOrder";
import {
    buildStoredOrderSidebarItems,
    getNestedThreadIdForEditDraft,
    getNestedThreadIdForAppendDraft,
    getReplacedThreadIdForEditDraft,
    getSidebarSortCommentForThread,
    matchesPinnedSidebarDraftVisibility,
    shouldRenderTopLevelDraftComment,
    sortSidebarRenderableItems,
} from "../src/ui/views/sidebarRenderOrder";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/note.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "note",
        selectedTextHash: overrides.selectedTextHash ?? "hash:note",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "page",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("getSidebarSortCommentForThread keeps the parent entry timestamp for threaded sorting", () => {
    const thread = commentToThread(createComment({
        id: "page-note-1",
        timestamp: 100,
    }));
    thread.entries.push({
        id: "reply-1",
        body: "Later reply",
        timestamp: 300,
    });
    thread.updatedAt = 300;

    const sortComment = getSidebarSortCommentForThread(thread);

    assert.equal(sortComment.id, "page-note-1");
    assert.equal(sortComment.timestamp, 100);
    assert.equal(sortComment.comment, "Comment body");
});

test("sortSidebarRenderableItems keeps page-note thread order stable after later replies", () => {
    const olderPageThread = commentToThread(createComment({
        id: "page-note-older",
        timestamp: 100,
    }));
    olderPageThread.entries.push({
        id: "reply-1",
        body: "Second child reply",
        timestamp: 400,
    });
    olderPageThread.updatedAt = 400;

    const newerPageThread = commentToThread(createComment({
        id: "page-note-newer",
        timestamp: 200,
    }));

    const items: SidebarRenderableItem[] = [
        { kind: "thread", thread: newerPageThread },
        { kind: "thread", thread: olderPageThread },
    ];
    const sorted = sortSidebarRenderableItems(items);

    assert.deepEqual(sorted.map((item) => item.kind === "thread" ? item.thread.id : item.draft.id), [
        "page-note-older",
        "page-note-newer",
    ]);
});

test("sortSidebarRenderableItems keeps root files ahead of nested folders to match index note ordering", () => {
    const nestedThread = commentToThread(createComment({
        id: "nested-note",
        filePath: "SideNote2 Graph Fixtures/graph-1000/size-1/isolated/g01-isolated-c01-n01.md",
        timestamp: 100,
    }));
    const rootThread = commentToThread(createComment({
        id: "root-note",
        filePath: "test.md",
        timestamp: 200,
    }));

    const items: SidebarRenderableItem[] = [
        { kind: "thread", thread: nestedThread },
        { kind: "thread", thread: rootThread },
    ];
    const sorted = sortSidebarRenderableItems(items);

    assert.deepEqual(sorted.map((item) => item.kind === "thread" ? item.thread.id : item.draft.id), [
        "root-note",
        "nested-note",
    ]);
});

test("getReplacedThreadIdForEditDraft replaces the parent thread when editing a child entry", () => {
    const thread = commentToThread(createComment({
        id: "thread-1",
        anchorKind: "selection",
        timestamp: 100,
    }));
    thread.entries.push({
        id: "reply-1",
        body: "Child reply",
        timestamp: 200,
    });
    thread.updatedAt = 200;

    const draft: DraftComment = {
        ...createComment({
            id: "reply-1",
            anchorKind: "selection",
            comment: "Child reply",
            timestamp: 200,
        }),
        mode: "edit",
    };

    assert.equal(getReplacedThreadIdForEditDraft([thread], draft), "thread-1");
});

test("getNestedThreadIdForEditDraft keeps child edit drafts inside their parent thread", () => {
    const thread = commentToThread(createComment({
        id: "thread-1",
        anchorKind: "selection",
        timestamp: 100,
    }));
    thread.entries.push({
        id: "reply-1",
        body: "Child reply",
        timestamp: 200,
    });
    thread.updatedAt = 200;

    const draft: DraftComment = {
        ...createComment({
            id: "reply-1",
            anchorKind: "selection",
            comment: "Child reply",
            timestamp: 200,
        }),
        mode: "edit",
        threadId: "thread-1",
    };

    assert.equal(getNestedThreadIdForEditDraft([thread], draft), "thread-1");
});

test("getNestedThreadIdForAppendDraft resolves a child-targeted append draft to its parent thread", () => {
    const thread = commentToThread(createComment({
        id: "thread-1",
        anchorKind: "selection",
        timestamp: 100,
    }));
    thread.entries.push({
        id: "reply-1",
        body: "Child reply",
        timestamp: 200,
    });

    const draft: DraftComment = {
        ...createComment({
            id: "draft-1",
            anchorKind: "selection",
            comment: "",
            timestamp: 300,
        }),
        mode: "append",
        threadId: "reply-1",
    };

    assert.equal(getNestedThreadIdForAppendDraft([thread], draft), "thread-1");
    assert.equal(getNestedThreadIdForAppendDraft([thread], {
        ...draft,
        mode: "new",
    }), null);
});

test("buildStoredOrderSidebarItems keeps file thread order and replaces the edited thread in place", () => {
    const firstThread = commentToThread(createComment({
        id: "thread-1",
        timestamp: 100,
    }));
    const secondThread = commentToThread(createComment({
        id: "thread-2",
        timestamp: 200,
    }));
    const draft: DraftComment = {
        ...createComment({
            id: "draft-1",
            comment: "Draft body",
            timestamp: 250,
        }),
        mode: "edit",
        threadId: "thread-2",
    };

    const items = buildStoredOrderSidebarItems([firstThread, secondThread], draft, "thread-2");

    assert.deepEqual(items.map((item) => item.kind === "thread" ? item.thread.id : item.draft.id), [
        "thread-1",
        "draft-1",
    ]);
});

test("buildStoredOrderSidebarItems inserts a new top-level draft into its natural sidebar position", () => {
    const anchoredThread = commentToThread(createComment({
        id: "anchored-1",
        anchorKind: "selection",
        startLine: 12,
        startChar: 0,
        timestamp: 200,
    }));
    const pageThread = commentToThread(createComment({
        id: "page-note-1",
        anchorKind: "page",
        startLine: 0,
        startChar: 0,
        timestamp: 100,
    }));
    const draft: DraftComment = {
        ...createComment({
            id: "draft-1",
            anchorKind: "page",
            comment: "",
            startLine: 0,
            startChar: 0,
            timestamp: 150,
        }),
        mode: "new",
        threadId: "draft-1",
    };

    const items = buildStoredOrderSidebarItems([pageThread, anchoredThread], draft, null);

    assert.deepEqual(items.map((item) => item.kind === "thread" ? item.thread.id : item.draft.id), [
        "page-note-1",
        "draft-1",
        "anchored-1",
    ]);
});

test("shouldRenderTopLevelDraftComment keeps normal note drafts visible even when the remembered index mode is agent", () => {
    const draft: DraftComment = {
        ...createComment({
            id: "draft-1",
            comment: "",
            timestamp: 250,
        }),
        mode: "new",
        threadId: "draft-1",
    };

    const visibleDraft = shouldRenderTopLevelDraftComment({
        draft,
        nestedAppendDraftThreadId: null,
        nestedEditDraftThreadId: null,
        isAgentIndexMode: false,
        agentThreadIds: new Set<string>(),
    });

    assert.equal(visibleDraft?.id, "draft-1");
});

test("shouldRenderTopLevelDraftComment hides drafts that do not belong to the current agent index scope", () => {
    const draft: DraftComment = {
        ...createComment({
            id: "draft-1",
            comment: "",
            timestamp: 250,
        }),
        mode: "new",
        threadId: "draft-1",
    };

    const hiddenDraft = shouldRenderTopLevelDraftComment({
        draft,
        nestedAppendDraftThreadId: null,
        nestedEditDraftThreadId: null,
        isAgentIndexMode: true,
        agentThreadIds: new Set<string>(["other-thread"]),
    });

    assert.equal(hiddenDraft, null);
});

test("shouldRenderTopLevelDraftComment hides nested edit drafts", () => {
    const draft: DraftComment = {
        ...createComment({
            id: "reply-1",
            anchorKind: "selection",
            comment: "Child reply",
            timestamp: 250,
        }),
        mode: "edit",
        threadId: "thread-1",
    };

    const hiddenDraft = shouldRenderTopLevelDraftComment({
        draft,
        nestedAppendDraftThreadId: null,
        nestedEditDraftThreadId: "thread-1",
        isAgentIndexMode: false,
        agentThreadIds: new Set<string>(),
    });

    assert.equal(hiddenDraft, null);
});

test("matchesPinnedSidebarDraftVisibility keeps new page-note drafts visible while pins are active", () => {
    assert.equal(
        matchesPinnedSidebarDraftVisibility({
            mode: "new",
            threadId: undefined,
        }, new Set(["thread-1"])),
        true,
    );
});

test("matchesPinnedSidebarDraftVisibility keeps append and edit drafts scoped to pinned threads", () => {
    assert.equal(
        matchesPinnedSidebarDraftVisibility({
            mode: "append",
            threadId: "thread-1",
        }, new Set(["thread-1"])),
        true,
    );
    assert.equal(
        matchesPinnedSidebarDraftVisibility({
            mode: "edit",
            threadId: "thread-2",
        }, new Set(["thread-1"])),
        false,
    );
});
