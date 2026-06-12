# Remove Legacy SideNote2 And Inline Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove current-runtime knowledge of old SideNote2 names and old source-note inline comment storage.

**Architecture:** Current Aside storage remains plugin data plus `.obsidian/plugins/aside/sidenotes/...`. Source markdown content is no longer parsed or rewritten as comment storage. Legacy migration is not in release `N`; users who need it must run release `N-1` before upgrading.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, repo helper scripts, esbuild.

---

### Task 1: Red Tests For Current-Only Storage

**Files:**
- Modify: `tests/canonicalCommentStorage.test.ts`
- Modify: `tests/sidecarCommentStorage.test.ts`
- Modify: `tests/noteCommentStorage.test.ts`
- Modify: `tests/pluginRegistrationController.test.ts`
- Modify: `tests/commentReferences.test.ts`

- [ ] **Step 1: Replace planner expectations**

Update `tests/canonicalCommentStorage.test.ts` so the planner input only contains `sidecarRecordFound`, and assert:

```ts
assert.deepEqual(planCanonicalCommentStorage({ sidecarRecordFound: true }), {
    action: "use-sidecar",
    source: "sidecar",
    shouldRecoverRenamedSource: false,
});
assert.deepEqual(planCanonicalCommentStorage({ sidecarRecordFound: false }), {
    action: "check-renamed-source",
    source: "none",
    shouldRecoverRenamedSource: true,
});
```

- [ ] **Step 2: Replace sidecar legacy-path test**

In `tests/sidecarCommentStorage.test.ts`, remove the test that proves old plugin cache reads work. Add a test that constructs storage with only `pluginDirPath: ".obsidian/plugins/aside"`, writes a current sidecar, and asserts all adapter file keys start with `.obsidian/plugins/aside/sidenotes/`.

- [ ] **Step 3: Replace note storage tests with current-only behavior**

Rewrite `tests/noteCommentStorage.test.ts` to cover only:

```ts
parseNoteComments("# Title\n\nBody", "note.md").threads.length === 0;
parseNoteComments("# Title\n\nBody", "note.md").mainContent === "# Title\n\nBody";
getVisibleNoteContent("Body") === "Body";
getManagedSectionRange("Body") === null;
getManagedSectionKind("Body") === "none";
sortCommentsByPosition([...]) orders by line/char/timestamp;
```

Do not include old hidden-block literals in the test file.

- [ ] **Step 4: Replace protocol compatibility tests**

Update protocol tests so only `aside-comment` is registered and only `obsidian://aside-comment?...` parses.

