# Trailing-Newline Anchor Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve a Markdown note's trailing newline and whitespace during anchor synchronization so full-file selections remain anchored and matching false orphans recover automatically.

**Architecture:** Keep exact-match anchor semantics unchanged. Change the single source-normalization boundary used by `parseNoteComments` to normalize only CRLF line endings, then exercise the real parser-to-sync path in regression tests so both new anchors and persisted false orphans are covered.

**Tech Stack:** TypeScript, Node test runner, Obsidian plugin sidecar persistence, esbuild, ESLint.

---

### Task 1: Lock the reported parser-to-synchronization failure with red tests

**Files:**
- Modify: `tests/noteCommentStorage.test.ts`
- Modify: `tests/commentSyncPolicy.test.ts`

- [ ] **Step 1: Replace the parser contract test with source-ending preservation**

Change the first parser test to:

```ts
test("parseNoteComments preserves the source ending while normalizing CRLF", () => {
    const parsed = parseNoteComments("# Title\r\n\r\nBody  \r\n", "note.md");

    assert.equal(parsed.mainContent, "# Title\n\nBody  \n");
    assert.deepEqual(parsed.comments, []);
    assert.deepEqual(parsed.threads, []);
});
```

- [ ] **Step 2: Import the real parser into the synchronization tests**

Add:

```ts
import { parseNoteComments } from "../src/core/storage/noteCommentStorage";
```

- [ ] **Step 3: Add a full-file selection regression test**

Add:

```ts
test("syncLoadedCommentsForCurrentNote keeps a full-file trailing-newline anchor attached", async () => {
    const noteContent = "Alpha target omega\n";
    const parsed = parseNoteComments(noteContent, "note.md");
    const manager = new CommentManager([]);

    const syncedState = await syncLoadedCommentsForCurrentNote(
        "note.md",
        parsed.mainContent,
        [commentToThread(createComment({
            startLine: 0,
            startChar: 0,
            endLine: 1,
            endChar: 0,
            selectedText: noteContent,
            selectedTextHash: "hash-full-file",
            orphaned: false,
        }))],
        manager,
        { updateFile: () => {} },
    );

    assert.equal(syncedState.threads[0]?.orphaned, false);
    assert.equal(syncedState.comments[0]?.selectedText, noteContent);
    assert.equal(syncedState.comments[0]?.endLine, 1);
    assert.equal(syncedState.comments[0]?.endChar, 0);
});
```

- [ ] **Step 4: Add a matching false-orphan recovery regression test**

Add:

```ts
test("syncLoadedCommentsForCurrentNote heals a matching trailing-newline false orphan", async () => {
    const noteContent = "Alpha target omega\n";
    const parsed = parseNoteComments(noteContent, "note.md");
    const manager = new CommentManager([]);

    const syncedState = await syncLoadedCommentsForCurrentNote(
        "note.md",
        parsed.mainContent,
        [commentToThread(createComment({
            startLine: 0,
            startChar: 0,
            endLine: 1,
            endChar: 0,
            selectedText: noteContent,
            selectedTextHash: "hash-full-file",
            orphaned: true,
        }))],
        manager,
        { updateFile: () => {} },
    );

    assert.equal(syncedState.threads[0]?.orphaned, false);
    assert.equal(manager.getCommentsForFile("note.md")[0]?.orphaned, false);
});
```

- [ ] **Step 5: Compile and run the focused tests to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "source ending|full-file trailing-newline|trailing-newline false orphan" .test-dist/tests/noteCommentStorage.test.js .test-dist/tests/commentSyncPolicy.test.js
```

Expected: three failures. The parser omits `"  \n"`; both synchronization tests report `orphaned: true` because `parseNoteComments` shortened the anchor source.

- [ ] **Step 6: Commit the proven failing regressions**

```bash
git add tests/noteCommentStorage.test.ts tests/commentSyncPolicy.test.ts
git commit -m "test: reproduce trailing newline orphaning"
```

### Task 2: Preserve exact source endings at the parser boundary

**Files:**
- Modify: `src/core/storage/noteCommentStorage.ts`

- [ ] **Step 1: Implement the minimal normalization change**

Change `normalizeSourceContent` to:

```ts
function normalizeSourceContent(noteContent: string): string {
    return noteContent.replace(/\r\n/g, "\n");
}
```

- [ ] **Step 2: Re-run the focused regressions to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "source ending|full-file trailing-newline|trailing-newline false orphan" .test-dist/tests/noteCommentStorage.test.js .test-dist/tests/commentSyncPolicy.test.js
```

Expected: all three matching tests pass with zero failures.

- [ ] **Step 3: Verify genuine missing-text anchors remain orphaned**

Run:

```bash
node --test .test-dist/tests/noteCommentStorage.test.js .test-dist/tests/commentSyncPolicy.test.js .test-dist/tests/anchorResolver.test.js .test-dist/tests/commentManager.idTargeting.test.js
```

Expected: all parser, synchronization, resolver, and manager tests pass, including existing tests that keep absent selections orphaned.

- [ ] **Step 4: Commit the production fix**

```bash
git add src/core/storage/noteCommentStorage.ts
git commit -m "fix: preserve source endings for anchors"
```

### Task 3: Verify, record, and integrate the fix

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-trailing-newline-anchor-design.md`
- Modify: `docs/superpowers/plans/2026-08-20-trailing-newline-anchor.md`

- [ ] **Step 1: Run the complete repository test suite**

```bash
npm test
```

Expected: all compiled and contract tests pass with zero failures.

- [ ] **Step 2: Run the production build and release-artifact guard**

```bash
npm run build
```

Expected: lint, typecheck, Obsidian compliance, bundle, and artifact inspection pass. The exact public artifact set is `main.js`, `manifest.json`, and `styles.css`, with no source map, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family sources, or secret-bearing files.

- [ ] **Step 3: Update implementation tracking**

Mark the implementation and feature-branch verification items complete in the design spec and this plan. Leave integration cleanup pending until it has occurred.

- [ ] **Step 4: Review the branch diff**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short --branch
```

Expected: only the parser, targeted tests, and tracked design/plan files differ.

- [ ] **Step 5: Commit tracking updates**

```bash
git add -f docs/superpowers/specs/2026-08-20-trailing-newline-anchor-design.md docs/superpowers/plans/2026-08-20-trailing-newline-anchor.md
git commit -m "docs: record trailing newline anchor verification"
```

- [ ] **Step 6: Use the finishing-a-development-branch workflow**

Merge `fix/trailing-newline-anchor-orphaning` locally into the current `main` without pushing, re-run `npm run build` on the merged result, remove the clean merged worktree/branch, and record final integration status. If `main` changed after the branch point, inspect and preserve all newer work before merging.
