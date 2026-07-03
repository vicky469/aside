# PDF Page Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reintroduce PDF page notes using current Aside sidecar/sync storage, without restoring the old attachment-comment storage path.

**Architecture:** Split file capabilities into markdown text anchors, PDF/markdown page notes, and sidebar support. PDF comments use a sidecar/sync-only persistence path that never reads or parses PDF bytes. Mutation and lifecycle gates branch by `anchorKind`, so markdown anchors stay markdown-only while PDF page-note threads can be created, edited, replied to, deleted, pinned, reordered, renamed, and indexed.

**Tech Stack:** TypeScript, Obsidian `TFile`, Node test runner, existing Aside sidecar/sync storage, existing `CommentManager` and `AggregateCommentIndex`.

---

### Task 1: Capability Rules And Sidebar Targeting

**Files:**
- Modify: `src/core/rules/commentableFiles.ts`
- Modify: `tests/commentableFiles.test.ts`
- Modify: `tests/sidebarIndexContext.test.ts`
- Modify: `tests/sidebarViewFileNormalization.test.ts`
- Modify: `tests/workspaceContextController.test.ts`

- [ ] **Step 1: Write failing capability tests**

Update `tests/commentableFiles.test.ts` so PDFs are page-note-capable and sidebar-supported, but not markdown-commentable:

```ts
import {
    isMarkdownCommentablePath,
    isPageNoteCapablePath,
    isPdfPageNotePath,
    isSidebarSupportedPath,
} from "../src/core/rules/commentableFiles";

assert.equal(isMarkdownCommentablePath("docs/paper.pdf"), false);
assert.equal(isPdfPageNotePath("docs/paper.pdf"), true);
assert.equal(isPageNoteCapablePath("docs/paper.pdf"), true);
assert.equal(isSidebarSupportedPath("docs/paper.pdf"), true);
assert.equal(isPageNoteCapablePath("docs/report.docx"), false);
assert.equal(isSidebarSupportedPath("docs/report.docx"), false);
```

- [ ] **Step 2: Write failing sidebar planning tests**

Update PDF expectations in `tests/sidebarIndexContext.test.ts`, `tests/sidebarViewFileNormalization.test.ts`, and `tests/workspaceContextController.test.ts` so active PDFs become sidebar targets and normalized sidebar files.

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentableFiles.test.js .test-dist/tests/sidebarIndexContext.test.js .test-dist/tests/sidebarViewFileNormalization.test.js .test-dist/tests/workspaceContextController.test.js
```

Expected: fail because PDF capability helpers are missing or still return unsupported.

- [ ] **Step 3: Implement file capability helpers**

In `src/core/rules/commentableFiles.ts`, add:

```ts
export function isPdfPageNotePath(filePath: string, allCommentsNotePath?: string): boolean {
    return /\.pdf$/i.test(filePath) && !isAllCommentsNotePath(filePath, allCommentsNotePath);
}

export function isPageNoteCapablePath(filePath: string, allCommentsNotePath?: string): boolean {
    return isMarkdownCommentablePath(filePath, allCommentsNotePath)
        || isPdfPageNotePath(filePath, allCommentsNotePath);
}

export function isPageNoteCapableFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isPageNoteCapablePath(file.path, allCommentsNotePath);
}
```

Change `isSidebarSupportedPath` to include `isPageNoteCapablePath`.

- [ ] **Step 4: Run capability/sidebar tests**

Run the same focused command from Step 2.

Expected: the focused tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/core/rules/commentableFiles.ts tests/commentableFiles.test.ts tests/sidebarIndexContext.test.ts tests/sidebarViewFileNormalization.test.ts tests/workspaceContextController.test.ts
git commit -m "feat(sidebar): support PDF page-note targets"
```

### Task 2: PDF Page Drafts And Mutation Gates

**Files:**
- Modify: `src/comments/commentEntryController.ts`
- Modify: `src/comments/commentMutationController.ts`
- Modify: `src/main.ts`
- Modify: `tests/commentEntryController.test.ts`
- Modify: `tests/commentMutationController.test.ts`

- [ ] **Step 1: Write failing entry-controller tests**

In `tests/commentEntryController.test.ts`, change the existing PDF page-draft test to expect success:

