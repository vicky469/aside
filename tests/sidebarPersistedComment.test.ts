import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment, type CommentThread } from "../src/commentManager";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import {
    buildPersistedCommentPresentation,
    buildPersistedCommentPinActionPresentation,
    buildPersistedThreadEntryPresentation,
    formatSidebarCommentIndexLeadLabel,
    formatSidebarSideNoteReferenceLabel,
    formatSidebarCommentSourceFileLabel,
    getDeletedRenderableThreadEntries,
    getInsertableSidebarCommentMarkdown,
    getRetryableAgentRunForSidebarComment,
    isRetryableAgentRunBusy,
    getAppendDraftInsertAfterEntryId,
    getRenderableThreadEntries,
    getAgentRunStatusPresentation,
    formatAgentRunMetadataFrontmatter,
    formatAgentRunVisibleMetadataLabels,
    renderPersistedCommentCard,
    resolveSidebarCommentAuthor,
    shouldShowRetryActionForSidebarComment,
    shouldRenderChildEntryMoveHandle,
    shouldRenderSidebarCommentAuthor,
    shouldRenderNestedThreadEntries,
    shouldRenderThreadNestedToggle,
    type SidebarPersistedCommentHost,
} from "../src/ui/views/sidebarPersistedComment";
import { formatSidebarCommentMeta } from "../src/ui/views/sidebarCommentSections";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 8,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 8,
        endChar: overrides.endChar ?? 9,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        deletedAt: overrides.deletedAt,
    };
}

function createThread(overrides: Partial<Comment> = {}): CommentThread {
    return commentToThread(createComment(overrides));
}

function createThreadWithEntries(overrides: Partial<CommentThread> = {}): CommentThread {
    const baseThread = createThread();
    return {
        ...baseThread,
        ...overrides,
        entries: overrides.entries ?? baseThread.entries,
    };
}

function createAgentRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: overrides.id ?? "run-1",
        threadId: overrides.threadId ?? "comment-1",
        triggerEntryId: overrides.triggerEntryId ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        requestedAgent: overrides.requestedAgent ?? "codex",
        runtime: overrides.runtime ?? "direct-cli",
        status: overrides.status ?? "succeeded",
        promptText: overrides.promptText ?? "@codex do it",
        createdAt: overrides.createdAt ?? 100,
        startedAt: overrides.startedAt,
        endedAt: overrides.endedAt ?? 200,
        retryOfRunId: overrides.retryOfRunId,
        outputEntryId: overrides.outputEntryId ?? "entry-2",
        error: overrides.error,
        usedSkills: overrides.usedSkills,
        usedTools: overrides.usedTools,
        usedFiles: overrides.usedFiles,
        usedUrls: overrides.usedUrls,
        usedToolErrors: overrides.usedToolErrors,
    };
}

class FakeClassList {
    constructor(private readonly owner: FakeElement) {}

    public add(...tokens: string[]): void {
        this.owner.className = mergeClassName(this.owner.className, tokens);
    }

    public remove(...tokens: string[]): void {
        const removeSet = new Set(tokens);
        this.owner.className = this.owner.className
            .split(/\s+/)
            .filter((token) => token && !removeSet.has(token))
            .join(" ");
    }

    public contains(token: string): boolean {
        return this.owner.className.split(/\s+/).includes(token);
    }

    public toggle(token: string, force?: boolean): boolean {
        const shouldHaveToken = force ?? !this.contains(token);
        if (shouldHaveToken) {
            this.add(token);
        } else {
            this.remove(token);
        }
        return shouldHaveToken;
    }
}

class FakeElement {
    public static defaultView: Pick<Window, "setTimeout" | "clearTimeout"> | null = null;
    public readonly children: FakeElement[] = [];
    public parentElement: FakeElement | null = null;
    public textContent = "";
    public tabIndex = 0;
    public hidden = false;
    public disabled = false;
    public onclick: unknown = null;
    public readonly style = { display: "" };
    public readonly classList = new FakeClassList(this);
    public readonly ownerDocument = {
        get defaultView(): Pick<Window, "setTimeout" | "clearTimeout"> | null {
            return FakeElement.defaultView;
        },
        createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    };
    private readonly attributes = new Map<string, string>();
    private readonly eventListeners = new Map<string, Array<(event: unknown) => void>>();

    constructor(
        public readonly tagName: string,
        public className = "",
    ) {}

    public get firstChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    public createDiv(className?: string | { cls?: string }): FakeElement {
        return this.createChild("div", typeof className === "string" ? className : className?.cls);
    }

    public createSpan(options?: string | { cls?: string; text?: string }): FakeElement {
        return this.createChild("span", typeof options === "string" ? options : options?.cls, typeof options === "string" ? undefined : options?.text);
    }

    public createEl(tagName: string, options: { cls?: string; text?: string } = {}): FakeElement {
        return this.createChild(tagName, options.cls, options.text);
    }

