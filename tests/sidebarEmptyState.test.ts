import * as assert from "node:assert/strict";
import test from "node:test";
import { renderNoSidebarFileEmptyState } from "../src/ui/views/sidebarEmptyState";

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
    const staleSidebar = root.createDiv("sidenote2-comments-container is-note-sidebar");
    staleSidebar.createDiv("sidenote2-comments-list");
    root.createDiv("sidenote2-empty-state");

    renderNoSidebarFileEmptyState(root);
    renderNoSidebarFileEmptyState(root);

    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].className, "sidenote2-empty-state");
    assert.deepEqual(root.children[0].children.map((child) => child.text), [
        "No markdown file selected.",
        "Open a markdown file to see its side notes.",
    ]);
});
