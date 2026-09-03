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

    assert.equal(adapters.length, 4);
});

test("AsideView preserves streamed reply controllers across both thread reconcilers", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");
    const adapters = source.match(
        /onReplaceThread:\s*\(threadId,\s*_previousThreadEl,\s*nextThreadEl\)\s*=>\s*this\.handoffStreamedReplyController\(/g,
    ) ?? [];

    assert.equal(adapters.length, 2);
    assert.match(source, /private handoffStreamedReplyController\(/u);
    assert.match(
        source,
        /this\.plugin\.getAgentRuns\(\)\.find\(\(candidate\) => candidate\.id === stream\.runId\)/u,
    );
    assert.match(source, /stream\.status !== run\.status/u);
    assert.match(source, /stream\.status !== "succeeded" && stream\.status !== "failed"/u);
    assert.match(source, /adoptSidebarPersistedCardInteractions/u);
});
