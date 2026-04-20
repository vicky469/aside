import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import type { DraftComment } from "../src/domain/drafts";
import { SidebarInteractionController } from "../src/ui/views/sidebarInteractionController";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 4,
        startChar: overrides.startChar ?? 1,
        endLine: overrides.endLine ?? 4,
        endChar: overrides.endChar ?? 7,
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
        mode: overrides.mode ?? "edit",
        threadId: overrides.threadId,
        appendAfterCommentId: overrides.appendAfterCommentId,
    };
}

class FakeNode {}

class FakeSidebarElement extends FakeNode {
    public parentElement: FakeSidebarElement | null = null;
    public addClassCalls: string[] = [];
    public removeClassCalls: string[] = [];
    public scrollCalls = 0;

    constructor(
        private readonly options: {
            isCommentItem?: boolean;
            isSectionChrome?: boolean;
        } = {},
    ) {
        super();
    }

    public closest(selector: string): FakeSidebarElement | null {
        if (selector === ".sidenote2-comment-item") {
            return this.options.isCommentItem ? this : null;
        }

        if (selector === ".sidenote2-comments-list-actions, .sidenote2-sidebar-toolbar, .sidenote2-active-file-filters") {
            return this.options.isSectionChrome ? this : null;
        }

        return null;
    }

    public contains(target: unknown): boolean {
        return target === this;
    }

    public getAttribute(_name: string): string | null {
        return null;
    }

    public addClass(name: string): void {
        this.addClassCalls.push(name);
    }

    public removeClass(name: string): void {
        this.removeClassCalls.push(name);
    }

    public scrollIntoView(_options: unknown): void {
        this.scrollCalls += 1;
    }
}

type FakeCommentElement = {
    addClassCalls: string[];
    removeClassCalls: string[];
    scrollCalls: number;
    dataCommentId?: string;
    dataDraftId?: string;
    getAttribute(name: string): string | null;
    addClass(name: string): void;
    removeClass(name: string): void;
    scrollIntoView(options: unknown): void;
};

function createCommentElement(ids: { commentId?: string; draftId?: string } = {}): FakeCommentElement {
    return {
        addClassCalls: [],
        removeClassCalls: [],
        scrollCalls: 0,
        dataCommentId: ids.commentId,
        dataDraftId: ids.draftId,
        getAttribute(name: string) {
            if (name === "data-comment-id") {
                return this.dataCommentId ?? null;
            }
            if (name === "data-draft-id") {
                return this.dataDraftId ?? null;
            }
            return null;
        },
        addClass(name: string) {
            this.addClassCalls.push(name);
        },
        removeClass(name: string) {
            this.removeClassCalls.push(name);
        },
        scrollIntoView(_options: unknown) {
            this.scrollCalls += 1;
        },
    };
}

function createHarness() {
    const matchingCommentEl = createCommentElement({ commentId: "comment-1" });
    const otherActiveEl = createCommentElement({ commentId: "comment-2" });
    let renderCalls = 0;
    const revealedComments: string[] = [];

    const controller = new SidebarInteractionController({
        app: {
            workspace: {
                activeLeaf: null,
                setActiveLeaf: () => {},
            },
        } as never,
        leaf: {} as never,
        containerEl: {
            querySelector: (selector: string) => {
                if (selector.includes("comment-1")) {
                    return matchingCommentEl;
                }
                return null;
            },
            querySelectorAll: () => [otherActiveEl],
            contains: () => true,
        } as never,
        getCurrentFile: () => null,
        getDraftForView: () => null,
        renderComments: async () => {
            renderCalls += 1;
        },
        saveDraft: () => {},
        cancelDraft: () => {},
        clearRevealedCommentSelection: () => {},
        revealComment: async (comment) => {
            revealedComments.push(comment.id);
        },
        getPreferredFileLeaf: () => null,
        openLinkText: async () => {},
    });

    return {
        controller,
        matchingCommentEl,
        otherActiveEl,
        getRenderCalls: () => renderCalls,
        revealedComments,
    };
}

