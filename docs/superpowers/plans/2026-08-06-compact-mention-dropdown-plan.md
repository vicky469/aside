# Compact Mention Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@` built-in and `/` vault-script suggestion menus compact, left-aligned, and single-line without changing tag details or suggestion interactions.

**Architecture:** `commentMentionSuggestions.ts` will expose the single source of truth for visible mention-row content. The inline editor and fallback modal will consume it; the generic inline model will make secondary detail optional, and a mention-only container class will scope intrinsic sizing and tighter padding so tag suggestions retain their current layout.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13 APIs, CSS, Node test runner, esbuild.

---

## File Structure

### Modified files

- `src/ui/editor/commentMentionSuggestions.ts` — shared mention/script row-presentation policy.
- `src/ui/views/sidebarDraftEditor.ts` — optional inline detail, conditional detail rendering, and mention variant class.
- `src/ui/modals/SideNoteMentionSuggestModal.ts` — fallback modal consumption of the shared single-line policy.
- `styles.css` — content-sized mention dropdown and mention-only row padding; obsolete detail selector removal.
- `tests/commentMentionSuggestions.test.ts` — built-in and script presentation-policy coverage.
- `tests/sidebarDraftEditor.test.ts` — inline DOM regression coverage for mention rows, tag details, and variant scoping.
- `tests/toolbarDisabledStyles.test.mjs` — compact geometry and obsolete mention-detail CSS coverage.
- `docs/superpowers/specs/2026-08-06-compact-mention-dropdown-design.md` — implementation and verification tracking.

## Task 1: Centralize single-line mention presentation

**Files:**

- Modify: `tests/commentMentionSuggestions.test.ts`
- Modify: `src/ui/editor/commentMentionSuggestions.ts`

- [ ] **Step 1: Write the failing presentation-policy test**

Import `getMentionSuggestionPresentation` in `tests/commentMentionSuggestions.test.ts` and add:

```ts
test("mention presentation exposes only the insertion value", () => {
    assert.deepEqual(getMentionSuggestionPresentation({
        kind: "built-in",
        mention: "@todo",
        label: "Todo",
    }), {
        title: "@todo",
    });
    assert.deepEqual(getMentionSuggestionPresentation({
        kind: "script",
        mention: "/clean-links",
        label: "clean-links.mjs",
        scriptPath: "🛠️ scripts/clean-links.mjs",
    }), {
        title: "/clean-links",
    });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rm -rf .test-dist && tsc -p tsconfig.test.json && node --test .test-dist/tests/commentMentionSuggestions.test.js
```

Expected: FAIL because `getMentionSuggestionPresentation` is not exported.

- [ ] **Step 3: Implement the minimal shared policy**

Add to `src/ui/editor/commentMentionSuggestions.ts`:

```ts
export interface MentionSuggestionPresentation {
    title: string;
}

export function getMentionSuggestionPresentation(
    suggestion: SideNoteMentionSuggestion,
): MentionSuggestionPresentation {
    return {
        title: suggestion.mention,
    };
}
```

Do not remove `label` or `scriptPath` from the domain suggestion type; they remain provider metadata even though this presentation does not display them.

- [ ] **Step 4: Re-run the focused test and verify it passes**

Run the command from Step 2.

Expected: PASS, including the existing `@`-only and `/`-only provider tests.

- [ ] **Step 5: Commit the shared policy**

```bash
git add src/ui/editor/commentMentionSuggestions.ts tests/commentMentionSuggestions.test.ts
git commit -m "refactor(ui): centralize mention presentation"
```

## Task 2: Make inline detail provider-specific

**Files:**

- Modify: `tests/sidebarDraftEditor.test.ts`
- Modify: `src/ui/views/sidebarDraftEditor.ts`

- [ ] **Step 1: Upgrade the fake DOM only as needed for visible-row assertions**

In `tests/sidebarDraftEditor.test.ts`, make `createFakeElement()` retain `text`, make `createDiv({ text })` copy the text into its child, and make `addClass(name)` append the class to `className`. Keep the fake local to this test file.

