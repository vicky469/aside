import * as assert from "node:assert/strict";
import test from "node:test";
import { isActionableMention } from "../src/core/text/actionableMentions";
import type { DraftComment } from "../src/domain/drafts";
import { renderStyledDraftCommentHtml } from "../src/ui/editor/commentEditorStyling";
import {
    reconcileSidebarItems,
    type SidebarItemRenderDescriptor,
} from "../src/ui/views/sidebarItemReconciler";
import { buildPageSidebarDraftRenderSignature } from "../src/ui/views/sidebarPageRenderSignature";

class FakeChildren extends Array<FakeElement> {
    item(index: number): FakeElement | null {
        return this[index] ?? null;
    }
}

class FakeElement {
    readonly children = new FakeChildren();
    readonly dataset: Record<string, string> = {};
    readonly classList = {
        contains: (_className: string): boolean => false,
    };
    parentElement: FakeElement | null = null;
    scrollTop = 0;
    scrollLeft = 0;
    renderedHtml = "";
    height = 0;
    clientHeight = 0;

    get layoutHeight(): number {
        return this.height || this.children.reduce((sum, child) => sum + child.layoutHeight, 0);
    }

    get scrollHeight(): number {
        return this.children.reduce((sum, child) => sum + child.layoutHeight, 0);
    }

    getBoundingClientRect(): { top: number; bottom: number; height: number } {
        const parent = this.parentElement;
        const preceding = parent ? parent.children.slice(0, parent.children.indexOf(this)) : [];
        const top = parent ? parent.getBoundingClientRect().top - parent.scrollTop
            + preceding.reduce((sum, child) => sum + child.layoutHeight, 0) : 0;
        return { top, bottom: top + this.layoutHeight, height: this.layoutHeight };
    }

    getAttribute(name: string): string | null {
        const key = name.slice(5).replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
        return this.dataset[key] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        const attrs = [...selector.matchAll(/\[([^\]]+)\]/gu)].map((match) => match[1]!);
        return this.children.flatMap((child) => [
            ...(attrs.some((attr) => child.getAttribute(attr) !== null) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }

    get isConnected(): boolean {
        return this.parentElement !== null;
    }

    insertBefore(node: FakeElement, reference: FakeElement | null): FakeElement {
        node.remove();
        const referenceIndex = reference === null ? -1 : this.children.indexOf(reference);
        if (referenceIndex === -1) {
            this.children.push(node);
        } else {
            this.children.splice(referenceIndex, 0, node);
        }
        node.parentElement = this;
        return node;
    }

    remove(): void {
        if (!this.parentElement) {
            return;
        }
        const index = this.parentElement.children.indexOf(this);
        if (index !== -1) {
            this.parentElement.children.splice(index, 1);
        }
        this.parentElement = null;
    }
}

function createNode(key: string, signature: string): FakeElement {
    const node = new FakeElement();
    node.dataset.asideRenderKey = key;
    node.dataset.asideRenderSignature = signature;
    return node;
}

function createContainer(children: readonly FakeElement[]): FakeElement {
    const container = new FakeElement();
    for (const child of children) {
        container.insertBefore(child, null);
    }
    return container;
}

function descriptor(
    key: string,
    signature: string,
    render: () => Promise<FakeElement> = async () => createNode(key, signature),
): SidebarItemRenderDescriptor {
    return {
        key,
        signature,
        threadId: key.startsWith("thread:") ? key.slice("thread:".length) : null,
        render: async () => await render() as unknown as HTMLElement,
    };
}

test("reconcileSidebarItems reuses unchanged keyed nodes and renders only changed nodes", async () => {
    const existing = createNode("thread:a", "same");
    const changed = createNode("thread:b", "old");
    const container = createContainer([existing, changed]);
    let renderCount = 0;

    const completed = await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [
            descriptor("thread:a", "same", async () => createNode("unused", "unused")),
            descriptor("thread:b", "new", async () => {
                renderCount += 1;
                return createNode("thread:b", "new");
            }),
        ],
    );

    assert.equal(completed, true);
    assert.equal(container.children[0], existing);
    assert.equal(renderCount, 1);
});

test("reconcileSidebarItems keeps a mounted draft editor stable as its text changes", async () => {
    const draft: DraftComment = {
        id: "draft-1",
        filePath: "docs/note.md",
        startLine: 4,
        startChar: 2,
        endLine: 4,
        endChar: 9,
        selectedText: "selected text",
        selectedTextHash: "hash:selected",
        comment: "first",
        timestamp: 100,
        anchorKind: "selection",
        mode: "new",
    };
    const originalSignature = buildPageSidebarDraftRenderSignature(
        draft,
        "draft-1",
        false,
        true,
    );
    const existing = Object.assign(createNode("draft:draft-1", originalSignature), {
        value: "first and second",
        selectionStart: 7,
        selectionEnd: 10,
        scrollTop: 18,
    });
    const container = createContainer([existing]);
    let renderCount = 0;

    const completed = await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [descriptor(
            "draft:draft-1",
            buildPageSidebarDraftRenderSignature({
                ...draft,
                comment: "first and second",
            }, "draft-1", false, true),
            async () => {
                renderCount += 1;
                return createNode("draft:draft-1", "replacement");
            },
        )],
    );

    assert.equal(completed, true);
    assert.equal(container.children[0], existing);
    assert.equal(existing.value, "first and second");
    assert.equal(existing.selectionStart, 7);
    assert.equal(existing.selectionEnd, 10);
    assert.equal(existing.scrollTop, 18);
    assert.equal(renderCount, 0);
});

