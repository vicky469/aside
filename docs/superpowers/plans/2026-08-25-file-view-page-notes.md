# File-View Page Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Aside create and manage page notes for every real vault file exposed by an Obsidian file-backed view, without adding preview support or widening Markdown-only text anchors.

**Architecture:** Keep one extension-independent page-note capability in `commentableFiles.ts`, then let the existing workspace, sidebar, persistence, and lifecycle paths consume it. Move the two remaining reorder mutations out of `main.ts` and through `CommentMutationController` so all page-note mutations use the same validation and non-Markdown refresh policy. Obsidian core or an installed viewer plugin remains the sole owner of source rendering.

**Tech Stack:** TypeScript 5.9, Obsidian API 1.13, Node test runner, ESLint, esbuild, sidecar JSON/sync-event persistence.

---

## Starting State

- Branch: `feature/file-view-page-notes`
- Worktree: `/Users/example/Obsidian/dev/aside/.worktrees/file-view-page-notes`
- Approved design: `docs/superpowers/specs/2026-08-25-file-view-page-notes-design.md`
- Baseline: `npm test` passes at commit `7eff819`.
- Scope guard: do not add a file view, extension registration, parser, converter, file-menu fallback, or setting. Do not widen selection anchors beyond Markdown. Do not change the publishing format policy or `/pdf-to-markdown`.

### Task 1: Make page-note capability extension-independent

**Files:**

- Modify: `tests/commentableFiles.test.ts`
- Modify: `src/core/rules/commentableFiles.ts`

- [ ] **Step 1: Write the failing capability matrix**

Replace the PDF/HTML/page-note assertions with table-driven coverage while retaining separate Markdown and HTML-format checks. Import and exercise the file wrappers as well as path helpers.

```ts
const pageNotePaths = [
    "notes/tmp.md",
    "docs/paper.pdf",
    "share/page.html",
    "media/image.PNG",
    "media/interview.m4a",
    "media/demo.mp4",
    "maps/strategy.canvas",
    "docs/proposal.docx",
    "LICENSE",
];

for (const filePath of pageNotePaths) {
    assert.equal(isPageNoteCapablePath(filePath), true, filePath);
    assert.equal(isSidebarSupportedPath(filePath), true, filePath);
}

assert.equal(isPageNoteCapablePath(""), false);
assert.equal(isPageNoteCapablePath(ALL_COMMENTS_NOTE_PATH), false);
assert.equal(isPageNoteCapablePath("Aside custom.md", "Aside custom.md"), false);
assert.equal(isPageNoteCapableFile(null), false);
assert.equal(isSidebarSupportedFile(null), false);
```

Keep `isHtmlPageNotePath` tests because HTML still has format-specific mutation behavior. Remove test imports and expectations for `isPdfPageNotePath`; it is not a policy after this change.

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentableFiles.test.js
```

Expected: failure on the first non-Markdown/PDF/HTML path, proving the old allowlist is still active.

- [ ] **Step 3: Replace the allowlist with the shared rule**

Implement the narrowest policy in `src/core/rules/commentableFiles.ts`:

```ts
export function isPageNoteCapablePath(filePath: string, allCommentsNotePath?: string): boolean {
    return filePath.length > 0 && !isAllCommentsNotePath(filePath, allCommentsNotePath);
}
```

Keep `isMarkdownCommentablePath` unchanged. Keep `isHtmlPageNotePath` unchanged. Delete `isPdfPageNotePath`. Leave `isSidebarSupportedPath` as index-or-page-note capability so the generated index retains its special mode.

- [ ] **Step 4: Run the focused test and confirm green**

Run the same focused command. Expected: all capability tests pass, including mixed-case and extensionless files, while default/custom index and null inputs remain excluded where required.

- [ ] **Step 5: Check for stale production policy owners**

Run:

```bash
rg -n "isPdfPageNotePath|isPageNoteCapablePath|isPageNoteCapableFile" src tests
```

Expected: no `isPdfPageNotePath`; one production page-note policy owner in `commentableFiles.ts`; consumers delegate rather than rebuild an extension list.

- [ ] **Step 6: Commit**

```bash
git add src/core/rules/commentableFiles.ts tests/commentableFiles.test.ts
git commit -m "feat(comments): support page notes for vault files"
```

### Task 2: Prove workspace and sidebar targeting for native and plugin views

**Files:**

- Modify: `tests/workspaceContextController.test.ts`
- Modify: `tests/sidebarIndexContext.test.ts`
- Modify: `tests/sidebarViewFileNormalization.test.ts`
- Modify: `tests/workspaceViewController.test.ts`

- [ ] **Step 1: Update the workspace target fixtures to the new capability**

Add a plugin-like `docs/proposal.docx` view and make the injected TFile guard recognize it. Change the canvas case from “unsupported” to a successful file-backed target. Retain the non-file view case and assert it returns `null` instead of reusing the last Markdown file.

```ts
const docxFile = createFile("docs/proposal.docx");
const resolved = resolveWorkspaceLeafTargetInput(
    { view: { file: docxFile, getViewType: () => "docx-viewer" } },
    markdownFile,
    (value): value is MockFile => value === markdownFile || value === docxFile,
);
assert.equal(resolved, docxFile);
```

- [ ] **Step 2: Update planner and sidebar normalization fixtures**

In `sidebarIndexContext.test.ts`, make the fixed/sidebar predicate accept every non-null mock file and update the canvas assertions to expect `activeSidebarFile`/`sidebarFile` to be the canvas file while preserving the last Markdown file. In `sidebarViewFileNormalization.test.ts`, expect image, canvas, DOCX, PDF, Markdown, and index files to survive normalization; only `null` should clear.

Do not change `pickPinnedCommentableFile` tests: that helper intentionally remains Markdown-only for selection/editor workflows.

- [ ] **Step 3: Cover visible file-backed views**

Change the `WorkspaceViewController` harness predicate to accept all non-null mock TFiles. Add native image and plugin DOCX leaves to `loadVisibleFiles`; assert each path is loaded once, the index still uses aggregate loading, and Markdown preview/selection behavior remains Markdown-only.

- [ ] **Step 4: Run the focused workspace suite**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/workspaceContextController.test.js \
  .test-dist/tests/sidebarIndexContext.test.js \
  .test-dist/tests/sidebarViewFileNormalization.test.js \
  .test-dist/tests/workspaceViewController.test.js
```

