import * as assert from "node:assert/strict";
import test from "node:test";

type LeafKind = "markdown" | "sidenote" | "other";

class MockSideNoteView {
    public updateCount = 0;

    async updateActiveFile(_file: { path: string }): Promise<void> {
        this.updateCount++;
    }
}

class MockPlugin {
    public activeMarkdownFile: { path: string } | null = { path: "note.md" };
    public view = new MockSideNoteView();

    async handleActiveLeafChangeOld(kind: LeafKind): Promise<void> {
        const file = kind === "markdown" ? { path: "other.md" } : this.getPinnedMarkdownFile();
        if (!file) {
            return;
        }

        this.activeMarkdownFile = file;
        await this.view.updateActiveFile(file);
    }

    async handleActiveLeafChangeFixed(kind: LeafKind): Promise<void> {
        if (kind === "sidenote") {
            return;
        }

        const file = kind === "markdown" ? { path: "other.md" } : null;
        if (!file) {
            return;
        }

        this.activeMarkdownFile = file;
        await this.view.updateActiveFile(file);
    }

    private getPinnedMarkdownFile(): { path: string } | null {
        return this.activeMarkdownFile;
    }
}

test("old active-leaf-change logic refreshes when the SideNote2 leaf becomes active", async () => {
    const plugin = new MockPlugin();

    await plugin.handleActiveLeafChangeOld("sidenote");

    assert.strictEqual(plugin.view.updateCount, 1);
    assert.deepStrictEqual(plugin.activeMarkdownFile, { path: "note.md" });
});

test("fixed active-leaf-change logic ignores SideNote2 leaf activation", async () => {
    const plugin = new MockPlugin();

    await plugin.handleActiveLeafChangeFixed("sidenote");

    assert.strictEqual(plugin.view.updateCount, 0);
    assert.deepStrictEqual(plugin.activeMarkdownFile, { path: "note.md" });
});

test("fixed active-leaf-change logic still refreshes for markdown leaves", async () => {
    const plugin = new MockPlugin();

    await plugin.handleActiveLeafChangeFixed("markdown");

    assert.strictEqual(plugin.view.updateCount, 1);
    assert.deepStrictEqual(plugin.activeMarkdownFile, { path: "other.md" });
});
