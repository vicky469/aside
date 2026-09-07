import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main.ts", "utf8");
const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");

function getMethodSource(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `missing method marker: ${startMarker}`);
    assert.ok(end > start, `missing method boundary after: ${startMarker}`);
    return source.slice(start, end);
}

test("saved entry routing reads the live Scripts capability into the named route", () => {
    const methodSource = getMethodSource(
        mainSource,
        "private async handleSavedUserEntry(event: SavedUserEntryEvent)",
        "private async publishSnapshotArtifacts",
    );

    assert.match(methodSource, /routeSavedUserEntry\(\{/u);
    assert.match(methodSource, /scriptsEnabled:\s*this\.isScriptsEnabled\(\)/u);
    assert.match(methodSource, /builtInControllers:\s*\{/u);
    assert.match(methodSource, /updateScript:\s*this\.updateScriptCommandController/u);
    assert.match(methodSource, /createScript:\s*this\.createScriptCommandController/u);
    assert.match(methodSource, /pdfToMarkdown:\s*this\.pdfToMarkdownCommandController/u);
    assert.match(methodSource, /scriptController:\s*this\.commentScriptController/u);
    assert.match(methodSource, /agentController:\s*this\.commentAgentController/u);
});

test("agent retry preparation reads the live Scripts capability through its production host", () => {
    const controllerSource = getMethodSource(
        mainSource,
        "private readonly commentAgentController: CommentAgentController",
        "private readonly createScriptCommandController",
    );

    assert.match(controllerSource, /isScriptsEnabled:\s*\(\)\s*=>\s*this\.isScriptsEnabled\(\)/u);
});

test("vault-script retry preparation reads the live Scripts capability through its production host", () => {
    const controllerSource = getMethodSource(
        mainSource,
        "private readonly commentScriptController = new CommentScriptController",
        "private readonly commentAgentController: CommentAgentController",
    );

    assert.match(controllerSource, /isScriptsEnabled:\s*\(\)\s*=>\s*this\.isScriptsEnabled\(\)/u);
});

test("retry entry points consult the live capability before their controllers", () => {
    const agentMethodSource = getMethodSource(
        mainSource,
        "public async retryAgentRun(runId: string)",
        "public async retryScriptRun(runId: string)",
    );
    const scriptMethodSource = getMethodSource(
        mainSource,
        "public async retryScriptRun(runId: string)",
        "public async retryAgentPromptForComment",
    );

    assert.match(
        agentMethodSource,
        /canRetryAgentRunWithScriptsCapability\(this\.isScriptsEnabled\(\), run\)/u,
    );
    assert.ok(
        agentMethodSource.indexOf("canRetryAgentRunWithScriptsCapability")
            < agentMethodSource.indexOf("commentAgentController.retryRun"),
    );
    assert.match(
        scriptMethodSource,
        /canRetryScriptRunWithScriptsCapability\(this\.isScriptsEnabled\(\)\)/u,
    );
    assert.ok(
        scriptMethodSource.indexOf("canRetryScriptRunWithScriptsCapability")
            < scriptMethodSource.indexOf("commentScriptController.retryRun"),
    );
});

test("AsideView supplies the live Scripts capability without gating cancellation", () => {
    const renderMethodSource = getMethodSource(
        asideViewSource,
        "private async renderPersistedComment(",
        "private setupPageThreadReorderInteractions(",
    );
    const streamedControllerMethodSource = getMethodSource(
        asideViewSource,
        "private getOrCreateStreamedReplyController(",
        "private removeStreamedReplyController(",
    );

    assert.match(renderMethodSource, /scriptsEnabled:\s*this\.plugin\.isScriptsEnabled\(\)/u);
    assert.match(streamedControllerMethodSource, /onCancelRun:\s*\(runId\)\s*=>/u);
    assert.doesNotMatch(streamedControllerMethodSource, /scriptsEnabled|isScriptsEnabled/u);
});