Expected: native and plugin file views target their real file; a non-file tab yields no target; `activeMarkdownFile` never becomes a binary/document file.

No production workspace change is expected because `WorkspaceContextController`, `resolveWorkspaceLeafTargetInput`, and `WorkspaceViewController` already operate on generic TFiles. If a focused test exposes a defect, fix the generic resolver only; do not add view-type or extension lists.

- [ ] **Step 5: Commit**

```bash
git add tests/workspaceContextController.test.ts tests/sidebarIndexContext.test.ts \
  tests/sidebarViewFileNormalization.test.ts tests/workspaceViewController.test.ts
git commit -m "test(sidebar): cover arbitrary file-backed views"
```

### Task 3: Route every page-note mutation, including reorder, through one controller

**Files:**

- Modify: `tests/commentEntryController.test.ts`
- Modify: `tests/commentMutationController.test.ts`
- Modify: `src/comments/commentMutationController.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add non-Markdown entry tests**

Make the entry-controller harness use `isPageNoteCapablePath` instead of a local extension list. Parameterize page-draft creation across PDF, PNG, canvas, and DOCX. Assert every draft has `anchorKind: "page"`, the file label, `refreshEditorDecorations: false`, and no source load. Add/retain a DOCX selection case that fails with the Markdown-only text-anchor notice.

- [ ] **Step 2: Add mutation and reorder tests before implementation**

Make the mutation harness use the shared path rule. Keep the PDF regression, then add a DOCX/canvas page-thread test covering append, edit, pin, delete, root-thread reorder, and child-entry reorder. The reorder assertions must include the non-Markdown persistence options:

```ts
{
    path: "maps/strategy.canvas",
    immediateAggregateRefresh: true,
    refreshEditorDecorations: false,
    refreshMarkdownPreviews: false,
}
```

Use a `getCurrentNoteContent` stub that throws so any accidental source-byte/editor path fails the test.

- [ ] **Step 3: Run focused tests and confirm the reorder failure**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/commentEntryController.test.js \
  .test-dist/tests/commentMutationController.test.js
```

Expected before Step 4: page creation and existing mutations follow the widened shared rule, but the newly specified controller reorder API is missing/failing.

- [ ] **Step 4: Add controller-owned reorder mutations**

Import `ReorderPlacement` into `commentMutationController.ts` and add `reorderThreadsForFile` plus `reorderThreadEntries`. Both methods must:

1. resolve the source with `getFileByPath`;
2. require `isPageNoteCapableFile`, not `isCommentableFile`;
3. load current sidecar state;
4. reorder through `CommentManager`;
5. persist through `buildPersistOptionsForFile` so non-Markdown files suppress editor decorations and Markdown preview refresh.

Core shape:

```ts
const file = this.host.getFileByPath(filePath);
if (!this.host.isPageNoteCapableFile(file)) return false;
await this.host.loadCommentsForFile(file);
const changed = this.host.getCommentManager().reorderThreadsForFile(
    file.path,
    movedThreadId,
    targetThreadId,
    placement,
);
if (!changed) return false;
await this.host.persistCommentsForFile(
    file,
    this.buildPersistOptionsForFile(file, { immediateAggregateRefresh: true }),
);
return true;
```

