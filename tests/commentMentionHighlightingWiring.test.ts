import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("draft and persisted renderers consume the host actionable predicate", () => {
    const draftSource = readFileSync("src/ui/views/sidebarDraftComment.ts", "utf8");
    const persistedSource = readFileSync("src/ui/views/sidebarPersistedComment.ts", "utf8");

    assert.match(
        draftSource,
        /renderStyledDraftCommentFragment\([\s\S]*host\.isActionableMention/,
    );
    assert.match(
        persistedSource,
        /decorateRenderedCommentMentions\(container, host\.isActionableMention\)/,
    );
});

test("AsideView supplies the plugin actionable predicate to comment hosts", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");
    const adapters = source.match(
        /isActionableMention:\s*\(mention\)\s*=>\s*this\.plugin\.isActionableMention\(mention\)/g,
    ) ?? [];

    assert.equal(adapters.length, 3);
});
