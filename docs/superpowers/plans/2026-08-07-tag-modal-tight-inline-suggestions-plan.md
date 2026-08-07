# Tag Modal and Tight Inline Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore fuzzy `#` tag search to the Obsidian modal while keeping `@` and `/` inline in a genuinely tight, content-width dropdown.

**Architecture:** A pure editor module will own tag collection, canonicalization, bounded Damerau-Levenshtein matching, deterministic ranking, create-candidate planning, and row presentation. `SideNoteTagSuggestModal` becomes a thin Obsidian adapter, while `SidebarDraftEditorController` routes `#` to that modal and keeps inline state mention-only. CSS removes the artificial minimum width and narrows list/row spacing without changing focus, ARIA, or selection behavior.

**Tech Stack:** TypeScript, Obsidian `SuggestModal`, Node test runner, repository DOM fakes, CSS contract tests, esbuild.

---

### Task 1: Add pure fuzzy tag suggestion planning

**Files:**
- Create: `src/ui/editor/commentTagSuggestions.ts`
- Create: `tests/commentTagSuggestions.test.ts`

- [x] **Step 1: Write failing textual-ranking tests**

Create `tests/commentTagSuggestions.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildTagSuggestions,
    getTagSuggestionPresentation,
} from "../src/ui/editor/commentTagSuggestions";

test("tag suggestions ignore case and hyphens", () => {
    const suggestions = buildTagSuggestions({
        query: "AnApple",
        vaultTags: [{ tag: "#an-apple", usageCount: 3 }],
    });
    assert.deepEqual(suggestions[0], { type: "existing", tag: "#an-apple" });
});

test("tag suggestions rank exact prefix segment and substring matches", () => {
    const suggestions = buildTagSuggestions({
        query: "project",
        vaultTags: [
            { tag: "#my-project-notes", usageCount: 99 },
            { tag: "#beta/project", usageCount: 2 },
            { tag: "#project/alpha", usageCount: 1 },
            { tag: "#project", usageCount: 1 },
        ],
    }).filter((suggestion) => suggestion.type === "existing");
    assert.deepEqual(suggestions.map((suggestion) => suggestion.tag), [
        "#project",
        "#project/alpha",
        "#beta/project",
        "#my-project-notes",
    ]);
});
```

- [x] **Step 2: Add failing typo-threshold and tie-break tests**

```ts
test("tag suggestions tolerate bounded common typos", () => {
    const cases = [
        ["projct", "#project"],
        ["projecct", "#project"],
        ["projevt", "#project"],
        ["proejct", "#project"],
        ["architectuer", "#architecture"],
    ] as const;
    const vaultTags = [
        { tag: "#project", usageCount: 1 },
        { tag: "#architecture", usageCount: 1 },
    ];
    for (const [query, expected] of cases) {
        const first = buildTagSuggestions({ query, vaultTags })
            .find((suggestion) => suggestion.type === "existing");
        assert.equal(first?.tag, expected, query);
    }
});

test("tag suggestions suppress fuzzy noise below four characters", () => {
    const suggestions = buildTagSuggestions({
        query: "prj",
        vaultTags: [{ tag: "#project", usageCount: 100 }],
    });
    assert.equal(suggestions.some((suggestion) => suggestion.type === "existing"), false);
});

test("tag suggestions use hidden usage only after textual relevance", () => {
    const suggestions = buildTagSuggestions({
        query: "proj",
        vaultTags: [
            { tag: "#project-zeta", usageCount: 1 },
            { tag: "#project-beta", usageCount: 8 },
            { tag: "#xproj", usageCount: 100 },
        ],
    }).filter((suggestion) => suggestion.type === "existing");
    assert.deepEqual(suggestions.map((suggestion) => suggestion.tag), [
        "#project-beta",
        "#project-zeta",
        "#xproj",
    ]);
});
```

- [x] **Step 3: Add failing create and presentation tests**