- [ ] **Step 2: Write failing inline mention and tag DOM tests**

Add one test that opens a connected `@t` draft with a single `@todo` result and asserts:

```ts
assert.match(container.className, /(?:^|\s)is-mention(?:\s|$)/u);
assert.deepEqual(row.children.map((child) => ({
    className: child.className,
    text: child.text,
})), [{
    className: "aside-inline-suggest-title",
    text: "@todo",
}]);
```

Extend the existing tag test to inspect the rendered row and assert it still contains both:

```ts
[
    { className: "aside-inline-suggest-title", text: "#an-apple" },
    { className: "aside-inline-suggest-note", text: "Used once" },
]
```

Also assert the tag container does not have `is-mention`.

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
rm -rf .test-dist && tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarDraftEditor.test.js
```

Expected: FAIL because mention choices still carry detail, every row renders a note, and the container lacks the variant class.

- [ ] **Step 4: Implement optional detail and the mention variant**

In `src/ui/views/sidebarDraftEditor.ts`:

- import `getMentionSuggestionPresentation`;
- change `InlineSuggestionChoice.note` to `note?: string`;
- map mention/script choices from the shared presentation and omit `note`;
- after creating the shared dropdown container, call `container.addClass("is-mention")` only when `kind === "mention"`;
- create `.aside-inline-suggest-note` only when `item.note` is defined.

Leave `buildTagSuggestionChoices()` unchanged so its usage count remains present.

- [ ] **Step 5: Re-run the focused test and verify it passes**

Run the command from Step 3.

Expected: PASS. Mention rows contain one child, tag rows contain two, and the variant is mention-only.

- [ ] **Step 6: Commit the inline renderer change**

```bash
git add src/ui/views/sidebarDraftEditor.ts tests/sidebarDraftEditor.test.ts
git commit -m "fix(ui): remove duplicate mention details"
```

## Task 3: Keep the fallback modal and CSS aligned

**Files:**

- Modify: `src/ui/modals/SideNoteMentionSuggestModal.ts`
- Modify: `tests/toolbarDisabledStyles.test.mjs`
- Modify: `styles.css`

- [ ] **Step 1: Write failing stylesheet and fallback-consumption regressions**

Replace the current shared-detail test so it covers only `.aside-link-suggest-note` and `.aside-tag-suggest-note`, then add assertions that:

- `.aside-mention-suggest-note` no longer appears in `styles.css`;
- `SideNoteMentionSuggestModal.ts` imports and calls `getMentionSuggestionPresentation` and does not reference `.label`, `.scriptPath`, or `aside-mention-suggest-note` in `renderSuggestion`;
- `.aside-inline-suggest-dropdown.is-mention` contains `justify-self: start`, `width: fit-content`, `min-width: min(8.25rem, 100%)`, `max-width: 100%`, and `box-sizing: border-box`;
- `.aside-inline-suggest-dropdown.is-mention .aside-inline-suggest-item` contains `padding: 5px 8px`.

Read the modal source in the test with:

```js
const mentionModalSource = readFileSync(
    new URL("../src/ui/modals/SideNoteMentionSuggestModal.ts", import.meta.url),
    "utf8",
);
```

- [ ] **Step 2: Run the stylesheet test and verify it fails**

Run:

```bash
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: FAIL because the compact variant is absent and the fallback modal still renders duplicate detail.

- [ ] **Step 3: Make the fallback modal single-line**

In `src/ui/modals/SideNoteMentionSuggestModal.ts`, import `getMentionSuggestionPresentation`, call it from `renderSuggestion`, and create only the title div:

```ts
const presentation = getMentionSuggestionPresentation(suggestion);
el.createDiv({ text: presentation.title });
```

- [ ] **Step 4: Add the mention-only compact CSS**

In `styles.css`, add:

```css
.aside-inline-suggest-dropdown.is-mention {
    justify-self: start;
    width: fit-content;
    min-width: min(8.25rem, 100%);
    max-width: 100%;
    box-sizing: border-box;
}

.aside-inline-suggest-dropdown.is-mention .aside-inline-suggest-item {
    padding: 5px 8px;
}
```

