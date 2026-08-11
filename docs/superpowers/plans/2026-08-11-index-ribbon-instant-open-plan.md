# Instant Index Ribbon Opening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal an existing Aside index immediately from the ribbon while refreshing its generated contents asynchronously.

**Architecture:** Add a small generic application-level coordinator that owns only the ordering policy for index navigation and refresh. `src/main.ts` remains the Obsidian adapter: it resolves and focuses Markdown leaves, activates the sidebar, reports notices, and delegates aggregate generation to the existing persistence controller.

**Tech Stack:** TypeScript 5.9, Obsidian Plugin API 1.13, Node.js test runner, ESLint, esbuild

---

### Task 1: Lock Down the Instant-Open Ordering Contract

**Files:**
- Create: `tests/indexNoteOpenController.test.ts`
- Create: `src/app/indexNoteOpenController.ts`

- [ ] **Step 1: Write the failing coordinator tests**

Create `tests/indexNoteOpenController.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { IndexNoteOpenController } from "../src/app/indexNoteOpenController";

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createHarness(options: {
    indexExists: boolean;
    refreshAggregateNoteNow: () => Promise<void>;
}) {
    const calls: string[] = [];
    const refreshErrors: Array<{ context: "creation" | "background"; error: unknown }> = [];
    let indexExists = options.indexExists;

    const controller = new IndexNoteOpenController<string>({
        getIndexNotePath: () => "🐰 Aside Index.md",
        hasIndexNote: () => indexExists,
        revealIndexNote: async (filePath) => {
            calls.push(`reveal:${filePath}`);
            return "index-leaf";
        },
        refreshAggregateNoteNow: async () => {
            calls.push("refresh");
            await options.refreshAggregateNoteNow();
        },
        activateIndexSidebar: async () => {
            calls.push("activate-sidebar");
        },
        restoreIndexFocus: (focusTarget, filePath) => {
            calls.push(`restore:${focusTarget}:${filePath}`);
        },
        reportMissingIndex: (filePath) => {
            calls.push(`missing:${filePath}`);
        },
        handleRefreshError: (error, context) => {
            refreshErrors.push({ context, error });
        },
    });

    return {
        calls,
        controller,
        refreshErrors,
        setIndexExists(value: boolean) {
            indexExists = value;
        },
    };
}

test("existing index opens without waiting for aggregate refresh", async () => {
    const refresh = createDeferred<void>();
    const harness = createHarness({
        indexExists: true,
        refreshAggregateNoteNow: () => refresh.promise,
    });

    await harness.controller.open();

    assert.deepEqual(harness.calls, [
        "reveal:🐰 Aside Index.md",
        "refresh",
        "activate-sidebar",
        "restore:index-leaf:🐰 Aside Index.md",
    ]);
    refresh.resolve();
    await refresh.promise;
});

test("missing index waits for one creation refresh before opening", async () => {
    const refresh = createDeferred<void>();
    const harness = createHarness({
        indexExists: false,
        refreshAggregateNoteNow: () => refresh.promise,
    });

    const opening = harness.controller.open();
    await Promise.resolve();
    assert.deepEqual(harness.calls, ["refresh"]);

    harness.setIndexExists(true);
    refresh.resolve();
    await opening;

    assert.deepEqual(harness.calls, [
        "refresh",
        "reveal:🐰 Aside Index.md",
        "activate-sidebar",
        "restore:index-leaf:🐰 Aside Index.md",
    ]);
});

test("missing index reports the existing open error after failed creation", async () => {
    const refreshError = new Error("refresh failed");
    const harness = createHarness({
        indexExists: false,
        refreshAggregateNoteNow: async () => {
            throw refreshError;
        },
    });

    await harness.controller.open();

    assert.deepEqual(harness.calls, [
        "refresh",
        "missing:🐰 Aside Index.md",
    ]);
    assert.deepEqual(harness.refreshErrors, [{
        context: "creation",
        error: refreshError,
    }]);
});

test("background refresh failure is handled after an existing index opens", async () => {
    const refreshError = new Error("refresh failed");
    const harness = createHarness({
        indexExists: true,
        refreshAggregateNoteNow: async () => {
            throw refreshError;
        },
    });

    await harness.controller.open();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.calls, [
        "reveal:🐰 Aside Index.md",
        "refresh",
        "activate-sidebar",
        "restore:index-leaf:🐰 Aside Index.md",
    ]);
    assert.deepEqual(harness.refreshErrors, [{
        context: "background",
        error: refreshError,
    }]);
});
```