```ts
test("tag suggestions deduplicate canonical variants and create only new tags", () => {
    const existing = buildTagSuggestions({
        query: "ANAPPLE",
        vaultTags: [{ tag: "#an-apple", usageCount: 2 }],
        extraTags: ["#An-Apple"],
    });
    assert.equal(existing.filter((item) => item.type === "existing").length, 1);
    assert.equal(existing.some((item) => item.type === "create"), false);
    assert.deepEqual(
        buildTagSuggestions({ query: "fresh-tag", vaultTags: [] })[0],
        { type: "create", tag: "#fresh-tag" },
    );
});

test("tag presentation hides usage and keeps create guidance", () => {
    assert.deepEqual(
        getTagSuggestionPresentation({ type: "existing", tag: "#project" }),
        { title: "#project" },
    );
    assert.deepEqual(
        getTagSuggestionPresentation({ type: "create", tag: "#fresh" }),
        { title: "Create tag: #fresh", note: "Insert this new tag into the comment." },
    );
});
```

- [x] **Step 4: Compile to verify RED**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL with `TS2307` because `commentTagSuggestions.ts` does not exist.

- [x] **Step 5: Implement the pure module**

Create `src/ui/editor/commentTagSuggestions.ts` with these contracts:

```ts
import { isTagCharacter, normalizeTagText } from "../../core/text/commentTags";
import type { VaultTagUsage } from "../../core/vault/vaultCapabilityIndex";

export type SideNoteTagSuggestion =
    | { type: "existing"; tag: string }
    | { type: "create"; tag: string };

export interface BuildTagSuggestionsOptions {
    query: string;
    vaultTags: readonly VaultTagUsage[];
    extraTags?: readonly string[];
    limit?: number;
}

interface TagRecord {
    tag: string;
    canonical: string;
    segments: string[];
    usageCount: number;
}

interface MatchScore {
    tier: number;
    distance: number;
    lengthDelta: number;
}

function normalizeQuery(value: string): string {
    return value.trim().replace(/^#+/u, "");
}

function canonicalize(value: string): string {
    return normalizeQuery(value).toLowerCase().replace(/-/gu, "");
}

function fuzzyThreshold(length: number): number {
    if (length < 4) return -1;
    return length < 8 ? 1 : 2;
}
```

