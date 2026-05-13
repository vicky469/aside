import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import type { DraftComment } from "../src/domain/drafts";
import {
    SidebarDraftEditorController,
    estimateDraftTextareaRows,
    getSidebarComments,
} from "../src/ui/views/sidebarDraftEditor";
import {
    computePinnedDraftScrollTop,
    pinDraftToTopOnMobile,
} from "../src/ui/views/sidebarDraftComment";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 5,
        startChar: overrides.startChar ?? 1,
        endLine: overrides.endLine ?? 5,
        endChar: overrides.endChar ?? 8,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        ...createComment(overrides),
        mode: overrides.mode ?? "new",
    };
}

function createDraftEditorController() {
    return new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
}

test("getSidebarComments replaces the persisted version of the draft, hides resolved comments, and sorts consistently", () => {
    const persistedComments = [
        createComment({ id: "comment-b", filePath: "docs/b.md", startLine: 8, timestamp: 300 }),
        createComment({ id: "draft-1", filePath: "docs/b.md", startLine: 12, timestamp: 400 }),
        createComment({ id: "comment-resolved", filePath: "docs/a.md", resolved: true, timestamp: 50 }),
        createComment({ id: "comment-page", filePath: "docs/a.md", anchorKind: "page", startLine: 20, startChar: 0, endLine: 20, endChar: 0, timestamp: 150 }),
        createComment({ id: "comment-a", filePath: "docs/a.md", startLine: 3, timestamp: 200 }),
    ];
    const draft = createDraft({
        id: "draft-1",
        filePath: "docs/b.md",
        startLine: 12,
        timestamp: 500,
        comment: "Draft body",
    });

    const comments = getSidebarComments(persistedComments, draft, false);

    assert.deepEqual(comments.map((comment) => ({
        id: comment.id,
        filePath: comment.filePath,
        timestamp: comment.timestamp,
        isDraft: "mode" in comment,
    })), [
        { id: "comment-page", filePath: "docs/a.md", timestamp: 150, isDraft: false },
        { id: "comment-a", filePath: "docs/a.md", timestamp: 200, isDraft: false },
        { id: "comment-b", filePath: "docs/b.md", timestamp: 300, isDraft: false },
        { id: "draft-1", filePath: "docs/b.md", timestamp: 500, isDraft: true },
    ]);
});

test("getSidebarComments applies file filters to both persisted comments and drafts", () => {
    const persistedComments = [
        createComment({ id: "comment-a", filePath: "docs/a.md", timestamp: 100 }),
        createComment({ id: "comment-b", filePath: "docs/b.md", timestamp: 200 }),
    ];
    const draft = createDraft({
        id: "draft-1",
        filePath: "docs/c.md",
        timestamp: 300,
    });

    assert.deepEqual(
        getSidebarComments(persistedComments, draft, false, ["docs/b.md"]).map((comment) => comment.id),
        ["comment-b"],
    );
    assert.deepEqual(
        getSidebarComments(persistedComments, draft, false, ["docs/c.md"]).map((comment) => comment.id),
        ["draft-1"],
    );
});

test("getSidebarComments shows only resolved comments when the resolved toggle is on", () => {
    const persistedComments = [
        createComment({ id: "comment-unresolved", filePath: "docs/a.md", timestamp: 100, resolved: false }),
        createComment({ id: "comment-resolved", filePath: "docs/a.md", timestamp: 200, resolved: true }),
    ];

    assert.deepEqual(
        getSidebarComments(persistedComments, null, true).map((comment) => comment.id),
        ["comment-resolved"],
    );
});

test("estimateDraftTextareaRows keeps draft editors within their intended bounds", () => {
    assert.equal(estimateDraftTextareaRows("Short", false), 2);
    assert.equal(estimateDraftTextareaRows("Short", true), 2);

    const longLine = "x".repeat(2_000);
    assert.equal(estimateDraftTextareaRows(longLine, false), 10);
    assert.equal(estimateDraftTextareaRows(longLine, true), 18);
});

test("computePinnedDraftScrollTop only scrolls enough to keep the draft visible", () => {
    assert.equal(computePinnedDraftScrollTop(120, 260, 460, 40, 420), 168);
    assert.equal(computePinnedDraftScrollTop(120, 24, 224, 40, 420), 96);
    assert.equal(computePinnedDraftScrollTop(120, 80, 280, 40, 420), 120);
    assert.equal(computePinnedDraftScrollTop(0, 4, 204, 20, 420), 0);
});