```ts
test("comment entry controller starts page drafts for PDF files", async () => {
    const host = createHost();
    const file = createFile("docs/diagram.pdf");

    const started = await host.controller.startPageCommentDraft(file);

    assert.equal(started, true);
    assert.deepEqual(host.loadedFiles, []);
    assert.deepEqual(host.markedFiles, [file.path]);
    assert.equal(host.draftCalls.length, 1);
    assert.deepEqual(host.highlightedCommentIds, ["comment-1"]);
    assert.equal(host.draftCalls[0].draft?.anchorKind, "page");
    assert.equal(host.draftCalls[0].draft?.filePath, file.path);
    assert.equal(host.draftCalls[0].draft?.selectedText, "diagram");
});
```

- [ ] **Step 2: Write failing mutation tests**

In `tests/commentMutationController.test.ts`, extend the host with `isPageNoteCapableFile`. Add tests proving PDF page-note drafts save without reading note content and PDF page-note replies/edit/delete persist to the PDF path:

```ts
test("comment mutation controller saves a PDF page-note draft without reading PDF content", async () => {
    const draft = toDraft(createComment({
        id: "pdf-draft",
        filePath: "docs/diagram.pdf",
        selectedText: "diagram",
        selectedTextHash: "",
        comment: "  PDF note  ",
        anchorKind: "page",
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        extraFiles: [draft.filePath],
        getCurrentNoteContent: async () => {
            throw new Error("PDF content must not be read");
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getCommentsForFile(draft.filePath)[0]?.comment, "PDF note");
    assert.deepEqual(host.persistedFiles.map((file) => file.path), [draft.filePath]);
    assert.deepEqual(host.persistedFiles[0], {
        path: draft.filePath,
        immediateAggregateRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    });
});
```

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentEntryController.test.js .test-dist/tests/commentMutationController.test.js
```

Expected: fail because page drafts and mutations still require markdown.

- [ ] **Step 3: Implement page-note capability gates**

Add `isPageNoteCapableFile` to entry and mutation hosts. In `CommentEntryController`, use it for `startPageCommentDraft` and for `startNewCommentDraft` when `anchorKind === "page"`. In `CommentMutationController`, add helpers:

```ts
private isValidSourceFileForComment(file: TFile | null, comment: Pick<Comment | DraftComment, "anchorKind">): file is TFile {
    return comment.anchorKind === "page"
        ? this.host.isPageNoteCapableFile(file)
        : this.host.isCommentableFile(file);
}

private buildPageNotePersistOptions(options: PersistOptions = {}): PersistOptions {
    return {
        ...options,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    };
}
```

Use those helpers in add, edit, append, delete, restore, clear, pin, reorder, and save-draft paths where the operation target is a page-note thread.

- [ ] **Step 4: Wire the plugin host**

In `src/main.ts`, import `isPageNoteCapableFile` and expose it to `CommentEntryController` and `CommentMutationController`. Keep private `isCommentableFile` markdown-only.

- [ ] **Step 5: Run entry/mutation tests**

Run the focused command from Step 2.

Expected: pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/comments/commentEntryController.ts src/comments/commentMutationController.ts src/main.ts tests/commentEntryController.test.ts tests/commentMutationController.test.ts
git commit -m "feat(comments): allow PDF page-note drafts"
```

### Task 3: PDF Sidecar Persistence Without PDF Reads

**Files:**
- Modify: `src/comments/commentPersistenceController.ts`
- Modify: `src/main.ts`
- Modify: `tests/commentPersistenceExternalSync.test.ts`

- [ ] **Step 1: Write failing persistence tests**

In `tests/commentPersistenceExternalSync.test.ts`, add tests that load and persist PDF page-note threads from sidecar/sync storage while `getCurrentNoteContent` throws for PDFs.

Expected test shape:

```ts
test("comment persistence controller loads PDF page-note sidecars without reading PDF content", async () => {
    const file = createFile("docs/scan.pdf");
    const adapter = createAdapter();
    adapter.files.set(getSidecarStoragePath(file.path), serializeSidecarThreads(file.path, [
        createThread(file.path, { anchorKind: "page", selectedText: "scan" }),
    ]));
    const controller = new CommentPersistenceController(createPersistenceHost({
        adapter,
        files: [file],
        isPageNoteCapableFile: (candidate) => !!candidate && candidate.extension === "pdf",
        getCurrentNoteContent: async () => {
            throw new Error("PDF content must not be read");
        },
    }));

    const comments = await controller.loadCommentsForFile(file);

    assert.equal(comments.length, 1);
    assert.equal(comments[0].filePath, file.path);
});
```

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentPersistenceExternalSync.test.js
```

Expected: fail because persistence still returns early for non-markdown or reads source content.

- [ ] **Step 2: Add PDF load/write path**

Extend `CommentPersistenceHost` with `isPageNoteCapableFile`. Add helpers inside `CommentPersistenceController`:

```ts
private async ensureSourceIdentityForStoredPath(filePath: string): Promise<SourceIdentityRecord> {
    return this.ensureSourceIdentityForFilePath(filePath);
}