- [ ] **Step 2: Compile to verify the test fails for the missing coordinator**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: TypeScript fails because `../src/app/indexNoteOpenController` does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

Create `src/app/indexNoteOpenController.ts`:

```ts
export type IndexNoteRefreshContext = "creation" | "background";

export interface IndexNoteOpenHost<FocusTarget> {
    getIndexNotePath(): string;
    hasIndexNote(filePath: string): boolean;
    revealIndexNote(filePath: string): Promise<FocusTarget>;
    refreshAggregateNoteNow(): Promise<void>;
    activateIndexSidebar(): Promise<void>;
    restoreIndexFocus(focusTarget: FocusTarget, filePath: string): void;
    reportMissingIndex(filePath: string): void;
    handleRefreshError(error: unknown, context: IndexNoteRefreshContext): void;
}

export class IndexNoteOpenController<FocusTarget> {
    constructor(private readonly host: IndexNoteOpenHost<FocusTarget>) {}

    public async open(): Promise<void> {
        const indexFilePath = this.host.getIndexNotePath();
        const existedAtClick = this.host.hasIndexNote(indexFilePath);

        if (!existedAtClick) {
            try {
                await this.host.refreshAggregateNoteNow();
            } catch (error) {
                this.host.handleRefreshError(error, "creation");
            }

            if (!this.host.hasIndexNote(indexFilePath)) {
                this.host.reportMissingIndex(indexFilePath);
                return;
            }
        }

        const focusTarget = await this.host.revealIndexNote(indexFilePath);
        if (existedAtClick) {
            this.refreshExistingIndexInBackground();
        }
        await this.host.activateIndexSidebar();
        this.host.restoreIndexFocus(focusTarget, indexFilePath);
    }

    private refreshExistingIndexInBackground(): void {
        void this.host.refreshAggregateNoteNow().catch((error: unknown) => {
            this.host.handleRefreshError(error, "background");
        });
    }
}
```

- [ ] **Step 4: Run the focused coordinator tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteOpenController.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit the coordinator and regression tests**

```bash
git add src/app/indexNoteOpenController.ts tests/indexNoteOpenController.test.ts
git commit -m "test: lock instant index open ordering"
```

### Task 2: Route the Ribbon Through the Fast Existing-Index Path

**Files:**
- Modify: `src/main.ts:18-26`
- Modify: `src/main.ts:380-450`
- Modify: `src/main.ts:2260-2320`

- [ ] **Step 1: Import and construct the index-open coordinator**

Add the import beside the other `src/app` controllers:

```ts
import {
    IndexNoteOpenController,
    type IndexNoteRefreshContext,
} from "./app/indexNoteOpenController";
```

After `commentNavigationController`, construct the coordinator:

```ts
    private readonly indexNoteOpenController = new IndexNoteOpenController<WorkspaceLeaf | null>({
        getIndexNotePath: () => this.getAllCommentsNotePath(),
        hasIndexNote: (filePath) => !!this.workspaceViewController.getMarkdownFileByPath(filePath),
        revealIndexNote: (filePath) => this.revealIndexNote(filePath),
        refreshAggregateNoteNow: () => this.refreshAggregateNoteNow(),
        activateIndexSidebar: () => this.commentNavigationController.activateView(false),
        restoreIndexFocus: (indexLeaf, filePath) => this.focusIndexLeaf(indexLeaf, filePath),
        reportMissingIndex: (filePath) => {
            this.showNotice(`Unable to open ${filePath}.`, "index", "index.open.error", {
                filePath,
            });
        },
        handleRefreshError: (error, context) => this.handleIndexOpenRefreshError(error, context),
    });
```

- [ ] **Step 2: Extract the Obsidian leaf adapter and delegate `openIndexNote()`**

Replace the current `openIndexNote()` body and keep the existing preferred-leaf selection helper:

