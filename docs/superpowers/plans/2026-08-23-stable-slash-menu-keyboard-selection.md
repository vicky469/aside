# Stable Slash Menu Keyboard Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` menu keyboard selection remain authoritative when the pointer rests over the inline suggestion list.

**Architecture:** Keep result rendering separate from active-index synchronization in `SidebarDraftEditorController`. Result changes may recreate rows, but Up, Down, and pointer selection will mutate class and ARIA state on the existing rows; CSS will paint only `.is-selected` so hover cannot show a second active row.

**Tech Stack:** TypeScript 5.9, Obsidian DOM extensions, CSS, Node test runner, esbuild.

---

## File Structure

### Modified files

- `tests/sidebarDraftEditor.test.ts` — fake DOM selection support and stable-row ArrowDown regression.
- `src/ui/views/sidebarDraftEditor.ts` — in-place option selection and ARIA synchronization.
- `tests/toolbarDisabledStyles.test.mjs` — single visual selection-state regression.
- `styles.css` — remove the competing `:hover` background selector.
- `docs/superpowers/specs/2026-08-23-stable-slash-menu-keyboard-selection-design.md` — evidence-backed implementation tracking.

### Task 1: Keep option elements stable during keyboard navigation

**Files:**

- Modify: `tests/sidebarDraftEditor.test.ts`
- Modify: `src/ui/views/sidebarDraftEditor.ts:419-474`

- [ ] **Step 1: Extend the fake element with Obsidian's forced class toggle**

Add this method beside `addClass` in `createFakeElement()`:

```ts
toggleClass: function toggleClass(name: string, enabled: boolean) {
    const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
    if (enabled) {
        classes.add(name);
    } else {
        classes.delete(name);
    }
    this.className = Array.from(classes).join(" ");
},
```

- [ ] **Step 2: Write the failing stable-row ArrowDown regression**

Add this test after `connected mention dropdown activates only the explicit @ query match`:

```ts
test("slash suggestion ArrowDown preserves rows while moving the active option", () => {
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: () => [
            {
                kind: "built-in",
                mention: "/create-script",
                label: "Create script",
            },
            {
                kind: "built-in",
                mention: "/update-script",
                label: "Update script",
            },
        ],
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
    const draft = createDraft({ comment: "/" });
    const { textarea, shell } = createSuggestionTextarea(draft.comment);

    assert.equal(controller.openDraftMentionSuggest(draft, textarea, false), true);
    const container = shell.children[0] as ReturnType<typeof createFakeElement>;
    const list = container.children[0] as ReturnType<typeof createFakeElement>;
    const originalRows = [...list.children] as ReturnType<typeof createFakeElement>[];
    const scrollCalls: string[] = [];
    originalRows[1].scrollIntoView = () => {
        scrollCalls.push("second");
    };
    const consumed: string[] = [];
    const event = {
        key: "ArrowDown",
        shiftKey: false,
        preventDefault: () => consumed.push("preventDefault"),
        stopPropagation: () => consumed.push("stopPropagation"),
        stopImmediatePropagation: () => consumed.push("stopImmediatePropagation"),
    } as unknown as KeyboardEvent;

    assert.equal(controller.handleDraftSuggestionKeydown(event, textarea), true);
    assert.deepEqual(list.children, originalRows);
    assert.doesNotMatch(originalRows[0].className, /(?:^|\s)is-selected(?:\s|$)/u);
    assert.equal(originalRows[0].attributes.get("aria-selected"), "false");
    assert.match(originalRows[1].className, /(?:^|\s)is-selected(?:\s|$)/u);
    assert.equal(originalRows[1].attributes.get("aria-selected"), "true");
    assert.deepEqual(scrollCalls, ["second"]);
    assert.deepEqual(consumed, [
        "preventDefault",
        "stopPropagation",
        "stopImmediatePropagation",
    ]);
});
```

