# Same-Note Persistence Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent simultaneous comment saves for one note from colliding or losing a newer agent reply while preserving concurrent agent execution and cross-note persistence.

**Architecture:** `CommentPersistenceController` will own a promise tail keyed by canonical note path. Public and deferred comment saves join that tail; each queued callback reads current manager state only after its turn begins and runs the existing sync-event, source-sidecar, path-sidecar, snapshot, and refresh transaction unchanged. A controller-level regression will use an Obsidian-like adapter that rejects rename-over-existing to prove same-note saves serialize, while a separate gate proves different notes remain parallel.

**Tech Stack:** TypeScript 5.9, Obsidian `DataAdapter`, Node test runner, existing `CommentManager`, `CommentPersistenceController`, sidecar storage, and sync-event store.

---

### Task 1: Reproduce simultaneous same-note persistence

**Files:**
- Create: `tests/commentPersistenceConcurrency.test.ts`

- [ ] **Step 1: Add an Obsidian-like adapter and minimal persistence host**

Create a focused test file whose `CollisionAwareAdapter` stores files in memory and rejects rename-over-existing:

```ts
async rename(sourcePath: string, destinationPath: string): Promise<void> {
    const content = this.files.get(sourcePath);
    if (content === undefined) {
        throw new Error(`Missing file: ${sourcePath}`);
    }
    if (this.files.has(destinationPath)) {
        throw new Error("Destination file already exists!");
    }
    this.files.set(destinationPath, content);
    this.files.delete(sourcePath);
}
```

The file must also define `createDeferred`, `createFile`, `createThread`, and `createHarness`. `createHarness` constructs a real `CommentPersistenceController` with `CommentManager`, `AggregateCommentIndex`, Markdown content `# Title\n\nAlpha target omega\n`, deterministic hash and ID functions, in-memory `PersistedPluginData`, no-op refresh adapters, and the collision-aware vault adapter. It returns the controller, adapter, manager, and a setter for the current-content reader when a test needs a gate.

- [ ] **Step 2: Write the failing same-note regression**

Add a test that starts two saves for `docs/note.md` without awaiting the first. The first starts with one reply entry. Before starting the second, append a second reply entry to the same manager thread. Await both saves and reload the path sidecar through its deterministic hash path:

```ts
const firstSave = controller.persistCommentsForFile(file, { immediateAggregateRefresh: true });
commentManager.addReply("thread-1", "reply two", 1710000002000, "entry-2");
const secondSave = controller.persistCommentsForFile(file, { immediateAggregateRefresh: true });

await Promise.all([firstSave, secondSave]);

const payload = JSON.parse(await adapter.read(getSidecarStoragePath(file.path))) as {
    threads: CommentThread[];
};
assert.deepEqual(payload.threads[0]?.entries.map((entry) => entry.id), ["entry-1", "entry-2"]);
```

Use the actual `CommentManager` reply API signature found in `src/commentManager.ts`; do not mutate returned clones.

- [ ] **Step 3: Run the regression and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentPersistenceConcurrency.test.js
```

Expected: FAIL with `Destination file already exists!` from one of the overlapping same-note sidecar renames.

- [ ] **Step 4: Commit the failing regression**

```bash
git add tests/commentPersistenceConcurrency.test.ts
git commit -m "test(persistence): reproduce same-note race"
```

### Task 2: Serialize canonical saves by note path

**Files:**
- Modify: `src/comments/commentPersistenceController.ts:511-570`
- Modify: `src/comments/commentPersistenceController.ts:1219-1228`
- Modify: `src/comments/commentPersistenceController.ts:1283-1300`
- Test: `tests/commentPersistenceConcurrency.test.ts`

- [ ] **Step 1: Add the keyed persistence tails**

Add the field beside the existing targeted replay promises:

```ts
private readonly commentPersistTails = new Map<string, Promise<void>>();
```

Clear it during `dispose()` after clearing deferred timers so settled work cannot retain file paths:

```ts
this.commentPersistTails.clear();
```

- [ ] **Step 2: Add the queue helper**

Add this private method before `persistCommentsForFile`:

```ts
private async enqueueCommentPersist(file: TFile, options: PersistOptions): Promise<void> {
    const previousTail = this.commentPersistTails.get(file.path) ?? Promise.resolve();
    const operation = previousTail
        .catch(() => undefined)
        .then(async () => {
            if (this.disposed) {
                return;
            }
            await this.writeCommentsForFile(file, options);
        });

    this.commentPersistTails.set(file.path, operation);
    try {
        await operation;
    } finally {
        if (this.commentPersistTails.get(file.path) === operation) {
            this.commentPersistTails.delete(file.path);
        }
    }
}
```

The `.catch(() => undefined)` applies only to the prior tail. The current `operation` must still reject its own caller if `writeCommentsForFile` fails.

- [ ] **Step 3: Route immediate and deferred saves through the queue**

Keep refresh-suppression scheduling at call time, then replace the direct write in `persistCommentsForFile`:

```ts
await this.enqueueCommentPersist(file, options);
```

In `flushDeferredCommentPersist`, replace the direct `writeCommentsForFile(file)` call with:

```ts
await this.persistCommentsForFile(file);
```

This ensures `writeCommentsForFile` is entered only after a note's queue turn begins, so `writeMarkdownCommentsForFile` and `writePageNoteCommentsForFile` capture the latest manager threads rather than a pre-wait snapshot.

- [ ] **Step 4: Run the same-note regression and verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentPersistenceConcurrency.test.js
```

