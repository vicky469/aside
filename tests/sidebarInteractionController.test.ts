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
            isDismissalExemptSurface?: boolean;
            isSectionChrome?: boolean;
            isToolbar?: boolean;
            isDeletedToolbarMode?: boolean;
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

        if (selector === ".sidenote2-sidebar-toolbar") {
            return this.options.isToolbar ? this : null;
        }

        if (selector === ".sidenote2-sidebar-toolbar.is-deleted-toolbar-mode") {
            return this.options.isToolbar && this.options.isDeletedToolbarMode ? this : null;
        }

        if (selector === ".suggestion-container, .modal-container, .prompt, .menu") {
            return this.options.isDismissalExemptSurface ? this : null;
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
    const openedCommentTargets: Array<{ filePath: string | null; commentId: string }> = [];
    const openedLinks: Array<{ href: string; sourcePath: string }> = [];

    const controller = new SidebarInteractionController({
        app: {
            vault: {
                getName: () => "dev",
            },
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
        openCommentById: async (filePath, commentId) => {
            openedCommentTargets.push({ filePath, commentId });
        },
        getPreferredFileLeaf: () => null,
        openLinkText: async (href, sourcePath) => {
            openedLinks.push({ href, sourcePath });
        },
    });

    return {
        controller,
        matchingCommentEl,
        otherActiveEl,
        getRenderCalls: () => renderCalls,
        revealedComments,
        openedCommentTargets,
        openedLinks,
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

test("sidebar interaction controller routes local side note protocol links through comment open flow", async () => {
    const harness = createHarness();

    await harness.controller.openSidebarInternalLink(
        "obsidian://side-note2-comment?vault=dev&file=docs%2Ftarget.md&commentId=comment-9",
        "docs/source.md",
        {} as HTMLElement,
    );

    assert.deepEqual(harness.openedCommentTargets, [{
        filePath: "docs/target.md",
        commentId: "comment-9",
    }]);
    assert.deepEqual(harness.openedLinks, []);
});

test("sidebar interaction controller marks the targeted comment active", () => {
    const harness = createHarness();

    harness.controller.setActiveComment("comment-1");
    assert.equal(harness.controller.getActiveCommentId(), "comment-1");
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
                    if (selector.includes("textarea")) {
                        return null;
                    }

                    return renderCompleted ? freshDraftEl : staleDraftEl;
                },
                querySelectorAll: () => [],
                contains: () => true,
            } as never,
            getCurrentFile: () => ({ path: "docs/architecture.md" }) as never,
            getDraftForView: () => createDraft({
                id: "draft-1",
                filePath: "docs/architecture.md",
            }),
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
        assert.equal(controller.getActiveCommentId(), null);
    } finally {
        Object.assign(globalThis, {
            window: originalWindow,
            document: originalDocument,
        });
    }
});

test("sidebar interaction controller clears active state classes", () => {
    const harness = createHarness();

    harness.controller.setActiveComment("comment-1");
    harness.controller.clearActiveState();

    assert.equal(harness.controller.getActiveCommentId(), null);
    assert.deepEqual(harness.otherActiveEl.removeClassCalls, ["active", "active"]);
});

test("sidebar interaction controller claims the sidebar leaf immediately when focusing an existing draft textarea", () => {
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

        assert.deepEqual(setActiveLeafCalls, [{
            leaf: sidebarLeaf,
            options: { focus: false },
        }]);
        assert.equal(documentStub.activeElement, textarea);
        assert.deepEqual(selectionCalls, [{
            start: textarea.value.length,
            end: textarea.value.length,
        }]);
        assert.equal(rafCallbacks.length, 0);
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

test("sidebar interaction controller autosaves draft edits on document clicks outside the sidebar", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    const originalWindow = globalThis.window;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    const rafCallbacks: Array<(time: number) => void> = [];
    Object.assign(globalThis, {
        window: {
            requestAnimationFrame(callback: (time: number) => void) {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            },
            cancelAnimationFrame() {},
            getSelection: () => null,
        },
    });

    try {
        let currentDraft: DraftComment | null = createDraft({ id: "draft-1" });
        const activeEl = createCommentElement({ draftId: "draft-1" });
        const draftEl = new FakeSidebarElement();
        const outsideEl = new FakeSidebarElement();
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
                contains: (target: unknown) => target !== outsideEl,
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
        controller.documentMouseDownHandler({
            button: 0,
            target: outsideEl,
        } as unknown as MouseEvent);
        await Promise.resolve();

        assert.deepEqual(saveDraftCalls, ["draft-1"]);
        assert.equal(controller.getActiveCommentId(), null);
        assert.equal(clearRevealedCommentSelectionCalls, 0);
        assert.equal(rafCallbacks.length, 1);

        const callback = rafCallbacks.shift();
        assert.ok(callback);
        callback?.(0);

        assert.equal(clearRevealedCommentSelectionCalls, 1);
        assert.deepEqual(activeEl.removeClassCalls, ["active"]);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
            window: originalWindow,
        });
    }
});

test("sidebar interaction controller defers revealed selection clearing until after outside editor clicks settle", () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    const originalWindow = globalThis.window;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    const rafCallbacks: Array<(time: number) => void> = [];
    Object.assign(globalThis, {
        window: {
            requestAnimationFrame(callback: (time: number) => void) {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            },
            cancelAnimationFrame() {},
            getSelection: () => null,
        },
    });

    try {
        const outsideEl = new FakeSidebarElement();
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
                querySelector: () => null,
                querySelectorAll: () => [],
                contains: (target: unknown) => target !== outsideEl,
            } as never,
            getCurrentFile: () => ({ path: "docs/architecture.md" }) as never,
            getDraftForView: () => null,
            renderComments: async () => {},
            saveDraft: () => {},
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {
                clearRevealedCommentSelectionCalls += 1;
            },
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        controller.documentMouseDownHandler({
            button: 0,
            target: outsideEl,
        } as unknown as MouseEvent);

        assert.equal(clearRevealedCommentSelectionCalls, 0);
        assert.equal(rafCallbacks.length, 1);

        const callback = rafCallbacks.shift();
        assert.ok(callback);
        callback?.(0);

        assert.equal(clearRevealedCommentSelectionCalls, 1);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
            window: originalWindow,
        });
    }
});