test("reconcileSidebarItems reorders retained nodes and removes obsolete nodes", async () => {
    const first = createNode("thread:a", "same");
    const second = createNode("thread:b", "same");
    const obsolete = createNode("thread:c", "same");
    const container = createContainer([first, second, obsolete]);
    const removedThreadIds: string[] = [];

    await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [descriptor("thread:b", "same"), descriptor("thread:a", "same")],
        { onRemoveThread: (threadId) => removedThreadIds.push(threadId) },
    );

    assert.deepEqual(Array.from(container.children), [second, first]);
    assert.equal(obsolete.isConnected, false);
    assert.deepEqual(removedThreadIds, ["c"]);
});

test("reconcileSidebarItems can retain a thread controller while replacing its rendered node", async () => {
    const existing = createNode("thread:a", "old");
    const replacement = createNode("thread:a", "new");
    const container = createContainer([existing]);
    container.scrollTop = 37;
    container.scrollLeft = 11;
    const replacedPairs: Array<[string, HTMLElement, HTMLElement]> = [];
    const connectionStates: Array<[boolean, boolean]> = [];
    const removedThreadIds: string[] = [];

    await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [descriptor("thread:a", "new", async () => replacement)],
        {
            onReplaceThread: (threadId: string, previous: HTMLElement, next: HTMLElement) => {
                replacedPairs.push([threadId, previous, next]);
                connectionStates.push([previous.isConnected, next.isConnected]);
                container.scrollTop = 0;
                container.scrollLeft = 0;
                return true;
            },
            onRemoveThread: (threadId) => removedThreadIds.push(threadId),
        },
    );

    assert.deepEqual(replacedPairs, [[
        "a",
        existing as unknown as HTMLElement,
        replacement as unknown as HTMLElement,
    ]]);
    assert.deepEqual(connectionStates, [[true, true]]);
    assert.equal(container.scrollTop, 37);
    assert.equal(container.scrollLeft, 11);
    assert.deepEqual(removedThreadIds, []);
    assert.equal(container.children[0], replacement);
});

test("reconcileSidebarItems leaves mounted nodes untouched when superseded", async () => {
    const existing = createNode("thread:a", "old");
    const container = createContainer([existing]);
    let current = true;

    const completed = await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [
            descriptor("thread:a", "new", async () => {
                current = false;
                return createNode("thread:a", "new");
            }),
        ],
        { isCurrent: () => current },
    );

    assert.equal(completed, false);
    assert.deepEqual(Array.from(container.children), [existing]);
});

test("reconcileSidebarItems removes stale script mention styling after Scripts is disabled", async () => {
    const draft: DraftComment = {
        id: "draft:a",
        filePath: "docs/note.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: "",
        selectedTextHash: "hash",
        comment: "@todo /clean",
        timestamp: 100,
        anchorKind: "page",
        orphaned: false,
        mode: "new",
    };
    const renderDraft = (scriptsEnabled: boolean): FakeElement => {
        const signature = buildPageSidebarDraftRenderSignature(
            draft,
            null,
            false,
            scriptsEnabled,
        );
        const node = createNode(`draft:${draft.id}`, signature);
        node.renderedHtml = renderStyledDraftCommentHtml(
            draft.comment,
            (mention) => isActionableMention(mention, {
                scriptsEnabled,
                isRunnableVaultScriptMention: (candidate) => candidate === "/clean",
            }),
        );
        return node;
    };
    const enabledNode = renderDraft(true);
    const container = createContainer([enabledNode]);
    const disabledNode = renderDraft(false);

    assert.equal(
        enabledNode.renderedHtml.includes(
            "<span class=\"aside-editor-token-mention\">/clean</span>",
        ),
        true,
    );
    await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [descriptor(
            `draft:${draft.id}`,
            disabledNode.dataset.asideRenderSignature ?? "",
            async () => disabledNode,
        )],
    );

    assert.equal(container.children[0], disabledNode);
    assert.equal(
        disabledNode.renderedHtml,
        "<span class=\"aside-editor-token-mention\">@todo</span> /clean",
    );
});

function createLongThread(signature: string, earlierReplyHeight: number): FakeElement {
    const thread = createNode("thread:long", signature);
    for (let index = 0; index < 12; index += 1) {
        const entry = new FakeElement();
        entry.dataset.commentId = `entry-${index}`;
        entry.height = index === 2 ? earlierReplyHeight : 100;
        thread.insertBefore(entry, null);
    }
    return thread;
}

for (const [beforeHeight, afterHeight] of [[300, 100], [100, 300]]) {
    test(`sidebar keeps the visible reply in place when an earlier reply changes height ${beforeHeight} to ${afterHeight}`, async () => {
        const previous = createLongThread("before", beforeHeight!);
        const next = createLongThread("after", afterHeight!);
        const container = createContainer([previous]);
        const viewport = createContainer([container]);
        viewport.height = viewport.clientHeight = 300;
        viewport.scrollTop = previous.children[7]!.getBoundingClientRect().top - 40;
        const beforeTop = previous.children[7]!.getBoundingClientRect().top;
        await reconcileSidebarItems(container as unknown as HTMLElement, [descriptor("thread:long", "after", async () => next)]);
        assert.equal(next.children[7]!.getBoundingClientRect().top, beforeTop);
    });
}

test("sidebar does not follow a new reply appended below the viewport", async () => {
    const previous = createLongThread("before", 100);
    const next = createLongThread("after", 100);
    const extra = new FakeElement();
    extra.height = 500;
    next.insertBefore(extra, null);
    const container = createContainer([previous]);
    const viewport = createContainer([container]);
    viewport.height = viewport.clientHeight = 300;
    viewport.scrollTop = 400;
    await reconcileSidebarItems(container as unknown as HTMLElement, [descriptor("thread:long", "after", async () => next)]);
    assert.equal(viewport.scrollTop, 400);
});