- [ ] **Step 5: Run red tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/canonicalCommentStorage.test.js .test-dist/tests/sidecarCommentStorage.test.js .test-dist/tests/noteCommentStorage.test.js .test-dist/tests/pluginRegistrationController.test.js .test-dist/tests/commentReferences.test.js
```

Expected: FAIL before production changes because old planner fields, old protocol registration, and old inline storage behavior still exist.

### Task 2: Remove Inline Source-Note Storage Runtime

**Files:**
- Modify: `src/core/storage/noteCommentStorage.ts`
- Modify: `src/core/storage/canonicalCommentStorage.ts`
- Delete: `src/core/storage/legacyInlineCommentMigration.ts`
- Modify: `src/comments/commentPersistenceController.ts`
- Modify: callers that import removed functions.

- [ ] **Step 1: Simplify note storage**

Make `parseNoteComments` return normalized note content and no comments/threads. Keep `sortCommentsByPosition`, `ParsedNoteComments`, and no-op compatibility helpers only where production callers still need them during the cleanup:

```ts
export function parseNoteComments(noteContent: string): ParsedNoteComments {
    const mainContent = noteContent.replace(/\r\n/g, "\n").trimEnd();
    return { mainContent, comments: [], threads: [] };
}
```

- [ ] **Step 2: Simplify canonical planner**

Make `CanonicalCommentStorageSource = "none" | "sidecar"` and `CanonicalCommentStorageAction = "use-sidecar" | "check-renamed-source"`. Remove inline thread counts and strip flags from inputs/plans.

- [ ] **Step 3: Remove inline migration from persistence**

Remove `mergeLegacyInlineThreads`, `ensureLegacyInlineCommentsMigrated`, `reconcileLegacyInlineThreadsWithSidecar`, and `stripInlineManagedSectionIfPresent`. `getCanonicalThreadState` should read current sidecar/source sidecar first, otherwise run current rename recovery, otherwise return no threads.

- [ ] **Step 4: Run targeted tests**

Run the Task 1 command again.

Expected: PASS for these focused tests after Task 2 and Task 3 changes are complete.

### Task 3: Remove Old Plugin Names, Paths, And Protocols

**Files:**
- Modify: `src/main.ts`
- Modify: `src/app/pluginRegistrationController.ts`
- Modify: `src/core/text/commentReferences.ts`
- Modify: `src/core/derived/allCommentsNote.ts`
- Modify: `src/core/derived/thoughtTrail.ts`
- Modify: `src/core/derived/indexFileFilterGraph.ts`
- Modify: `src/settings/indexNoteSettingsController.ts`

- [ ] **Step 1: Remove startup migration from old plugin data**

Delete old plugin id constants, old device-id prefix, `getLegacyPluginDataDirPaths`, and `loadDataWithLegacyFallback`. Use `this.loadData()` directly for persisted plugin data.

- [ ] **Step 2: Register only current URI protocol**

In `PluginRegistrationController.register`, remove registration of the old comment protocol.

- [ ] **Step 3: Parse only current comment/index protocols**

Remove old protocol constants and regex alternates from `commentReferences.ts` and `allCommentsNote.ts`.

- [ ] **Step 4: Remove old generated-index path handling**

`isAllCommentsNotePath` should compare only the configured current path. Delete legacy generated-index migration/removal from settings controller and remove old index path sets from thought-trail and file-filter graph code.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/pluginRegistrationController.test.js .test-dist/tests/commentReferences.test.js .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/allCommentsNote.test.js .test-dist/tests/thoughtTrail.test.js .test-dist/tests/indexFileFilterGraph.test.js
```

Expected: PASS after tests are updated for current-only behavior.

### Task 4: Update Helper Scripts To Current Storage Only

**Files:**
- Modify: `scripts/lib/asideRepoScripts.mjs`
- Modify: script tests that create source-note inline fixtures.

- [ ] **Step 1: Remove old path constructors and URI parsing**

Delete old plugin sidecar path constructors, old `data.json` fallback, old URI protocol parsing, and all hidden-block fallback reads/strips.

- [ ] **Step 2: Load only current sidecars**

`loadThreadsWithFallback` should read current Aside sidecars and return an empty thread list when none exists. It should still read note text only for anchoring/content fingerprint safety.

- [ ] **Step 3: Write only current sidecars**

`writeSidecar` should write current path/source sidecars and remove current sidecars when the thread list is empty. It must not remove old plugin files.

- [ ] **Step 4: Run script tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/createNoteCommentThreadScript.test.js .test-dist/tests/appendNoteCommentEntryScript.test.js .test-dist/tests/updateNoteCommentScript.test.js .test-dist/tests/generateLargeGraphFixtureScript.test.js
```

Expected: PASS after script tests use current sidecar fixtures.

### Task 5: Static Removal And Full Verification

**Files:**
- Modify: tests and release notes as needed.
- Keep unrelated `docs/prd/synced-side-note-event-log-spec.md` untouched.

- [ ] **Step 1: Static removal search**

Run:

```bash
rg -n "SideNote2|side-note2|sidenote2" src scripts tests styles.css manifest.json package.json
rg -n "legacy-inline|migrate-inline|legacyPluginDirPaths|getLegacyPluginDataDirPaths" src scripts tests
rg -n "<!-- Aside comments|<!-- SideNote2 comments" src scripts tests
```

Expected: no output.

- [ ] **Step 2: Full test/build verification**

Run:

```bash
npm run build
```

Expected: exit 0.
