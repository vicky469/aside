# Clipboard Regression Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable automated coverage for Aside's deterministic clipboard contract and document the remaining platform-specific manual checks.

**Architecture:** Extend the existing pure paste, clipboard-writer, and selection test suites. Add one Obsidian-runtime-free adapter that composes comment URI generation with an injected clipboard writer, then route the existing Share side note action through it. Keep OS permissions, pop-out focus, and mobile clipboard behavior in a release-candidate manual matrix.

**Tech Stack:** TypeScript, Node.js test runner, Obsidian API typings, npm build pipeline.

---

### Task 1: Complete paste and selection characterization coverage

**Files:**
- Modify: `tests/commentEditorPaste.test.ts`
- Modify: `tests/sidebarClipboardSelection.test.ts`

- [ ] **Step 1: Add paste-planner characterization cases**

Append cases that exercise selection replacement and caret placement, normalization, equivalent rich/plain fallback, and converter failure:

```ts
test("createDraftPasteEdit replaces the selected range with normalized rich Markdown", () => {
    const edit = createDraftPasteEdit(
        "Before OLD After",
        7,
        10,
        clipboardData({
            "text/html": "<p>New&nbsp;line</p>",
            "text/plain": "Different plain text",
        }),
        () => "\r\nNew\u00a0line\r\n",
    );

    assert.deepEqual(edit, {
        value: "Before New line After",
        selectionStart: 15,
        selectionEnd: 15,
    });
});

test("createDraftPasteEdit lets native paste handle equivalent rich and plain text", () => {
    assert.equal(createDraftPasteEdit(
        "Draft",
        5,
        5,
        clipboardData({
            "text/html": "<p>Same&nbsp;text</p>",
            "text/plain": "Same text",
        }),
        () => "Same\u00a0text",
    ), null);
});

test("createDraftPasteEdit lets native paste continue when HTML conversion fails", () => {
    assert.equal(createDraftPasteEdit(
        "Draft",
        5,
        5,
        clipboardData({ "text/html": "<strong>Text</strong>" }),
        () => { throw new Error("conversion failed"); },
    ), null);
});
```

- [ ] **Step 2: Run the paste tests as characterization evidence**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentEditorPaste.test.js
```

Expected: all paste tests pass because these cases lock down existing behavior rather than introduce production behavior.

- [ ] **Step 3: Add the missing sidebar boundary cases**

Append:

```ts
test("getSelectedSidebarClipboardText returns null for empty selected text", () => {
    assert.equal(getSelectedSidebarClipboardText({
        isCollapsed: false,
        selectedText: "",
        anchorInsideSidebar: true,
        focusInsideSidebar: true,
    }), null);
});

test("getSelectedSidebarClipboardText rejects a selection entering the sidebar", () => {
    assert.equal(getSelectedSidebarClipboardText({
        isCollapsed: false,
        selectedText: "cross-boundary",
        anchorInsideSidebar: false,
        focusInsideSidebar: true,
    }), null);
});
```

- [ ] **Step 4: Run the selection tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarClipboardSelection.test.js
```

Expected: all selection tests pass.

- [ ] **Step 5: Commit the characterization coverage**

```bash
git add tests/commentEditorPaste.test.ts tests/sidebarClipboardSelection.test.ts
git commit -m "test: cover clipboard paste boundaries"
```

### Task 2: Complete clipboard-writer failure and cleanup coverage

**Files:**
- Modify: `tests/copyTextToClipboard.test.ts`

- [ ] **Step 1: Extend the fake textarea and document observations**

Record whether a fallback document was asked to create a textarea and retain the existing focus, selection, attribute, style, range, and removal observations:

```ts
function createFakeDocument(execCommandResult: boolean, execCommandError?: Error) {
    const appended: FakeTextarea[] = [];
    let createCount = 0;
    const doc: CopyTextDocument = {
        createAttachedTextarea() {
            createCount += 1;
            const textarea = new FakeTextarea();
            appended.push(textarea);
            return textarea;
        },
        execCommand(command: "copy") {
            assert.equal(command, "copy");
            if (execCommandError) throw execCommandError;
            return execCommandResult;
        },
    };
    return { doc, appended, getCreateCount: () => createCount };
}
```

- [ ] **Step 2: Add async/fallback and cleanup cases**

Add focused cases proving that async success skips the document, async rejection falls back, false is returned on `execCommand` failure, and thrown fallback errors still remove the textarea:

```ts
test("copyTextToClipboard falls back after async clipboard rejection", async () => {
    const { doc, appended } = createFakeDocument(true);
    const copied = await copyTextToClipboard("Fallback text", {
        clipboard: { async writeText() { throw new Error("denied"); } },
        activeDocument: doc,
    });
    assert.equal(copied, true);
    assert.equal(appended[0].removed, true);
});

test("copyTextToClipboard configures and removes the fallback textarea", async () => {
    const { doc, appended } = createFakeDocument(false);
    assert.equal(await copyTextToClipboard("Fallback text", {
        clipboard: null,
        activeDocument: doc,
    }), false);
    assert.equal(appended[0].attributes.get("readonly"), "true");
    assert.equal(appended[0].cssProps.position, "fixed");
    assert.equal(appended[0].focused, true);
    assert.equal(appended[0].selected, true);
    assert.deepEqual(appended[0].selectionRange, [0, "Fallback text".length]);
    assert.equal(appended[0].removed, true);
});

test("copyTextToClipboard removes the textarea when execCommand throws", async () => {
    const { doc, appended } = createFakeDocument(false, new Error("copy failed"));
    assert.equal(await copyTextToClipboard("Fallback text", {
        clipboard: null,
        activeDocument: doc,
    }), false);
    assert.equal(appended[0].removed, true);
});
```