Remove `.aside-mention-suggest-note` from the shared modal-detail selector. Do not change the base dropdown or base item geometry used by tags.

- [ ] **Step 5: Re-run the stylesheet test and verify it passes**

Run the command from Step 2.

Expected: PASS for compact mention geometry, fallback consumption, and unchanged link/tag detail styling.

- [ ] **Step 6: Commit the aligned fallback and styles**

```bash
git add src/ui/modals/SideNoteMentionSuggestModal.ts styles.css tests/toolbarDisabledStyles.test.mjs
git commit -m "fix(ui): compact mention suggestions"
```

## Task 4: Verify, install, and close tracking

**Files:**

- Modify: `docs/superpowers/specs/2026-08-06-compact-mention-dropdown-design.md`

- [ ] **Step 1: Run focused regressions together**

```bash
rm -rf .test-dist && tsc -p tsconfig.test.json && node --test .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftEditor.test.js && node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the complete repository verification**

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, bundle, and the release-artifact inspection all PASS.

- [ ] **Step 3: Inspect the exact shipped artifacts again**

```bash
node scripts/check-release-artifacts.mjs
find . -maxdepth 1 -type f \( -name 'main.js.map' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|BEGIN CERTIFICATE" main.js manifest.json styles.css
```

Expected: the guard passes; the exposure searches print no shipped source map, embedded source, raw TypeScript/JSX-family source, secret-bearing file, private key, or certificate finding.

- [ ] **Step 4: Install the verified build into the real vault**

```bash
npm run dev:install-built -- --vault /Users/wenqingli/Obsidian/lean-startup
cmp main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: installation succeeds and all three comparisons exit 0.

- [ ] **Step 5: Visually verify the installed dropdowns**

In the real Aside draft editor, verify:

- `@` shows only built-ins, each as one line;
- `/` shows only vault scripts, each as one line;
- both menus hug their contents at the left edge and remain within the editor;
- `#` still uses the full shared width and shows usage-count detail;
- arrow keys, Enter, Escape, mouse selection, outside click, focus, and ARIA behavior remain unchanged.

If Obsidian cannot be reloaded automatically, report that limitation instead of marking this step complete without evidence.

- [ ] **Step 6: Update the design-spec tracking from evidence**

Mark implementation and verification boxes in `docs/superpowers/specs/2026-08-06-compact-mention-dropdown-design.md` only for checks actually completed. Leave the live visual-check box open if the installed plugin could not be reloaded and inspected.

- [ ] **Step 7: Review the implementation against the approved scope**

Run:

```bash
git diff 4f524a0 -- src/ui/editor/commentMentionSuggestions.ts src/ui/views/sidebarDraftEditor.ts src/ui/modals/SideNoteMentionSuggestModal.ts styles.css tests/commentMentionSuggestions.test.ts tests/sidebarDraftEditor.test.ts tests/toolbarDisabledStyles.test.mjs docs/superpowers/specs/2026-08-06-compact-mention-dropdown-design.md
git status --short
```

Confirm there are no changes to query parsing, ranking, insertion, keyboard/mouse behavior, tag presentation, or unrelated files.

- [ ] **Step 8: Commit the verified tracking update**

```bash
git add docs/superpowers/specs/2026-08-06-compact-mention-dropdown-design.md
git commit -m "docs: verify compact mention dropdown"
```

## Definition of Done

- `@` returns only built-ins and `/` returns only vault scripts.
- Mention and script rows show only the exact insertion value.
- Inline and fallback mention surfaces consume the same presentation policy.
- Mention dropdowns are left-aligned, content-sized, capped at editor width, and use `5px 8px` row padding.
- Tag suggestions retain their usage-count line and existing full-width geometry.
- Existing interaction and accessibility behavior remains green.
- The complete build and exact-artifact security inspection pass.
- The verified artifacts are installed byte-identically into `lean-startup`.
- Live visual verification is recorded honestly.