private async loadStoredPageNoteThreadsForFile(file: TFile): Promise<Comment[]> {
    await this.replaySyncedSideNoteEvents(file.path);
    const sourceRecord = await this.ensureSourceIdentityForStoredPath(file.path);
    const sidecarResult = await this.readSourceOrPathSidecar(sourceRecord, file.path);
    const threads = await this.normalizeThreadsForFile(file.path, sidecarResult?.threads ?? []);
    this.host.getCommentManager().replaceThreadsForFile(file.path, threads);
    this.host.getAggregateCommentIndex().updateFile(file.path, threads.map((thread) => threadToComment(thread)));
    return threads.flatMap((thread) => thread.entries.map((entry) => threadToComment({ ...thread, entries: [entry] })));
}
```

Branch `loadCommentsForFile`:

- `isCommentableFile(file)`: current markdown path.
- `isPageNoteCapableFile(file)`: PDF sidecar/sync-only path.
- otherwise return `[]`.

Branch `writeCommentsForFile` similarly:

- markdown uses current content parsing path.
- PDF builds event diffs from existing sidecar/sync threads and writes normalized current manager threads directly.

- [ ] **Step 3: Wire persistence host**

In `src/main.ts`, expose `isPageNoteCapableFile` to `CommentPersistenceController`.

- [ ] **Step 4: Run persistence tests**

Run the focused command from Step 1.

Expected: pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/comments/commentPersistenceController.ts src/main.ts tests/commentPersistenceExternalSync.test.ts
git commit -m "feat(persistence): store PDF page notes in sidecars"
```

### Task 4: Lifecycle, Index Refresh, And Spec Tracking

**Files:**
- Modify: `src/app/pluginLifecycleController.ts`
- Modify: `src/main.ts`
- Modify: `tests/pluginLifecycleController.test.ts`
- Modify: `tests/indexSidebarState.test.ts`
- Modify: `docs/superpowers/specs/2026-07-03-pdf-page-notes-design.md`

- [ ] **Step 1: Write failing lifecycle tests**

In `tests/pluginLifecycleController.test.ts`, add tests for PDF delete and folder delete using a page-note-capable host predicate. Expect PDF stored comments and aggregate index entries to clear.

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/pluginLifecycleController.test.js .test-dist/tests/indexSidebarState.test.js
```

Expected: fail because lifecycle delete still uses markdown-only `isCommentableFile`.

- [ ] **Step 2: Implement lifecycle page-note capability**

Add `isPageNoteCapableFile` to `PluginLifecycleHost`. Use it for delete/folder cleanup collection. Keep `handleMarkdownFileModified` markdown-only.

Wire `src/main.ts` to pass `isPageNoteCapableFile`.

- [ ] **Step 3: Update spec tracking**

After focused tests pass, update `docs/superpowers/specs/2026-07-03-pdf-page-notes-design.md` checkboxes for implemented and verified items. Leave `npm run build` unchecked until the full build passes.

- [ ] **Step 4: Run lifecycle/index tests**

Run the focused command from Step 1.

Expected: pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/app/pluginLifecycleController.ts src/main.ts tests/pluginLifecycleController.test.ts tests/indexSidebarState.test.ts docs/superpowers/specs/2026-07-03-pdf-page-notes-design.md
git commit -m "feat(lifecycle): index PDF page notes"
```

### Task 5: Full Verification And Release Safety

**Files:**
- Modify only if verification exposes issues.

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: all TypeScript tests, `.mjs` tests, lint, typecheck, and production build pass.

- [ ] **Step 2: Run release artifact inspection**

```bash
node scripts/check-release-artifacts.mjs
```

Expected: `Release artifact inspection passed for main.js, manifest.json, styles.css`.

- [ ] **Step 3: Mark final spec verification**

Check off `npm run build` and any remaining verified checklist items in `docs/superpowers/specs/2026-07-03-pdf-page-notes-design.md`.

- [ ] **Step 4: Commit final verification doc update**

```bash
git add docs/superpowers/specs/2026-07-03-pdf-page-notes-design.md
git commit -m "docs(spec): mark PDF page notes complete"
```

- [ ] **Step 5: Final status**

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected: feature branch is clean with implementation commits on top of `b7a1e3e`.
