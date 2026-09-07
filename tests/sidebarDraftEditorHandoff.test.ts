import * as assert from "node:assert/strict";
import test from "node:test";
import { handoffSidebarDraftEditor } from "../src/ui/views/sidebarDraftEditorHandoff";

class FakeElement {
    public readonly children: FakeElement[] = [];
    public readonly dataset: Record<string, string> = {};
    public parentElement: FakeElement | null = null;
    public mountedRoot = false;
    public value = "";
    public selectionStart = 0;
    public selectionEnd = 0;
    public scrollTop = 0;
    public focusCalls = 0;
    public lastFocusPreventScroll = false;
    public ownerDocument: { activeElement: FakeElement | null } = {
        activeElement: null,
    };

    public get isConnected(): boolean {
        let current: FakeElement = this;
        while (current.parentElement) {
            current = current.parentElement;
        }
        return current.mountedRoot;
    }

    public appendChild(child: FakeElement): FakeElement {
        child.remove();
        child.parentElement = this;
        child.setOwnerDocument(this.ownerDocument);
        this.children.push(child);
        return child;
    }

    public contains(target: FakeElement | null): boolean {
        return target === this || this.children.some((child) => child.contains(target));
    }

    public focus(options?: { preventScroll?: boolean }): void {
        this.focusCalls += 1;
        this.lastFocusPreventScroll = options?.preventScroll === true;
        this.ownerDocument.activeElement = this;
    }

    public querySelector<T extends FakeElement = FakeElement>(selector: string): T | null {
        for (const child of this.children) {
            if (selector === "[data-draft-id]" && child.dataset.draftId) {
                return child as T;
            }
            const nested = child.querySelector<T>(selector);
            if (nested) {
                return nested;
            }
        }
        return null;
    }

    public replaceWith(replacement: FakeElement): void {
        const parent = this.parentElement;
        if (!parent) {
            return;
        }
        const index = parent.children.indexOf(this);
        replacement.remove();
        parent.children[index] = replacement;
        replacement.parentElement = parent;
        this.parentElement = null;
    }

    public remove(): void {
        if (!this.parentElement) {
            return;
        }
        if (this.contains(this.ownerDocument.activeElement)) {
            this.ownerDocument.activeElement = null;
        }
        const index = this.parentElement.children.indexOf(this);
        if (index !== -1) {
            this.parentElement.children.splice(index, 1);
        }
        this.parentElement = null;
    }

    private setOwnerDocument(ownerDocument: { activeElement: FakeElement | null }): void {
        this.ownerDocument = ownerDocument;
        this.children.forEach((child) => child.setOwnerDocument(ownerDocument));
    }
}

function createMountedThread(draftId: string): {
    root: FakeElement;
    thread: FakeElement;
    draft: FakeElement;
} {
    const root = new FakeElement();
    root.mountedRoot = true;
    const thread = root.appendChild(new FakeElement());
    const draft = thread.appendChild(new FakeElement());
    draft.dataset.draftId = draftId;
    return { root, thread, draft };
}

test("handoffSidebarDraftEditor preserves a mounted append draft subtree", () => {
    const container = new FakeElement();
    container.mountedRoot = true;
    const previousThread = container.appendChild(new FakeElement());
    const nextThread = container.appendChild(new FakeElement());
    const mountedDraft = previousThread.appendChild(new FakeElement());
    mountedDraft.dataset.draftId = "draft-append";
    const textarea = mountedDraft.appendChild(new FakeElement());
    Object.assign(textarea, {
        value: "unsaved text",
        selectionStart: 4,
        selectionEnd: 8,
        scrollTop: 18,
    });
    textarea.ownerDocument.activeElement = textarea;
    const replacementDraft = nextThread.appendChild(new FakeElement());
    replacementDraft.dataset.draftId = "draft-append";

    assert.equal(handoffSidebarDraftEditor(
        previousThread as unknown as HTMLElement,
        nextThread as unknown as HTMLElement,
    ), true);
    assert.equal(nextThread.querySelector("[data-draft-id]"), mountedDraft);
    assert.equal(textarea.value, "unsaved text");
    assert.equal(textarea.selectionStart, 4);
    assert.equal(textarea.selectionEnd, 8);
    assert.equal(textarea.scrollTop, 18);
    assert.equal(textarea.ownerDocument.activeElement, textarea);
    assert.equal(textarea.focusCalls, 1);
    assert.equal(textarea.lastFocusPreventScroll, true);
    assert.equal(mountedDraft.isConnected, true);
});

test("handoffSidebarDraftEditor preserves a mounted inline edit subtree", () => {
    const container = new FakeElement();
    container.mountedRoot = true;
    const previousThread = container.appendChild(new FakeElement());
    const nextThread = container.appendChild(new FakeElement());
    const previousReplyList = previousThread.appendChild(new FakeElement());
    const nextReplyList = nextThread.appendChild(new FakeElement());
    const mountedEditCard = previousReplyList.appendChild(new FakeElement());
    mountedEditCard.dataset.draftId = "entry-2";
    const replacementEditCard = nextReplyList.appendChild(new FakeElement());
    replacementEditCard.dataset.draftId = "entry-2";

    assert.equal(handoffSidebarDraftEditor(
        previousThread as unknown as HTMLElement,
        nextThread as unknown as HTMLElement,
    ), true);
    assert.equal(nextReplyList.children[0], mountedEditCard);
    assert.equal(mountedEditCard.isConnected, true);
});

test("handoffSidebarDraftEditor rejects mismatched draft ids", () => {
    const previous = createMountedThread("draft-old");
    const next = createMountedThread("draft-new");

    assert.equal(handoffSidebarDraftEditor(
        previous.thread as unknown as HTMLElement,
        next.thread as unknown as HTMLElement,
    ), false);
    assert.equal(previous.thread.querySelector("[data-draft-id]"), previous.draft);
    assert.equal(next.thread.querySelector("[data-draft-id]"), next.draft);
});

test("handoffSidebarDraftEditor rejects a detached replacement thread", () => {
    const previous = createMountedThread("draft-1");
    const nextThread = new FakeElement();
    const nextDraft = nextThread.appendChild(new FakeElement());
    nextDraft.dataset.draftId = "draft-1";

    assert.equal(handoffSidebarDraftEditor(
        previous.thread as unknown as HTMLElement,
        nextThread as unknown as HTMLElement,
    ), false);
    assert.equal(previous.thread.querySelector("[data-draft-id]"), previous.draft);
    assert.equal(nextThread.querySelector("[data-draft-id]"), nextDraft);
});
