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
    };
}

function createFakeElement() {
    return {
        children: [] as unknown[],
        firstChild: null as unknown,
        className: "",
        text: "",
        classList: {
            add: () => {},
        },
        addClass: function addClass(name: string) {
            this.className = `${this.className} ${name}`.trim();
        },
        setAttribute: () => {},
        removeAttribute: () => {},
        appendChild: () => {},
        removeChild: function removeChild(child: unknown) {
            const index = this.children.indexOf(child);
            if (index >= 0) {
                this.children.splice(index, 1);
            }
            this.firstChild = this.children[0] ?? null;
        },
        remove: () => {},
        contains: function contains(target: unknown): boolean {
            return target === this || this.children.includes(target);
        },
        addEventListener: () => {},
        createDiv: function createDiv(clsOrOptions?: string | { cls?: string; text?: string }) {
            const child = createFakeElement();
            child.className = typeof clsOrOptions === "string"
                ? clsOrOptions
                : clsOrOptions?.cls ?? "";
            child.text = typeof clsOrOptions === "string"
                ? ""
                : clsOrOptions?.text ?? "";
            this.children.push(child);
            this.firstChild = this.children[0] ?? null;
            return child;
        },
        createEl: function createEl(_tag: string, options: { cls?: string; text?: string } = {}) {
            const child = createFakeElement();
            child.className = options.cls ?? "";
            child.text = options.text ?? "";
            this.children.push(child);
            this.firstChild = this.children[0] ?? null;
            return child;
        },
    } as any;
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
        getMentionSuggestions: () => [],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
}