```ts
function boundedDamerauLevenshtein(left: string, right: string, limit: number): number {
    if (Math.abs(left.length - right.length) > limit) return limit + 1;
    const rows = Array.from({ length: left.length + 1 }, () =>
        Array<number>(right.length + 1).fill(0));
    for (let index = 0; index <= left.length; index += 1) rows[index]![0] = index;
    for (let index = 0; index <= right.length; index += 1) rows[0]![index] = index;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            rows[leftIndex]![rightIndex] = Math.min(
                rows[leftIndex - 1]![rightIndex]! + 1,
                rows[leftIndex]![rightIndex - 1]! + 1,
                rows[leftIndex - 1]![rightIndex - 1]! + substitution,
            );
            if (
                leftIndex > 1
                && rightIndex > 1
                && left[leftIndex - 1] === right[rightIndex - 2]
                && left[leftIndex - 2] === right[rightIndex - 1]
            ) {
                rows[leftIndex]![rightIndex] = Math.min(
                    rows[leftIndex]![rightIndex]!,
                    rows[leftIndex - 2]![rightIndex - 2]! + 1,
                );
            }
        }
    }
    return rows[left.length]![right.length]!;
}

function scoreTag(query: string, tag: TagRecord): MatchScore | null {
    if (!query || tag.canonical === query) {
        return { tier: 0, distance: 0, lengthDelta: 0 };
    }
    if (tag.canonical.startsWith(query)) {
        return { tier: 1, distance: 0, lengthDelta: tag.canonical.length - query.length };
    }
    const segmentPrefix = tag.segments.find((segment) => segment.startsWith(query));
    if (segmentPrefix) {
        return { tier: 2, distance: 0, lengthDelta: segmentPrefix.length - query.length };
    }
    const substring = [tag.canonical, ...tag.segments]
        .filter((target) => target.includes(query))
        .sort((left, right) => left.length - right.length)[0];
    if (substring) {
        return { tier: 3, distance: 0, lengthDelta: substring.length - query.length };
    }
    const threshold = fuzzyThreshold(query.length);
    if (threshold < 0) return null;
    const best = [tag.canonical, ...tag.segments]
        .map((target) => ({
            target,
            distance: boundedDamerauLevenshtein(query, target, threshold),
        }))
        .filter((match) => match.distance <= threshold)
        .sort((left, right) => left.distance - right.distance
            || Math.abs(left.target.length - query.length)
                - Math.abs(right.target.length - query.length))[0];
    return best
        ? {
            tier: 4,
            distance: best.distance,
            lengthDelta: Math.abs(best.target.length - query.length),
        }
        : null;
}

function collectTagRecords(options: BuildTagSuggestionsOptions): Map<string, TagRecord> {
    const records = new Map<string, TagRecord>();
    const add = (rawTag: string, usageCount: number): void => {
        const tag = normalizeTagText(rawTag);
        const canonical = canonicalize(tag);
        if (!tag || !canonical) return;
        const existing = records.get(canonical);
        if (existing) {
            existing.usageCount += usageCount;
            return;
        }
        records.set(canonical, {
            tag,
            canonical,
            segments: canonical.split("/").filter(Boolean),
            usageCount,
        });
    };
    for (const tag of options.vaultTags) add(tag.tag, tag.usageCount);
    for (const tag of options.extraTags ?? []) add(tag, 1);
    return records;
}

export function buildTagSuggestions(
    options: BuildTagSuggestionsOptions,
): SideNoteTagSuggestion[] {
    const normalizedQuery = normalizeQuery(options.query);
    const query = canonicalize(normalizedQuery);
    const records = collectTagRecords(options);
    const existing = Array.from(records.values())
        .map((tag) => ({ tag, score: scoreTag(query, tag) }))
        .filter((entry): entry is { tag: TagRecord; score: MatchScore } => entry.score !== null)
        .sort((left, right) => left.score.tier - right.score.tier
            || left.score.distance - right.score.distance
            || left.score.lengthDelta - right.score.lengthDelta
            || right.tag.usageCount - left.tag.usageCount
            || left.tag.tag.localeCompare(right.tag.tag))
        .slice(0, options.limit ?? 40)
        .map<SideNoteTagSuggestion>((entry) => ({ type: "existing", tag: entry.tag.tag }));
    const canCreate = normalizedQuery.length > 0
        && Array.from(normalizedQuery).every(isTagCharacter)
        && !records.has(query);
    return canCreate
        ? [{ type: "create", tag: normalizeTagText(normalizedQuery) }, ...existing]
        : existing;
}

export function getTagSuggestionPresentation(
    suggestion: SideNoteTagSuggestion,
): { title: string; note?: string } {
    return suggestion.type === "create"
        ? {
            title: `Create tag: ${suggestion.tag}`,
            note: "Insert this new tag into the comment.",
        }
        : { title: suggestion.tag };
}
```

- [x] **Step 6: Run focused tests to verify GREEN**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentTagSuggestions.test.js
```

Expected: all tag-planning tests PASS.

- [x] **Step 7: Commit**

```bash
git add src/ui/editor/commentTagSuggestions.ts tests/commentTagSuggestions.test.ts
git commit -m "feat(tags): add fuzzy suggestion ranking"
```

### Task 2: Make the tag modal a thin shared-model adapter

**Files:**
- Modify: `src/ui/modals/SideNoteTagSuggestModal.ts`
- Modify: `tests/commentTagSuggestions.test.ts`

- [x] **Step 1: Add a failing ownership regression test**

```ts
import { readFileSync } from "node:fs";