test("sidebar interaction controller highlights a comment by rerendering and scrolling it into view", async () => {
    const harness = createHarness();

    harness.controller.highlightComment("comment-1");
    await Promise.resolve();

    assert.equal(harness.controller.getActiveCommentId(), "comment-1");
    assert.equal(harness.getRenderCalls(), 1);
    assert.equal(harness.matchingCommentEl.scrollCalls, 1);
});

test("sidebar interaction controller opens a comment by marking it active and revealing it", async () => {
    const harness = createHarness();

    await harness.controller.openCommentInEditor(createComment({ id: "comment-1" }));

    assert.equal(harness.controller.getActiveCommentId(), "comment-1");
    assert.deepEqual(harness.revealedComments, ["comment-1"]);
    assert.deepEqual(harness.otherActiveEl.removeClassCalls, ["active"]);
    assert.deepEqual(harness.matchingCommentEl.addClassCalls, ["active"]);
});

test("sidebar interaction controller scrolls the rerendered draft card instead of a stale pre-render node", async () => {
    const staleDraftEl = createCommentElement({ draftId: "draft-1" });
    const freshDraftEl = createCommentElement({ draftId: "draft-1" });
    let renderCalls = 0;
    let renderCompleted = false;
    const rafCallbacks: Array<(time: number) => void> = [];
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    Object.assign(globalThis, {
        window: {
            requestAnimationFrame(callback: (time: number) => void) {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            },
            cancelAnimationFrame() {},
            getSelection: () => null,
        },
        document: {
            activeElement: null,
        },
    });

    try {
        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: (selector: string) => {
                    if (!selector.includes("draft-1")) {
                        return null;
                    }

                    return renderCompleted ? freshDraftEl : staleDraftEl;
                },
                querySelectorAll: () => [],
                contains: () => true,
            } as never,
            getCurrentFile: () => null,
            getDraftForView: () => null,
            renderComments: async () => {
                renderCalls += 1;
                renderCompleted = true;
            },
            saveDraft: () => {},
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {},
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        await controller.highlightAndFocusDraft("draft-1");

        assert.equal(renderCalls, 1);
        assert.equal(staleDraftEl.scrollCalls, 0);
        assert.equal(freshDraftEl.scrollCalls, 1);
    } finally {
        Object.assign(globalThis, {
            window: originalWindow,
            document: originalDocument,
        });
    }
});

test("sidebar interaction controller clears active state classes", () => {
    const harness = createHarness();

    harness.controller.clearActiveState();

    assert.equal(harness.controller.getActiveCommentId(), null);
    assert.deepEqual(harness.otherActiveEl.removeClassCalls, ["active"]);
});