    public appendChild(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    public insertBefore(child: FakeElement, referenceChild: FakeElement | null): FakeElement {
        if (child === referenceChild) {
            return child;
        }
        child.remove();
        child.parentElement = this;
        const index = referenceChild ? this.children.indexOf(referenceChild) : -1;
        if (index >= 0) {
            this.children.splice(index, 0, child);
        } else {
            this.children.push(child);
        }
        return child;
    }

    public replaceChildren(...children: FakeElement[]): void {
        this.children.splice(0, this.children.length);
        children.forEach((child) => {
            this.appendChild(child);
        });
    }

    public remove(): void {
        if (!this.parentElement) {
            return;
        }
        const siblings = this.parentElement.children;
        const index = siblings.indexOf(this);
        if (index >= 0) {
            siblings.splice(index, 1);
        }
        this.parentElement = null;
    }

    public addClass(className: string): void {
        this.classList.add(className);
    }

    public setText(text: string): void {
        this.textContent = text;
    }

    public setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    public getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    public addEventListener(type: string, listener: (event: unknown) => void): void {
        const listeners = this.eventListeners.get(type) ?? [];
        listeners.push(listener);
        this.eventListeners.set(type, listeners);
    }

    public dispatchEvent(event: { type: string }): boolean {
        for (const listener of this.eventListeners.get(event.type) ?? []) {
            listener(event);
        }
        return true;
    }

    public querySelector(selector: string): FakeElement | null {
        return this.find((element) => matchesFakeSelector(element, selector));
    }

    public querySelectorAll(_selector: string): FakeElement[] {
        return [];
    }

    public findAllByClass(className: string): FakeElement[] {
        const matches: FakeElement[] = [];
        this.collect((element) => {
            if (element.classList.contains(className)) {
                matches.push(element);
            }
        });
        return matches;
    }

    private createChild(tagName: string, className = "", text = ""): FakeElement {
        const child = new FakeElement(tagName, className);
        child.textContent = text;
        return this.appendChild(child);
    }

    private find(predicate: (element: FakeElement) => boolean): FakeElement | null {
        for (const child of this.children) {
            if (predicate(child)) {
                return child;
            }
            const match = child.find(predicate);
            if (match) {
                return match;
            }
        }
        return null;
    }

    private collect(visitor: (element: FakeElement) => void): void {
        for (const child of this.children) {
            visitor(child);
            child.collect(visitor);
        }
    }
}

function mergeClassName(current: string, tokens: string[]): string {
    return Array.from(new Set([
        ...current.split(/\s+/).filter(Boolean),
        ...tokens.filter(Boolean),
    ])).join(" ");
}

function matchesFakeSelector(element: FakeElement, selector: string): boolean {
    if (!selector.startsWith(".")) {
        return false;
    }
    return element.classList.contains(selector.slice(1));
}

function createRenderHost(overrides: Partial<SidebarPersistedCommentHost> = {}): SidebarPersistedCommentHost {
    return {
        activeCommentId: null,
        currentFilePath: "docs/architecture.md",
        currentUserLabel: "You",
        showSourceRedirectAction: false,
        showBookmarkAndPinControls: false,
        showDeletedComments: false,
        enablePageThreadReorder: false,
        enableChildEntryMove: false,
        enableSoftDeleteActions: false,
        showNestedComments: true,
        showNestedCommentsByDefault: true,
        getKnownCommentById: () => null,
        editDraftComment: null,
        appendDraftComment: null,
        agentRun: null,
        agentStream: null,
        threadAgentRuns: [],
        getEventTargetElement: () => null,
        isSelectionInsideSidebarContent: () => false,
        claimSidebarInteractionOwnership: () => {},
        insertCommentMarkdownIntoFile: async () => true,
        renderMarkdown: async (markdown, container) => {
            (container as unknown as FakeElement).textContent = markdown;
        },
        openSidebarInternalLink: async () => {},
        openCommentFromCard: async () => {},
        openCommentInEditor: async () => {},
        shareComment: async () => {},
        saveVisibleDraftIfPresent: async () => true,
        setShowNestedCommentsForThread: () => {},
        moveCommentThread: () => {},
        restoreComment: () => true,
        clearDeletedComment: () => true,
        startEditDraft: () => {},
        isPinnedThread: () => false,
        togglePinnedThread: () => {},
        startAppendEntryDraft: () => {},
        retryAgentRun: () => true,
        retryAgentPromptForComment: () => true,
        reanchorCommentThreadToCurrentSelection: () => {},
        deleteCommentWithConfirm: () => true,
        renderAppendDraft: () => {},
        renderInlineEditDraft: () => {},
        setIcon: () => {},
        ...overrides,
    };
}

test("buildPersistedCommentPresentation includes page and active classes for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        id: "comment-2",
        anchorKind: "page",
    }), "comment-2");

    assert.deepEqual(presentation.classes, [
        "aside-comment-item",
        "aside-thread-item",
        "page-note",
        "active",
    ]);
});

test("buildPersistedCommentPresentation includes orphaned class for orphaned selection comments", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        orphaned: true,
    }), null);

    assert.deepEqual(presentation.classes, [
        "aside-comment-item",
        "aside-thread-item",
        "orphaned",
    ]);
    assert.deepEqual(presentation.reanchorAction, {
        label: "Re-anchor to current selection",
    });
});

test("buildPersistedCommentPinActionPresentation toggles the pin affordance label", () => {
    assert.deepEqual(
        buildPersistedCommentPinActionPresentation(true),
        {
            active: true,
            ariaLabel: "Unpin this side note",
        },
    );
    assert.deepEqual(
        buildPersistedCommentPinActionPresentation(false),
        {
            active: false,
            ariaLabel: "Pin this side note",
        },
    );
});

test("buildPersistedCommentPresentation omits re-anchor action for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        anchorKind: "page",
        orphaned: false,
    }), null);

    assert.equal(presentation.reanchorAction, null);
});

test("buildPersistedCommentPresentation shows the parent entry time without a note count", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    const presentation = buildPersistedCommentPresentation(thread, null);

    assert.equal(
        presentation.metaText,
        formatSidebarCommentMeta({ timestamp: 100 }),
    );
    assert.equal(presentation.metaPreviewText, "comment");
});

