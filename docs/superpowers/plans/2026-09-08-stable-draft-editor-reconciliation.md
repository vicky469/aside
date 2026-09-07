# Stable Draft Editor Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Aside draft editors visible and stationary across background sidebar refreshes without hiding concurrent agent or script updates.

**Architecture:** Split mutable draft text from structural render identity so top-level drafts reuse their mounted node. When a persisted thread genuinely rerenders, insert the replacement while the old thread is still connected and transplant the matching nested draft subtree by stable draft ID. Make the two-layer editor fail open by showing textarea text unless a synchronized preview is explicitly ready.

**Tech Stack:** TypeScript, Obsidian DOM helpers, CSS, Node test runner, esbuild.

---

## File Structure

- Modify `src/ui/views/sidebarPageRenderSignature.ts`: exclude editable body text from shared draft structural identity.
- Modify `src/ui/views/sidebarItemReconciler.ts`: invoke replacement handoffs only after old and new thread nodes are connected.
- Create `src/ui/views/sidebarDraftEditorHandoff.ts`: preserve the one matching mounted nested draft subtree by stable draft ID.
- Modify `src/ui/views/AsideView.ts`: use the shared draft handoff for both note and Index thread reconciliation.
- Modify `src/ui/views/sidebarDraftComment.ts`: own preview readiness and blur-time synchronization.
- Modify `styles.css`: make visible textarea text the fallback and switch to the formatted layer only when ready.
- Modify `tests/sidebarPageRenderSignature.test.ts`: cover structural draft identity and live surrounding run updates.
- Modify `tests/sidebarItemReconciler.test.ts`: cover mounted replacement timing and top-level draft node stability.
- Create `tests/sidebarDraftEditorHandoff.test.ts`: cover nested append/edit subtree preservation.
- Modify `tests/sidebarDraftComment.test.ts`: cover preview readiness policy.
- Create `tests/sidebarDraftVisibilityStyles.test.mjs`: cover the fail-open CSS and blur wiring.
- Modify `docs/superpowers/specs/2026-09-07-stable-draft-editor-reconciliation-design.md`: record completed implementation and verification evidence.

### Task 1: Make draft render identity structural

**Files:**
- Modify: `tests/sidebarPageRenderSignature.test.ts`
- Modify: `tests/sidebarItemReconciler.test.ts`
- Modify: `src/ui/views/sidebarPageRenderSignature.ts:43-64`

- [ ] **Step 1: Write failing signature tests**

Add a focused test proving text edits do not alter either top-level or nested draft identity, while saving state and surrounding agent state still do:

```ts
test("draft render signatures ignore live editor text", () => {
    const topLevelDraft = createDraft({ id: "draft-top", comment: "first" });
    const editedTopLevelDraft = { ...topLevelDraft, comment: "first and second" };
    assert.equal(
        buildPageSidebarDraftRenderSignature(topLevelDraft, "draft-top"),
        buildPageSidebarDraftRenderSignature(editedTopLevelDraft, "draft-top"),
    );

    const appendDraft = createDraft({
        id: "draft-append",
        mode: "append",
        threadId: "thread-1",
        comment: "first",
    });
    const base = createThreadRenderOptions({ appendDraftComment: appendDraft });
    assert.equal(
        buildPageSidebarThreadRenderSignature(base),
        buildPageSidebarThreadRenderSignature({
            ...base,
            appendDraftComment: { ...appendDraft, comment: "first and second" },
        }),
    );
});
```

Keep the existing saving-state assertion and add or retain an agent-run status assertion so removing the body hash does not freeze true surrounding updates.

- [ ] **Step 2: Write the failing top-level node-stability test**

In `tests/sidebarItemReconciler.test.ts`, compose a draft signature before and after changing only `comment`. Give the fake node `value`, `selectionStart`, `selectionEnd`, and `scrollTop` fields, reconcile the second descriptor, and assert the same object and browser-owned fields remain unchanged while the descriptor renderer is not called.

