# Optimistic Agent Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a completed agent response as final Obsidian Markdown in its existing live card before background persistence finishes.

**Architecture:** Extract the persisted comment Markdown pipeline into one exported helper, inject that helper into `StreamedAgentReplyController` through `AsideView`, and render terminal content into a detached container before an identity-checked atomic swap. Keep streaming text updates synchronous and invalidate asynchronous render completions when their run, text, card, or controller generation is stale.

**Tech Stack:** TypeScript, Obsidian `MarkdownRenderer`, DOM APIs, Node test runner, repository build and artifact guard.

---

### Task 1: Share the sidebar Markdown renderer

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts:110-135,700-745`
- Test: `tests/sidebarPersistedComment.test.ts`

- [x] **Step 1: Write a failing direct test for the shared renderer**

Import `renderSidebarCommentMarkdown` and add a test that passes Markdown containing a resolvable Aside reference. Capture the Markdown and source path received by `renderMarkdown`, then assert that the shared helper applies the existing reference normalization and forwards the source path.

```ts
test("renderSidebarCommentMarkdown shares persisted normalization and source path", async () => {
    const container = new FakeElement("div");
    let renderedMarkdown = "";
    let renderedSourcePath = "";
    const host = createRenderHost({
        getKnownCommentById: () => createComment({
            anchorKind: "page",
            comment: "Linked note",
            filePath: "docs/source.md",
        }),
        renderMarkdown: async (markdown, _container, sourcePath) => {
            renderedMarkdown = markdown;
            renderedSourcePath = sourcePath;
        },
    });

    await renderSidebarCommentMarkdown(
        container as unknown as HTMLElement,
        "obsidian://aside-comment?vault=lean-startup&file=docs%2Fsource.md&commentId=comment-1",
        "docs/current.md",
        host,
    );

    assert.match(renderedMarkdown, /Linked note/u);
    assert.equal(renderedSourcePath, "docs/current.md");
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: compilation fails because `renderSidebarCommentMarkdown` is not exported.

- [x] **Step 3: Extract the minimal shared host and renderer**

Add a focused host type and exported helper. Narrow `interceptSideNoteProtocolLinks` to the same host, and make `renderThreadEntryContent` delegate to the helper.

```ts
export type SidebarCommentMarkdownRenderHost = Pick<
    SidebarPersistedCommentHost,
    "getKnownCommentById" | "isActionableMention" | "renderMarkdown" | "openSidebarInternalLink"
>;

export async function renderSidebarCommentMarkdown(
    container: HTMLElement,
    markdown: string,
    sourcePath: string,
    host: SidebarCommentMarkdownRenderHost,
): Promise<void> {
    if (!markdown.trim()) {
        return;
    }
    await host.renderMarkdown(
        normalizeCommentMarkdownForRenderWithOptions(markdown, {
            resolveSideNoteReferenceLabel: (match) => formatSidebarSideNoteReferenceLabel(
                host.getKnownCommentById(match.target.commentId),
                match.target.filePath,
            ),
        }),
        container,
        sourcePath,
    );
    decorateRenderedCommentMentions(container, host.isActionableMention);
    interceptSideNoteProtocolLinks(container, sourcePath, host);
}
```

- [x] **Step 4: Run the focused suite and verify GREEN**

Run the Step 2 commands. Expected: all `sidebarPersistedComment` tests pass.

- [x] **Step 5: Commit the shared renderer**

```bash
git add src/ui/views/sidebarPersistedComment.ts tests/sidebarPersistedComment.test.ts
git commit -m "refactor(ui): share comment markdown renderer"
```

### Task 2: Format terminal responses in the existing live card

**Files:**
- Modify: `src/ui/views/streamedAgentReplyController.ts`
- Test: `tests/streamedAgentReplyController.test.ts`

- [x] **Step 1: Write failing tests for detached rendering and stable identity**

Add a deferred `renderFinalMarkdown` callback. Sync a succeeded response, assert that its complete plain text and original card remain visible while rendering is pending, resolve the callback after placing a rendered node in the detached container, then assert that the rendered node appears in that same card.

```ts
test("formats a completed response off-DOM in the existing card", async () => {
    let finishRender = () => { throw new Error("Renderer did not start."); };
    let renderTarget: FakeStreamElement | null = null;
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async (_markdown, container) => {
            renderTarget = container as unknown as FakeStreamElement;
            await new Promise<void>((resolve) => { finishRender = resolve; });
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;
    controller.syncContent(contentEl as any, {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "succeeded",
        partialText: "**Done**",
        startedAt: 100,
        updatedAt: 101,
    });
    assert.equal(contentEl.textContent, "**Done**");
    const renderedNode = new FakeStreamElement("strong");
    (renderTarget as unknown as FakeStreamElement).appendChild(renderedNode);
    finishRender();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(controller.contentEl, contentEl);
    assert.equal(contentEl.childNodes[0], renderedNode);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: compilation fails because `renderFinalMarkdown` is not an option.

- [x] **Step 3: Add the minimal terminal render state machine**

Extend the options and controller state, keeping active text updates synchronous. Use a key derived from run id and exact response text plus the current content element identity. Render immediately into a detached `div`, then replace visible children only after all captured identities still match.

```ts
type StreamedAgentReplyControllerOptions = {
    onCancelRun?: (runId: string) => void;
    renderFinalMarkdown?: (markdown: string, container: HTMLElement) => Promise<void>;
    onFinalMarkdownRenderError?: (error: unknown) => void;
};

private finalRenderGeneration = 0;
private finalRenderKey: string | null = null;
private finalRenderContentEl: HTMLDivElement | null = null;

private syncContent(contentEl: HTMLDivElement, stream: AgentRunStreamState): void {
    const canRender = (stream.status === "succeeded" || stream.status === "failed")
        && stream.partialText.trim().length > 0
        && !!this.options.renderFinalMarkdown;
    if (!canRender) {
        this.invalidateFinalRender();
        if (contentEl.textContent !== stream.partialText) contentEl.textContent = stream.partialText;
        return;
    }
    const key = `${stream.runId}\u0000${stream.partialText}`;
    if (this.finalRenderKey === key && this.finalRenderContentEl === contentEl) return;
    this.invalidateFinalRender();
    contentEl.textContent = stream.partialText;
    this.finalRenderKey = key;
    this.finalRenderContentEl = contentEl;
    const generation = ++this.finalRenderGeneration;
    const detached = createElement(contentEl.ownerDocument, "div", contentEl.className);
    try {
        void this.options.renderFinalMarkdown(stream.partialText, detached).then(() => {
            if (generation !== this.finalRenderGeneration
                || this.finalRenderKey !== key
                || this.finalRenderContentEl !== contentEl
                || this.contentEl !== contentEl) return;
            contentEl.replaceChildren(...Array.from(detached.childNodes));
        }).catch((error) => this.options.onFinalMarkdownRenderError?.(error));
    } catch (error) {
        this.options.onFinalMarkdownRenderError?.(error);
    }
}
```

Call `syncContent` from `sync`, and call an `invalidateFinalRender` helper from `clear` before card state is released.

- [x] **Step 4: Run the focused suite and verify GREEN**

Run the Step 2 commands. Expected: all `streamedAgentReplyController` tests pass.

- [x] **Step 5: Write failing race and fallback tests**

Add tests proving:

1. a late first render cannot overwrite a newer run or response;
2. repeated terminal sync calls launch only one renderer;
3. a rejected renderer leaves the complete plain-text response visible;
4. a `succeeded` to save-`failed` update with identical text preserves already-rendered nodes.

- [x] **Step 6: Run the new tests and verify RED where behavior is missing**

Run the Step 2 commands. Expected: each new assertion fails for its intended stale, duplicate, fallback, or status-transition behavior.

- [x] **Step 7: Complete invalidation and failure handling**

Implement one invalidation helper that increments the generation and clears render identity. Preserve the same terminal render key across `succeeded` and `failed` statuses so a save failure changes only the status line. Report both synchronous throws and promise rejections through `onFinalMarkdownRenderError` without clearing visible content.

- [x] **Step 8: Run the focused suite and verify GREEN**

Run the Step 2 commands. Expected: all streamed reply tests pass with no warnings.

- [x] **Step 9: Commit the live-card formatter**

```bash
git add src/ui/views/streamedAgentReplyController.ts tests/streamedAgentReplyController.test.ts
git commit -m "feat(agents): format completed replies early"
```

### Task 3: Wire Obsidian rendering and verify background independence

**Files:**
- Modify: `src/ui/views/AsideView.ts:65-75,3372-3385`
- Test: `tests/commentAgentController.test.ts`
- Modify: `docs/superpowers/specs/2026-09-03-optimistic-agent-markdown-rendering-design.md`
- Modify: `docs/superpowers/plans/2026-09-03-optimistic-agent-markdown-rendering.md`

- [x] **Step 1: Strengthen the blocked-persistence test**

In the existing optimistic completion test, keep the persistence promise unresolved and assert that the `succeeded` stream containing the final answer is published first. This is the controller-level proof that view formatting can begin independently of storage.

- [x] **Step 2: Run the focused controller suite**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: the strengthened assertion passes against the existing optimistic persistence boundary.

- [x] **Step 3: Inject the shared renderer from `AsideView`**

Import `renderSidebarCommentMarkdown` and supply these options when constructing the streamed controller:

```ts
renderFinalMarkdown: async (markdown, container) => {
    const thread = this.plugin.getThreadById(threadId);
    if (!thread) {
        throw new Error(`Cannot render completed agent reply for missing thread ${threadId}.`);
    }
    const sourcePath = thread.filePath;
    await renderSidebarCommentMarkdown(container, markdown, sourcePath, {
        getKnownCommentById: (commentId) => this.plugin.getCommentById(commentId),
        isActionableMention: (mention) => this.plugin.isActionableMention(mention),
        renderMarkdown: async (normalizedMarkdown, target, renderSourcePath) => {
            await MarkdownRenderer.render(this.app, normalizedMarkdown, target, renderSourcePath, this);
        },
        openSidebarInternalLink: (href, renderSourcePath, focusTarget, options) =>
            this.interactionController.openSidebarInternalLink(href, renderSourcePath, focusTarget, options),
    });
},
onFinalMarkdownRenderError: (error) => {
    console.error("[Aside] Failed to render completed agent reply.", error);
},
```

- [x] **Step 4: Run focused UI and controller suites**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js .test-dist/tests/commentAgentController.test.js
```

Expected: all focused tests pass.

- [x] **Step 5: Run the complete build**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, production bundle, and release artifact guard all pass.

- [x] **Step 6: Inspect the exact shipped artifacts**

Verify the only shipped plugin assets are the expected `main.js`, `manifest.json`, and `styles.css`; confirm there is no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source, `.env*`, `.npmrc`, private key, or certificate in the release surface.

- [x] **Step 7: Mark the design and plan checklists complete**

Mark an item `[x]` only when its implementation and listed verification have passed.

- [x] **Step 8: Commit the integration and verified documentation**

```bash
git add src/ui/views/AsideView.ts tests/commentAgentController.test.ts docs/superpowers/specs/2026-09-03-optimistic-agent-markdown-rendering-design.md docs/superpowers/plans/2026-09-03-optimistic-agent-markdown-rendering.md
git commit -m "feat(agents): render final markdown before save"
```

- [x] **Step 9: Install and reload the verified build**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: installation and plugin reload succeed.

- [x] **Step 10: Compare installed artifacts byte-for-byte**

Run `cmp -s` for `main.js`, `manifest.json`, and `styles.css` against `/path/to/vault/.obsidian/plugins/aside/`. Expected: all three report `match`.