test("buildPersistedThreadEntryPresentation gives child entries their own indented card styling", () => {
    const thread = createThreadWithEntries({
        orphaned: true,
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    const childEntry = thread.entries[1];
    const presentation = buildPersistedThreadEntryPresentation(thread, childEntry, childEntry.id);

    assert.deepEqual(presentation.classes, [
        "aside-comment-item",
        "aside-thread-item",
        "aside-thread-entry-item",
        "orphaned",
        "active",
    ]);
    assert.equal(
        presentation.metaText,
        formatSidebarCommentMeta({
            timestamp: childEntry.timestamp,
            orphaned: true,
        }),
    );
    assert.equal(presentation.metaPreviewText, null);
});

test("buildPersistedCommentPresentation omits anchored preview text for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        anchorKind: "page",
        selectedText: "Architecture",
    }), null);

    assert.equal(presentation.metaPreviewText, null);
});

test("shouldRenderChildEntryMoveHandle hides child drag handles in index/source cards", () => {
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: true,
        entryDeleted: false,
        threadDeleted: false,
    }), false);
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: false,
        entryDeleted: false,
        threadDeleted: false,
    }), true);
});

test("shouldRenderChildEntryMoveHandle hides child drag handles for deleted entries", () => {
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: false,
        entryDeleted: true,
        threadDeleted: false,
    }), false);
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: false,
        entryDeleted: false,
        threadDeleted: true,
    }), false);
});

test("renderPersistedCommentCard renders a drag handle for top-level anchored threads", async () => {
    const root = new FakeElement("div");

    await renderPersistedCommentCard(
        root as unknown as HTMLDivElement,
        createThread(),
        createRenderHost({
            enableChildEntryMove: true,
        }),
    );

    const handles = root.findAllByClass("aside-comment-drag-handle");
    assert.equal(handles.length, 1);
    assert.equal(handles[0].getAttribute("data-aside-drag-kind"), "thread");
    assert.equal(handles[0].getAttribute("data-aside-thread-id"), "comment-1");
});

test("renderPersistedCommentCard does not render a nesting drag handle for page threads", async () => {
    const root = new FakeElement("div");

    await renderPersistedCommentCard(
        root as unknown as HTMLDivElement,
        createThread({
            anchorKind: "page",
            selectedText: "Architecture",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
        }),
        createRenderHost({
            enableChildEntryMove: true,
        }),
    );

    assert.equal(root.findAllByClass("aside-comment-drag-handle").length, 0);
});

test("renderPersistedCommentCard renders anchored child selected-text previews", async () => {
    const root = new FakeElement("div");
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "Parent", timestamp: 100 },
            {
                id: "entry-2",
                body: "Child",
                timestamp: 200,
                anchor: {
                    filePath: "docs/architecture.md",
                    startLine: 12,
                    startChar: 0,
                    endLine: 12,
                    endChar: 11,
                    selectedText: "child point",
                    selectedTextHash: "hash:child point",
                    anchorKind: "selection",
                },
            },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    await renderPersistedCommentCard(
        root as unknown as HTMLDivElement,
        thread,
        createRenderHost(),
    );

    assert.deepEqual(
        root.findAllByClass("aside-comment-meta-preview").map((element) => element.textContent),
        ["comment", "child point"],
    );
});

test("renderPersistedCommentCard does not show selected text as content for empty anchored child entries", async () => {
    const root = new FakeElement("div");
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "Parent", timestamp: 100 },
            {
                id: "entry-2",
                body: "",
                timestamp: 200,
                anchor: {
                    filePath: "docs/architecture.md",
                    startLine: 12,
                    startChar: 0,
                    endLine: 13,
                    endChar: 11,
                    selectedText: "child point\ncontinued",
                    selectedTextHash: "hash:child point",
                    anchorKind: "selection",
                },
            },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    await renderPersistedCommentCard(
        root as unknown as HTMLDivElement,
        thread,
        createRenderHost(),
    );

    const anchorPreviews = root.findAllByClass("aside-thread-entry-anchor-preview");
    assert.equal(anchorPreviews.length, 0);
    assert.deepEqual(
        root.findAllByClass("aside-comment-meta-preview").map((element) => element.textContent),
        ["comment", "child point continued"],
    );
});

test("shouldRenderNestedThreadEntries hides stored child comments when nested comments are off", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries hides a targeted child comment when nested comments are off", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: "entry-2",
        showNestedComments: false,
        showNestedCommentsByDefault: true,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries hides an active parent thread when nested comments are hidden", () => {
    const thread = createThreadWithEntries({
        id: "entry-1",
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: "entry-1",
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries does not keep an active parent thread visible after the thread was explicitly hidden", () => {
    const thread = createThreadWithEntries({
        id: "entry-1",
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: "entry-1",
        showNestedComments: false,
        showNestedCommentsByDefault: true,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries keeps stored child comments visible while editing a thread entry", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: true,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps append drafts visible even when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: true,
        hasAgentStream: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps streamed agent replies visible even when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: true,
    }), true);
});

test("shouldRenderNestedThreadEntries hides finished agent replies when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
        hasAgentReplies: true,
    }), false);
});

test("shouldRenderNestedThreadEntries hides deleted child entries when nested comments are off", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Deleted child", timestamp: 200, deletedAt: 250 },
        ],
        createdAt: 100,
        updatedAt: 250,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
        hasDeletedEntriesVisible: true,
    }), false);
});

test("renderPersistedCommentCard renders the full thread when search shows nested comments", async () => {
    const root = new FakeElement("div");
    const thread = createThreadWithEntries({
        id: "thread-search",
        entries: [
            { id: "thread-search", body: "Parent entry without the term", timestamp: 100 },
            { id: "entry-api", body: "API cleanup is ready", timestamp: 200 },
            { id: "entry-other", body: "Different follow-up", timestamp: 300 },
            { id: "entry-later-api", body: "Later API cleanup note", timestamp: 400 },
        ],
        createdAt: 100,
        updatedAt: 400,
    });

    await renderPersistedCommentCard(
        root as unknown as HTMLDivElement,
        thread,
        createRenderHost({
            showNestedComments: true,
        }),
    );

    assert.deepEqual(
        root.findAllByClass("aside-comment-item").map((element) => element.getAttribute("data-comment-id")),
        ["thread-search", "entry-api", "entry-other", "entry-later-api"],
    );
});