Implement the entry equivalent with `reorderThreadEntries`.

- [ ] **Step 5: Delegate the public plugin API**

Keep the signatures in `main.ts`, but replace their Markdown-only bodies with calls to `commentMutationController`. This preserves all current UI call sites while removing the last duplicate mutation policy.

- [ ] **Step 6: Run the focused tests and typecheck**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/commentEntryController.test.js \
  .test-dist/tests/commentMutationController.test.js
npm run typecheck
```

Expected: all tests pass; Markdown selection tests remain unchanged; non-Markdown reorder persists without Markdown refresh work.

- [ ] **Step 7: Commit**

```bash
git add src/comments/commentMutationController.ts src/main.ts \
  tests/commentEntryController.test.ts tests/commentMutationController.test.ts
git commit -m "feat(comments): generalize page-note mutations"
```

### Task 4: Preserve sidecars, index state, rename, and deletion without a viewer

**Files:**

- Modify: `tests/commentPersistenceExternalSync.test.ts`
- Modify: `tests/pluginLifecycleController.test.ts`

- [ ] **Step 1: Add viewer-independent persistence coverage**

Keep the existing PDF load/save cases and add a plugin-viewed document case such as `docs/proposal.docx`. The harness must expose the real TFile through `vault.getAbstractFileByPath`, return no Markdown view, and use a `getCurrentNoteContent` stub that increments a counter and throws.

Assert after load/save:

- source-content read count is zero;
- the sidecar contains the page thread at the DOCX path;
- `CommentManager` and `AggregateCommentIndex` contain it;
- editor-decoration and Markdown-preview refresh counts are zero when the page-note mutation requests suppression;
- data reloads even though no file view is open.

- [ ] **Step 2: Widen lifecycle harness identity, not folder identity**

Change the lifecycle `isPageNoteCapableFile` fixture to recognize any file-shaped object with a string `extension`, while folders remain excluded. Parameterize rename/delete coverage over PDF plus PNG or DOCX page-note sources. Remove assertions that PNG is ignored; page-note data for that real file must now migrate or clear. Update folder-deletion expectations so nested supported non-Markdown files are included.

Keep `handleFileModify` Markdown-only: binary/document modify events must still bypass Markdown content parsing.

- [ ] **Step 3: Run focused persistence/lifecycle tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/commentPersistenceExternalSync.test.js \
  .test-dist/tests/pluginLifecycleController.test.js
```

Expected: PDF and DOCX/image page-note sidecars load, save, index, rename, and delete without any source-content access; Markdown modify behavior remains unchanged.

No production persistence or lifecycle branch is expected: both already delegate to `isPageNoteCapableFile` for page data and to `isCommentableFile` for content parsing. If a failure exposes a leak, fix that delegation rather than adding an extension exception.

- [ ] **Step 4: Commit**

```bash
git add tests/commentPersistenceExternalSync.test.ts tests/pluginLifecycleController.test.ts
git commit -m "test(storage): cover arbitrary file page notes"
```

### Task 5: Update the shared user and agent language

**Files:**

- Modify: `tests/sideNotePromptPolicy.test.mjs`
- Modify: `shared/sideNotePromptPolicy.js`
- Modify: `README.md`

- [ ] **Step 1: Change the shared prompt contract test first**

Replace the Markdown-page expectation with:

```js
assert.match(prompt, /A page note is scoped to the current file/i);
assert.match(prompt, /Only inspect or modify the current file/i);
assert.doesNotMatch(prompt, /current markdown page/i);
```

Run:

```bash
node --test tests/sideNotePromptPolicy.test.mjs
```

Expected: failure because the shared prompt still says “current markdown page.”

- [ ] **Step 2: Update the single shared prompt owner**

In `shared/sideNotePromptPolicy.js`, change only the two general page-scope lines from “current markdown page” to “current file.” Do not alter `/create-script`’s Markdown-note input contract or `/pdf-to-markdown`’s PDF-specific contract.

- [ ] **Step 3: Update README capability and usage copy**

State that page notes work for any real vault file shown in an Obsidian file-backed view, including viewers supplied by plugins. State separately that selection-anchored notes remain Markdown-only and Aside does not add previews for unsupported formats.

- [ ] **Step 4: Verify shared wording**

```bash
node --test tests/sideNotePromptPolicy.test.mjs
rg -n "current markdown page|Adds page notes to markdown, PDF, and HTML|In HTML and PDF files" shared README.md tests
```

Expected: the test passes and the stale general page-note claims are gone. Format-specific publishing and historical release notes are intentionally untouched.

- [ ] **Step 5: Commit**

