# File-View Agent Regenerate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar Generate action regenerate agent replies for every page-note-capable file while preserving Markdown-only source reads and anchors.

**Architecture:** Reuse the shared page-note capability as the retry entry-point guard by exposing it through `CommentAgentHost` and the existing `main.ts` adapter. Leave output-entry reuse, queued/running streams, runtime prompt construction, and annotation handling in their current owners; regression tests distinguish file-level eligibility from Markdown text capability and use a source-read tripwire.

**Tech Stack:** TypeScript, Obsidian API typings, Node test runner, esbuild, ESLint, repository artifact guard, Obsidian CLI.

---

## File Structure

- Modify `tests/commentAgentController.test.ts`: model page-note and Markdown capabilities separately; verify non-Markdown retry, output reuse/append, stream association, rejection, and no source reads.
- Modify `src/agents/commentAgentController.ts`: add the page-note predicate to the host interface and consume it only at the retry eligibility boundary.
- Modify `src/main.ts`: adapt `CommentAgentHost.isPageNoteCapableFile` to the plugin's shared capability method.
- Modify `docs/superpowers/specs/2026-08-25-file-view-agent-regenerate-design.md`: track verified implementation and acceptance evidence.
- Create `docs/superpowers/plans/2026-08-25-file-view-agent-regenerate.md`: retain this executable plan.

No UI file should change unless the controller regression proves a second defect: the current UI already resolves Generate to the stored agent run and renders its stream against `outputEntryId`.

### Task 1: Add Regression Tests That Separate File and Text Capabilities

**Files:**
- Modify: `tests/commentAgentController.test.ts:55-220`
- Modify: `tests/commentAgentController.test.ts:1380-1665`

- [x] **Step 1: Add explicit capability and source-read seams to the controller harness**

Add these options to `createHarness`:

```ts
    isCommentableFilePath?: (filePath: string) => boolean;
    isPageNoteCapableFilePath?: (filePath: string) => boolean;
    currentNoteContentError?: Error;
```

Record note-content reads next to the other harness observations:

```ts
    const currentNoteContentReads: string[] = [];
```

Keep the pre-fix host on its current Markdown predicate for the first red run:

```ts
        isCommentableFile: (candidate): candidate is TFile => (
            !!candidate
            && (options.isCommentableFilePath?.(candidate.path) ?? true)
        ),
        getCurrentNoteContent: async (file) => {
            currentNoteContentReads.push(file.path);
            if (options.currentNoteContentError) {
                throw options.currentNoteContentError;
            }
            return options.currentNoteContent ?? "";
        },
```

Expose `currentNoteContentReads` from the returned harness object. Declare `isPageNoteCapableFilePath` now for the later green wiring, but do not add a not-yet-supported property to the controller host before the red run.

- [x] **Step 2: Add an existing-output PDF retry test**

Add this test beside the current regenerate tests:

```ts
test("comment agent controller regenerates a non-Markdown reply in the existing output entry", async () => {
    let attempt = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
        releaseRetry = resolve;
    });
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        availableFilePaths: ["Books/Guide.pdf"],
        isCommentableFilePath: (filePath) => /\.md$/iu.test(filePath),
        isPageNoteCapableFilePath: () => true,
        currentNoteContentError: new Error("binary source must not be read"),
        customRunAgentRuntime: async () => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error("first conversion failed");
            }
            await retryGate;
            return { runtime: "direct-cli", replyText: "Recovered conversion" };
        },
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const failedRun = harness.controller.getLatestAgentRunForThread("thread-1");
    const outputEntryId = failedRun?.outputEntryId ?? "";
    assert.equal(failedRun?.status, "failed");
    assert.ok(outputEntryId);

    const started = await harness.controller.retryRun(failedRun?.id ?? "");

    assert.equal(started, true);
    const retryRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retryRun?.outputEntryId, outputEntryId);
    assert.equal(harness.commentManager.getCommentById(outputEntryId)?.comment, "");
    assert.equal(
        harness.controller.getActiveAgentStreamForThread("thread-1")?.outputEntryId,
        outputEntryId,
    );
    assert.equal(harness.appendedEntries.length, 1);
    assert.deepEqual(harness.currentNoteContentReads, []);

    releaseRetry();
    await waitForAgentQueueToDrain(harness.controller);
    assert.equal(harness.commentManager.getCommentById(outputEntryId)?.comment, "Recovered conversion");
});
```

- [x] **Step 3: Add missing-output and ineligible-source coverage**

Add a DOCX run whose stored output entry is absent:

