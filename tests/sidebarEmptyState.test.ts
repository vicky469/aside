import * as assert from "node:assert/strict";
import test from "node:test";
import {
    NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT,
    renderNoSidebarFileEmptyState,
} from "../src/ui/views/sidebarEmptyState";

class FakeElement {
    public readonly children: FakeElement[] = [];
    public text = "";

    constructor(public readonly tagName: string, public readonly className = "") {}

    public createDiv(className: string): FakeElement {
        const child = new FakeElement("div", className);
        this.children.push(child);
        return child;
    }

    public createEl(tagName: string, options: { text: string }): FakeElement {
        const child = new FakeElement(tagName);
        child.text = options.text;
        this.children.push(child);
        return child;
    }

    public empty(): void {
        this.children.length = 0;
    }
}

test("no-sidebar-file empty state clears stale note sidebar content and stays singular", () => {
    const root = new FakeElement("div");
    const staleSidebar = root.createDiv("aside-comments-container is-note-sidebar");
    staleSidebar.createDiv("aside-comments-list");
    root.createDiv("aside-empty-state");

    renderNoSidebarFileEmptyState(root);
    renderNoSidebarFileEmptyState(root);

    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].className, "aside-empty-state");
    assert.deepEqual(root.children[0].children.map((child) => child.text), [
        "No markdown file selected.",
        "Open a markdown file to see its side notes.",
    ]);
});

test("note sidebar empty create hint includes page and anchored note paths", () => {
    assert.equal(
        NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT,
        "Use the add button to create a page side note, or select text and right-click \"Add comment to selection\" to add an anchored note.",
    );
    assert.doesNotMatch(NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT, /Use the add button to create a page side note\.$/);
});