- [ ] **Step 3: Run the clipboard-writer tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/copyTextToClipboard.test.js
```

Expected: all clipboard-writer tests pass and no production change is necessary.

- [ ] **Step 4: Commit the writer coverage**

```bash
git add tests/copyTextToClipboard.test.ts
git commit -m "test: cover clipboard fallback cleanup"
```

### Task 3: Test and wire the comment-location copy adapter

**Files:**
- Create: `src/ui/copyCommentLocationToClipboard.ts`
- Create: `tests/copyCommentLocationToClipboard.test.ts`
- Modify: `src/ui/views/AsideView.ts`

- [ ] **Step 1: Write the failing adapter tests**

Create `tests/copyCommentLocationToClipboard.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { copyCommentLocationToClipboard } from "../src/ui/copyCommentLocationToClipboard";

test("copyCommentLocationToClipboard writes the exact encoded Aside URI", async () => {
    const writes: string[] = [];
    const copied = await copyCommentLocationToClipboard(
        "dev vault",
        { filePath: "Folder/My Note.md", id: "comment 1" },
        async (text) => { writes.push(text); return true; },
    );
    assert.equal(copied, true);
    assert.deepEqual(writes, [
        "obsidian://aside-comment?vault=dev%20vault&file=Folder%2FMy%20Note.md&commentId=comment%201",
    ]);
});

test("copyCommentLocationToClipboard returns writer failure", async () => {
    assert.equal(await copyCommentLocationToClipboard(
        "vault",
        { filePath: "Note.md", id: "comment" },
        async () => false,
    ), false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `src/ui/copyCommentLocationToClipboard.ts` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Create `src/ui/copyCommentLocationToClipboard.ts`:

```ts
import type { Comment } from "../commentManager";
import { buildCommentLocationUrl } from "../core/derived/allCommentsNote";

export type ClipboardTextWriter = (text: string) => Promise<boolean>;

export function copyCommentLocationToClipboard(
    vaultName: string,
    comment: Pick<Comment, "filePath" | "id">,
    writeText: ClipboardTextWriter,
): Promise<boolean> {
    return writeText(buildCommentLocationUrl(vaultName, comment));
}
```

- [ ] **Step 4: Run the adapter tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/copyCommentLocationToClipboard.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Route the share action through the tested adapter**

In `src/ui/views/AsideView.ts`, replace the direct URI composition with:

```ts
import { copyCommentLocationToClipboard } from "../copyCommentLocationToClipboard";

shareComment: (persistedComment) => copyCommentLocationToClipboard(
    this.app.vault.getName(),
    persistedComment,
    copyTextToClipboard,
),
```

Remove the now-unused `buildCommentLocationUrl` import from `AsideView.ts`.

- [ ] **Step 6: Run adapter tests, typecheck, and lint**

Run:

```bash
npm run typecheck
npm run lint
node --test .test-dist/tests/copyCommentLocationToClipboard.test.js
```

Expected: all commands pass with zero warnings.

- [ ] **Step 7: Commit the adapter**

```bash
git add src/ui/copyCommentLocationToClipboard.ts src/ui/views/AsideView.ts tests/copyCommentLocationToClipboard.test.ts
git commit -m "test: cover side note link copying"
```

### Task 4: Document the platform matrix and verify the repository

**Files:**
- Create: `docs/testing/clipboard-manual-matrix.md`
- Modify: `docs/superpowers/specs/2026-07-17-clipboard-regression-tests-design.md`

- [ ] **Step 1: Add the manual matrix**

Create `docs/testing/clipboard-manual-matrix.md` with a release-candidate table covering Obsidian 1.12.7, Obsidian 1.13+, a desktop pop-out, and one mobile platform. Include plain/rich/Excalidraw paste, rendered selection copy, native draft copy, Share side note, denied async writes, and the harmless clipboard canary. Mark every row pending by default and state that automated tests do not satisfy these rows.

- [ ] **Step 2: Run the focused suite**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/commentEditorPaste.test.js \
  .test-dist/tests/copyTextToClipboard.test.js \
  .test-dist/tests/sidebarClipboardSelection.test.js \
  .test-dist/tests/copyCommentLocationToClipboard.test.js
```

Expected: all clipboard-focused tests pass.

- [ ] **Step 3: Run the complete build**

Run:

```bash
npm run build
```

Expected: plugin tests, script tests, Worker tests, lint, typecheck, compliance checks, bundle, and release-artifact guard all pass. Run with local-network and Wrangler-log permissions because the existing Worker suite requires them.

- [ ] **Step 4: Update only proven spec items**

Mark all implementation items complete after the focused and complete builds pass. Mark automated verification complete. Leave the actual manual platform executions unchecked; only mark the documentation-separation item complete.

- [ ] **Step 5: Inspect and commit the final diff**

Run:

```bash
git diff --check
git status --short
```

Then commit:

```bash
git add docs/testing/clipboard-manual-matrix.md docs/superpowers/specs/2026-07-17-clipboard-regression-tests-design.md
git commit -m "docs: add clipboard manual matrix"
```