- [ ] **Step 3: Run the focused tests and witness RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPageRenderSignature.test.js .test-dist/tests/sidebarItemReconciler.test.js
```

Expected: FAIL because `getDraftIdentity()` still hashes `draft.comment`, making reconciliation replace the draft node.

- [ ] **Step 4: Remove mutable body text from structural identity**

Change `getDraftIdentity()` to end with the structural thread relationship:

```ts
return [
    "draft",
    draft.id,
    draft.filePath,
    draft.startLine,
    draft.startChar,
    draft.endLine,
    draft.endChar,
    draft.selectedTextHash,
    draft.timestamp,
    draft.anchorKind ?? "",
    draft.orphaned === true ? 1 : 0,
    draft.deletedAt ?? "",
    draft.mode,
    draft.threadId ?? "",
].join("|");
```

Do not change persisted thread-entry, agent-run, or script-run identities.

- [ ] **Step 5: Run the focused tests and witness GREEN**

Run the Step 3 commands. Expected: all focused tests pass.

- [ ] **Step 6: Commit structural identity**

```bash
git add src/ui/views/sidebarPageRenderSignature.ts tests/sidebarPageRenderSignature.test.ts tests/sidebarItemReconciler.test.ts
git commit -m "fix(sidebar): keep draft nodes stable"
```

### Task 2: Preserve nested editors during thread replacement

**Files:**
- Modify: `tests/sidebarItemReconciler.test.ts`
- Create: `tests/sidebarDraftEditorHandoff.test.ts`
- Modify: `src/ui/views/sidebarItemReconciler.ts:28-83`
- Create: `src/ui/views/sidebarDraftEditorHandoff.ts`
- Modify: `src/ui/views/AsideView.ts:2238-2250,2517-2528`

- [ ] **Step 1: Write the failing connected-handoff test**

Extend the reconciler test callback to capture connection state:

```ts
const connectionStates: Array<[boolean, boolean]> = [];

await reconcileSidebarItems(container as unknown as HTMLElement, descriptors, {
    onReplaceThread: (_threadId, previous, next) => {
        connectionStates.push([previous.isConnected, next.isConnected]);
        return true;
    },
});

assert.deepEqual(connectionStates, [[true, true]]);
```

Expected under current behavior: the new node is still detached when the callback runs.

- [ ] **Step 2: Write failing nested handoff tests**

Build synthetic old and new thread trees containing matching `[data-draft-id]` nodes. Cover both append-card and inline-edit shapes. Assert:

```ts
assert.equal(handoffSidebarDraftEditor(previousThread, nextThread), true);
assert.equal(nextThread.querySelector("[data-draft-id]"), mountedDraft);
assert.equal(mountedDraft.value, "unsaved text");
assert.equal(mountedDraft.selectionStart, 4);
assert.equal(mountedDraft.scrollTop, 18);
```

Add mismatch and disconnected cases that return `false` and leave both trees unchanged.

- [ ] **Step 3: Run the focused tests and witness RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarItemReconciler.test.js .test-dist/tests/sidebarDraftEditorHandoff.test.js
```

Expected: FAIL because the handoff module does not exist and replacement callbacks run before insertion.

- [ ] **Step 4: Move replacement callbacks after insertion**

In `reconcileSidebarItems()`, keep collecting replacement pairs, insert every desired node first, then call `onReplaceThread`, and finally remove undesired old nodes. Preserve the existing `onRemoveThread` behavior when the callback does not retain its controller.

- [ ] **Step 5: Implement one shared draft-subtree handoff**

Create:

```ts
export function handoffSidebarDraftEditor(
    previousThreadEl: HTMLElement,
    nextThreadEl: HTMLElement,
): boolean {
    const previousDraft = previousThreadEl.querySelector<HTMLElement>("[data-draft-id]");
    const nextDraft = nextThreadEl.querySelector<HTMLElement>("[data-draft-id]");
    if (
        !previousDraft
        || !nextDraft
        || !previousDraft.isConnected
        || !nextDraft.isConnected
        || previousDraft.dataset.draftId !== nextDraft.dataset.draftId
    ) {
        return false;
    }

    nextDraft.replaceWith(previousDraft);
    return true;
}
```