```ts
test("comment agent controller appends an output entry when a non-Markdown retry has none", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Documents/Guide.docx",
            comment: "@codex summarize this file",
        })],
        availableFilePaths: ["Documents/Guide.docx"],
        isCommentableFilePath: (filePath) => /\.md$/iu.test(filePath),
        isPageNoteCapableFilePath: () => true,
        currentNoteContentError: new Error("binary source must not be read"),
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Documents/Guide.docx",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@codex summarize this file",
                createdAt: 10,
                startedAt: 11,
                endedAt: 12,
                error: "previous failure",
                outputEntryId: "missing-output",
            }],
        },
        runtimeReplyText: "Recovered document reply",
    });

    assert.equal(await harness.controller.retryRun("run-old"), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retryRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.notEqual(retryRun?.outputEntryId, "missing-output");
    assert.equal(harness.appendedEntries.length, 1);
    assert.equal(
        harness.commentManager.getCommentById(retryRun?.outputEntryId ?? "")?.comment,
        "Recovered document reply",
    );
    assert.deepEqual(harness.currentNoteContentReads, []);
});
```

Add one table-driven rejection test for a missing source and the generated index:

```ts
test("comment agent controller rejects missing and ineligible retry sources without reply mutation", async () => {
    for (const scenario of [{
        name: "missing source",
        filePath: "Documents/Missing.docx",
        availableFilePaths: [] as string[],
        isPageNoteCapableFilePath: () => true,
    }, {
        name: "generated index",
        filePath: "🐰 Aside Index.md",
        availableFilePaths: ["🐰 Aside Index.md"],
        isPageNoteCapableFilePath: () => false,
    }]) {
        const harness = createHarness({
            initialComments: [createComment({
                filePath: scenario.filePath,
                comment: "@codex retry this",
            })],
            availableFilePaths: scenario.availableFilePaths,
            isCommentableFilePath: () => false,
            isPageNoteCapableFilePath: scenario.isPageNoteCapableFilePath,
            initialPersistedData: {
                agentRuns: [{
                    id: "run-old",
                    threadId: "thread-1",
                    triggerEntryId: "thread-1",
                    filePath: scenario.filePath,
                    requestedAgent: "codex",
                    runtime: "direct-cli",
                    status: "failed",
                    promptText: "@codex retry this",
                    createdAt: 10,
                    endedAt: 12,
                    outputEntryId: "reply-1",
                }],
            },
        });
        harness.commentManager.appendEntry("thread-1", {
            id: "reply-1",
            body: "Previous failure",
            timestamp: 20,
        });

        assert.equal(await harness.controller.retryRun("run-old"), false, scenario.name);
        assert.deepEqual(harness.runtimeCalls, [], scenario.name);
        assert.deepEqual(harness.editedEntries, [], scenario.name);
        assert.deepEqual(harness.appendedEntries, [], scenario.name);
        assert.equal(
            harness.commentManager.getCommentById("reply-1")?.comment,
            "Previous failure",
            scenario.name,
        );
    }
});
```

- [x] **Step 4: Run the focused test to prove the Markdown guard is the failure**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: the new PDF and DOCX tests fail at `started === true` because the current retry guard returns `false` when `isCommentableFile` rejects the source. Existing focused tests remain green.

### Task 2: Consume the Shared Page-Note Capability at Retry

**Files:**
- Modify: `src/agents/commentAgentController.ts:71-83`
- Modify: `src/agents/commentAgentController.ts:456-472`
- Modify: `src/main.ts:510-528`
- Modify: `tests/commentAgentController.test.ts:115-145`

- [x] **Step 1: Extend the agent host interface**

Add the required predicate next to `isCommentableFile`:

```ts
    isCommentableFile(file: TFile | null): file is TFile;
    isPageNoteCapableFile(file: TFile | null): file is TFile;
    getCurrentNoteContent(file: TFile): Promise<string>;
```

- [x] **Step 2: Replace only the retry eligibility guard**

Change `retryPromptForCommentInternal` to:

```ts
        const file = this.host.getFileByPath(options.filePath);
        if (!this.host.isPageNoteCapableFile(file)) {
            this.host.showNotice(options.missingFileNotice);
            return false;
        }
```

Do not change `applyAgentAnnotationProposals` or `buildRuntimePromptContext`; they must continue to reject non-Markdown anchoring and skip non-Markdown note-content reads.

- [x] **Step 3: Wire production and test hosts to the shared capability**

In the `CommentAgentController` host in `src/main.ts`, add:

```ts
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        isPageNoteCapableFile: (file): file is TFile => this.isPageNoteCapableFile(file),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
```

In the test harness, add after `isCommentableFile`:

```ts
        isPageNoteCapableFile: (candidate): candidate is TFile => (
            !!candidate
            && (options.isPageNoteCapableFilePath?.(candidate.path) ?? true)
        ),
```

