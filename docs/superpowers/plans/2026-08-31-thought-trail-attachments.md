# Thought Trail Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-scoped `Attachments` source to Thought Trail that lists direct resolved non-Markdown embeds from the selected file.

**Architecture:** A focused attachment module will own pure normalization, filtering, deduplication, ordering, and the thin Obsidian metadata-cache adapter. `sidebarThoughtTrailSource.ts` will become the sole source-policy owner for IDs, labels, scope, availability, and fallback; `AsideView` will compute one attachment model per render path and pass it to the existing renderer, which adds a compact semantic list while preserving Wikilinks and Tags.

**Tech Stack:** TypeScript 5.9, Obsidian `App`/`MetadataCache`/`TFile` APIs, existing DOM helpers and preferred-leaf navigation, Node's built-in test runner, ESLint, esbuild, CSS with Obsidian variables.

**Design:** `docs/superpowers/specs/2026-08-31-thought-trail-attachments-design.md`

---

## File Structure

- Create `src/ui/views/sidebarThoughtTrailAttachments.ts` as the single attachment-model owner and Obsidian metadata adapter.
- Create `tests/sidebarThoughtTrailAttachments.test.ts` for pure model and adapter behavior.
- Modify `src/ui/views/sidebarThoughtTrailSource.ts` so all source identity, label, scope, availability, ordering, and fallback policy has one owner.
- Modify `tests/sidebarThoughtTrailSource.test.ts` to lock the three-source policy.
- Modify `src/ui/views/sidebarThoughtTrailState.ts` to own Thought Trail availability across Wikilinks, Tags, and Attachments.
- Modify `tests/sidebarThoughtTrailState.test.ts` to prove attachments alone enable Thought Trail.
- Modify `src/ui/views/AsideView.ts` to compute attachment models for note, index, and loaded-thread availability paths and pass availability facts through shared helpers.
- Modify `src/ui/views/sidebarThoughtTrailRenderer.ts` to consume shared source definitions and render the attachment list.
- Modify `tests/sidebarThoughtTrailRendererSource.test.mjs` for representative renderer wiring and change-surface ownership checks.
- Modify `styles.css` and `tests/toolbarDisabledStyles.test.mjs` for compact theme-native attachment rows.
- Modify the design spec only after every implementation and verification item has evidence.

## Baseline

The isolated worktree is `.worktrees/thought-trail-attachments` on `feat/thought-trail-attachments`, based on design commit `ba54522`. Before implementation, `npm test` passes 1,351 TypeScript tests and 105 `.mjs` contract tests with zero failures.

### Task 1: Direct Attachment Model and Metadata Adapter

**Files:**
- Create: `src/ui/views/sidebarThoughtTrailAttachments.ts`
- Create: `tests/sidebarThoughtTrailAttachments.test.ts`

- [ ] **Step 1: Write the failing pure-model and adapter tests**

Create `tests/sidebarThoughtTrailAttachments.test.ts` with real resolved-file descriptors and a small Obsidian adapter harness:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import type { App, CachedMetadata, TFile } from "obsidian";
import {
    buildThoughtTrailAttachmentItems,
    getDirectThoughtTrailAttachments,
} from "../src/ui/views/sidebarThoughtTrailAttachments";

function createFile(path: string, extension: string): TFile {
    const name = path.split("/").pop() ?? path;
    return { path, name, extension, basename: name.replace(/\.[^.]+$/u, "") } as TFile;
}

test("buildThoughtTrailAttachmentItems keeps unique resolved non-Markdown embeds in display order", () => {
    const targets = new Map([
        ["Image", { filePath: "assets/Zebra.PNG", fileName: "Zebra.PNG", extension: "PNG" }],
        ["Pdf", { filePath: "files/alpha.pdf", fileName: "alpha.pdf", extension: "pdf" }],
        ["Markdown", { filePath: "docs/note.md", fileName: "note.md", extension: "MD" }],
    ]);

    assert.deepEqual(
        buildThoughtTrailAttachmentItems(
            "docs/source.md",
            ["Image", "Pdf", "Image", "Markdown", "Missing"],
            (linkPath) => targets.get(linkPath) ?? null,
        ),
        [
            { filePath: "files/alpha.pdf", label: "alpha.pdf", typeLabel: "PDF" },
            { filePath: "assets/Zebra.PNG", label: "Zebra.PNG", typeLabel: "PNG" },
        ],
    );
});