test("shouldRenderThreadNestedToggle hides the toggle only while visible drafts are open", () => {
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: true,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: true,
        hasChildEditDraft: false,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: true,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: false,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
    }), true);
});

test("getAppendDraftInsertAfterEntryId returns the clicked child entry id for child-targeted appends", () => {
    const thread = createThreadWithEntries({
        id: "thread-1",
        entries: [
            { id: "thread-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
            { id: "entry-3", body: "Later child", timestamp: 300 },
        ],
        createdAt: 100,
        updatedAt: 300,
    });

    assert.equal(getAppendDraftInsertAfterEntryId(thread, {
        ...createComment({
            id: "draft-1",
            comment: "",
            timestamp: 400,
        }),
        mode: "append",
        threadId: "thread-1",
        appendAfterCommentId: "entry-2",
    }), "entry-2");
});

test("getAppendDraftInsertAfterEntryId falls back to end-of-thread for parent-targeted or unknown append targets", () => {
    const thread = createThreadWithEntries({
        id: "thread-1",
        entries: [
            { id: "thread-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(getAppendDraftInsertAfterEntryId(thread, {
        ...createComment({
            id: "draft-1",
            comment: "",
            timestamp: 300,
        }),
        mode: "append",
        threadId: "thread-1",
        appendAfterCommentId: "thread-1",
    }), null);
    assert.equal(getAppendDraftInsertAfterEntryId(thread, {
        ...createComment({
            id: "draft-2",
            comment: "",
            timestamp: 300,
        }),
        mode: "append",
        threadId: "thread-1",
        appendAfterCommentId: "missing-entry",
    }), null);
});

test("getRenderableThreadEntries keeps the persisted agent output entry visible while the live stream is retained", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Agent reply", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.deepEqual(
        getRenderableThreadEntries(thread, {
            runId: "run-1",
            threadId: thread.id,
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "succeeded",
            partialText: "Agent reply",
            startedAt: 100,
            updatedAt: 200,
            outputEntryId: "entry-2",
        }),
        thread.entries,
    );
});

test("getDeletedRenderableThreadEntries keeps only deleted child entries for deleted mode", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Deleted child", timestamp: 200, deletedAt: 250 },
            { id: "entry-3", body: "Active child", timestamp: 300 },
        ],
        createdAt: 100,
        updatedAt: 300,
    });

    assert.deepEqual(getDeletedRenderableThreadEntries(thread), {
        parentEntry: null,
        childEntries: [thread.entries[1]],
    });
});

test("getDeletedRenderableThreadEntries keeps the deleted root and children for a deleted thread", () => {
    const thread = createThreadWithEntries({
        deletedAt: 250,
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100, deletedAt: 250 },
            { id: "entry-2", body: "Deleted child", timestamp: 200, deletedAt: 240 },
        ],
        createdAt: 100,
        updatedAt: 250,
    });

    assert.deepEqual(getDeletedRenderableThreadEntries(thread), {
        parentEntry: thread.entries[0],
        childEntries: [thread.entries[1]],
    });
});

test("renderPersistedCommentCard keeps soft-deleted cards clickable in deleted mode", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        getSelection: () => null,
    } as unknown as typeof globalThis.window;

    try {
        const root = new FakeElement("div");
        const openedCommentIds: string[] = [];

        await renderPersistedCommentCard(
            root as unknown as HTMLDivElement,
            createThread({
                deletedAt: 250,
            }),
            createRenderHost({
                showDeletedComments: true,
                enableSoftDeleteActions: true,
                openCommentFromCard: async (comment) => {
                    openedCommentIds.push(comment.id);
                },
            }),
        );

        const card = root.findAllByClass("aside-comment-item")[0];
        assert.ok(card);
        card.dispatchEvent({
            type: "click",
            target: card,
            preventDefault() {},
            stopPropagation() {},
        } as unknown as Event);

        assert.deepEqual(openedCommentIds, ["comment-1"]);
    } finally {
        globalThis.window = originalWindow;
    }
});

test("renderPersistedCommentCard renders restore actions for deleted source cards", async () => {
    for (const orphaned of [false, true]) {
        const root = new FakeElement("div");

        await renderPersistedCommentCard(
            root as unknown as HTMLDivElement,
            createThread({
                deletedAt: 250,
                orphaned,
            }),
            createRenderHost({
                showDeletedComments: true,
                showSourceRedirectAction: true,
                enableSoftDeleteActions: true,
            }),
        );

        assert.equal(root.findAllByClass("aside-comment-action-restore").length, 1);
        assert.equal(root.findAllByClass("aside-comment-action-permanent-delete").length, 1);
        assert.equal(root.findAllByClass("aside-comment-action-redirect").length, 0);
    }
});

test("formatSidebarCommentSourceFileLabel keeps the basename without md, even for long paths", () => {
    assert.equal(
        formatSidebarCommentSourceFileLabel("docs/thoughts/refactored.md"),
        "refactored",
    );
    assert.equal(
        formatSidebarCommentSourceFileLabel("Folder\\Nested\\Note.md"),
        "Note",
    );
    assert.equal(
        formatSidebarCommentSourceFileLabel(
            "docs/thoughts/very/deeply/nested/this-is-a-deliberately-extremely-long-file-name-to-check-how-the-sidebar-header-allocates-space-for-the-source-label.md",
        ),
        "this-is-a-deliberately-extremely-long-file-name-to-check-how-the-sidebar-header-allocates-space-for-the-source-label",
    );
});