Use this helper in both note and Index `onReplaceThread` adapters before handing off streamed-reply controllers. The callback return value remains owned by the stream-controller handoff.

- [ ] **Step 6: Run the focused tests and witness GREEN**

Run the Step 3 commands. Expected: all focused tests pass.

- [ ] **Step 7: Re-run the change-surface search**

Run:

```bash
rg -n "onReplaceThread|data-draft-id|handoffSidebarDraftEditor" src tests
```

Expected: one shared draft-handoff implementation, two thin `AsideView` adapters, and intentional tests only.

- [ ] **Step 8: Commit nested preservation**

```bash
git add src/ui/views/sidebarItemReconciler.ts src/ui/views/sidebarDraftEditorHandoff.ts src/ui/views/AsideView.ts tests/sidebarItemReconciler.test.ts tests/sidebarDraftEditorHandoff.test.ts
git commit -m "fix(sidebar): preserve nested draft editors"
```

### Task 3: Make draft text visibility fail open

**Files:**
- Modify: `tests/sidebarDraftComment.test.ts`
- Create: `tests/sidebarDraftVisibilityStyles.test.mjs`
- Modify: `src/ui/views/sidebarDraftComment.ts:296-322,383-417`
- Modify: `styles.css:3094-3161`

- [ ] **Step 1: Write failing preview-readiness tests**

Export a pure `isDraftPreviewReady()` seam and first write its required behavior:

```ts
test("draft preview readiness never hides nonempty textarea text behind an empty preview", () => {
    assert.equal(isDraftPreviewReady("draft text", "draft text"), true);
    assert.equal(isDraftPreviewReady("draft text", ""), false);
    assert.equal(isDraftPreviewReady("", "add a comment"), true);
});
```

- [ ] **Step 2: Write the failing wiring and stylesheet contract test**

Read `sidebarDraftComment.ts` and `styles.css` from `tests/sidebarDraftVisibilityStyles.test.mjs`. Assert that blur calls `syncPreview`, base textarea text is normal, and transparency applies only under the same ready-and-blurred selector that makes the preview visible:

```js
assert.match(source, /textarea\.addEventListener\("blur", syncPreview\)/);
assert.match(styles, /\.aside-inline-textarea\s*\{[\s\S]*?color:\s*var\(--text-normal\)/);
assert.match(styles, /\.aside-inline-editor-shell\.is-preview-ready:not\(:focus-within\) \.aside-inline-textarea/);
assert.match(styles, /\.aside-inline-editor-shell\.is-preview-ready:not\(:focus-within\) \.aside-inline-editor-preview/);
```

- [ ] **Step 3: Run the focused tests and witness RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarDraftComment.test.js
node --test tests/sidebarDraftVisibilityStyles.test.mjs
```

Expected: FAIL because preview readiness and blur synchronization are not implemented and base textarea text is transparent.

- [ ] **Step 4: Implement preview readiness and blur synchronization**

Add:

```ts
export function isDraftPreviewReady(value: string, renderedText: string): boolean {
    return value.length === 0 || renderedText.length > 0;
}
```

At the start of `syncPreview()`, remove `is-preview-ready`. After rendering, toggle it from `isDraftPreviewReady(textarea.value, preview.textContent ?? "")`. Register `textarea.addEventListener("blur", syncPreview)` for every platform, while keeping the mobile blur listener responsible only for its viewport cleanup.

- [ ] **Step 5: Make CSS switch both layers atomically**

Use visible textarea text and a hidden preview as defaults:

```css
.aside-inline-editor-preview {
    visibility: hidden;
}

.aside-inline-textarea {
    color: var(--text-normal);
    -webkit-text-fill-color: var(--text-normal);
}

