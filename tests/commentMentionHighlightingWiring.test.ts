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

test("AsideView includes live Scripts capability in draft and thread render signatures", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");

    assert.match(
        source,
        /buildPageSidebarDraftRenderSignature\([\s\S]*?this\.plugin\.isScriptsEnabled\(\)[\s\S]*?\)/u,
    );
    assert.match(
        source,
        /buildPageSidebarThreadRenderSignature\(\{[\s\S]*?scriptsEnabled:\s*this\.plugin\.isScriptsEnabled\(\)/u,
    );
});

test("AsideView preserves streamed reply controllers across both thread reconcilers", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");
    const adapters = source.match(
        /onReplaceThread:\s*\(threadId,\s*previousThreadEl,\s*nextThreadEl\)\s*=>\s*\{\s*handoffSidebarDraftEditor\(previousThreadEl, nextThreadEl\);\s*return this\.handoffStreamedReplyController\(threadId, nextThreadEl\);\s*\}/g,
    ) ?? [];

    assert.equal(adapters.length, 2);
    assert.match(source, /private handoffStreamedReplyController\(/u);
    assert.match(source, /const runsById = new Map\(/u);
    assert.match(source, /runsById\.get\(stream\.runId\)/u);
    assert.match(source, /stream\.status !== run\.status/u);
    assert.match(source, /stream\.status !== "cancelled"/u);
    assert.match(source, /adoptSidebarPersistedCardInteractions/u);
});

test("AsideView keys streamed reply controllers by run so same-thread runs stay independent", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");

    assert.match(source, /this\.plugin\.getAgentStreamsForThread\(threadId\)/u);
    assert.match(source, /this\.streamedReplyControllers\.get\(update\.runId\)/u);
    assert.match(source, /this\.removeStreamedReplyController\(update\.runId\)/u);
    assert.doesNotMatch(
        source,
        /getOrCreateStreamedReplyController\(update\.threadId\)\.sync/u,
    );
});