test("computePinnedDraftScrollTop keeps draft actions above floating bottom controls", () => {
    assert.equal(computePinnedDraftScrollTop(220, 660, 835, 143, 843, 777), 286);
});

test("pinDraftToTopOnMobile performs a minimal scroll adjustment when the draft is offscreen", () => {
    const originalHTMLElement = globalThis.HTMLElement;
    class FakeElement {}
    Object.assign(globalThis, {
        HTMLElement: FakeElement,
    });

    try {
    const scrollCalls: Array<{ top: number; behavior: string }> = [];
        const scrollContainer = Object.assign(new FakeElement(), {
            scrollTop: 120,
            getBoundingClientRect: () => ({ top: 40, bottom: 420 }),
            scrollTo: (options: { top: number; behavior: string }) => {
                scrollCalls.push(options);
            },
        }) as unknown as HTMLElement;
        const draftEl = Object.assign(new FakeElement(), {
            getBoundingClientRect: () => ({ top: 260, bottom: 460 }),
        }) as unknown as HTMLElement;
        const textarea = {
            closest: (selector: string) => {
                if (selector === ".aside-comment-draft") {
                    return draftEl;
                }
                if (selector === ".aside-view-container") {
                    return scrollContainer;
                }
                return null;
            },
        } as unknown as HTMLTextAreaElement;

        pinDraftToTopOnMobile(textarea);

        assert.deepEqual(scrollCalls, [{
            top: 168,
            behavior: "auto",
        }]);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
        });
    }
});

test("pinDraftToTopOnMobile skips no-op scroll corrections", () => {
    const originalHTMLElement = globalThis.HTMLElement;
    class FakeElement {}
    Object.assign(globalThis, {
        HTMLElement: FakeElement,
    });

    try {
        const scrollCalls: Array<{ top: number; behavior: string }> = [];
        const scrollContainer = Object.assign(new FakeElement(), {
            scrollTop: 120,
            getBoundingClientRect: () => ({ top: 40, bottom: 420 }),
            scrollTo: (options: { top: number; behavior: string }) => {
                scrollCalls.push(options);
            },
        }) as unknown as HTMLElement;
        const draftEl = Object.assign(new FakeElement(), {
            getBoundingClientRect: () => ({ top: 80, bottom: 280 }),
        }) as unknown as HTMLElement;
        const textarea = {
            closest: (selector: string) => {
                if (selector === ".aside-comment-draft") {
                    return draftEl;
                }
                if (selector === ".aside-view-container") {
                    return scrollContainer;
                }
                return null;
            },
        } as unknown as HTMLTextAreaElement;

        pinDraftToTopOnMobile(textarea);

        assert.deepEqual(scrollCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
        });
    }
});

test("sidebar draft editor controller applies bold formatting directly", () => {
    const dispatchedEvents: string[] = [];
    const controller = createDraftEditorController();
    const textarea = {
        value: "hello world",
        selectionStart: 6,
        selectionEnd: 11,
        dispatchEvent: (event: Event) => {
            dispatchedEvents.push(event.type);
            return true;
        },
        setSelectionRange(start: number, end: number) {
            textarea.selectionStart = start;
            textarea.selectionEnd = end;
        },
        rows: 4,
    } as unknown as HTMLTextAreaElement;

    controller.applyDraftBold("draft-1", textarea, false);

    assert.equal(textarea.value, "hello **world**");
    assert.equal(textarea.selectionStart, 8);
    assert.equal(textarea.selectionEnd, 13);
    assert.deepEqual(dispatchedEvents, ["input"]);
});

test("sidebar draft editor controller applies highlight formatting directly", () => {
    const dispatchedEvents: string[] = [];
    const controller = createDraftEditorController();
    const textarea = {
        value: "hello world",
        selectionStart: 6,
        selectionEnd: 11,
        dispatchEvent: (event: Event) => {
            dispatchedEvents.push(event.type);
            return true;
        },
        setSelectionRange(start: number, end: number) {
            textarea.selectionStart = start;
            textarea.selectionEnd = end;
        },
        rows: 4,
    } as unknown as HTMLTextAreaElement;

    controller.applyDraftHighlight("draft-1", textarea, false);

    assert.equal(textarea.value, "hello ==world==");
    assert.equal(textarea.selectionStart, 8);
    assert.equal(textarea.selectionEnd, 13);
    assert.deepEqual(dispatchedEvents, ["input"]);
});
