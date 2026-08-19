# Share During Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the persisted side-note Share action available during parent and child inline editing without saving the draft, and show copied feedback only when the clipboard write succeeds.

**Architecture:** Keep URI construction in the existing clipboard adapter. Carry its boolean result through `SidebarPersistedCommentHost.shareComment`, make the footer Share handler independent of the save-visible-draft guard, and reuse `renderThreadFooterActions` in a Share-only edit-state configuration. The normal non-edit footer remains unchanged.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, esbuild, ESLint.

---

## Task 1: Lock the edit-state behavior with failing renderer tests

**Files:**
- Modify: `tests/sidebarPersistedComment.test.ts`

- [ ] Change the default renderer host stub to model the real clipboard result:

```ts
shareComment: async () => true,
```

- [ ] Update the existing successful-share test override to return `true` after recording the shared comment id.

- [ ] Add a parent edit-mode regression test that renders an active `editDraftComment`, clicks the card's Share button, and proves:

```ts
assert.equal(shareButtons.length, 1);
assert.deepEqual(sharedCommentIds, ["comment-1"]);
assert.equal(saveVisibleDraftCalls, 0);
assert.equal(host.editDraftComment?.id, "comment-1");
```

- [ ] Add a child edit-mode regression test using a two-entry thread. Select the card whose `data-comment-id` is `entry-2`, click its Share button, and prove the child id is shared without saving the visible draft.

- [ ] Add a clipboard-failure regression test with `shareComment: async () => false`; after the click, prove that the Share label/icon remain normal, the status stays hidden, and no feedback reset timer is scheduled.

- [ ] Run the focused test and confirm RED for the intended reasons:

```bash
npm run test:compiled -- --test-name-pattern "sharing a side note|inline editing|clipboard fails"
```

Expected: parent/child edit tests fail because the Share button is absent; the failure-feedback test fails because the current handler reports Copied regardless of the clipboard result.

- [ ] Commit the failing regression tests:

```bash
git add tests/sidebarPersistedComment.test.ts
git commit -m "test: cover sharing during inline edits"
```

## Task 2: Propagate clipboard success and decouple Share from draft saving

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/sidebarPersistedComment.test.ts` only if the compiler exposes a missed mock signature

- [ ] Change the host contract from `Promise<void>` to `Promise<boolean>`:

```ts
shareComment(comment: Comment): Promise<boolean>;
```

- [ ] Make the Share click handler use the clipboard result directly, without `saveVisibleDraftIfPresent`:

```ts
const copied = await host.shareComment(comment);
if (!copied) {
    return;
}
shareCopiedResetTimer = renderShareCopiedFeedback(
    shareButton,
    shareStatusEl,
    shareCopiedResetTimer,
);
```

- [ ] Return `copyCommentLocationToClipboard(...)` from the real `AsideView` host adapter instead of awaiting and discarding its boolean result.

- [ ] Run the focused tests again. Expected: the clipboard-failure and existing non-edit success tests pass; edit-mode tests still fail because no Share action is rendered during editing.

- [ ] Commit the clipboard-result boundary change:

```bash
git add src/ui/views/sidebarPersistedComment.ts src/ui/views/AsideView.ts tests/sidebarPersistedComment.test.ts
git commit -m "fix: report share clipboard failures"
```

## Task 3: Render only Share while parent or child editing is active

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts`

- [ ] After the normal child `if (!entryEditDraft)` actions, add an edit-state footer using the same renderer with no regeneration/run metadata and only Share enabled:

```ts
if (entryEditDraft) {
    renderThreadFooterActions(entryEl, entryComment, null, entryAuthor, null, {
        showShareAction: !host.showSourceRedirectAction
            && !entryComment.deletedAt
            && !thread.deletedAt,
        showAddEntryAction: false,
        showRetryAction: false,
    }, host);
}
```

- [ ] After the normal parent `if (!parentEditDraft)` actions, add the equivalent Share-only edit-state footer, preserving the existing parent Share visibility policy.

- [ ] Run the focused tests and confirm GREEN:

```bash
npm run test:compiled -- --test-name-pattern "sharing a side note|inline editing|clipboard fails"
```

- [ ] Run the full compiled renderer suite:

```bash
npm run test:compiled -- --test-name-pattern "renderPersistedCommentCard"
```

- [ ] Commit the rendering fix:

```bash
git add src/ui/views/sidebarPersistedComment.ts
git commit -m "fix: keep share available while editing"
```

## Task 4: Verify the feature branch and update implementation tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-share-during-inline-edit-design.md`
- Modify: `docs/superpowers/plans/2026-08-19-share-during-inline-edit.md`

- [ ] Run the complete test suite:

```bash
npm test
```

- [ ] Run lint, typecheck, Obsidian compliance, production bundling, and release-artifact inspection through the repository build:

```bash
npm run build
```

Expected: build succeeds; shipped `main.js`, `manifest.json`, and `styles.css` exist; no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TS/JSX-family source, `.env*`, `.npmrc`, private keys, or certificates are present in the release artifact set.

- [ ] Mark the implemented behavior and feature-branch verification items complete in the design specification. Leave merge/main verification pending.

- [ ] Review the branch diff for unrelated changes:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

- [ ] Commit tracking updates if they changed:

```bash
git add -f docs/superpowers/specs/2026-08-19-share-during-inline-edit-design.md docs/superpowers/plans/2026-08-19-share-during-inline-edit.md
git commit -m "docs: record inline share verification"
```

## Task 5: Merge locally into main and verify the integrated result

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-share-during-inline-edit-design.md`
- Modify: `docs/superpowers/plans/2026-08-19-share-during-inline-edit.md`

- [ ] Confirm both the main worktree and feature worktree are clean, and confirm `main` still points to the feature branch's original base or contains only understood changes.

- [ ] From the main worktree, merge without pushing:

```bash
git merge --no-ff fix/share-during-inline-edit
```

- [ ] Re-run integrated verification on `main`:

```bash
npm test
npm run build
```

- [ ] Mark the merge and merged-main verification checklist items complete in the design specification and this plan, then commit the tracking update on `main`.

- [ ] Remove the clean temporary worktree and merged feature branch:

```bash
git worktree remove .worktrees/fix-share-during-inline-edit
git branch -d fix/share-during-inline-edit
```

- [ ] Confirm final state and that no remote push occurred:

```bash
git status --short --branch
git log --oneline --decorate -8
git rev-list --left-right --count origin/main...main
```

Expected: clean local `main`; local commits are ahead of `origin/main`; no remote refs changed.