test("formatSidebarCommentIndexLeadLabel uses selected text for anchored notes and filename for page notes", () => {
    assert.equal(
        formatSidebarCommentIndexLeadLabel(createComment({
            anchorKind: "page",
            filePath: "docs/architecture.md",
            selectedText: "Ignored page label",
        })),
        "architecture",
    );
    assert.equal(
        formatSidebarCommentIndexLeadLabel(createComment({
            anchorKind: "selection",
            selectedText: "First line\nsecond line",
            filePath: "docs/architecture.md",
        })),
        "First line second line",
    );
});

test("formatSidebarSideNoteReferenceLabel uses filename and selected text for anchored notes", () => {
    assert.equal(
        formatSidebarSideNoteReferenceLabel(createComment({
            filePath: "books/the-goal.md",
            anchorKind: "selection",
            selectedText: "This is a long selected passage that should be trimmed for sidebar link rendering.",
        }), "books/the-goal.md"),
        "the-goal: This is a long selected passage that should b...",
    );
});

test("formatSidebarSideNoteReferenceLabel uses filename and cleaned body preview for page notes", () => {
    assert.equal(
        formatSidebarSideNoteReferenceLabel(createComment({
            filePath: "Notes/The Goal.md",
            anchorKind: "page",
            comment: "Continued from obsidian://aside-comment?vault=public&file=books%2Falpha.md&commentId=comment-1 and then a little more context.",
        }), "Notes/The Goal.md"),
        "The Goal: Continued from side note and then a little mo...",
    );
});

test("getInsertableSidebarCommentMarkdown keeps the full agent reply body without trailing references", () => {
    assert.equal(
        getInsertableSidebarCommentMarkdown(
            "entry-2",
            [
                "Here is the summary.",
                "",
                "| Name | Status |",
                "| --- | --- |",
                "| Alpha | Ready |",
                "",
                "Mentioned:",
                "- [linked note](obsidian://aside-comment?vault=dev&file=docs%2Flinked.md&commentId=linked-1)",
            ].join("\n"),
            [createAgentRun({ outputEntryId: "entry-2" })],
        ),
        [
            "Here is the summary.",
            "",
            "| Name | Status |",
            "| --- | --- |",
            "| Alpha | Ready |",
        ].join("\n"),
    );
});

test("getInsertableSidebarCommentMarkdown returns null for user-authored comments", () => {
    assert.equal(getInsertableSidebarCommentMarkdown("entry-2", "Reply body", []), null);
});

test("resolveSidebarCommentAuthor labels user-written entries as the current user", () => {
    assert.deepEqual(resolveSidebarCommentAuthor("entry-1", [createAgentRun()], "You"), {
        kind: "user",
        label: "You",
    });
});

test("shouldRenderSidebarCommentAuthor hides the current user badge but keeps agent badges", () => {
    assert.equal(shouldRenderSidebarCommentAuthor({
        kind: "user",
        label: "You",
    }), false);
    assert.equal(shouldRenderSidebarCommentAuthor({
        kind: "codex",
        label: "Codex",
    }), true);
});

test("resolveSidebarCommentAuthor labels agent-produced replies from their output run", () => {
    assert.deepEqual(
        resolveSidebarCommentAuthor(
            "entry-2",
            [createAgentRun({ requestedAgent: "claude", outputEntryId: "entry-2" })],
            "You",
        ),
        {
            kind: "claude",
            label: "Claude",
        },
    );
});

test("getRetryableAgentRunForSidebarComment resolves runs from the trigger entry instead of the output entry", () => {
    const run = createAgentRun({
        id: "run-1",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-2",
    });

    assert.equal(
        getRetryableAgentRunForSidebarComment("entry-1", [run])?.id,
        "run-1",
    );
    assert.equal(
        getRetryableAgentRunForSidebarComment("entry-2", [run]),
        null,
    );
});

test("getRetryableAgentRunForSidebarComment keeps the newest retryable run for the same ask entry", () => {
    const olderRun = createAgentRun({
        id: "run-1",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-2",
        createdAt: 100,
        endedAt: 150,
    });
    const newerRun = createAgentRun({
        id: "run-2",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-3",
        createdAt: 200,
        endedAt: 250,
        retryOfRunId: "run-1",
    });

    assert.equal(
        getRetryableAgentRunForSidebarComment("entry-1", [olderRun, newerRun])?.id,
        "run-2",
    );
});

test("shouldShowRetryActionForSidebarComment falls back to explicit agent prompts without stored run metadata", () => {
    assert.equal(
        shouldShowRetryActionForSidebarComment("entry-1", "@codex explain this", []),
        true,
    );
});

test("shouldShowRetryActionForSidebarComment stays hidden for plain user comments without a stored run", () => {
    assert.equal(
        shouldShowRetryActionForSidebarComment("entry-1", "plain comment", []),
        false,
    );
});

test("isRetryableAgentRunBusy disables regenerate while a run is queued or running", () => {
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "queued" })), true);
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "running" })), true);
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "succeeded" })), false);
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "failed" })), false);
    assert.equal(isRetryableAgentRunBusy(null), false);
});

test("getAgentRunStatusPresentation uses compact success and failure markers", () => {
    assert.deepEqual(getAgentRunStatusPresentation("succeeded"), {
        marker: "✓",
        markerKind: "text",
    });
    assert.deepEqual(getAgentRunStatusPresentation("failed"), {
        marker: "✕",
        markerKind: "text",
    });
});

test("getAgentRunStatusPresentation distinguishes queued from running", () => {
    assert.deepEqual(getAgentRunStatusPresentation("queued"), {
        marker: "…",
        markerKind: "text",
    });
    assert.deepEqual(getAgentRunStatusPresentation("running"), {
        marker: null,
        markerKind: "spinner",
    });
});