test("getSidebarComments replaces the persisted version of the draft and sorts consistently", () => {
    const persistedComments = [
        createComment({ id: "comment-b", filePath: "docs/b.md", startLine: 8, timestamp: 300 }),
        createComment({ id: "draft-1", filePath: "docs/b.md", startLine: 12, timestamp: 400 }),
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

    const comments = getSidebarComments(persistedComments, draft);

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
        getSidebarComments(persistedComments, draft, ["docs/b.md"]).map((comment) => comment.id),
        ["comment-b"],
    );
    assert.deepEqual(
        getSidebarComments(persistedComments, draft, ["docs/c.md"]).map((comment) => comment.id),
        ["draft-1"],
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

test("sidebar draft editor controller continues markdown lists directly", () => {
    const dispatchedEvents: string[] = [];
    const controller = createDraftEditorController();
    const textarea = {
        value: "- first item",
        selectionStart: 12,
        selectionEnd: 12,
        dispatchEvent: (event: Event) => {
            dispatchedEvents.push(event.type);
            return true;
        },
        setSelectionRange(start: number, end: number) {
            textarea.selectionStart = start;
            textarea.selectionEnd = end;
        },
        rows: 2,
    } as unknown as HTMLTextAreaElement;

    const applied = controller.applyDraftListContinuation("draft-1", textarea, false);

    assert.equal(applied, true);
    assert.equal(textarea.value, "- first item\n- ");
    assert.equal(textarea.selectionStart, 15);
    assert.equal(textarea.selectionEnd, 15);
    assert.deepEqual(dispatchedEvents, ["input"]);
});

test("sidebar draft editor controller leaves non-list enter handling native", () => {
    const dispatchedEvents: string[] = [];
    const controller = createDraftEditorController();
    const textarea = {
        value: "plain paragraph",
        selectionStart: 15,
        selectionEnd: 15,
        dispatchEvent: (event: Event) => {
            dispatchedEvents.push(event.type);
            return true;
        },
        setSelectionRange(start: number, end: number) {
            textarea.selectionStart = start;
            textarea.selectionEnd = end;
        },
        rows: 2,
    } as unknown as HTMLTextAreaElement;

    const applied = controller.applyDraftListContinuation("draft-1", textarea, false);

    assert.equal(applied, false);
    assert.equal(textarea.value, "plain paragraph");
    assert.equal(textarea.selectionStart, 15);
    assert.equal(textarea.selectionEnd, 15);
    assert.deepEqual(dispatchedEvents, []);
});

test("sidebar draft editor controller inserts a chosen mention into a disconnected draft", async () => {
    const updates: Array<{ commentId: string; commentText: string }> = [];
    const focusedDraftIds: string[] = [];
    let renderCount = 0;
    let chooseMention: ((mention: string) => void | Promise<void>) | undefined;
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: (commentId, commentText) => {
            updates.push({ commentId, commentText });
        },
        renderComments: async () => {
            renderCount += 1;
        },
        scheduleDraftFocus: (commentId) => {
            focusedDraftIds.push(commentId);
        },
        getMentionSuggestions: () => [],
        openMentionSuggestModal: (options) => {
            assert.equal(options.initialQuery, "cle");
            chooseMention = options.onChooseMention;
        },
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
    const comment = createDraft({
        id: "draft-mention",
        comment: "please /cle now",
    });
    const textarea = {
        value: comment.comment,
        selectionStart: 11,
        selectionEnd: 11,
        isConnected: false,
    } as unknown as HTMLTextAreaElement;

    assert.equal(controller.openDraftMentionSuggest(comment, textarea, false), true);
    assert.ok(chooseMention);
    await chooseMention("/clean-links");

    assert.deepEqual(updates, [{
        commentId: "draft-mention",
        commentText: "please /clean-links now",
    }]);
    assert.equal(renderCount, 1);
    assert.deepEqual(focusedDraftIds, ["draft-mention"]);
});

test("sidebar draft editor controller matches tag suggestions case-insensitively and ignores hyphens", async () => {
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [createComment({
            id: "existing-tag",
            comment: "We use #an-apple for this",
        })],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: () => [],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
    const comment = createDraft({
        id: "draft-tag",
        comment: "#anApple",
    });
    const shell = createFakeElement();
    const textarea = {
        value: comment.comment,
        selectionStart: 8,
        selectionEnd: 8,
        isConnected: true,
        ownerDocument: {
            addEventListener: () => {},
            removeEventListener: () => {},
        },
        setAttribute: () => {},
        removeAttribute: () => {},
        closest: () => shell,
    } as unknown as HTMLTextAreaElement;

    assert.equal(controller.openDraftTagSuggest(comment, textarea, false), true);
    const state = (controller as unknown as {
        inlineSuggestionState: {
            items: Array<{ title: string; value: string }>;
        } | null;
    }).inlineSuggestionState;
    assert.ok(state);
    assert.equal(state.items[0]?.value, "#an-apple");
    assert.equal(state.items.some((item) => item.title.startsWith("Create tag")), false);
    const container = shell.children[0] as ReturnType<typeof createFakeElement>;
    const list = container.children[0] as ReturnType<typeof createFakeElement>;
    const row = list.children[0] as ReturnType<typeof createFakeElement>;
    assert.doesNotMatch(container.className, /(?:^|\s)is-mention(?:\s|$)/u);
    assert.deepEqual(row.children.map((child: ReturnType<typeof createFakeElement>) => ({
        className: child.className,
        text: child.text,
    })), [
        { className: "aside-inline-suggest-title", text: "#an-apple" },
        { className: "aside-inline-suggest-note", text: "Used 2 times" },
    ]);
});

test("sidebar draft editor controller renders connected mention suggestions without detail", () => {
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: () => [{
            kind: "built-in",
            mention: "@todo",
            label: "Todo",
        }],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
    const comment = createDraft({
        id: "draft-mention-inline",
        comment: "@t",
    });
    const shell = createFakeElement();
    const textarea = {
        value: comment.comment,
        selectionStart: 2,
        selectionEnd: 2,
        isConnected: true,
        ownerDocument: {
            addEventListener: () => {},
            removeEventListener: () => {},
        },
        setAttribute: () => {},
        removeAttribute: () => {},
        closest: () => shell,
    } as unknown as HTMLTextAreaElement;

    assert.equal(controller.openDraftMentionSuggest(comment, textarea, false), true);
    const container = shell.children[0] as ReturnType<typeof createFakeElement>;
    const list = container.children[0] as ReturnType<typeof createFakeElement>;
    const row = list.children[0] as ReturnType<typeof createFakeElement>;

    assert.match(container.className, /(?:^|\s)is-mention(?:\s|$)/u);
    assert.deepEqual(row.children.map((child: ReturnType<typeof createFakeElement>) => ({
        className: child.className,
        text: child.text,
    })), [{
        className: "aside-inline-suggest-title",
        text: "@todo",
    }]);
});

test("sidebar draft editor controller prioritizes an open wiki link over mention suggestions", () => {
    let mentionSuggestCount = 0;
    let linkSuggestCount = 0;
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: () => [],
        openMentionSuggestModal: () => {
            mentionSuggestCount += 1;
        },
        openLinkSuggestModal: (options) => {
            assert.equal(options.initialQuery, "@");
            linkSuggestCount += 1;
        },
        openTagSuggestModal: () => {},
    });
    const comment = createDraft({
        id: "draft-link-mention",
        comment: "[[@",
    });
    const textarea = {
        value: comment.comment,
        selectionStart: 3,
        selectionEnd: 3,
        isConnected: false,
    } as unknown as HTMLTextAreaElement;

    assert.equal(controller.openDraftMentionSuggest(comment, textarea, false), false);
    assert.equal(controller.openDraftLinkSuggest(comment, textarea, false), true);
    assert.equal(mentionSuggestCount, 0);
    assert.equal(linkSuggestCount, 1);
});