test("sidebar interaction controller claims the sidebar leaf before focusing a draft textarea", () => {
    const setActiveLeafCalls: Array<{ leaf: unknown; options: unknown }> = [];
    const sidebarLeaf = { id: "sidebar-leaf" };
    let activeLeaf: unknown = { id: "editor-leaf" };
    const selectionCalls: Array<{ start: number; end: number }> = [];
    const textarea = {
        isConnected: true,
        value: "Draft text",
        focus(_options?: unknown) {
            documentStub.activeElement = this as unknown as Element;
        },
        setSelectionRange(start: number, end: number) {
            selectionCalls.push({ start, end });
        },
    } as unknown as HTMLTextAreaElement;
    const rafCallbacks: Array<(time: number) => void> = [];
    const windowStub = {
        requestAnimationFrame(callback: (time: number) => void) {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        },
        cancelAnimationFrame() {},
        getSelection: () => null,
    };
    const documentStub = {
        activeElement: null as Element | null,
    };
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    Object.assign(globalThis, {
        window: windowStub,
        document: documentStub,
    });

    try {
        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    get activeLeaf() {
                        return activeLeaf;
                    },
                    setActiveLeaf: (leaf: unknown, options: unknown) => {
                        setActiveLeafCalls.push({ leaf, options });
                        activeLeaf = leaf;
                    },
                },
            } as never,
            leaf: sidebarLeaf as never,
            containerEl: {
                querySelector: (selector: string) =>
                    selector === '[data-draft-id="draft-1"] textarea' ? textarea : null,
                querySelectorAll: () => [],
                contains: () => true,
            } as never,
            getCurrentFile: () => null,
            getDraftForView: () => null,
            renderComments: async () => {},
            saveDraft: () => {},
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {},
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        controller.scheduleDraftFocus("draft-1", 0);
        assert.equal(rafCallbacks.length, 1);

        const callback = rafCallbacks.shift();
        assert.ok(callback);
        callback?.(0);

        assert.deepEqual(setActiveLeafCalls, [{
            leaf: sidebarLeaf,
            options: { focus: false },
        }]);
        assert.equal(documentStub.activeElement, textarea);
        assert.deepEqual(selectionCalls, [{
            start: textarea.value.length,
            end: textarea.value.length,
        }]);
    } finally {
        Object.assign(globalThis, {
            window: originalWindow,
            document: originalDocument,
        });
    }
});

test("sidebar interaction controller autosaves draft edits on sidebar background click", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        let currentDraft: DraftComment | null = createDraft({ id: "draft-1" });
        const activeEl = createCommentElement({ draftId: "draft-1" });
        const draftEl = new FakeSidebarElement();
        const backgroundEl = new FakeSidebarElement();
        const saveDraftCalls: string[] = [];
        let clearRevealedCommentSelectionCalls = 0;

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: (selector: string) => selector.includes("draft-1") ? draftEl : null,
                querySelectorAll: () => [activeEl],
                contains: () => true,
            } as never,
            getCurrentFile: () => ({ path: "docs/architecture.md" }) as never,
            getDraftForView: () => currentDraft,
            renderComments: async () => {},
            saveDraft: async (commentId) => {
                saveDraftCalls.push(commentId);
                currentDraft = null;
            },
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {
                clearRevealedCommentSelectionCalls += 1;
            },
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        controller.setActiveComment("draft-1");
        await controller.sidebarClickHandler({ target: backgroundEl } as unknown as MouseEvent);

        assert.deepEqual(saveDraftCalls, ["draft-1"]);
        assert.equal(controller.getActiveCommentId(), null);
        assert.equal(clearRevealedCommentSelectionCalls, 1);
        assert.deepEqual(activeEl.removeClassCalls, ["active"]);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});

test("sidebar interaction controller autosaves without clearing active state when clicking another comment", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        let currentDraft: DraftComment | null = createDraft({ id: "draft-1" });
        const activeEl = createCommentElement({ draftId: "draft-1" });
        const draftEl = new FakeSidebarElement();
        const commentTargetEl = new FakeSidebarElement({ isCommentItem: true });
        const saveDraftCalls: string[] = [];
        let clearRevealedCommentSelectionCalls = 0;

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: (selector: string) => selector.includes("draft-1") ? draftEl : null,
                querySelectorAll: () => [activeEl],
                contains: () => true,
            } as never,
            getCurrentFile: () => ({ path: "docs/architecture.md" }) as never,
            getDraftForView: () => currentDraft,
            renderComments: async () => {},
            saveDraft: async (commentId) => {
                saveDraftCalls.push(commentId);
                currentDraft = null;
            },
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {
                clearRevealedCommentSelectionCalls += 1;
            },
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        controller.setActiveComment("draft-1");
        await controller.sidebarClickHandler({ target: commentTargetEl } as unknown as MouseEvent);

        assert.deepEqual(saveDraftCalls, ["draft-1"]);
        assert.equal(controller.getActiveCommentId(), "draft-1");
        assert.equal(clearRevealedCommentSelectionCalls, 0);
        assert.deepEqual(activeEl.removeClassCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});
