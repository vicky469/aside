import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("draft and persisted renderers consume the host script predicate", () => {
    const draftSource = readFileSync("src/ui/views/sidebarDraftComment.ts", "utf8");
    const persistedSource = readFileSync("src/ui/views/sidebarPersistedComment.ts", "utf8");

    assert.match(
        draftSource,
        /renderStyledDraftCommentFragment\([\s\S]*host\.isRunnableVaultScriptMention/,
    );
    assert.match(
        persistedSource,
        /decorateRenderedCommentMentions\(container, host\.isRunnableVaultScriptMention\)/,
    );
});

test("AsideView supplies the plugin live-registry predicate to comment hosts", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");
    const adapters = source.match(
        /isRunnableVaultScriptMention:\s*\(mention\)\s*=>\s*this\.plugin\.isRunnableVaultScriptMention\(mention\)/g,
    ) ?? [];

    assert.equal(adapters.length, 3);
});