test("sidebar interaction controller ignores document clicks that start inside the sidebar", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        const currentDraft = createDraft({ id: "draft-1" });
        const insideEl = new FakeSidebarElement();
        const saveDraftCalls: string[] = [];

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: (selector: string) => selector.includes("draft-1") ? insideEl : null,
                querySelectorAll: () => [],
                contains: (target: unknown) => target === insideEl,
            } as never,
            getCurrentFile: () => ({ path: "docs/architecture.md" }) as never,
            getDraftForView: () => currentDraft,
            renderComments: async () => {},
            saveDraft: async (commentId) => {
                saveDraftCalls.push(commentId);
            },
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {},
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        controller.documentMouseDownHandler({
            button: 0,
            target: insideEl,
        } as unknown as MouseEvent);
        await Promise.resolve();

        assert.deepEqual(saveDraftCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});

test("sidebar interaction controller keeps draft editing open while clicking a picker modal", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        const currentDraft = createDraft({ id: "draft-1" });
        const modalEl = new FakeSidebarElement({ isDismissalExemptSurface: true });
        const saveDraftCalls: string[] = [];

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: () => null,
                querySelectorAll: () => [],
                contains: (target: unknown) => false && target === modalEl,
            } as never,
            getCurrentFile: () => ({ path: "docs/architecture.md" }) as never,
            getDraftForView: () => currentDraft,
            renderComments: async () => {},
            saveDraft: async (commentId) => {
                saveDraftCalls.push(commentId);
            },
            cancelDraft: () => {},
            clearRevealedCommentSelection: () => {},
            revealComment: async () => {},
            getPreferredFileLeaf: () => null,
            openLinkText: async () => {},
        });

        controller.documentMouseDownHandler({
            button: 0,
            target: modalEl,
        } as unknown as MouseEvent);
        await Promise.resolve();

        assert.deepEqual(saveDraftCalls, []);
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

test("sidebar interaction controller keeps deleted mode on sidebar background click", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        const backgroundEl = new FakeSidebarElement();
        const setShowDeletedCommentsCalls: boolean[] = [];

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: () => null,
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
            shouldShowDeletedComments: () => true,
            setShowDeletedComments: async (showDeleted) => {
                setShowDeletedCommentsCalls.push(showDeleted);
            },
        });

        await controller.sidebarClickHandler({ target: backgroundEl } as unknown as MouseEvent);

        assert.deepEqual(setShowDeletedCommentsCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});

test("sidebar interaction controller keeps deleted mode while clicking a normal toolbar", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        const toolbarEl = new FakeSidebarElement({
            isSectionChrome: true,
            isToolbar: true,
        });
        const setShowDeletedCommentsCalls: boolean[] = [];

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: () => null,
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
            shouldShowDeletedComments: () => true,
            setShowDeletedComments: async (showDeleted) => {
                setShowDeletedCommentsCalls.push(showDeleted);
            },
        });

        await controller.sidebarClickHandler({ target: toolbarEl } as unknown as MouseEvent);

        assert.deepEqual(setShowDeletedCommentsCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});

test("sidebar interaction controller keeps deleted mode while clicking the deleted toolbar", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        const toolbarEl = new FakeSidebarElement({
            isSectionChrome: true,
            isToolbar: true,
            isDeletedToolbarMode: true,
        });
        const setShowDeletedCommentsCalls: boolean[] = [];

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: () => null,
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
            shouldShowDeletedComments: () => true,
            setShowDeletedComments: async (showDeleted) => {
                setShowDeletedCommentsCalls.push(showDeleted);
            },
        });

        await controller.sidebarClickHandler({ target: toolbarEl } as unknown as MouseEvent);

        assert.deepEqual(setShowDeletedCommentsCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});

test("sidebar interaction controller keeps deleted mode on document clicks outside the sidebar", async () => {
    const originalHTMLElement = globalThis.HTMLElement;
    const originalNode = globalThis.Node;
    Object.assign(globalThis, {
        HTMLElement: FakeSidebarElement,
        Node: FakeNode,
    });

    try {
        const outsideEl = new FakeSidebarElement();
        const setShowDeletedCommentsCalls: boolean[] = [];

        const controller = new SidebarInteractionController({
            app: {
                workspace: {
                    activeLeaf: null,
                    setActiveLeaf: () => {},
                },
            } as never,
            leaf: {} as never,
            containerEl: {
                querySelector: () => null,
                querySelectorAll: () => [],
                contains: (target: unknown) => target !== outsideEl,
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
            shouldShowDeletedComments: () => true,
            setShowDeletedComments: async (showDeleted) => {
                setShowDeletedCommentsCalls.push(showDeleted);
            },
        });

        controller.documentMouseDownHandler({
            button: 0,
            target: outsideEl,
        } as unknown as MouseEvent);
        await Promise.resolve();

        assert.deepEqual(setShowDeletedCommentsCalls, []);
    } finally {
        Object.assign(globalThis, {
            HTMLElement: originalHTMLElement,
            Node: originalNode,
        });
    }
});