.aside-inline-editor-shell.is-preview-ready:not(:focus-within) .aside-inline-editor-preview {
    visibility: visible;
}

.aside-inline-editor-shell.is-preview-ready:not(:focus-within) .aside-inline-textarea {
    color: transparent;
    -webkit-text-fill-color: transparent;
}
```

Keep focus border, caret, placeholder, sizing, and selection styling unchanged. Remove the old independent focus-within preview-hiding and base textarea-transparency declarations.

- [ ] **Step 6: Run the focused tests and witness GREEN**

Run the Step 3 commands. Expected: all focused tests pass.

- [ ] **Step 7: Commit fail-open visibility**

```bash
git add src/ui/views/sidebarDraftComment.ts styles.css tests/sidebarDraftComment.test.ts tests/sidebarDraftVisibilityStyles.test.mjs
git commit -m "fix(editor): prevent blank draft text"
```

### Task 4: Verify, document, build, and install

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-stable-draft-editor-reconciliation-design.md`

- [ ] **Step 1: Run focused regressions together**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPageRenderSignature.test.js .test-dist/tests/sidebarItemReconciler.test.js .test-dist/tests/sidebarDraftEditorHandoff.test.js .test-dist/tests/sidebarDraftComment.test.js
node --test tests/sidebarDraftVisibilityStyles.test.mjs
```

Expected: all focused tests pass with no warnings or errors.

- [ ] **Step 2: Run the complete production verification**

```bash
npm run build
```

Expected: complete tests, lint, typecheck, Obsidian compliance, production bundle, bundle-size guard, and release-artifact guard all pass.

- [ ] **Step 3: Update the tracked spec**

Mark implementation and verification items complete only for behavior proven by Steps 1 and 2. Record the exact focused suites, build result, and privacy check in `Self-Review`. Keep live installation unchecked until artifact comparison succeeds.

- [ ] **Step 4: Inspect the exact development artifact before installation**

Run:

```bash
npm run release:artifacts:check
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name '*.map' -o -name '*.ts' -o -name '*.tsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
```

Expected: artifact guard passes; exposure scans return no shipped source maps, embedded source markers, raw source files, or obvious secret-bearing files.

- [ ] **Step 5: Install into `lean-startup` and reload Aside**

```bash
node scripts/install-built-plugin.mjs --vault ../../lean-startup
obsidian vault=lean-startup plugin:reload id=aside
```

Expected: installer copies `main.js`, `manifest.json`, and `styles.css`; Obsidian reloads Aside successfully.

- [ ] **Step 6: Compare installed artifacts and inspect runtime errors**

```bash
cmp -s main.js ../../lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json ../../lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css ../../lean-startup/.obsidian/plugins/aside/styles.css
obsidian vault=lean-startup dev:errors
```

Expected: all three comparisons exit zero and no Aside runtime errors are reported.

- [ ] **Step 7: Complete the spec and commit verification**

Mark the live-install verification item complete, then run:

```bash
git diff --check
git status --short
git add docs/superpowers/specs/2026-09-07-stable-draft-editor-reconciliation-design.md
git commit -m "docs(sidebar): complete draft stability"
```

Expected: clean formatting and one documentation commit containing the final evidence.

## Plan Self-Review

- Spec coverage: every unchecked implementation item maps to Tasks 1-3; every verification item maps to Task 4.
- Tracking coverage: top-level stability, nested handoff, fail-open preview, live agent/script updates, build, and installed artifact comparison all have explicit checks.
- Placeholder scan: no deferred steps, vague error-handling requests, or unresolved implementation choices remain.
- Type consistency: draft IDs use `HTMLElement.dataset.draftId`; the shared handoff takes old and new thread roots; existing `onReplaceThread` continues returning stream-controller retention.
- Scope: no persistence, storage schema, provider routing, comment ordering, or automatic navigation behavior changes.
- Privacy: examples use synthetic paths, IDs, and bodies; release scans inspect artifacts without embedding local user data.
