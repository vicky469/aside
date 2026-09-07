import * as assert from "node:assert/strict";
import test from "node:test";
import type { DraftComment } from "../src/domain/drafts";
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
    const originalSignature = buildPageSidebarDraftRenderSignature(draft, "draft-1");
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
            }, "draft-1"),
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
    const replacedPairs: Array<[string, HTMLElement, HTMLElement]> = [];
    const removedThreadIds: string[] = [];

    await reconcileSidebarItems(
        container as unknown as HTMLElement,
        [descriptor("thread:a", "new", async () => replacement)],
        {
            onReplaceThread: (threadId: string, previous: HTMLElement, next: HTMLElement) => {
                replacedPairs.push([threadId, previous, next]);
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