```ts
    private focusIndexLeaf(indexLeaf: WorkspaceLeaf | null, indexFilePath: string): void {
        if (indexLeaf && indexLeaf.view instanceof MarkdownView && indexLeaf.view.file?.path === indexFilePath) {
            this.app.workspace.setActiveLeaf(indexLeaf, { focus: true });
        }
    }

    private async revealIndexNote(indexFilePath: string): Promise<WorkspaceLeaf | null> {
        let indexLeaf = this.getPreferredMarkdownLeafByPath(indexFilePath);
        if (indexLeaf && indexLeaf.view instanceof MarkdownView && indexLeaf.view.file?.path === indexFilePath) {
            this.focusIndexLeaf(indexLeaf, indexFilePath);
            return indexLeaf;
        }

        await this.app.workspace.openLinkText(indexFilePath, "", "tab");
        indexLeaf = this.getPreferredMarkdownLeafByPath(indexFilePath);
        return indexLeaf;
    }

    private handleIndexOpenRefreshError(error: unknown, context: IndexNoteRefreshContext): void {
        const timing = context === "creation" ? "while creating" : "after opening";
        this.warn(
            `Unable to refresh ${this.getAllCommentsNotePath()} ${timing} the Aside index.`,
            error,
            "index",
            `index.open.refresh.${context}.warn`,
        );
    }

    async openIndexNote(): Promise<void> {
        await this.indexNoteOpenController.open();
    }
```

The coordinator now reveals an existing file before starting aggregate refresh. The first-run path still creates the file before `revealIndexNote()` is called, and the same leaf is restored after sidebar activation.

- [ ] **Step 3: Run focused tests, type-check, and lint**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteOpenController.test.js .test-dist/tests/pluginRegistrationController.test.js
npm run typecheck
npm run lint
```

Expected: 4 coordinator tests and 3 plugin-registration tests pass; type-check and lint exit successfully.

- [ ] **Step 4: Inspect the production diff for ordering and unrelated changes**

Run:

```bash
git diff --check
git diff -- src/main.ts src/app/indexNoteOpenController.ts tests/indexNoteOpenController.test.ts
```

Expected: no whitespace errors; the existing-index path calls `revealIndexNote()` before `refreshAggregateNoteNow()` and no unrelated files are changed.

- [ ] **Step 5: Commit the plugin wiring**

```bash
git add src/main.ts
git commit -m "fix: open existing index before refresh"
```

### Task 3: Verify the Complete Change and Close Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-index-ribbon-instant-open-design.md`
- Modify: `docs/superpowers/plans/2026-08-11-index-ribbon-instant-open-plan.md`

- [ ] **Step 1: Run the full production pipeline**

Run:

```bash
npm run build
```

Expected: all compiled TypeScript tests and contract tests pass; ESLint, TypeScript, Obsidian compliance, production bundling, and the release artifact guard all exit successfully.

- [ ] **Step 2: Inspect the exact shipped plugin assets**

Run:

```bash
ls -lh main.js manifest.json styles.css
rg -n "sourceMappingURL|sourcesContent|/Users/|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name '*.map' -o -name '*.ts' -o -name '*.tsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
```

Expected: the three shipped assets exist; the exposure scan and root-level forbidden-file scan produce no output.

- [ ] **Step 3: Mark verified implementation tracking complete**

In `docs/superpowers/specs/2026-08-11-index-ribbon-instant-open-design.md`, change every unchecked item under `### To Implement` and `### Verification` to `[x]` only after Steps 1 and 2 pass.

In this plan, mark each executed step `[x]` only after its listed command or edit succeeds.

- [ ] **Step 4: Confirm the final worktree state**

Run:

```bash
git diff --check
git status --short
git log -5 --oneline --decorate
```

Expected: only the completed spec and plan tracking edits remain unstaged, and the two implementation commits appear in the recent log.

- [ ] **Step 5: Commit completed tracking**

```bash
git add -f docs/superpowers/specs/2026-08-11-index-ribbon-instant-open-design.md docs/superpowers/plans/2026-08-11-index-ribbon-instant-open-plan.md
git commit -m "docs: complete instant index opening plan"
```

- [ ] **Step 6: Report verification evidence**

Report the focused test counts, full pipeline result, artifact-guard result, and exact exposure scans. Do not claim a vault installation, release, tag, or push because those actions are outside this plan.
