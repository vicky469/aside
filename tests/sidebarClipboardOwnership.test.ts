import * as assert from "node:assert/strict";
import test from "node:test";

type LeafKind = "markdown" | "sidenote";

class MockWorkspace {
    public activeLeaf: LeafKind = "markdown";

    setActiveLeaf(leaf: LeafKind): void {
        this.activeLeaf = leaf;
    }

    copy(selectedSidebarText: string, editorSelection: string): string {
        return this.activeLeaf === "sidenote" ? selectedSidebarText : editorSelection;
    }
}

class MockSidebarView {
    constructor(private readonly workspace: MockWorkspace) {}

    interactInsideRenderedCommentOld(): void {
        // The old behavior left the markdown leaf active after revealComment().
    }

    interactInsideRenderedCommentFixed(): void {
        this.workspace.setActiveLeaf("sidenote");
    }
}

test("old sidebar interaction can leak the managed JSON block through editor copy", () => {
    const workspace = new MockWorkspace();
    const view = new MockSidebarView(workspace);
    const sidebarSelection = "Copied from sidebar";
    const editorSelection = [
        "Copied from sidebar",
        "",
        "<!-- Aside comments",
        "[{\"id\":\"comment-1\",\"comment\":\"Copied from sidebar\"}]",
        "-->",
    ].join("\n");

    view.interactInsideRenderedCommentOld();

    assert.equal(workspace.copy(sidebarSelection, editorSelection), editorSelection);
});

test("fixed sidebar interaction claims copy ownership before copy runs", () => {
    const workspace = new MockWorkspace();
    const view = new MockSidebarView(workspace);
    const sidebarSelection = "Copied from sidebar";
    const editorSelection = [
        "Copied from sidebar",
        "",
        "<!-- Aside comments",
        "[{\"id\":\"comment-1\",\"comment\":\"Copied from sidebar\"}]",
        "-->",
    ].join("\n");

    view.interactInsideRenderedCommentFixed();

    assert.equal(workspace.copy(sidebarSelection, editorSelection), sidebarSelection);
});