Expected: PASS; both same-note saves resolve and the final sidecar contains both reply IDs.

- [ ] **Step 5: Commit the queue implementation**

```bash
git add src/comments/commentPersistenceController.ts tests/commentPersistenceConcurrency.test.ts
git commit -m "fix(persistence): serialize same-note saves"
```

### Task 3: Lock down cross-note concurrency and rejection recovery

**Files:**
- Modify: `tests/commentPersistenceConcurrency.test.ts`

- [ ] **Step 1: Add the cross-note concurrency test**

Configure the harness content reader so note A resolves an `aEntered` deferred and waits on `releaseA`, while note B resolves `bEntered` immediately. Start A, await `aEntered`, start B, and require B to enter before releasing A:

```ts
const saveA = controller.persistCommentsForFile(fileA);
await aEntered.promise;
const saveB = controller.persistCommentsForFile(fileB);
await bEntered.promise;
releaseA.resolve();
await Promise.all([saveA, saveB]);
```

If the implementation accidentally uses one global queue, the test hangs before `releaseA`. Protect the assertion with a deterministic immediate-turn sentinel and fail with `note B was globally blocked` rather than using a long wall-clock timeout.

- [ ] **Step 2: Add the rejection-recovery test**

Make the content reader throw once for one note, then succeed. Assert the first save rejects with `first save failed`, the second save resolves, and its sidecar exists:

```ts
await assert.rejects(controller.persistCommentsForFile(file), /first save failed/);
await controller.persistCommentsForFile(file);
assert.equal(await adapter.exists(getSidecarStoragePath(file.path)), true);
```

This proves a failed operation does not poison the note's promise tail.

- [ ] **Step 3: Run focused persistence tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentPersistenceConcurrency.test.js .test-dist/tests/sidecarCommentStorage.test.js .test-dist/tests/commentPersistenceExternalSync.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 4: Commit the concurrency guards**

```bash
git add tests/commentPersistenceConcurrency.test.ts
git commit -m "test(persistence): preserve cross-note concurrency"
```

### Task 4: Complete verification, tracking, and live installation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-same-note-persistence-serialization-design.md`

- [ ] **Step 1: Run the full build**

Run:

```bash
npm run build
```

Expected: all tests pass; lint, typecheck, Obsidian compliance, bundle, and release artifact guard exit zero. Confirm the guard inspects `main.js`, `manifest.json`, and `styles.css` and reports no source maps, `sourceMappingURL`, embedded `sourcesContent`, raw TypeScript/JSX-family source files, or secret-bearing files.

- [ ] **Step 2: Re-run the change-surface search**

Run:

```bash
rg -n "writeCommentsForFile\(|commentPersistTails|Destination file already exists" src tests
```

Expected: immediate and deferred callers route through the single controller queue; no provider-specific or duplicate queue exists.

- [ ] **Step 3: Mark the tracked spec complete**

Change every verified `### To Implement` and `### Verification` item in the associated spec from `[ ]` to `[x]`. Do not mark the live-install item until Step 5 succeeds.

- [ ] **Step 4: Commit implementation tracking**

```bash
git add -f docs/superpowers/specs/2026-09-03-same-note-persistence-serialization-design.md
git commit -m "docs(persistence): complete save serialization"
```

- [ ] **Step 5: Install and reload the verified build in `lean-startup`**

Run:

```bash
npm run dev:install-built -- --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: installation copies `main.js`, `manifest.json`, and `styles.css`; Obsidian reload succeeds.

- [ ] **Step 6: Verify installed assets byte-for-byte**

Run:

```bash
plugin_dir="/path/to/vault/.obsidian/plugins/aside"
for artifact in main.js manifest.json styles.css; do
    cmp -s "$artifact" "$plugin_dir/$artifact"
done
```

Expected: all three comparisons exit zero.

- [ ] **Step 7: Mark live installation complete and commit**

Mark the remaining spec verification item `[x]`, then run:

```bash
git add -f docs/superpowers/specs/2026-09-03-same-note-persistence-serialization-design.md
git commit -m "docs(persistence): verify live save fix"
```

- [ ] **Step 8: Append the result to the reported Aside thread**

Run `node scripts/append-note-comment-entry.mjs --help`, then append a concise result to comment `cd8b80f8-86e1-449e-8f4c-3a78a530b9e6` in the supplied `lean-startup` note. State that same-note saves are serialized, agents and different notes remain concurrent, the regression/build passed, and the build was installed. Verify the appended entry in both source and path sidecars.