```bash
git add shared/sideNotePromptPolicy.js tests/sideNotePromptPolicy.test.mjs README.md
git commit -m "docs: describe file-view page notes"
```

### Task 6: Run the change-surface audit and full verification

**Files:**

- Modify after verification: `docs/superpowers/specs/2026-08-25-file-view-page-notes-design.md`

- [ ] **Step 1: Audit extension-specific claims and policies**

```bash
rg -n "isPdfPageNotePath|Markdown, PDF, and HTML|markdown, PDF, and HTML|unsupported non-PDF|extension === \"pdf\"|endsWith\(\"\.pdf\"" src shared tests README.md
```

Classify every hit. Expected remaining format checks are limited to publishing, PDF conversion, historical tests/docs, or genuinely Markdown/HTML-specific behavior. There must be no second production page-note eligibility list.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: all TypeScript and JavaScript tests pass, including Markdown anchors, rendered HTML, PDF page notes, publishing, and `/pdf-to-markdown`.

- [ ] **Step 3: Run the exact production build**

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, production bundle, and `release:artifacts:check` all exit 0.

- [ ] **Step 4: Inspect the exact public artifacts**

```bash
npm run release:artifacts:check
test ! -e main.js.map
rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|BEGIN CERTIFICATE|npm_[A-Za-z0-9]{20,}|github_pat_|gh[pousr]_|sk-[A-Za-z0-9]{20,}" main.js manifest.json styles.css
```

Expected: guard passes, `main.js.map` is absent, and `rg` returns no matches. The exact shipped set remains `main.js`, `manifest.json`, and `styles.css`; no raw TypeScript/JSX-family file is among those artifacts.

- [ ] **Step 5: Review the diff**

```bash
git diff --check
git status --short
git diff --stat 7eff819...HEAD
```

Expected: no whitespace errors, no generated `.test-dist` or dependency changes, and only scoped source/test/docs changes plus rebuilt `main.js` if the repository tracks it.

### Task 7: Install, smoke-test a native file view, and close tracking

**Files:**

- Modify: `docs/superpowers/specs/2026-08-25-file-view-page-notes-design.md`

- [ ] **Step 1: Record the inspected build hashes**

```bash
shasum -a 256 main.js manifest.json styles.css
```

Save the three hashes in the execution notes.

- [ ] **Step 2: Install the inspected build into the development vault**

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
```

- [ ] **Step 3: Confirm installed byte identity**

```bash
cmp -s main.js "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js"
cmp -s manifest.json "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json"
cmp -s styles.css "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css"
```

Expected: all three commands exit 0.

- [ ] **Step 4: Smoke-test a native image view**

Use the existing source file `Attachments/Pasted image 20260729144516.png` in vault `lean-startup`.

Before opening it:

```bash
shasum -a 256 "/Users/example/Obsidian/lean-startup/Attachments/Pasted image 20260729144516.png"
obsidian vault=lean-startup open path="Attachments/Pasted image 20260729144516.png"
```

In the native image tab, confirm the Aside sidebar targets the PNG and exposes Add page note. Create a page note, append a reply, edit the reply, pin/unpin or reorder the thread, reload Aside, and confirm the thread persists. Confirm a non-file tab clears the source target rather than showing stale Markdown comments. Re-run the source hash and confirm it is unchanged.

- [ ] **Step 5: Mark the approved spec complete**

In `docs/superpowers/specs/2026-08-25-file-view-page-notes-design.md`:

- change status to `Implemented`;
- check only items verified by code/build/install/live evidence;
- leave supplemental third-party DOCX live acceptance unchecked or explicitly noted as supplemental if no installed viewer is available.

- [ ] **Step 6: Commit tracking and final artifacts**

```bash
git add main.js docs/superpowers/specs/2026-08-25-file-view-page-notes-design.md
git commit -m "docs: complete file-view page-note rollout"
```

If `main.js` is unchanged or intentionally not tracked by the implementation commits, omit it from `git add`. Do not create a release or tag in this task.

## Final Acceptance Checklist

- [ ] One extension-independent page-note policy exists; no production extension allowlist remains.
- [ ] Any active real TFile from a native or plugin file-backed view targets the Aside sidebar.
- [ ] Non-file tabs never reuse a stale Markdown target.
- [ ] Selection anchors, editor reads, highlights, and Markdown preview refresh remain Markdown-only.
- [ ] Create, reply, edit, delete, pin, root reorder, child reorder, index, rename, delete, and reload work for non-Markdown page notes.
- [ ] Viewer unavailability does not delete sidecar/index data.
- [ ] Publishing and `/pdf-to-markdown` remain unchanged.
- [ ] Full build and release-artifact guard pass.
- [ ] Installed assets match the inspected build byte-for-byte.
- [ ] Native image smoke passes without source-file modification.