test("tag modal delegates ranking and hides usage detail", () => {
    const source = readFileSync("src/ui/modals/SideNoteTagSuggestModal.ts", "utf8");
    assert.match(source, /buildTagSuggestions\(/u);
    assert.match(source, /getTagSuggestionPresentation\(/u);
    assert.doesNotMatch(source, /Used once|usageCount\s*===|function getMatchScore/u);
});
```

- [x] **Step 2: Run it to verify RED**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentTagSuggestions.test.js
```

Expected: FAIL because the modal still owns matching and renders count copy.

- [x] **Step 3: Refactor the modal**

Import `buildTagSuggestions`, `getTagSuggestionPresentation`, and `SideNoteTagSuggestion`. Delete modal-owned suggestion types, tag records, collection, scoring, sorting, and create-candidate helpers. Store raw `extraTags` and `vaultTags`, then use:

```ts
getSuggestions(query: string): SideNoteTagSuggestion[] {
    return buildTagSuggestions({
        query,
        vaultTags: this.vaultTags,
        extraTags: this.extraTags,
        limit: this.limit,
    });
}

renderSuggestion(suggestion: SideNoteTagSuggestion, el: HTMLElement): void {
    const presentation = getTagSuggestionPresentation(suggestion);
    el.createDiv({ text: presentation.title });
    if (presentation.note) {
        el.createDiv({ cls: "aside-tag-suggest-note", text: presentation.note });
    }
}
```

Keep placeholder, empty state, instructions, modal title, initial-query input dispatch, caret placement, choose callback, and close callback.

- [x] **Step 4: Verify and commit**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentTagSuggestions.test.js
git diff --check
git add src/ui/modals/SideNoteTagSuggestModal.ts tests/commentTagSuggestions.test.ts
git commit -m "fix(tags): restore fuzzy modal suggestions"
```

Expected: tests PASS and no visible usage-count policy remains.

### Task 3: Route `#` to the modal and keep inline state mention-only

**Files:**
- Modify: `src/ui/views/sidebarDraftEditor.ts`
- Modify: `tests/sidebarDraftEditor.test.ts`

- [x] **Step 1: Replace the inline-tag test with failing modal tests**

Add this reusable fake textarea factory and capture type:

```ts
interface CapturedTagSuggestCallbacks {
    extraTags: string[];
    initialQuery: string;
    onChooseTag: (tagText: string) => Promise<void>;
    onCloseModal: () => void;
}

function createSuggestionTextarea(
    value: string,
    cursor = value.length,
    isConnected = true,
) {
    const shell = createFakeElement();
    const focusCalls: string[] = [];
    const selectionCalls: Array<[number, number]> = [];
    const textarea = {
        value,
        selectionStart: cursor,
        selectionEnd: cursor,
        isConnected,
        rows: 2,
        ownerDocument: { addEventListener: () => {}, removeEventListener: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {},
        closest: () => shell,
        focus: () => { focusCalls.push("focus"); },
        dispatchEvent: () => true,
        setSelectionRange(start: number, end: number) {
            textarea.selectionStart = start;
            textarea.selectionEnd = end;
            selectionCalls.push([start, end]);
        },
    } as unknown as HTMLTextAreaElement;
    return { textarea, shell, focusCalls, selectionCalls };
}
```

Add the routing test with a captured modal callback:

```ts
test("sidebar draft editor routes tags to the modal without an inline box", () => {
    let captured: CapturedTagSuggestCallbacks | undefined;
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [createComment({ comment: "Existing #project" })],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: () => [],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: (options) => { captured = options; },
    });
    const { textarea, shell } = createSuggestionTextarea("#proj");

    assert.equal(controller.openDraftTagSuggest(createDraft({ comment: "#proj" }), textarea, false), true);
    assert.equal(captured?.initialQuery, "proj");
    assert.deepEqual(captured?.extraTags, ["#project", "#proj"]);
    assert.equal(shell.children.length, 0);
});
```

Add connected and disconnected selection tests:

```ts
test("tag modal selection replaces the captured query in a connected draft", async () => {
    let captured: CapturedTagSuggestCallbacks | undefined;
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: () => [],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: (options) => { captured = options; },
    });
    const draft = createDraft({ id: "draft-tag", comment: "Plan #proj later" });
    const { textarea, focusCalls } = createSuggestionTextarea(draft.comment, 10);

    assert.equal(controller.openDraftTagSuggest(draft, textarea, false), true);
    await captured?.onChooseTag("#project");
    assert.equal(textarea.value, "Plan #project later");
    assert.deepEqual(focusCalls, ["focus"]);
});

test("tag modal selection updates a disconnected draft through stored state", async () => {
    let captured: CapturedTagSuggestCallbacks | undefined;
    const updates: Array<[string, string]> = [];
    const focusedDrafts: string[] = [];
    let renderCount = 0;
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: (id, text) => { updates.push([id, text]); },
        renderComments: async () => { renderCount += 1; },
        scheduleDraftFocus: (id) => { focusedDrafts.push(id); },
        getMentionSuggestions: () => [],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: (options) => { captured = options; },
    });
    const draft = createDraft({ id: "draft-tag", comment: "#proj" });
    const { textarea } = createSuggestionTextarea(draft.comment, draft.comment.length, false);

    assert.equal(controller.openDraftTagSuggest(draft, textarea, false), true);
    await captured?.onChooseTag("#project");
    assert.deepEqual(updates, [["draft-tag", "#project"]]);
    assert.equal(renderCount, 1);
    assert.deepEqual(focusedDrafts, ["draft-tag"]);
});
```

Add the close test with synchronous animation-frame control:

```ts
test("closing the tag modal restores the captured caret", () => {
    const originalWindow = globalThis.window;
    let captured: CapturedTagSuggestCallbacks | undefined;
    Object.assign(globalThis, {
        window: { requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; } },
    });
    try {
        const controller = new SidebarDraftEditorController({
            getAllIndexedComments: () => [],
            updateDraftCommentText: () => {},
            renderComments: async () => {},
            scheduleDraftFocus: () => {},
            getMentionSuggestions: () => [],
            openMentionSuggestModal: () => {},
            openLinkSuggestModal: () => {},
            openTagSuggestModal: (options) => { captured = options; },
        });
        const draft = createDraft({ comment: "#proj" });
        const { textarea, focusCalls, selectionCalls } = createSuggestionTextarea(draft.comment);
        controller.openDraftTagSuggest(draft, textarea, false);
        captured?.onCloseModal();
        assert.deepEqual(focusCalls, ["focus"]);
        assert.deepEqual(selectionCalls, [[5, 5]]);
    } finally {
        Object.assign(globalThis, { window: originalWindow });
    }
});
```

Update input-trigger coverage so `inputData === "#"` opens the modal, while existing `@` and `/` coverage still sees `.aside-inline-suggest-dropdown.is-mention`.

- [x] **Step 2: Compile and run to verify RED**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarDraftEditor.test.js
```

Expected: FAIL because connected tags still render inline, disconnected tags return false, and modal callbacks are unused.

- [x] **Step 3: Implement modal routing**

Delete `VaultTagRecord`, inline tag matching/choice helpers, `DropdownItemKind`, `InlineSuggestionState.kind`, and the tag branch from `refreshActiveInlineSuggestion`. Make `openInlineSuggestion` mention-only and always add `is-mention`.

Rewrite `openDraftTagSuggest` to capture `initialValue`, `tagQuery`, `tagQuery.end`, and an `inserted` flag; set active owner `tag`; pass `initialQuery` and `collectTagSources(textarea)` to the modal; and use:

```ts
onChooseTag: async (tagText) => {
    inserted = true;
    const edit = replaceOpenTagQuery(initialValue, tagQuery, tagText);
    if (textarea.isConnected) {
        this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
        textarea.focus();
        return;
    }
    this.host.updateDraftCommentText(comment.id, edit.value);
    await this.host.renderComments();
    this.host.scheduleDraftFocus(comment.id);
},
```

On close, clear the active owner. If nothing was inserted and the textarea remains connected, use `window.requestAnimationFrame` to focus it and restore the captured caret. Keep `[[` precedence and all mention/script keyboard, pointer, outside-click, and ARIA behavior unchanged.

- [x] **Step 4: Run focused editor verification**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentTagSuggestions.test.js .test-dist/tests/commentEditorTags.test.js .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/sidebarDraftEditor.test.js
npm run typecheck
git diff --check
```

Expected: routing, selection, focus, lifecycle, mention, and script tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/ui/views/sidebarDraftEditor.ts tests/sidebarDraftEditor.test.ts
git commit -m "fix(editor): return tag suggestions to modal"
```

### Task 4: Tighten the `@` and `/` inline dropdown

**Files:**
- Modify: `styles.css:2314-2354`
- Modify: `tests/toolbarDisabledStyles.test.mjs:19-59`

- [x] **Step 1: Change the CSS contract test first**

Require retained `justify-self: start`, `width: fit-content`, `max-width: 100%`, and `box-sizing: border-box`, reject any `min-width`, require variant list padding `2px 0`, and require row padding `3px 5px`:

```js
const mentionListRule = css.match(
    /\.aside-inline-suggest-dropdown\.is-mention \.aside-inline-suggest-list\s*\{(?<body>[\s\S]*?)\}/,
);

assert.doesNotMatch(mentionDropdownRule.groups.body, /min-width\s*:/);
assert.ok(mentionListRule?.groups?.body, "missing mention list compact rule");
assert.match(mentionListRule.groups.body, /padding:\s*2px 0\s*;/);
assert.match(mentionItemRule.groups.body, /padding:\s*3px 5px\s*;/);
```

- [x] **Step 2: Run it to verify RED**

```bash
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: FAIL on old `8.25rem`, `4px 0`, and `5px 8px` geometry.

- [x] **Step 3: Apply tight variant CSS**

```css
.aside-inline-suggest-dropdown.is-mention {
    justify-self: start;
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
}

.aside-inline-suggest-dropdown.is-mention .aside-inline-suggest-list {
    padding: 2px 0;
}

.aside-inline-suggest-dropdown.is-mention .aside-inline-suggest-item {
    padding: 3px 5px;
}
```

Delete the old minimum width. Preserve theme border/background, selected-row treatment, scroll cap, ellipsis, and width cap.

- [x] **Step 4: Verify and commit**

```bash
node --test tests/toolbarDisabledStyles.test.mjs
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentTagSuggestions.test.js .test-dist/tests/sidebarDraftEditor.test.js
git diff --check
git add styles.css tests/toolbarDisabledStyles.test.mjs
git commit -m "style(editor): tighten inline suggestions"
```

Expected: presentation and editor tests PASS.

### Task 5: Verify, track, install, and inspect

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-tag-modal-tight-inline-suggestions-design.md`
- Verify only: `main.js`
- Verify only: `manifest.json`
- Verify only: `styles.css`

- [x] **Step 1: Run complete focused regression**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentTagSuggestions.test.js .test-dist/tests/commentEditorTags.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/sidebarDraftEditor.test.js
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: fuzzy ranking, creation, modal lifecycle, trigger split, inline interaction, and CSS tests PASS.

- [x] **Step 2: Run full build and exact artifact guard**

```bash
npm run build
npm run release:artifacts:check
test ! -e main.js.map
```

Expected: all tests, lint, typecheck, Obsidian compliance, bundle, and artifact inspection PASS. The exact install set is `main.js`, `manifest.json`, and `styles.css`, with no source map, embedded source, raw TypeScript/JSX, secrets, keys/certificates, local paths, or local-only fixtures.

- [x] **Step 3: Update and commit evidence-backed spec status**

Mark implementation/test/build items `[x]` only after commands pass. Leave installation and real-vault visual items unchecked until Steps 4-5 succeed.

```bash
git add -f docs/superpowers/specs/2026-08-07-tag-modal-tight-inline-suggestions-design.md
git commit -m "docs: verify tag modal and tight suggestions"
```

- [x] **Step 4: Install and compare verified build**

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
cmp -s main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: installation succeeds and all comparisons exit 0.

- [ ] **Step 5: Reload Aside and inspect interaction**

In `lean-startup`, use Command Palette → `Reload app without saving` or disable/enable Aside in Community Plugins. Do not restart all vault windows if the target cannot be controlled safely.

Verify `#` opens the modal, filters every keystroke, ranks case/hyphen variants and bounded typos, hides counts, and inserts existing/new tags. Verify `@` and `/` stay inline with tight content width and capped long names. Exercise Arrow keys, Enter, Tab, Escape, pointer selection, outside dismissal, focus, and ARIA behavior. Only then check remaining spec items and commit that final checklist change.

- [x] **Step 6: Review final scope**

```bash
git diff 2f420ec -- src/ui/editor/commentTagSuggestions.ts src/ui/modals/SideNoteTagSuggestModal.ts src/ui/views/sidebarDraftEditor.ts styles.css tests/commentTagSuggestions.test.ts tests/sidebarDraftEditor.test.ts tests/toolbarDisabledStyles.test.mjs docs/superpowers/specs/2026-08-07-tag-modal-tight-inline-suggestions-design.md
git status --short
```

Expected: only planned feature, tests, and tracking changes appear; worktree is clean after commits.
