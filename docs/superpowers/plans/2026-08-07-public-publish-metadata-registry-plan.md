# Public Publish Metadata Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist durable publish status, date-only last-published metadata, and full public URLs in plugin data, then render `public/index.md` with a compact URL-last table.

**Architecture:** Add a pure normalized metadata model under `src/core/publish`, keep it separate from user-editable `AsideSettings`, and expose it through the existing serialized plugin-data store. The publish controller owns migration, post-deployment metadata mutations, and generated-index writes in one queue; vault lifecycle adapters keep record paths current on rename/delete events.

**Tech Stack:** TypeScript, Node test runner, Obsidian vault/plugin APIs, Markdown tables, Wrangler Pages static deployment.

**Design spec:** `docs/superpowers/specs/2026-08-07-public-publish-metadata-registry-design.md`

---

### Task 1: Add the normalized public-publish metadata model

**Files:**
- Create: `src/core/publish/publicPublishMetadata.ts`
- Create: `tests/publicPublishMetadata.test.ts`

- [ ] **Step 1: Write failing normalization and transition tests**

Create `tests/publicPublishMetadata.test.ts` with explicit cases for malformed values, canonical paths, later-record deduplication, impossible dates, legacy ISO timestamps, invalid URLs, immutable publish/unpublish transitions, exact file rename, folder rename, file deletion, and folder deletion.

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
    formatPublicPublishDate,
    markPublicPublishMetadataUnpublished,
    normalizePublicPublishMetadataRecords,
    recordSuccessfulPublicPublish,
    removePublicPublishMetadataPath,
    removePublicPublishMetadataPathsInFolder,
    renamePublicPublishMetadataFolder,
    renamePublicPublishMetadataPath,
} from "../src/core/publish/publicPublishMetadata";

const allowedRoot = "public/";

test("public publish metadata normalization rejects malformed records and lets the later canonical path win", () => {
    assert.deepEqual(normalizePublicPublishMetadataRecords([
        null,
        { path: "../outside.md", status: "published", published: "2026-08-01", publishedUrl: "https://example.com/outside" },
        { path: "public/page.md", status: "published", published: "2026-02-30", publishedUrl: "javascript:alert(1)" },
        { path: "public/./page.md", status: "published", published: "2026-08-06T08:00:00.000Z", publishedUrl: "https://publish.example.com/public/page" },
        { path: "public/index.md", status: "published", published: "2026-08-06", publishedUrl: "https://publish.example.com/public/index" },
    ], allowedRoot), [{
        path: "public/page.md",
        status: "published",
        published: "2026-08-06",
        publishedUrl: "https://publish.example.com/public/page",
    }]);
});

test("public publish metadata records successful publish and preserves its date on unpublish", () => {
    const published = recordSuccessfulPublicPublish([], {
        path: "public/page.md",
        published: "2026-08-07",
        publishedUrl: "https://publish.example.com/public/page",
    }, allowedRoot);
    const unpublished = markPublicPublishMetadataUnpublished(published, "public/page.md", allowedRoot);

    assert.deepEqual(unpublished, [{
        path: "public/page.md",
        status: "unpublished",
        published: "2026-08-07",
        publishedUrl: null,
    }]);
    assert.notEqual(unpublished, published);
});

test("public publish metadata follows file and folder lifecycle changes", () => {
    const records = normalizePublicPublishMetadataRecords([
        { path: "public/a.html", status: "published", published: "2026-08-07", publishedUrl: "https://example.com/a" },
        { path: "public/folder/b.pdf", status: "unpublished", published: "2026-08-06", publishedUrl: null },
    ], allowedRoot);

    assert.deepEqual(renamePublicPublishMetadataPath(records, "public/a.html", "public/a-renamed.html", allowedRoot).map((record) => record.path), [
        "public/a-renamed.html",
        "public/folder/b.pdf",
    ]);
    assert.deepEqual(renamePublicPublishMetadataFolder(records, "public/folder", "public/archive", allowedRoot).map((record) => record.path), [
        "public/a.html",
        "public/archive/b.pdf",
    ]);
    assert.deepEqual(removePublicPublishMetadataPath(records, "public/a.html", allowedRoot).map((record) => record.path), ["public/folder/b.pdf"]);
    assert.deepEqual(removePublicPublishMetadataPathsInFolder(records, "public/folder", allowedRoot).map((record) => record.path), ["public/a.html"]);
});