test("buildThoughtTrailAttachmentItems normalizes resolved paths and labels extensionless files", () => {
    assert.deepEqual(
        buildThoughtTrailAttachmentItems("docs/source.md", ["Data", "Duplicate"], () => ({
            filePath: "assets\\raw-data",
            fileName: "raw-data",
            extension: "",
        })),
        [{ filePath: "assets/raw-data", label: "raw-data", typeLabel: "FILE" }],
    );
});

test("getDirectThoughtTrailAttachments reads embeds only from the selected Markdown file", () => {
    const source = createFile("docs/source.md", "md");
    const image = createFile("assets/image.png", "png");
    const markdown = createFile("docs/embedded.md", "md");
    const metadataByPath = new Map<string, CachedMetadata>([[source.path, {
        embeds: [
            { link: "assets/image.png", original: "![[assets/image.png]]", position: {} as never },
            { link: "docs/embedded.md", original: "![[docs/embedded.md]]", position: {} as never },
        ],
    }]]);
    const app = {
        vault: { getAbstractFileByPath: (path: string) => path === source.path ? source : null },
        metadataCache: {
            getFileCache: (file: TFile) => metadataByPath.get(file.path) ?? null,
            getFirstLinkpathDest: (linkPath: string) =>
                linkPath === image.path ? image : linkPath === markdown.path ? markdown : null,
        },
    } as unknown as App;

    assert.deepEqual(getDirectThoughtTrailAttachments(app, source.path), [
        { filePath: image.path, label: image.name, typeLabel: "PNG" },
    ]);
    assert.deepEqual(getDirectThoughtTrailAttachments(app, "docs/other.md"), []);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailAttachments.test.js
```

Expected: FAIL because `sidebarThoughtTrailAttachments` and its exports do not exist. The failure must be about the missing feature, not malformed test data.

- [ ] **Step 3: Implement the minimal attachment owner**

Create `src/ui/views/sidebarThoughtTrailAttachments.ts`:

```ts
import type { App, TFile } from "obsidian";

export interface ThoughtTrailAttachmentTarget {
    filePath: string;
    fileName: string;
    extension: string;
}

export interface ThoughtTrailAttachmentItem {
    filePath: string;
    label: string;
    typeLabel: string;
}

type ThoughtTrailAttachmentResolver = (
    linkPath: string,
    sourceFilePath: string,
) => ThoughtTrailAttachmentTarget | null;

function normalizeVaultPath(value: string): string {
    return value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}

function isFileLike(value: unknown): value is TFile {
    const candidate = value as Partial<TFile> | null;
    return !!candidate
        && typeof candidate.path === "string"
        && typeof candidate.name === "string"
        && typeof candidate.extension === "string";
}

export function buildThoughtTrailAttachmentItems(
    sourceFilePath: string,
    embedLinkPaths: readonly string[],
    resolveTarget: ThoughtTrailAttachmentResolver,
): ThoughtTrailAttachmentItem[] {
    const itemsByPath = new Map<string, ThoughtTrailAttachmentItem>();
    for (const rawLinkPath of embedLinkPaths) {
        const linkPath = rawLinkPath.trim();
        const target = linkPath ? resolveTarget(linkPath, sourceFilePath) : null;
        const filePath = normalizeVaultPath(target?.filePath ?? "");
        const extension = target?.extension.trim().replace(/^\./u, "") ?? "";
        if (!target || !filePath || extension.toLowerCase() === "md" || itemsByPath.has(filePath)) {
            continue;
        }

        itemsByPath.set(filePath, {
            filePath,
            label: target.fileName || filePath.split("/").pop() || filePath,
            typeLabel: extension ? extension.toUpperCase() : "FILE",
        });
    }

    return Array.from(itemsByPath.values()).sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
        || left.filePath.localeCompare(right.filePath)
    );
}

export function getDirectThoughtTrailAttachments(
    app: App,
    sourceFilePath: string,
): ThoughtTrailAttachmentItem[] {
    const sourceFile = app.vault.getAbstractFileByPath(sourceFilePath);
    if (!isFileLike(sourceFile) || sourceFile.extension.toLowerCase() !== "md") {
        return [];
    }

    const embedLinkPaths = (app.metadataCache.getFileCache(sourceFile)?.embeds ?? [])
        .map((embed) => embed.link)
        .filter((linkPath): linkPath is string => typeof linkPath === "string" && !!linkPath.trim());
    return buildThoughtTrailAttachmentItems(sourceFilePath, embedLinkPaths, (linkPath, sourcePath) => {
        const target = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
        return isFileLike(target)
            ? { filePath: target.path, fileName: target.name, extension: target.extension }
            : null;
    });
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused command. Expected: 3 tests pass, 0 fail. Then run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailGraph.test.js .test-dist/tests/thoughtTrailNoteLinkGraph.test.js
```

Expected: existing Markdown embed/Wikilink tests remain green.

- [ ] **Step 5: Commit the model slice**

```bash
git add src/ui/views/sidebarThoughtTrailAttachments.ts tests/sidebarThoughtTrailAttachments.test.ts
git commit -m "feat(thought-trail): model attachments"
```

### Task 2: Shared Three-Source Policy

**Files:**
- Modify: `src/ui/views/sidebarThoughtTrailSource.ts`
- Modify: `tests/sidebarThoughtTrailSource.test.ts`

- [ ] **Step 1: Extend source-policy tests first**

Update `tests/sidebarThoughtTrailSource.test.ts` to import `SIDEBAR_THOUGHT_TRAIL_SOURCES`, `getThoughtTrailSourceDefinition`, and `isThoughtTrailSourceAvailable`. Add the definition test, replace the existing normalization test with the version below, and replace the existing boolean availability test with the object-form version below:

```ts
test("Thought Trail source definitions own order, labels, and scope", () => {
    assert.deepEqual(SIDEBAR_THOUGHT_TRAIL_SOURCES, [
        { id: "wikilinks", label: "Wikilinks", scope: "Vault" },
        { id: "tags", label: "Tags", scope: "Vault" },
        { id: "attachments", label: "Attachments", scope: "File" },
    ]);
    assert.equal(getThoughtTrailSourceDefinition("attachments").scope, "File");
});

test("normalizeThoughtTrailSource accepts all and only supported sources", () => {
    assert.equal(normalizeThoughtTrailSource("wikilinks"), "wikilinks");
    assert.equal(normalizeThoughtTrailSource("tags"), "tags");
    assert.equal(normalizeThoughtTrailSource("attachments"), "attachments");
    assert.equal(normalizeThoughtTrailSource("links"), null);
});

test("source availability disables alternatives independently and falls back to Wikilinks", () => {
    const neither = { tags: false, attachments: false };
    assert.equal(isThoughtTrailSourceAvailable("wikilinks", neither), true);
    assert.equal(isThoughtTrailSourceAvailable("tags", neither), false);
    assert.equal(isThoughtTrailSourceAvailable("attachments", neither), false);
    assert.equal(resolveAvailableThoughtTrailSource("tags", neither), "wikilinks");
    assert.equal(resolveAvailableThoughtTrailSource("attachments", neither), "wikilinks");
    assert.equal(resolveAvailableThoughtTrailSource("attachments", { tags: false, attachments: true }), "attachments");
});
```

- [ ] **Step 2: Run the source test and verify RED**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailSource.test.js
```

Expected: FAIL because the third source, definitions, availability object, and helper exports are absent.

- [ ] **Step 3: Centralize the complete policy**

Replace `src/ui/views/sidebarThoughtTrailSource.ts` with:

```ts
export type SidebarThoughtTrailSource = "wikilinks" | "tags" | "attachments";
export type SidebarThoughtTrailScope = "Vault" | "File";

export interface SidebarThoughtTrailSourceAvailability {
    tags: boolean;
    attachments: boolean;
}

export interface SidebarThoughtTrailSourceDefinition {
    id: SidebarThoughtTrailSource;
    label: string;
    scope: SidebarThoughtTrailScope;
}

export const SIDEBAR_THOUGHT_TRAIL_SOURCES: readonly SidebarThoughtTrailSourceDefinition[] = [
    { id: "wikilinks", label: "Wikilinks", scope: "Vault" },
    { id: "tags", label: "Tags", scope: "Vault" },
    { id: "attachments", label: "Attachments", scope: "File" },
];

export function getDefaultThoughtTrailSource(): SidebarThoughtTrailSource {
    return "wikilinks";
}

export function normalizeThoughtTrailSource(value: unknown): SidebarThoughtTrailSource | null {
    return SIDEBAR_THOUGHT_TRAIL_SOURCES.some((definition) => definition.id === value)
        ? value as SidebarThoughtTrailSource
        : null;
}

export function getThoughtTrailSourceDefinition(
    source: SidebarThoughtTrailSource,
): SidebarThoughtTrailSourceDefinition {
    return SIDEBAR_THOUGHT_TRAIL_SOURCES.find((definition) => definition.id === source)
        ?? SIDEBAR_THOUGHT_TRAIL_SOURCES[0];
}

export function isThoughtTrailSourceAvailable(
    source: SidebarThoughtTrailSource,
    availability: SidebarThoughtTrailSourceAvailability,
): boolean {
    return source === "wikilinks" || availability[source];
}

export function resolveAvailableThoughtTrailSource(
    source: SidebarThoughtTrailSource,
    availability: SidebarThoughtTrailSourceAvailability,
): SidebarThoughtTrailSource {
    return isThoughtTrailSourceAvailable(source, availability)
        ? source
        : getDefaultThoughtTrailSource();
}
```

- [ ] **Step 4: Run the focused source test and typecheck**

Run the focused command. Expected: all source-policy tests pass. Then run:

```bash
npm run typecheck
```

Expected: typecheck exits 0. The only pre-existing resolver consumer is the source-policy test replaced in Step 1; do not add renderer or AsideView behavior in this slice.

- [ ] **Step 5: Commit the policy slice**

```bash
git add src/ui/views/sidebarThoughtTrailSource.ts tests/sidebarThoughtTrailSource.test.ts
git commit -m "feat(thought-trail): add attachment source policy"
```

### Task 3: Sidebar Availability and Attachment Data Flow

**Files:**
- Modify: `src/ui/views/sidebarThoughtTrailState.ts`
- Modify: `tests/sidebarThoughtTrailState.test.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts` (options type only)
- Modify: `tests/sidebarThoughtTrailRendererSource.test.mjs` (wiring contract only)

- [ ] **Step 1: Write failing availability and wiring tests**

Extend the existing import from `sidebarThoughtTrailState`, then add to `tests/sidebarThoughtTrailState.test.ts`:

```ts
import { getThoughtTrailUnavailableReason } from "../src/ui/views/sidebarThoughtTrailState";

test("direct attachments make an otherwise empty rooted Thought Trail available", () => {
    assert.equal(getThoughtTrailUnavailableReason({
        hasRootScope: true,
        lineCount: 0,
        sourceAvailability: { tags: false, attachments: true },
    }), null);
    assert.equal(getThoughtTrailUnavailableReason({
        hasRootScope: true,
        lineCount: 0,
        sourceAvailability: { tags: false, attachments: false },
    }), "no-renderable-lines");
    assert.equal(getThoughtTrailUnavailableReason({
        hasRootScope: false,
        lineCount: 1,
        sourceAvailability: { tags: true, attachments: true },
    }), "no-root-scope");
});
```

Update the AsideView source contract in `tests/sidebarThoughtTrailRendererSource.test.mjs` so it requires one shared attachment adapter and the shared resolver rather than an inline `attachments` branch:

```js
test("AsideView shares attachment models across availability and rendering", () => {
    assert.match(asideViewSource, /getDirectThoughtTrailAttachments/);
    assert.match(asideViewSource, /resolveAvailableThoughtTrailSource/);
    const attachmentCalls = asideViewSource.match(/getDirectThoughtTrailAttachments\(/g) ?? [];
    assert.equal(attachmentCalls.length, 3, "index, note render, and loaded-thread availability use one adapter");
    assert.match(asideViewSource, /attachments:\s*indexThoughtTrailAttachments/);
    assert.match(asideViewSource, /attachments:\s*thoughtTrailAttachments/);
});
```

- [ ] **Step 2: Verify the new availability tests fail**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailState.test.js
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
```

Expected: the TypeScript test fails because the shared unavailable-reason helper does not exist; the contract test fails because AsideView does not discover or pass attachments.

- [ ] **Step 3: Move availability policy into `sidebarThoughtTrailState.ts`**

Import `SidebarThoughtTrailSourceAvailability` and add:

```ts
export type ThoughtTrailUnavailableReason = "no-root-scope" | "no-renderable-lines";

export function getThoughtTrailUnavailableReason(options: {
    hasRootScope: boolean;
    lineCount: number;
    sourceAvailability: SidebarThoughtTrailSourceAvailability;
}): ThoughtTrailUnavailableReason | null {
    if (!options.hasRootScope) {
        return "no-root-scope";
    }

    return options.lineCount > 0
        || options.sourceAvailability.tags
        || options.sourceAvailability.attachments
        ? null
        : "no-renderable-lines";
}
```

Remove the private duplicate from `AsideView.ts` and import this shared helper.

- [ ] **Step 4: Thread attachment models through every AsideView path**

Import `getDirectThoughtTrailAttachments` and `ThoughtTrailAttachmentItem`, plus `resolveAvailableThoughtTrailSource` and `SidebarThoughtTrailSourceAvailability`.

For index availability, compute and retain the exact model:

```ts
const indexThoughtTrailAttachments = selectedIndexFileFilterRootPath
    ? getDirectThoughtTrailAttachments(this.app, selectedIndexFileFilterRootPath)
    : [];
const indexThoughtTrailSourceAvailability: SidebarThoughtTrailSourceAvailability = {
    tags: hasIndexThoughtTrailTagSource,
    attachments: indexThoughtTrailAttachments.length > 0,
};
const indexThoughtTrailUnavailableReason = isAllCommentsView
    ? getThoughtTrailUnavailableReason({
        hasRootScope: hasIndexThoughtTrailRootScope,
        lineCount: indexThoughtTrailLineCount,
        sourceAvailability: indexThoughtTrailSourceAvailability,
    })
    : null;
```

Pass the retained model and availability to the renderer call:

```ts
attachments: indexThoughtTrailAttachments,
source: this.resolveThoughtTrailSource(indexThoughtTrailSourceAvailability),
```

Use the same shape in `renderNoteThoughtTrailSidebar`:

```ts
const thoughtTrailAttachments = getDirectThoughtTrailAttachments(this.app, file.path);
const thoughtTrailSourceAvailability = {
    tags: hasThoughtTrailTagSource,
    attachments: thoughtTrailAttachments.length > 0,
};
const hasThoughtTrailRootScope = scopedFilePaths.length > 0
    || hasThoughtTrailTagSource
    || thoughtTrailAttachments.length > 0;
```

Pass `attachments: thoughtTrailAttachments` and the resolved source into its renderer options. In `buildNoteThoughtTrailAvailabilityFromLoadedThreads`, call the same attachment adapter for `file.path`, include it in `hasThoughtTrailRootScope`, and call the object-form unavailable-reason helper.

Replace the view's source resolver with the shared policy:

```ts
private resolveThoughtTrailSource(
    availability: SidebarThoughtTrailSourceAvailability,
): SidebarThoughtTrailSource {
    this.thoughtTrailSource = resolveAvailableThoughtTrailSource(
        this.thoughtTrailSource,
        availability,
    );
    return this.thoughtTrailSource;
}
```

Extend `SidebarThoughtTrailOptions` with:

```ts
attachments: readonly ThoughtTrailAttachmentItem[];
```

Do not render the list in this task; this slice establishes compile-safe shared data flow and availability first.

- [ ] **Step 5: Verify availability, wiring, and existing sidebar behavior**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailState.test.js .test-dist/tests/sidebarThoughtTrailScope.test.js .test-dist/tests/sidebarThoughtTrailSource.test.js
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
npm run typecheck
```

Expected: all focused tests and typecheck pass. The source contract should find exactly the three intentional attachment adapter calls and no renderer-only discovery path.

- [ ] **Step 6: Commit the availability slice**

```bash
git add src/ui/views/sidebarThoughtTrailState.ts tests/sidebarThoughtTrailState.test.ts src/ui/views/AsideView.ts src/ui/views/sidebarThoughtTrailRenderer.ts tests/sidebarThoughtTrailRendererSource.test.mjs
git commit -m "feat(thought-trail): enable attachment-only trails"
```

### Task 4: Attachment Source Control, List, Navigation, and Styles

**Files:**
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts`
- Modify: `tests/sidebarThoughtTrailRendererSource.test.mjs`
- Modify: `styles.css`
- Modify: `tests/toolbarDisabledStyles.test.mjs`

- [ ] **Step 1: Write failing renderer and style contracts**

Add renderer assertions that require the shared definitions, semantic attachment list, exact row fields, tooltip, and shared opener:

```js
test("Thought Trail renders the shared three-source policy and dynamic scope", () => {
    assert.match(source, /for \(const definition of SIDEBAR_THOUGHT_TRAIL_SOURCES\)/);
    assert.match(source, /isThoughtTrailSourceAvailable\(definition\.id,\s*options\.sourceAvailability\)/);
    assert.match(source, /text:\s*definition\.label/);
    assert.match(source, /text:\s*`Scope: \$\{getThoughtTrailSourceDefinition\(options\.source\)\.scope\}`/);
    assert.doesNotMatch(source, /\["wikilinks",\s*"tags"\]/);
});

test("attachments render one compact semantic list and reuse exact file opening", () => {
    assert.match(source, /createEl\("ul",\s*\{\s*cls:\s*"aside-thought-trail-attachments"/);
    assert.match(source, /createEl\("li",\s*\{[\s\S]*?cls:\s*"aside-thought-trail-attachment-row"/);
    assert.match(source, /cls:\s*"aside-thought-trail-attachment-link"[\s\S]*?type:\s*"button"/);
    assert.match(source, /text:\s*attachment\.label/);
    assert.match(source, /text:\s*attachment\.typeLabel/);
    assert.match(source, /setTooltip\(button,\s*attachment\.filePath\)/);
    assert.match(source, /openThoughtTrailFile\(attachment\.filePath,\s*context\)/);
});
```

Add a stylesheet test using the existing `getExactCssRule` helper:

```js
test("thought trail attachments stay compact and theme-native", () => {
    const listRule = getExactCssRule(".aside-thought-trail-attachments");
    const rowRule = getExactCssRule(".aside-thought-trail-attachment-row");
    const linkRule = getExactCssRule(".aside-thought-trail button.aside-thought-trail-attachment-link");
    const typeRule = getExactCssRule(".aside-thought-trail-attachment-type");
    assert.match(listRule.body, /list-style:\s*none\s*;/);
    assert.match(listRule.body, /padding:\s*0\s*;/);
    assert.match(rowRule.body, /display:\s*flex\s*;/);
    assert.match(linkRule.body, /color:\s*var\(--text-normal\)\s*;/);
    assert.match(typeRule.body, /color:\s*var\(--text-faint\)\s*;/);
    assert.doesNotMatch(listRule.body + rowRule.body + linkRule.body + typeRule.body, /#[0-9a-f]{3,6}|purple|blue/iu);
});
```

- [ ] **Step 2: Run renderer/style contracts and verify RED**

```bash
node --test tests/sidebarThoughtTrailRendererSource.test.mjs tests/toolbarDisabledStyles.test.mjs
```

Expected: FAIL on missing shared source iteration, dynamic File scope, attachment list, and attachment CSS.

- [ ] **Step 3: Render source policy from its shared definitions**

Import `SIDEBAR_THOUGHT_TRAIL_SOURCES`, `getThoughtTrailSourceDefinition`, `isThoughtTrailSourceAvailable`, and `SidebarThoughtTrailSourceAvailability`. Change the source control options to receive `sourceAvailability`, then replace the inline two-source loop with:

```ts
for (const definition of SIDEBAR_THOUGHT_TRAIL_SOURCES) {
    const isDisabled = !isThoughtTrailSourceAvailable(
        definition.id,
        options.sourceAvailability,
    );
    const labelEl = sourceOptionsEl.createEl("label", {
        cls: `aside-thought-trail-source-option${isDisabled ? " is-disabled" : ""}`,
    });
    const inputEl = labelEl.createEl("input", {
        type: "radio",
        attr: { name: options.radioGroupName, value: definition.id },
    });
    inputEl.checked = options.source === definition.id;
    inputEl.disabled = isDisabled;
    inputEl.addEventListener("change", () => {
        if (inputEl.checked) {
            options.onSourceChange(definition.id);
        }
    });
    labelEl.createSpan({ text: definition.label });
}
controlEl.createSpan({
    cls: "aside-thought-trail-scope-note",
    text: `Scope: ${getThoughtTrailSourceDefinition(options.source).scope}`,
});
```

Build `sourceAvailability` from the existing tag model and `options.attachments.length` immediately before rendering the control.

- [ ] **Step 4: Add the compact list and exact shared navigation**

Extract a small path-based wrapper around the existing URL opener:

```ts
function openThoughtTrailFile(
    filePath: string,
    context: SidebarThoughtTrailRenderContext,
): void {
    const targetUrl = `obsidian://open?vault=${encodeURIComponent(context.app.vault.getName())}&file=${encodeURIComponent(filePath)}`;
    void openThoughtTrailTarget(targetUrl, context);
}
```

Use it from the existing tag link and the new attachment list:

```ts
function renderThoughtTrailAttachmentsList(
    container: HTMLDivElement,
    attachments: readonly ThoughtTrailAttachmentItem[],
    context: SidebarThoughtTrailRenderContext,
): void {
    const listEl = container.createEl("ul", { cls: "aside-thought-trail-attachments" });
    for (const attachment of attachments) {
        const rowEl = listEl.createEl("li", {
            cls: "aside-thought-trail-attachment-row",
            attr: { "data-file-path": attachment.filePath },
        });
        const button = rowEl.createEl("button", {
            cls: "aside-thought-trail-attachment-link",
            text: attachment.label,
            attr: { type: "button" },
        });
        setTooltip(button, attachment.filePath);
        button.addEventListener("click", () => {
            openThoughtTrailFile(attachment.filePath, context);
        });
        rowEl.createSpan({
            cls: "aside-thought-trail-attachment-type",
            text: attachment.typeLabel,
        });
    }
}
```

In `renderSidebarThoughtTrail`, branch before Tags/Wikilinks:

```ts
if (options.source === "attachments") {
    const sectionEl = thoughtTrailEl.createDiv("aside-thought-trail-section");
    renderThoughtTrailAttachmentsList(sectionEl, options.attachments, context);
    return;
}
```

- [ ] **Step 5: Add minimal theme-native CSS**

Add near the existing Thought Trail list rules:

```css
.aside-thought-trail-attachments {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.aside-thought-trail-attachment-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.aside-thought-trail button.aside-thought-trail-attachment-link {
    -webkit-appearance: none;
    appearance: none;
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: 2px 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: var(--text-normal);
    font: inherit;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.aside-thought-trail button.aside-thought-trail-attachment-link:hover,
.aside-thought-trail button.aside-thought-trail-attachment-link:focus-visible {
    color: var(--text-accent);
    text-decoration: underline;
}

.aside-thought-trail-attachment-type {
    flex: 0 0 auto;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    line-height: 1.2;
}
```

- [ ] **Step 6: Verify GREEN for renderer, styles, and all focused Thought Trail tests**

```bash
node --test tests/sidebarThoughtTrailRendererSource.test.mjs tests/toolbarDisabledStyles.test.mjs
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailAttachments.test.js .test-dist/tests/sidebarThoughtTrailSource.test.js .test-dist/tests/sidebarThoughtTrailState.test.js .test-dist/tests/sidebarThoughtTrailGraph.test.js .test-dist/tests/sidebarThoughtTrailScope.test.js .test-dist/tests/thoughtTrailNoteLinkGraph.test.js
npm run lint
npm run typecheck
```

Expected: every focused test passes, lint has zero warnings, and typecheck exits 0.

- [ ] **Step 7: Commit the UI slice**

```bash
git add src/ui/views/sidebarThoughtTrailRenderer.ts tests/sidebarThoughtTrailRendererSource.test.mjs styles.css tests/toolbarDisabledStyles.test.mjs
git commit -m "feat(thought-trail): render attachments"
```

### Task 5: Change-Surface Audit, Full Verification, and Tracked Spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-thought-trail-attachments-design.md`
- Verify all files changed since `ba54522`

- [ ] **Step 1: Repeat the change-surface audit**

Run:

```bash
rg -n -S '"wikilinks"|"tags"|"attachments"|Related Files By|Scope: Vault|Scope: File|SidebarThoughtTrailSource' src scripts tests docs
rg -n -S '\["wikilinks",\s*"tags"\]|source === "wikilinks" \?|source === "tags"' src/ui/views tests
```

Expected: source IDs, labels, and scope policy originate in `sidebarThoughtTrailSource.ts`; `AsideView` contains only availability adapters; the renderer consumes definitions; remaining literals are intentional branch behavior, tests, or docs. No renderer-owned two-source array or label conditional remains.

- [ ] **Step 2: Run all automated verification**

```bash
npm run build
```

Expected:

- 1,356 TypeScript tests pass after the three attachment-model tests, one source-definition test, and one availability test are added.
- 109 `.mjs` contract/style tests pass after the four renderer/wiring/style contracts are added.
- ESLint reports zero warnings.
- TypeScript typecheck exits 0.
- Obsidian compliance passes.
- Production bundle succeeds.
- Release artifact inspection passes for exactly `main.js`, `manifest.json`, and `styles.css` with no source map or source-exposure marker.

- [ ] **Step 3: Install the built plugin into the development vault**

From the isolated worktree, run:

```bash
npm run dev:install-built -- --vault ../../..
obsidian plugin:reload id=aside vault=dev
```

Expected: the installer copies only `main.js`, `manifest.json`, and `styles.css`; Obsidian reloads Aside without an error notice.

- [ ] **Step 4: Perform the installed-vault attachment smoke**

In a scratch Markdown note in the development vault:

1. Embed one existing image and one existing PDF.
2. Embed the image a second time.
3. Embed one Markdown note and one missing non-Markdown path.
4. Open Aside, choose Thought Trail, and select Attachments.
5. Verify Attachments is third, `Scope: File` is shown, and exactly one row appears for each resolved image/PDF with the correct type label.
6. Verify the Markdown embed and unresolved embed are absent.
7. Click each row and verify the exact attachment opens in the preferred leaf.
8. Switch to Wikilinks and Tags and verify both still show `Scope: Vault` and retain their previous results.
9. Remove both eligible embeds, return to the note, and verify Attachments is visible but disabled and an active Attachments selection falls back to Wikilinks.

Expected: every step passes without a console error or stale attachment row. Remove only the scratch note after recording the result; do not delete the reused attachment files.

- [ ] **Step 5: Mark the tracked spec complete only after evidence exists**

In `docs/superpowers/specs/2026-08-31-thought-trail-attachments-design.md`, change each completed `### To Implement` and `### Verification` checkbox from `[ ]` to `[x]`. Leave any failed or unperformed smoke item unchecked and report it instead of claiming completion.

- [ ] **Step 6: Inspect the complete branch diff**

```bash
git status --short
git diff --check
git diff --stat ba54522..HEAD
git diff --name-status ba54522..HEAD
git log --oneline --decorate ba54522..HEAD
```

Expected: only the files named by this plan changed; no version, manifest, release-note, generated map, dependency-lock, or unrelated worktree file changed. The branch contains the small model, source policy, availability, renderer, and documentation commits described above.

- [ ] **Step 7: Commit the verified spec record**

```bash
git add -f docs/superpowers/specs/2026-08-31-thought-trail-attachments-design.md
git commit -m "docs: verify thought trail attachments"
```

- [ ] **Step 8: Request final code review**

Use the requesting-code-review workflow against base `ba54522` and current branch tip. The reviewer must check direct-file scope, no vault attachment scan, non-Markdown filtering, disabled/fallback behavior, exact navigation, change-surface ownership, tests, and artifact safety before integration.
