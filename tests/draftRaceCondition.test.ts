import * as assert from "node:assert/strict";
import test from "node:test";

// Mock render tracking to demonstrate the race condition
class MockSideNoteView {
    public renderCount = 0;
    public draftRenderCount = 0;
    public focusCallCount = 0;
    private draftId: string | null = null;

    async renderComments(): Promise<number> {
        const renderId = ++this.renderCount;
        // Simulate async DOM operations
        await Promise.resolve();

        // If there's a draft being rendered, count it
        if (this.draftId) {
            this.draftRenderCount++;
        }

        return renderId;
    }

    async highlightAndFocusDraft(commentId: string): Promise<void> {
        this.draftId = commentId;
        await this.renderComments();
        this.focusCallCount++;
        // Simulate focus after render
        await Promise.resolve();
    }

    setDraft(draftId: string | null): void {
        this.draftId = draftId;
    }

    // OLD behavior: always renders (causes race condition)
    async updateActiveFileOld(): Promise<void> {
        // This always renders, even when draft is about to be rendered again
        await this.renderComments();
    }

    // FIXED behavior: avoids redundant renders
    async updateActiveFileFixed(hasDraft: boolean): Promise<void> {
        // Skip render if draft exists - it will be rendered by highlightAndFocusDraft
        if (hasDraft) {
            return;
        }
        await this.renderComments();
    }
}

// Simulate the plugin flow
class MockPlugin {
    public view: MockSideNoteView;
    public draftComment: { id: string; filePath: string } | null = null;

    constructor() {
        this.view = new MockSideNoteView();
    }

    async setDraftComment(draft: typeof this.draftComment): Promise<void> {
        this.draftComment = draft;
        this.view.setDraft(draft?.id ?? null);
        await this.view.renderComments();
    }

    // OLD implementation - has race condition
    async startNewCommentDraftOld(): Promise<void> {
        const draft = {
            id: "draft-123",
            filePath: "test.md",
            comment: "",
        };

        await this.setDraftComment(draft);
        await this.activateViewAndHighlightCommentOld(draft.id);
    }

    async activateViewAndHighlightCommentOld(commentId: string): Promise<void> {
        await this.activateViewOld();
        await this.view.highlightAndFocusDraft(commentId);
    }

    async activateViewOld(): Promise<void> {
        // View already exists scenario - this triggers redundant render
        await this.view.updateActiveFileOld();
    }

    // FIXED implementation - avoids redundant renders
    async startNewCommentDraftFixed(): Promise<void> {
        const draft = {
            id: "draft-123",
            filePath: "test.md",
            comment: "",
        };

        await this.setDraftComment(draft);
        await this.activateViewAndHighlightCommentFixed(draft.id);
    }

    async activateViewAndHighlightCommentFixed(commentId: string): Promise<void> {
        await this.activateViewFixed();
        await this.view.highlightAndFocusDraft(commentId);
    }

    async activateViewFixed(): Promise<void> {
        // Skip redundant render when draft exists
        await this.view.updateActiveFileFixed(this.draftComment !== null);
    }
}

test("demonstrates the race condition with old implementation", async () => {
    const plugin = new MockPlugin();

    await plugin.startNewCommentDraftOld();

    // The old implementation renders 3 times:
    // 1. setDraftComment -> renderComments (draft is set, draftRenderCount = 1)
    // 2. activateViewOld -> updateActiveFileOld -> renderComments (draft still set, draftRenderCount = 2)
    // 3. highlightAndFocusDraft -> renderComments (draft still set, draftRenderCount = 3)
    assert.strictEqual(plugin.view.renderCount, 3, "Old impl renders 3 times (race condition)");

    // The draft textarea is rendered 3 times, causing the flash
    assert.strictEqual(plugin.view.draftRenderCount, 3, "Draft rendered 3 times (causes cursor flash)");
});

test("fixed implementation renders fewer times", async () => {
    const plugin = new MockPlugin();

    await plugin.startNewCommentDraftFixed();

    // The fixed implementation renders 2 times:
    // 1. setDraftComment -> renderComments (draft is set, draftRenderCount = 1)
    // 2. activateViewFixed -> updateActiveFileFixed (SKIPS render because hasDraft=true)
    // 3. highlightAndFocusDraft -> renderComments (draft still set, draftRenderCount = 2)
    assert.strictEqual(plugin.view.renderCount, 2, "Fixed impl renders only 2 times");

    // Draft rendered twice - once in setDraftComment, once in highlightAndFocusDraft
    assert.strictEqual(plugin.view.draftRenderCount, 2, "Draft rendered twice (better than 3)");
    assert.strictEqual(plugin.view.focusCallCount, 1, "Focus called once after final render");
});