- [ ] **Step 3: Run the focused controller test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarDraftEditor.test.js
```

Expected: FAIL because `setInlineSuggestionSelectedIndex()` recreates the option elements, so `list.children` differs from `originalRows` and the original second-row scroll spy is not called.

- [ ] **Step 4: Add one selection-state synchronization method**

Add this method immediately before `setInlineSuggestionSelectedIndex()`:

```ts
private syncInlineSuggestionSelection(state: InlineSuggestionState): void {
    state.optionElements.forEach((option, index) => {
        const selected = index === state.selectedIndex;
        option.toggleClass("is-selected", selected);
        option.setAttribute("aria-selected", selected ? "true" : "false");
    });

    const selectedOption = state.optionElements[state.selectedIndex];
    if (selectedOption) {
        state.textarea.setAttribute("aria-activedescendant", selectedOption.id);
    } else {
        state.textarea.removeAttribute("aria-activedescendant");
    }
}
```

Replace `setInlineSuggestionSelectedIndex()` with:

```ts
private setInlineSuggestionSelectedIndex(
    state: InlineSuggestionState,
    index: number,
): void {
    if (!state.items.length) {
        state.selectedIndex = -1;
        this.syncInlineSuggestionSelection(state);
        return;
    }

    state.selectedIndex = Math.min(Math.max(0, index), state.items.length - 1);
    this.syncInlineSuggestionSelection(state);
    const selectedOption = state.optionElements[state.selectedIndex];
    if (selectedOption && typeof selectedOption.scrollIntoView === "function") {
        selectedOption.scrollIntoView({ block: "nearest" });
    }
}
```

At the end of `renderInlineSuggestionChoices()`, replace its direct `aria-activedescendant` block with:

```ts
this.syncInlineSuggestionSelection(state);
```

- [ ] **Step 5: Re-run the focused controller test and verify GREEN**

Run the three commands from Step 3.

Expected: all `sidebarDraftEditor` tests PASS; the original row objects remain, the second row becomes active, ARIA follows it, and it scrolls into view.

- [ ] **Step 6: Commit the controller regression and fix**

```bash
git add tests/sidebarDraftEditor.test.ts src/ui/views/sidebarDraftEditor.ts
git commit -m "fix(ui): stabilize slash key selection"
```

### Task 2: Keep one visible selection state

**Files:**

- Modify: `tests/toolbarDisabledStyles.test.mjs`
- Modify: `styles.css:2483-2486`

- [ ] **Step 1: Write the failing stylesheet regression**

Add this test after `mention suggestions use a one-line fallback and compact inline geometry`:

```js
test("inline suggestions use one visual selection state", () => {
    const selectedRule = css.match(
        /\.aside-inline-suggest-item\.is-selected\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(selectedRule?.groups?.body, "missing selected suggestion rule");
    assert.match(selectedRule.groups.body, /background:\s*color-mix\(/);
    assert.doesNotMatch(css, /\.aside-inline-suggest-item:hover/);
});
```

- [ ] **Step 2: Run the stylesheet test and verify RED**

Run:

```bash
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: FAIL because the background rule combines `.is-selected` with `.aside-inline-suggest-item:hover`.

- [ ] **Step 3: Remove the competing hover selector**

Change the shared selection rule in `styles.css` from:

```css
.aside-inline-suggest-item.is-selected,
.aside-inline-suggest-item:hover {
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
}
```

to:

```css
.aside-inline-suggest-item.is-selected {
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
}
```

Pointer movement still selects rows through the existing `mouseenter` listener.

- [ ] **Step 4: Re-run the stylesheet test and verify GREEN**

Run the command from Step 2.

Expected: all stylesheet tests PASS and no `.aside-inline-suggest-item:hover` selector remains.

- [ ] **Step 5: Commit the stylesheet regression and fix**

```bash
git add tests/toolbarDisabledStyles.test.mjs styles.css
git commit -m "fix(ui): show one suggestion selection"
```

### Task 3: Verify, install, and close tracking

**Files:**

- Modify: `docs/superpowers/specs/2026-08-23-stable-slash-menu-keyboard-selection-design.md`

- [ ] **Step 1: Run focused regressions together**

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarDraftEditor.test.js
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the complete repository verification**

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, bundle, and the release-artifact inspection all PASS.

- [ ] **Step 3: Inspect the exact shipped assets for source exposure**

```bash
node scripts/check-release-artifacts.mjs
find . -maxdepth 1 -type f \( -name 'main.js.map' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|BEGIN CERTIFICATE" main.js manifest.json styles.css
```

Expected: the guard passes; the searches report no source map, embedded source, raw TypeScript/JSX-family source, secret-bearing file, private key, or certificate in the shipped assets.

- [ ] **Step 4: Install the verified build into `lean-startup`**

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
cmp main.js /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp manifest.json /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp styles.css /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: installation succeeds and all three comparisons exit 0.

- [ ] **Step 5: Reload safely and smoke-test the real menu**

Before restarting, use Obsidian's developer evaluation to confirm no Markdown view reports `dirty: true`. Then perform a full Obsidian restart so the new installer and plugin bundle load together. In a disposable Aside page-note draft:

1. type `/` and confirm one row is blue;
2. leave the pointer over the first row and press Down twice;
3. confirm exactly one later row is blue after each keypress;
4. press Up and confirm selection moves back;
5. press Enter and confirm the active directive is inserted;
6. reopen `/`, move the pointer between rows, and confirm pointer selection still works; and
7. cancel the disposable draft without saving.

Expected: keyboard selection never snaps back to the stationary pointer, Enter inserts the active directive, pointer movement remains functional, and no runtime errors are logged.

- [ ] **Step 6: Update the tracked spec only from evidence**

Mark implementation and verification boxes in `docs/superpowers/specs/2026-08-23-stable-slash-menu-keyboard-selection-design.md` only for checks completed above. Leave any unverified live item open and state why.

- [ ] **Step 7: Review the final scope and commit tracking**

```bash
git diff 3559603 -- src/ui/views/sidebarDraftEditor.ts tests/sidebarDraftEditor.test.ts styles.css tests/toolbarDisabledStyles.test.mjs docs/superpowers/specs/2026-08-23-stable-slash-menu-keyboard-selection-design.md
git status --short
git add docs/superpowers/specs/2026-08-23-stable-slash-menu-keyboard-selection-design.md
git commit -m "docs: verify slash key selection"
```

Expected: only the controller, its regression test, the selection CSS, its regression test, and evidence tracking changed; the working tree is clean after the tracking commit.