test("formatAgentRunMetadataFrontmatter renders compact run metadata", () => {
    assert.equal(
        formatAgentRunMetadataFrontmatter(createAgentRun({
            usedSkills: [{ name: "aside", mode: "write", source: "built-in" }],
            usedFiles: ["docs/source.md", "docs/source.md"],
            usedTools: ["browser-use.browser_navigate", "browser-use.browser_navigate"],
            usedUrls: ["https://example.com/page?token=secret#section"],
        })),
        [
            "---",
            "skills: aside (write)",
            "files: docs/source.md",
            "tools: browser-use.browser_navigate",
            "urls: https://example.com/page",
            "---",
        ].join("\n"),
    );
    assert.equal(formatAgentRunMetadataFrontmatter(createAgentRun()), null);
    assert.equal(
        formatAgentRunMetadataFrontmatter(createAgentRun({
            usedTools: ["shell"],
        })),
        null,
    );
});

test("formatAgentRunVisibleMetadataLabels keeps metadata terse", () => {
    assert.deepEqual(
        formatAgentRunVisibleMetadataLabels(createAgentRun({
            usedSkills: [{ name: "aside", mode: "write", source: "built-in" }],
            usedFiles: ["docs/source.md", "docs/source.md"],
            usedTools: ["WebSearch"],
            usedUrls: [
                "https://example.com/page",
                "https://example.com/other",
                "\\n- https://example.com/imported",
            ],
            usedToolErrors: [{
                name: "WebSearch",
                payload: "Web search is unavailable.",
            }],
        })),
        [
            "Skills: aside",
            "Files: source",
            "Tools: WebSearch (unavailable)",
            "URLs:\nhttps://example.com/page\nhttps://example.com/other\nhttps://example.com/imported",
        ],
    );
});

test("renderPersistedCommentCard renders agent run files as clickable file links", async () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "@codex check this", timestamp: 100 },
            { id: "entry-2", body: "Agent reply", timestamp: 110 },
        ],
    });
    const openedLinks: Array<{
        href: string;
        sourcePath: string;
        focusTargetClass: string;
    }> = [];
    const host = createRenderHost({
        threadAgentRuns: [
            createAgentRun({
                outputEntryId: "entry-2",
                usedFiles: ["Folder/Source Note.md", "src/sidebarPersistedComment.ts"],
            }),
        ],
        openSidebarInternalLink: async (href, sourcePath, focusTarget) => {
            openedLinks.push({
                href,
                sourcePath,
                focusTargetClass: (focusTarget as unknown as FakeElement).className,
            });
        },
    });
    const root = new FakeElement("div");

    await renderPersistedCommentCard(root as unknown as HTMLDivElement, thread, host);

    const fileLinks = root.findAllByClass("aside-agent-run-file-link");
    assert.equal(fileLinks.length, 2);
    assert.deepEqual(fileLinks.map((link) => link.textContent), [
        "Source Note",
        "sidebarPersistedComment.ts",
    ]);
    assert.deepEqual(fileLinks.map((link) => link.getAttribute("href")), [
        "Folder/Source Note.md",
        "src/sidebarPersistedComment.ts",
    ]);
    assert.deepEqual(fileLinks.map((link) => link.getAttribute("data-href")), [
        "Folder/Source Note.md",
        "src/sidebarPersistedComment.ts",
    ]);
    assert.deepEqual(fileLinks.map((link) => link.getAttribute("title")), [
        "Folder/Source Note.md",
        "src/sidebarPersistedComment.ts",
    ]);
    assert.equal(fileLinks.every((link) => link.classList.contains("internal-link")), true);

    let prevented = false;
    let stopped = false;
    const clickEvent = {
        type: "click",
        preventDefault: () => {
            prevented = true;
        },
        stopPropagation: () => {
            stopped = true;
        },
    };
    fileLinks[0]?.dispatchEvent(clickEvent);

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(openedLinks, [{
        href: "Folder/Source Note.md",
        sourcePath: "docs/architecture.md",
        focusTargetClass: "internal-link aside-agent-run-file-link",
    }]);
});

test("renderPersistedCommentCard shows copied feedback after sharing a side note", async () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "Share this", timestamp: 100 },
        ],
    });
    const scheduledTimeouts: Array<{
        callback: () => void;
        delayMs: number;
        timerId: number;
    }> = [];
    const sharedCommentIds: string[] = [];
    const iconUpdates: Array<{ className: string; icon: string }> = [];
    FakeElement.defaultView = {
        setTimeout: ((handler: TimerHandler, delayMs?: number, ...args: unknown[]) => {
            const timerId = scheduledTimeouts.length + 1;
            scheduledTimeouts.push({
                callback: () => {
                    if (typeof handler === "function") {
                        handler(...args);
                    }
                },
                delayMs: delayMs ?? 0,
                timerId,
            });
            return timerId;
        }) as Window["setTimeout"],
        clearTimeout: (() => {}) as Window["clearTimeout"],
    };

    try {
        const host = createRenderHost({
            shareComment: async (comment) => {
                sharedCommentIds.push(comment.id);
            },
            setIcon: (element, icon) => {
                iconUpdates.push({
                    className: (element as unknown as FakeElement).className,
                    icon,
                });
            },
        });
        const root = new FakeElement("div");

        await renderPersistedCommentCard(root as unknown as HTMLDivElement, thread, host);

        const shareButton = root.findAllByClass("aside-thread-share-button")[0];
        assert.ok(shareButton);
        assert.equal(shareButton.getAttribute("aria-label"), "Share side note");
        const copiedLabel = root.findAllByClass("aside-thread-share-status")[0];
        assert.ok(copiedLabel);
        assert.equal(copiedLabel.hidden, true);

        let stopped = false;
        const clickEvent = {
            stopPropagation: () => {
                stopped = true;
            },
        };
        const onclick = shareButton.onclick;
        assert.equal(typeof onclick, "function");
        await (onclick as (event: typeof clickEvent) => Promise<void>)(clickEvent);

        assert.equal(stopped, true);
        assert.deepEqual(sharedCommentIds, ["comment-1"]);
        assert.equal(shareButton.getAttribute("aria-label"), "Copied");
        assert.equal(shareButton.getAttribute("title"), "Copied");
        assert.ok(shareButton.classList.contains("is-copied"));
        assert.equal(shareButton.hidden, true);
        assert.equal(copiedLabel.hidden, false);
        assert.equal(copiedLabel.textContent, "Copied");
        assert.equal(scheduledTimeouts.length, 1);
        assert.equal(scheduledTimeouts[0]?.delayMs, 1000);
        const shareIconUpdates = iconUpdates
            .filter((update) => update.className.includes("aside-thread-share-button"))
            .map((update) => update.icon);
        assert.deepEqual(shareIconUpdates, ["share"]);

        scheduledTimeouts[0]?.callback();

        assert.equal(shareButton.getAttribute("aria-label"), "Share side note");
        assert.equal(shareButton.getAttribute("title"), "Share side note");
        assert.equal(shareButton.classList.contains("is-copied"), false);
        assert.equal(shareButton.hidden, false);
        assert.equal(copiedLabel.hidden, true);
        assert.equal(copiedLabel.textContent, "");
    } finally {
        FakeElement.defaultView = null;
    }
});