- [x] **Step 4: Run the focused test and verify green behavior**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: all comment-agent tests pass. The PDF test reuses and clears its existing output entry, exposes an active stream for that entry, and completes without reading the PDF. The DOCX test appends exactly one replacement entry and also performs no source read.

- [x] **Step 5: Re-run the change-surface audit**

Run:

```bash
rg -n "isCommentableFile|isPageNoteCapableFile" src/agents/commentAgentController.ts src/main.ts tests/commentAgentController.test.ts
```

Expected: retry eligibility uses `isPageNoteCapableFile`; annotation handling retains `isCommentableFile`; runtime prompt construction retains its Markdown path check; production and test hosts expose both predicates. There is no extension allowlist or generated-index duplicate in the controller.

- [x] **Step 6: Commit the tested fix**

```bash
git add src/agents/commentAgentController.ts src/main.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): regenerate file-view replies"
```

### Task 3: Verify, Inspect, Install, and Smoke-Test the Exact Build

**Files:**
- Modify: `docs/superpowers/specs/2026-08-25-file-view-agent-regenerate-design.md`
- Verify generated: `main.js`
- Verify public assets: `main.js`, `manifest.json`, `styles.css`
- Install exact assets into: `/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside`

- [x] **Step 1: Run the complete build pipeline**

Run:

```bash
npm run build
```

Expected: 1,249 compiled tests after the three additions, 98 repository-policy tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact inspection all pass with zero failures or warnings other than the existing npm `min-release-age` notice.

- [x] **Step 2: Inspect exactly what will be installed**

Run:

```bash
find . -maxdepth 1 -type f \( -name 'main.js' -o -name 'main.js.map' -o -name 'manifest.json' -o -name 'styles.css' \) -print | sort
node scripts/check-release-artifacts.mjs
rg -n "sourceMappingURL|sourcesContent|/Users/|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|BEGIN CERTIFICATE|npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_|sk-[A-Za-z0-9]{20,}" main.js manifest.json styles.css
shasum -a 256 main.js manifest.json styles.css
```

Expected: the exact public set is `main.js`, `manifest.json`, and `styles.css`; no `main.js.map` exists; the artifact guard passes; the explicit sensitive/source scan returns no matches; hashes are recorded for post-install comparison.

- [x] **Step 3: Install the exact inspected assets into `lean-startup`**

Run:

```bash
node scripts/install-built-plugin.mjs --vault "/Users/example/Obsidian/lean-startup"
```

Then compare each installed asset:

```bash
cmp -s main.js "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js"
cmp -s manifest.json "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json"
cmp -s styles.css "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css"
```

Expected: installer reports only the three public assets; all three `cmp` commands exit `0`.

- [x] **Step 4: Reload Aside and smoke-test the original PDF Generate flow**

Run:

```bash
obsidian plugin:reload id=aside vault=lean-startup
```

Open the source file `z_📚 reading/software/Algorithms + Data Structures = Programs (Prentice-Hall -- Niklaus Wirth -- Prentice-Hall series in automatic computation, 1st, 1976 -- PRENTICE-HALL, -- isbn13 9780130224187 -- 368d91a7f3fe63605e919b0d1f8f7b6f -- Anna’s Archive.pdf`, select thread `a1b19ae4-2266-4014-b7c3-0e08990a2fe8`, click Generate, and verify in this order:

1. The existing failed reply is cleared rather than duplicated.
2. The turning spinner appears in that same reply card while the run is queued/running.
3. The final or newly failed response replaces that card.
4. A second reply is appended only when the stored output entry is genuinely missing.
5. No missing-file notice appears for the PDF source.

- [x] **Step 5: Mark only verified tracking items complete**

Update `docs/superpowers/specs/2026-08-25-file-view-agent-regenerate-design.md` from `[ ]` to `[x]` only for implementation and verification items supported by the completed commands and live smoke evidence. Change the status to `Implemented` only when every required item is checked.

- [x] **Step 6: Commit the tracked design and plan**

```bash
git add -f docs/superpowers/specs/2026-08-25-file-view-agent-regenerate-design.md docs/superpowers/plans/2026-08-25-file-view-agent-regenerate.md
git commit -m "docs: track file-view agent regeneration"
```

### Task 4: Integrate the Completed Branch

**Files:**
- Verify: all branch changes against the current `main`

- [ ] **Step 1: Confirm branch cleanliness and commit scope**

Run:

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected: clean worktree, one tested code commit plus one documentation commit, no whitespace errors, and changes limited to the two controller/adapter files, controller tests, spec, and plan.

- [ ] **Step 2: Use the finishing-development-branch workflow**

Invoke `superpowers:finishing-a-development-branch`, re-run its required verification, and integrate according to the user's selected option. Do not push, tag, publish, or upload artifacts unless separately requested.