test("publish dates use the local calendar date", () => {
    assert.equal(formatPublicPublishDate(new Date(2026, 7, 7, 0, 5).getTime()), "2026-08-07");
});
```

- [ ] **Step 2: Compile to verify the new module is missing**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `src/core/publish/publicPublishMetadata.ts` does not exist.

- [ ] **Step 3: Implement the focused metadata API**

Create `src/core/publish/publicPublishMetadata.ts` with this public contract:

```ts
export type PublicPublishMetadataStatus = "published" | "unpublished";

export interface PublicPublishMetadataRecord {
    path: string;
    status: PublicPublishMetadataStatus;
    published: string | null;
    publishedUrl: string | null;
}

export interface SuccessfulPublicPublishMetadata {
    path: string;
    published: string;
    publishedUrl: string;
}

export function formatPublicPublishDate(timestamp: number): string;
export function normalizePublicPublishDate(value: unknown): string | null;
export function normalizePublicPublishMetadataRecords(
    value: unknown,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
export function arePublicPublishMetadataRecordsEqual(
    left: readonly PublicPublishMetadataRecord[],
    right: readonly PublicPublishMetadataRecord[],
): boolean;
export function recordSuccessfulPublicPublish(
    value: unknown,
    input: SuccessfulPublicPublishMetadata,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
export function markPublicPublishMetadataUnpublished(
    value: unknown,
    path: string,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
export function renamePublicPublishMetadataPath(
    value: unknown,
    previousPath: string,
    nextPath: string,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
export function renamePublicPublishMetadataFolder(
    value: unknown,
    previousFolderPath: string,
    nextFolderPath: string,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
export function removePublicPublishMetadataPath(
    value: unknown,
    path: string,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
export function removePublicPublishMetadataPathsInFolder(
    value: unknown,
    folderPath: string,
    allowedRoot: string,
): PublicPublishMetadataRecord[];
```

Implement these exact rules:

- Accept only `.md`, `.html`, `.htm`, and `.pdf` paths inside `normalizePublishAllowedRoot(allowedRoot)`.
- Exclude the exact generated `index.md` path.
- Normalize `YYYY-MM-DD` and valid legacy ISO timestamps to a real calendar `YYYY-MM-DD`; invalid/impossible dates become `null`.
- Validate `publishedUrl` with `new URL`, accept only HTTP(S), preserve the trimmed full string, and force it to `null` for unpublished records.
- Normalize duplicate paths through a `Map`; later valid records replace earlier records.
- Sort every returned array by path and never mutate the supplied value.
- Use `Date#getFullYear`, `getMonth`, and `getDate` in `formatPublicPublishDate` so the stored date follows the user's local Obsidian calendar date rather than UTC midnight.
- When a rename moves a record outside the publish root, remove that record rather than retaining a stale path.

- [ ] **Step 4: Run the metadata tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicPublishMetadata.test.js
```

Expected: PASS for every metadata normalization and lifecycle case.

- [ ] **Step 5: Commit the pure model**

```bash
git add src/core/publish/publicPublishMetadata.ts tests/publicPublishMetadata.test.ts
git commit -m "feat(publish): add metadata registry model"
```

### Task 2: Store the registry in normalized plugin data

**Files:**
- Modify: `src/settings/indexNoteSettingsPlanner.ts:26-48,81-135`
- Modify: `src/settings/indexNoteSettingsController.ts:142-166,408-452`
- Modify: `tests/indexNoteSettingsController.test.ts:35-94` and loaded-settings cases

- [ ] **Step 1: Add failing plugin-data normalization tests**

Add tests proving the registry remains outside `AsideSettings`, malformed persisted values normalize before runtime access, and serialized writes preserve unrelated plugin data.

```ts
test("loaded settings resolution normalizes public publish metadata outside AsideSettings", () => {
    const resolved = resolveLoadedSettings({
        publicPublishMetadataRecords: [
            { path: "public/page.md", status: "published", published: "2026-08-07", publishedUrl: "https://publish.example.com/public/page" },
            { path: "../outside.md", status: "published", published: "2026-08-07", publishedUrl: "https://publish.example.com/outside" },
        ],
    }, createSettings());

    assert.equal("publicPublishMetadataRecords" in resolved.settings, false);
    assert.deepEqual(resolved.publicPublishMetadataRecords, [{
        path: "public/page.md",
        status: "published",
        published: "2026-08-07",
        publishedUrl: "https://publish.example.com/public/page",
    }]);
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});
```

Extend the controller harness and add:

```ts
test("settings controller serializes public publish metadata writes without dropping unrelated data", async () => {
    const harness = createControllerHarness({
        loadedData: { scriptRuns: { keep: true }, publicPublishMetadataRecords: [] },
    });
    await harness.controller.loadSettings();

    await Promise.all([
        harness.controller.writePublicPublishMetadataRecords([{
            path: "public/a.md",
            status: "published",
            published: "2026-08-07",
            publishedUrl: "https://publish.example.com/public/a",
        }]),
        harness.controller.updatePersistedPluginData((data) => ({ ...data, agentRuns: { keep: true } })),
    ]);

    assert.deepEqual(harness.controller.readPublicPublishMetadataRecords(), [{
        path: "public/a.md",
        status: "published",
        published: "2026-08-07",
        publishedUrl: "https://publish.example.com/public/a",
    }]);
    assert.deepEqual(harness.savedPayloads.at(-1)?.scriptRuns, { keep: true });
    assert.deepEqual(harness.savedPayloads.at(-1)?.agentRuns, { keep: true });
});
```

- [ ] **Step 2: Compile and run the focused settings suite to verify failure**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js
```

Expected: FAIL because the resolution field and registry accessors do not exist.

- [ ] **Step 3: Add registry normalization to persisted plugin data**

In `src/settings/indexNoteSettingsPlanner.ts`, keep the field off `AsideSettings` and add it only to persisted data and resolution:

```ts
export type PersistedPluginData = Partial<AsideSettings> & {
    publicPublishMetadataRecords?: unknown;
    preferredAgentTarget?: unknown;
    agentRuns?: unknown;
    scriptRuns?: unknown;
    confirmDelete?: unknown;
    enableDebugMode?: unknown;
    remoteRuntimeBaseUrl?: unknown;
    syncedBundledSidenoteSkillPluginVersion?: unknown;
    sidecarStorageMigrationVersion?: unknown;
    sideNoteSyncEventState?: unknown;
    sideNoteSyncEventMigrationVersions?: unknown;
    sourceIdentityState?: unknown;
    sourceIdentityMigrationVersions?: unknown;
};

export interface LoadedSettingsResolution {
    settings: AsideSettings;
    publicPublishMetadataRecords: PublicPublishMetadataRecord[];
    shouldRewriteLegacySettings: boolean;
}
```

Inside `resolveLoadedSettings`, normalize with the already-normalized `publishSettings.publishAllowedRoot`. Set `shouldRewriteLegacySettings` when a present raw registry is not deeply equal to the normalized array, so malformed records and duplicate paths are rewritten once.

- [ ] **Step 4: Expose serialized registry reads and writes**

In `IndexNoteSettingsController`, seed the in-memory persisted data with `resolved.publicPublishMetadataRecords` during `loadSettings`, then add:

```ts
public readPublicPublishMetadataRecords(): PublicPublishMetadataRecord[] {
    return normalizePublicPublishMetadataRecords(
        this.persistedPluginData.publicPublishMetadataRecords,
        this.host.getSettings().publishAllowedRoot,
    );
}

public async writePublicPublishMetadataRecords(
    records: readonly PublicPublishMetadataRecord[],
): Promise<void> {
    const normalized = normalizePublicPublishMetadataRecords(
        records,
        this.host.getSettings().publishAllowedRoot,
    );
    await this.updatePersistedPluginData((data) => ({
        ...data,
        publicPublishMetadataRecords: normalized,
    }));
}
```

All writes must continue through `persistedPluginDataWriteQueue`; do not call `host.saveData` directly from publish code.

- [ ] **Step 5: Run the focused settings and registry tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicPublishMetadata.test.js .test-dist/tests/indexNoteSettingsController.test.js
```

Expected: PASS, including malformed-load rewriting and overlapping plugin-data writes.

- [ ] **Step 6: Commit plugin-data storage**

```bash
git add src/settings/indexNoteSettingsPlanner.ts src/settings/indexNoteSettingsController.ts tests/indexNoteSettingsController.test.ts
git commit -m "feat(publish): persist normalized metadata records"
```

### Task 3: Render compact URL-last publish inventory rows

**Files:**
- Modify: `src/core/text/commentUrls.ts:166-214,253-283`
- Modify: `tests/commentUrlShortening.test.ts:1-67`
- Modify: `src/core/publish/publicPublishIndex.ts:11-211`
- Modify: `tests/publicPublishIndex.test.ts:16-143`

- [ ] **Step 1: Add failing shared URL presentation tests**

Import `formatHttpUrlForMarkdown` in `tests/commentUrlShortening.test.ts` and add:

```ts
test("formatHttpUrlForMarkdown uses comment-card shortening without changing the full target", () => {
    const fullUrl = "https://publish.example.com/public/startup/tech%20stack?language=zh#summary";
    assert.equal(
        formatHttpUrlForMarkdown(fullUrl),
        `[publish.example.com/public/startup/tech stack](${fullUrl})`,
    );
    assert.equal(formatHttpUrlForMarkdown("https://example.com/a"), "https://example.com/a");
});
```

- [ ] **Step 2: Add failing index contract and migration tests**

Change the expected current header and representative row to:

```md
| path | status | last_published_at | published_url |
| --- | --- | --- | --- |
| startup/tech stack.md | published | 2026-08-06 | [publish.example.com/public/startup/tech stack](https://publish.example.com/public/startup/tech%20stack) |
```

Add explicit read cases for:

```ts
const urlLastMarkdown = [
    "| path | status | last_published_at | published_url |",
    "| --- | --- | --- | --- |",
    "| startup/tech stack.md | published | 2026-08-06 | [publish.example.com/public/startup/tech stack](https://publish.example.com/public/startup/tech%20stack) |",
].join("\n");

assert.equal(
    readPublicPublishIndexEntries(urlLastMarkdown)[0]?.publishedUrl,
    "https://publish.example.com/public/startup/tech%20stack",
);
```

Retain fixtures for all supported URL-first four-, five-, and six-column tables. Change valid legacy ISO timestamp expectations to `YYYY-MM-DD`, retain unknown dates as `null`, and verify escaped path/URL pipe characters do not split rows.

- [ ] **Step 3: Run focused tests to verify the old URL-first format fails**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentUrlShortening.test.js .test-dist/tests/publicPublishIndex.test.js
```

Expected: FAIL because the shared single-URL formatter is not exported and the index still renders URL second.

- [ ] **Step 4: Export the comment-card URL formatter**

Keep `buildUrlLabel` and `buildShortMarkdownLink` private. Add this public wrapper in `commentUrls.ts` and make `shortenBareUrlsInLine` call it only after its existing boundary checks:

```ts
export function formatHttpUrlForMarkdown(urlValue: string): string {
    const trimmed = urlValue.trim();
    return buildShortMarkdownLink(trimmed) ?? trimmed;
}
```

Inside `shortenBareUrlsInLine`, continue without replacing when `formatHttpUrlForMarkdown(url) === url`; this preserves the current behavior for short bare URLs.

This preserves one owner for URL length thresholds, decoded labels, truncation, and Markdown label escaping.

- [ ] **Step 5: Implement the URL-last index format**

In `publicPublishIndex.ts`:

```ts
const tableHeader = "| path | status | last_published_at | published_url |";
const currentTableColumns = ["path", "status", "last_published_at", "published_url"] as const;
const urlFirstTableColumns = ["path", "published_url", "status", "last_published_at"] as const;
```

Keep separate format descriptors for the typed and permission-source legacy orders. Render rows with:

```ts
function renderEntryRow(entry: PublicPublishIndexEntry): string {
    const renderedUrl = entry.publishedUrl
        ? formatHttpUrlForMarkdown(entry.publishedUrl)
        : "";
    return `| ${escapeTableCell(entry.path)} | ${entry.status} | ${entry.lastPublishedAt ?? ""} | ${renderedUrl ? escapeTableCell(renderedUrl) : ""} |`;
}
```

Before URL validation, unescape the complete table cell and extract a full generated Markdown target with an anchored, greedy target capture so encoded or literal parentheses remain part of the URL:

```ts
function readPublishedUrlCell(value: string): string | null {
    const cell = unescapeTableCell(value).trim();
    if (!cell) {
        return null;
    }
    const markdownLink = cell.match(/^\[[\s\S]*\]\((https?:\/\/[\s\S]+)\)$/u);
    return markdownLink?.[1] ?? cell;
}
```

Normalize parsed `last_published_at` through `normalizePublicPublishDate`. Continue ignoring non-file legacy rows, malformed rows, and the private permission/type columns.

- [ ] **Step 6: Run URL and index tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentUrlShortening.test.js .test-dist/tests/publicPublishIndex.test.js
```

Expected: PASS for shared URL presentation, URL-last rendering, full-target parsing, prior column orders, date-only values, sorting, and escaping.

- [ ] **Step 7: Commit index presentation and compatibility parsing**

```bash
git add src/core/text/commentUrls.ts tests/commentUrlShortening.test.ts src/core/publish/publicPublishIndex.ts tests/publicPublishIndex.test.ts
git commit -m "fix(publish): compact urls in url-last index"
```

### Task 4: Migrate legacy publish state into the durable registry

**Files:**
- Modify: `src/publish/publicHtmlPublishController.ts:34-41,88-103,156-162,823-913`
- Modify: `tests/publicHtmlPublishController.test.ts:23-116,146-336`

- [ ] **Step 1: Extend the controller harness with registry storage**

Add harness options and host methods:

```ts
publicPublishMetadataRecords?: PublicPublishMetadataRecord[];
metadataWriteError?: Error;
```

```ts
let publicPublishMetadataRecords = normalizePublicPublishMetadataRecords(
    options.publicPublishMetadataRecords ?? [],
    (options.settings ?? settings).publishAllowedRoot,
);
const metadataWrites: PublicPublishMetadataRecord[][] = [];

getPublicPublishMetadataRecords: () => publicPublishMetadataRecords,
setPublicPublishMetadataRecords: async (records) => {
    if (options.metadataWriteError) {
        throw options.metadataWriteError;
    }
    publicPublishMetadataRecords = records.map((record) => ({ ...record }));
    metadataWrites.push(publicPublishMetadataRecords);
},
```

Return getters for records and writes from `createHarness`.

- [ ] **Step 2: Add failing startup migration tests**

Add tests proving:

- A legacy index ISO timestamp becomes a registry date-only value.
- Enabled Markdown and paired HTML frontmatter seed published records with correct full URLs and `published: null` when no trustworthy date exists.
- `publishedPublicArtifactPaths` seeds standalone HTML/PDF records without removing that deployment configuration.
- Existing registry records override index/config-derived status and history.
- Unpublished legacy rows remain in the registry.
- `public/index.md` is excluded.
- Startup refresh persists normalized records before regenerating the URL-last table.

Use this representative assertion:

```ts
assert.deepEqual(harness.getPublicPublishMetadataRecords(), [{
    path: "public/page.md",
    status: "published",
    published: "2026-08-05",
    publishedUrl: "https://publish.example.com/public/page",
}, {
    path: "public/report.pdf",
    status: "published",
    published: null,
    publishedUrl: "https://publish.example.com/public/report.pdf",
}]);
```

- [ ] **Step 3: Run controller tests to verify migration failure**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: FAIL because `PublicHtmlPublishHost` has no metadata registry API and refresh still derives durable state from the index.

- [ ] **Step 4: Add registry methods to the controller host and one serialized state queue**

Extend `PublicHtmlPublishHost`:

```ts
getPublicPublishMetadataRecords(): PublicPublishMetadataRecord[];
setPublicPublishMetadataRecords(records: readonly PublicPublishMetadataRecord[]): Promise<void>;
```

Replace `publicPublishIndexRefreshQueue` with one queue that covers reconciliation, metadata persistence, and index regeneration:

```ts
private publicPublishStateQueue: Promise<void> = Promise.resolve();

private enqueuePublicPublishStateWrite(operation: () => Promise<void>): Promise<void> {
    const result = this.publicPublishStateQueue.then(operation);
    this.publicPublishStateQueue = result.catch(() => undefined);
    return result;
}
```

- [ ] **Step 5: Implement reconciliation with explicit precedence**

Refactor `refreshPublicPublishIndex()` to enqueue one operation that:

1. Reads and parses the existing index.
2. Converts relative index paths to normalized full vault paths and seeds legacy records.
3. Overlays enabled Markdown, paired HTML, and standalone configured paths as published while preserving any legacy date.
4. Overlays normalized stored registry records last, making the registry authoritative.
5. Persists the normalized registry if it changed.
6. Maps full registry paths back to root-relative `PublicPublishIndexEntry` values and writes the generated index.

Keep the transformation in focused private methods with these signatures:

```ts
private async readReconciledPublicPublishMetadata(
    settings: PublishSettings,
): Promise<PublicPublishMetadataRecord[]>;

private async reconcilePublicPublishMetadata(
    settings: PublishSettings,
    existingIndexMarkdown: string | null,
): Promise<PublicPublishMetadataRecord[]>;

private async writePublicPublishIndexFromMetadata(
    settings: PublishSettings,
    records: readonly PublicPublishMetadataRecord[],
): Promise<void>;
```

`readReconciledPublicPublishMetadata` owns the fresh index read and delegates the deterministic merge to `reconcilePublicPublishMetadata`; both startup refresh and post-deployment mutations use that same entrypoint.

Write registry data before the index. If index creation/modification fails, leave the saved registry intact so the next refresh can recover.

- [ ] **Step 6: Run startup migration tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicPublishMetadata.test.js .test-dist/tests/publicPublishIndex.test.js .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: PASS for migration, honest unknown dates, precedence, exclusion, and registry-derived index regeneration.

- [ ] **Step 7: Commit startup migration**

```bash
git add src/publish/publicHtmlPublishController.ts tests/publicHtmlPublishController.test.ts
git commit -m "feat(publish): migrate inventory into registry"
```

### Task 5: Persist publish and unpublish results only after deployment succeeds

**Files:**
- Modify: `src/publish/publicHtmlPublishController.ts:404-498,500-638,779-900`
- Modify: `tests/publicHtmlPublishController.test.ts:146-336,520-723,905-954`

- [ ] **Step 1: Add failing publish lifecycle and error tests**

Add exact cases for:

```text
publish Markdown/HTML/PDF -> status published, local date, full URL
republish next day -> replace published date
unpublish -> status unpublished, preserve date, clear URL
unpublish migrated legacy row -> preserve migrated date
failed deployment -> no metadata/index writes
metadata save failure after successful deploy -> ok false incomplete-state notice, index unchanged
index write failure after metadata save -> metadata retained, ok false stale-index notice
startup refresh overlapping publish -> publish mutation wins after serialized refresh
```

Use a mutable injected timestamp in the harness:

```ts
let now = Date.parse("2026-08-06T08:00:00.000Z");
const controller = new PublicHtmlPublishController(host, () => now);
```

Expose `setNow` and assert a republish on `2026-08-07` replaces `published: "2026-08-06"` with `published: "2026-08-07"`.

- [ ] **Step 2: Run the controller suite to verify old index-only recording fails**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: FAIL because successful operations still write an ISO timestamp override directly to `public/index.md`.

- [ ] **Step 3: Replace index overrides with registry mutations**

Keep `recordPublicPublishResult` after each existing deploy/configuration path. For a successful result, enqueue a reconciliation followed by exactly one transition:

```ts
private async recordPublicPublishResult(
    filePath: string,
    status: PublicPublishMetadataStatus,
    result: PublicHtmlPublishResult,
): Promise<PublicHtmlPublishResult> {
    if (!result.ok) {
        return result;
    }

    try {
        await this.enqueuePublicPublishStateWrite(async () => {
            const settings = this.host.getSettings();
            const records = await this.readReconciledPublicPublishMetadata(settings);
            const nextRecords = status === "published"
                ? recordSuccessfulPublicPublish(records, {
                    path: filePath,
                    published: formatPublicPublishDate(this.now()),
                    publishedUrl: result.url,
                }, settings.publishAllowedRoot)
                : markPublicPublishMetadataUnpublished(records, filePath, settings.publishAllowedRoot);
            await this.host.setPublicPublishMetadataRecords(nextRecords);
            await this.writePublicPublishIndexFromMetadata(settings, nextRecords);
        });
        return result;
    } catch (error) {
        return {
            ok: false,
            notice: `Publish deployment succeeded, but Aside could not finish local publish metadata: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
```

Do not alter metadata for `result.ok === false`. Do not clear `published` on unpublish. Do not roll back a successful remote deployment when local persistence fails; report the incomplete state explicitly.

- [ ] **Step 4: Distinguish recoverable index failure in tests and notices**

Wrap only the generated-file write in a typed error:

```ts
class PublicPublishIndexWriteError extends Error {
    public readonly cause: unknown;

    constructor(cause: unknown) {
        super("Unable to regenerate public/index.md.");
        this.name = "PublicPublishIndexWriteError";
        this.cause = cause;
    }
}
```

If `recordPublicPublishResult` catches this error after `setPublicPublishMetadataRecords` succeeds, return:

```ts
{
    ok: false,
    notice: "Publish metadata was saved, but Aside could not regenerate public/index.md. Reload or refresh publishing to retry.",
}
```

Other persistence errors retain the incomplete-metadata notice from Step 3. Preserve the stored registry after an index failure and prove that a later `refreshPublicPublishIndex()` regenerates the file.

- [ ] **Step 5: Run all publish-focused tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicPublishMetadata.test.js .test-dist/tests/publicPublishIndex.test.js .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: PASS for publish, republish, unpublish, deployment failure, persistence failure, index recovery, and overlapping operations.

- [ ] **Step 6: Commit durable lifecycle mutations**

```bash
git add src/publish/publicHtmlPublishController.ts tests/publicHtmlPublishController.test.ts
git commit -m "fix(publish): persist successful publish metadata"
```

### Task 6: Keep registry and standalone configuration aligned on rename/delete

**Files:**
- Modify: `src/core/publish/publishedPublicArtifacts.ts:26-88`
- Modify: `tests/publishedPublicArtifacts.test.ts:1-46`
- Modify: `src/app/pluginEventRouter.ts:22-103`
- Modify: `tests/pluginEventRouter.test.ts:17-143`
- Modify: `src/app/pluginLifecycleController.ts:5-16,87-140`
- Modify: `tests/pluginLifecycleController.test.ts:72-190,274-399`
- Modify: `src/main.ts:88-96,529-576,587-604,965-1009`

- [ ] **Step 1: Add a failing standalone folder-rename helper test**

Add and test this API in `publishedPublicArtifacts.ts`:

```ts
export function renamePublishedPublicArtifactPathsInFolder(
    value: unknown,
    previousFolderPath: string,
    nextFolderPath: string,
    allowedRoot: string,
): string[];
```

The test must move `public/old/a.html` and `public/old/nested/b.pdf` to `public/new/...`, retain unrelated paths, and remove moved paths when the destination is outside the publish root.

- [ ] **Step 2: Add failing folder-rename routing tests**

In `pluginEventRouter.test.ts`, send `createFolder("public/new")` through the rename handler with old path `public/old` and expect:

```ts
assert.deepEqual(harness.calls, ["rename:public/old->public/new"]);
```

In `pluginLifecycleController.test.ts`, add separate captured calls for file and folder publish-state renames. Assert folder rename calls the folder host method and does not enter file comment hydration.

- [ ] **Step 3: Run lifecycle tests to verify folders are currently discarded**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publishedPublicArtifacts.test.js .test-dist/tests/pluginEventRouter.test.js .test-dist/tests/pluginLifecycleController.test.js
```

Expected: FAIL because the event router converts renamed folders to `null` and no folder-rename publish helper exists.

- [ ] **Step 4: Preserve abstract files through rename routing**

Change `PluginEventRouterHost.handleFileRename` and `PluginLifecycleController.handleFileRename` to accept `TAbstractFile | null`. Route rename events through the existing `isTAbstractFile` guard:

```ts
this.host.app.vault.on("rename", async (file, oldPath) => {
    await this.host.handleFileRename(
        isTAbstractFile(file) ? file : null,
        oldPath,
    );
});
```

In the lifecycle controller, branch before file-only comment handling:

```ts
if (this.isFolder(file)) {
    await this.host.renamePublishedPublicArtifactFolder(oldPath, file.path);
    return;
}
await this.host.renamePublishedPublicArtifactPath(oldPath, file.path);
```

Add `renamePublishedPublicArtifactFolder` to `PluginLifecycleHost`.

- [ ] **Step 5: Wire main.ts to mutate config and registry, then regenerate the index**

Add main-plugin helpers that use the pure functions and the serialized settings controller:

```ts
private async updatePublicPublishMetadataRecords(
    nextRecords: readonly PublicPublishMetadataRecord[],
): Promise<void> {
    await this.indexNoteSettingsController.writePublicPublishMetadataRecords(nextRecords);
    await this.publicHtmlPublishController.refreshPublicPublishIndex();
}
```

For file rename/delete and folder rename/delete:

1. Update `publishedPublicArtifactPaths` with its existing or new folder helper.
2. Read registry records with `indexNoteSettingsController.readPublicPublishMetadataRecords()`.
3. Apply the matching pure metadata rename/remove helper.
4. Persist changed metadata.
5. Refresh the generated index.

Pass controller host methods in `main.ts`:

```ts
getPublicPublishMetadataRecords: () => this.indexNoteSettingsController.readPublicPublishMetadataRecords(),
setPublicPublishMetadataRecords: (records) => this.indexNoteSettingsController.writePublicPublishMetadataRecords(records),
```

Do not add `publicPublishMetadataRecords` to `AsideSettings`, `DEFAULT_SETTINGS`, or the settings UI.

- [ ] **Step 6: Run lifecycle and publish suites**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publishedPublicArtifacts.test.js .test-dist/tests/pluginEventRouter.test.js .test-dist/tests/pluginLifecycleController.test.js .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: PASS for file/folder rename/delete and existing page-note lifecycle behavior.

- [ ] **Step 7: Run typecheck to verify the real Obsidian adapters**

```bash
npm run typecheck
```

Expected: PASS with `TAbstractFile` rename routing and the new controller host methods.

- [ ] **Step 8: Commit lifecycle integration**

```bash
git add src/core/publish/publishedPublicArtifacts.ts tests/publishedPublicArtifacts.test.ts src/app/pluginEventRouter.ts tests/pluginEventRouter.test.ts src/app/pluginLifecycleController.ts tests/pluginLifecycleController.test.ts src/main.ts
git commit -m "fix(publish): track metadata across vault lifecycle"
```

### Task 7: Verify, document, install, and inspect the real vault migration

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-public-publish-metadata-registry-design.md`
- Verify only: `main.js`
- Verify only: `manifest.json`
- Verify only: `styles.css`
- Verify only: `/Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/data.json`
- Verify only: `/Users/wenqingli/Obsidian/lean-startup/public/index.md`

- [ ] **Step 1: Run the complete focused regression group**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicPublishMetadata.test.js .test-dist/tests/commentUrlShortening.test.js .test-dist/tests/publicPublishIndex.test.js .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/publishedPublicArtifacts.test.js .test-dist/tests/pluginEventRouter.test.js .test-dist/tests/pluginLifecycleController.test.js .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: all registry, presentation, storage, controller, and lifecycle tests pass.

- [ ] **Step 2: Run the full verified build**

```bash
npm run build
```

Expected: the full test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard all pass.

- [ ] **Step 3: Inspect the exact install artifacts as public files**

```bash
npm run release:artifacts:check
test ! -e main.js.map
```

Expected: inspection passes for exactly `main.js`, `manifest.json`, and `styles.css`; no `main.js.map` exists. The guard rejects `sourceMappingURL`, `sourcesContent`, local user paths, private keys/certificates, recognizable tokens, and global `fetch` in shipped output. No raw TypeScript/JSX, fixtures, `.env*`, `.npmrc`, private keys, or certificates are included in the three-file install set.

- [ ] **Step 4: Update the tracked design checklist from evidence**

Mark each implementation and verification item `[x]` only when its corresponding code/test/build evidence from Tasks 1-7 exists. Keep the real-vault inspection item unchecked until Step 7 completes.

- [ ] **Step 5: Commit the verified implementation status**

```bash
git add docs/superpowers/specs/2026-08-07-public-publish-metadata-registry-design.md
git commit -m "docs: verify publish metadata registry"
```

- [ ] **Step 6: Install the verified three-file build into lean-startup**

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
cmp -s main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: install succeeds and all three `cmp` commands exit 0, proving byte-identical installed artifacts.

- [ ] **Step 7: Reload Aside in the lean-startup vault and inspect migration output**

Reload the Aside plugin from Obsidian's Community Plugins UI so startup maintenance runs. Do not trigger a remote republish solely to manufacture historical dates.

Inspect:

```bash
rg -n -A 80 '"publicPublishMetadataRecords"' /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/data.json
sed -n '1,120p' /Users/wenqingli/Obsidian/lean-startup/public/index.md
```

Expected:

- Plugin data contains normalized full vault paths, status, full URL targets, and `published: null` for historical artifacts whose prior publish date cannot be recovered.
- The index header is `| path | status | last_published_at | published_url |`.
- Long/encoded URLs render as compact clickable Markdown links in the final column.
- Existing unknown historical dates remain empty rather than being assigned the migration date.
- Any later real publish/republish fills the current local `YYYY-MM-DD` date through the tested post-deployment path.

- [ ] **Step 8: Mark real-vault verification complete and commit**

After the data and index inspection succeeds, mark the final real-vault checklist item `[x]` and commit it:

```bash
git add docs/superpowers/specs/2026-08-07-public-publish-metadata-registry-design.md
git commit -m "docs: verify real publish metadata migration"
```

- [ ] **Step 9: Confirm the final worktree state**

```bash
git status --short
git log -8 --oneline
```

Expected: no unintended changes; the history contains focused commits for the model, storage, index presentation, migration, publish lifecycle, vault lifecycle, and verification.