test("renderPersistedCommentCard can collapse agent run metadata from the footer actions", async () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "@codex check this", timestamp: 100 },
            { id: "entry-2", body: "Agent reply", timestamp: 110 },
        ],
    });
    const iconUpdates: Array<{ className: string; icon: string }> = [];
    const host = createRenderHost({
        threadAgentRuns: [
            createAgentRun({
                outputEntryId: "entry-2",
                usedSkills: [{ name: "aside" }],
                usedFiles: ["Folder/Source Note.md"],
            }),
        ],
        setIcon: (element, icon) => {
            iconUpdates.push({
                className: (element as unknown as FakeElement).className,
                icon,
            });
        },
    });
    const root = new FakeElement("div");

    await renderPersistedCommentCard(root as unknown as HTMLDivElement, thread, host);

    const toggleButton = root.findAllByClass("aside-agent-run-metadata-toggle-button")[0];
    assert.ok(toggleButton);
    assert.equal(toggleButton.getAttribute("aria-expanded"), "true");
    assert.equal(toggleButton.getAttribute("aria-label"), "Hide metadata");
    assert.equal(toggleButton.getAttribute("type"), "button");
    assert.equal(iconUpdates.at(-1)?.icon, "chevron-up");
    const footerActionsEl = toggleButton.parentElement;
    assert.ok(footerActionsEl);
    assert.ok(footerActionsEl.classList.contains("aside-thread-footer-actions"));
    const footerMetaEl = footerActionsEl.parentElement;
    assert.ok(footerMetaEl);
    assert.ok(footerMetaEl.classList.contains("aside-thread-footer-meta"));
    const metadataRows = root.findAllByClass("aside-agent-run-visible-metadata");
    assert.equal(metadataRows.length, 2);
    assert.equal(metadataRows.every((row) => row.parentElement === footerMetaEl), true);
    const footerActionsIndex = footerMetaEl.children.indexOf(footerActionsEl);
    const firstMetadataIndex = footerMetaEl.children.indexOf(metadataRows[0]);
    assert.notEqual(footerActionsIndex, -1);
    assert.notEqual(firstMetadataIndex, -1);
    assert.ok(footerActionsIndex < firstMetadataIndex);
    assert.equal(metadataRows.every((row) => row.hidden === false), true);
    assert.equal(metadataRows.every((row) => row.classList.contains("is-collapsed")), false);

    let stopped = false;
    const clickEvent = {
        stopPropagation: () => {
            stopped = true;
        },
    };
    const onclick = toggleButton.onclick;
    assert.equal(typeof onclick, "function");
    (onclick as (event: typeof clickEvent) => void)(clickEvent);

    assert.equal(stopped, true);
    assert.equal(toggleButton.getAttribute("aria-expanded"), "false");
    assert.equal(toggleButton.getAttribute("aria-label"), "Show metadata");
    assert.equal(metadataRows.every((row) => row.hidden === true), true);
    assert.equal(metadataRows.every((row) => row.classList.contains("is-collapsed")), true);
    assert.equal(iconUpdates.at(-1)?.icon, "chevron-down");
});

test("renderPersistedCommentCard puts agent metadata above status and Add to file", async () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "@codex draft this", timestamp: 100 },
            { id: "entry-2", body: "Agent reply", timestamp: 110 },
        ],
    });
    const host: SidebarPersistedCommentHost = {
        activeCommentId: null,
        currentFilePath: "docs/architecture.md",
        currentUserLabel: "You",
        showSourceRedirectAction: false,
        showBookmarkAndPinControls: false,
        showDeletedComments: false,
        enablePageThreadReorder: false,
        enableChildEntryMove: false,
        enableSoftDeleteActions: false,
        showNestedComments: true,
        showNestedCommentsByDefault: true,
        getKnownCommentById: () => null,
        editDraftComment: null,
        appendDraftComment: null,
        agentRun: null,
        agentStream: null,
        threadAgentRuns: [
            createAgentRun({
                outputEntryId: "entry-2",
                usedSkills: [{ name: "aside", mode: "write", source: "built-in" }],
            }),
        ],
        getEventTargetElement: () => null,
        isSelectionInsideSidebarContent: () => false,
        claimSidebarInteractionOwnership: () => {},
        insertCommentMarkdownIntoFile: async () => true,
        renderMarkdown: async (markdown, container) => {
            (container as unknown as FakeElement).textContent = markdown;
        },
        openSidebarInternalLink: async () => {},
        openCommentFromCard: async () => {},
        openCommentInEditor: async () => {},
        shareComment: async () => {},
        saveVisibleDraftIfPresent: async () => true,
        setShowNestedCommentsForThread: () => {},
        moveCommentThread: () => {},
        restoreComment: () => true,
        clearDeletedComment: () => true,
        startEditDraft: () => {},
        isPinnedThread: () => false,
        togglePinnedThread: () => {},
        startAppendEntryDraft: () => {},
        retryAgentRun: () => true,
        retryAgentPromptForComment: () => true,
        reanchorCommentThreadToCurrentSelection: () => {},
        deleteCommentWithConfirm: () => true,
        renderAppendDraft: () => {},
        renderInlineEditDraft: () => {},
        setIcon: () => {},
    };
    const root = new FakeElement("div");

    await renderPersistedCommentCard(root as unknown as HTMLDivElement, thread, host);

    const childFooterMeta = root.findAllByClass("aside-thread-footer-meta")[1];
    assert.ok(childFooterMeta);
    const childClasses = childFooterMeta.children.map((child) => child.className);
    const addToFileIndex = childClasses.findIndex((className) =>
        className.includes("aside-thread-footer-meta-action")
    );
    const statusIndex = childClasses.findIndex((className) =>
        className.includes("aside-agent-run-status")
    );
    const metadataIndex = childClasses.findIndex((className) =>
        className.includes("aside-agent-run-metadata-frontmatter")
    );

    assert.notEqual(addToFileIndex, -1);
    assert.notEqual(statusIndex, -1);
    assert.notEqual(metadataIndex, -1);
    const addToFileEl = childFooterMeta.children[addToFileIndex];
    assert.equal(addToFileEl?.tagName, "button");
    assert.equal(addToFileEl?.getAttribute("type"), "button");
    assert.equal(addToFileEl?.getAttribute("role"), null);
    assert.ok(metadataIndex < statusIndex);
    assert.ok(metadataIndex < addToFileIndex);
    assert.ok(statusIndex < addToFileIndex);
    assert.equal(childClasses.some((className) =>
        className.includes("aside-thread-footer-meta-separator")
    ), false);
});

test("renderPersistedCommentCard renders source redirects for nested index entries", async () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "comment-1", body: "Parent side note", timestamp: 100 },
            { id: "entry-2", body: "Nested side note", timestamp: 110 },
        ],
    });
    const openedCommentIds: string[] = [];
    const host = createRenderHost({
        showSourceRedirectAction: true,
        openCommentInEditor: async (comment) => {
            openedCommentIds.push(comment.id);
        },
    });
    const root = new FakeElement("div");

    await renderPersistedCommentCard(root as unknown as HTMLDivElement, thread, host);

    const redirectButtons = root.findAllByClass("aside-comment-action-redirect");
    assert.equal(redirectButtons.length, 2);
    const childRedirectButton = redirectButtons[1];
    assert.ok(childRedirectButton);
    await (childRedirectButton.onclick as (event: { stopPropagation(): void }) => Promise<void>)({
        stopPropagation() {},
    });
    assert.deepEqual(openedCommentIds, ["entry-2"]);
});

test("renderPersistedCommentCard reuses toolbar pin styling for page note pins", async () => {
    const thread = createThreadWithEntries({
        anchorKind: "page",
        entries: [
            { id: "comment-1", body: "Page note", timestamp: 100 },
        ],
    });
    const host: SidebarPersistedCommentHost = {
        activeCommentId: null,
        currentFilePath: "docs/architecture.md",
        currentUserLabel: "You",
        showSourceRedirectAction: false,
        showBookmarkAndPinControls: true,
        showDeletedComments: false,
        enablePageThreadReorder: false,
        enableChildEntryMove: false,
        enableSoftDeleteActions: false,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        getKnownCommentById: () => null,
        editDraftComment: null,
        appendDraftComment: null,
        agentRun: null,
        agentStream: null,
        threadAgentRuns: [],
        getEventTargetElement: () => null,
        isSelectionInsideSidebarContent: () => false,
        claimSidebarInteractionOwnership: () => {},
        insertCommentMarkdownIntoFile: async () => true,
        renderMarkdown: async (markdown, container) => {
            (container as unknown as FakeElement).textContent = markdown;
        },
        openSidebarInternalLink: async () => {},
        openCommentFromCard: async () => {},
        openCommentInEditor: async () => {},
        shareComment: async () => {},
        saveVisibleDraftIfPresent: async () => true,
        setShowNestedCommentsForThread: () => {},
        moveCommentThread: () => {},
        restoreComment: () => true,
        clearDeletedComment: () => true,
        startEditDraft: () => {},
        isPinnedThread: () => true,
        togglePinnedThread: () => {},
        startAppendEntryDraft: () => {},
        retryAgentRun: () => true,
        retryAgentPromptForComment: () => true,
        reanchorCommentThreadToCurrentSelection: () => {},
        deleteCommentWithConfirm: () => true,
        renderAppendDraft: () => {},
        renderInlineEditDraft: () => {},
        setIcon: () => {},
    };
    const root = new FakeElement("div");

    await renderPersistedCommentCard(root as unknown as HTMLDivElement, thread, host);

    const pinButton = root.findAllByClass("aside-comment-action-pin")[0];
    assert.ok(pinButton);
    assert.equal(pinButton.classList.contains("aside-toolbar-icon-button"), true);
    assert.equal(pinButton.classList.contains("aside-sidebar-file-pin-button"), true);
});
