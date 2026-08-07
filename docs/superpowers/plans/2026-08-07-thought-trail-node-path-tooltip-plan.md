# Thought Trail Node Path Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every clickable Thought Trail Mermaid node's complete vault-relative `.md` path in an Obsidian-native hover tooltip without changing compact visible labels or navigation.

**Architecture:** Keep Mermaid click directives as the single node-ID-to-file-URL source of truth. Add one pure resolver in `thoughtTrailNodeLinks.ts`, then let the existing renderer-independent node binder consume it and call Obsidian's `setTooltip` for both direct and fallback Mermaid output.

**Tech Stack:** TypeScript, Obsidian API, Mermaid SVG, Node test runner, source-level wiring tests.

---

### Task 1: Resolve rendered Mermaid nodes to full file paths

**Files:**
- Modify: `tests/thoughtTrailNodeLinks.test.ts`
- Modify: `src/ui/views/thoughtTrailNodeLinks.ts`

- [ ] **Step 1: Write the failing resolver test**

Extend the imports and add a test that asks for a not-yet-implemented resolver without creating a TypeScript compile failure:

```ts
import * as thoughtTrailNodeLinks from "../src/ui/views/thoughtTrailNodeLinks";
import {
    extractThoughtTrailClickTargets,
    parseThoughtTrailOpenFilePath,
    resolveThoughtTrailNodeId,
} from "../src/ui/views/thoughtTrailNodeLinks";

test("resolveThoughtTrailNodeFilePath returns full paths for unique and duplicate basenames", () => {
    const resolver = (thoughtTrailNodeLinks as unknown as {
        resolveThoughtTrailNodeFilePath?: (
            dataId: string | null,
            elementId: string | null,
            clickTargets: ReadonlyMap<string, string>,
        ) => string | null;
    }).resolveThoughtTrailNodeFilePath;
    assert.equal(typeof resolver, "function", "expected node file-path resolver export");

    const targets = extractThoughtTrailClickTargets([
        "flowchart TD",
        "    click n0 href \"obsidian://open?vault=dev&file=projects%2Falpha.md\" \"Open projects/alpha.md\"",
        "    click n1 href \"obsidian://open?vault=dev&file=archive%2Falpha.md\" \"Open archive/alpha.md\"",
        "    click n2 href \"obsidian://open?vault=dev&file=standalone.md\" \"Open standalone.md\"",
    ]);

    assert.equal(resolver?.("n0", null, targets), "projects/alpha.md");
    assert.equal(resolver?.(null, "flowchart-n1-0", targets), "archive/alpha.md");
    assert.equal(resolver?.("n2", null, targets), "standalone.md");
    assert.equal(resolver?.(null, "edge-L1", targets), null);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/thoughtTrailNodeLinks.test.js
```

Expected: compilation succeeds, then the test fails with `expected node file-path resolver export` because the new resolver does not exist.

- [ ] **Step 3: Implement the minimal resolver**

Add this shared helper after `resolveThoughtTrailNodeId` in `src/ui/views/thoughtTrailNodeLinks.ts`:

```ts
export function resolveThoughtTrailNodeFilePath(
    dataId: string | null | undefined,
    elementId: string | null | undefined,
    clickTargets: ReadonlyMap<string, string>,
): string | null {
    const nodeId = resolveThoughtTrailNodeId(dataId, elementId);
    if (!nodeId) {
        return null;
    }

    const targetUrl = clickTargets.get(nodeId);
    return targetUrl ? parseThoughtTrailOpenFilePath(targetUrl) : null;
}
```

- [ ] **Step 4: Replace the provisional test access with a typed import**

Remove the namespace import and add `resolveThoughtTrailNodeFilePath` to the existing named import. Replace `resolver?.(...)` assertions with direct calls:

```ts
assert.equal(resolveThoughtTrailNodeFilePath("n0", null, targets), "projects/alpha.md");
assert.equal(resolveThoughtTrailNodeFilePath(null, "flowchart-n1-0", targets), "archive/alpha.md");
assert.equal(resolveThoughtTrailNodeFilePath("n2", null, targets), "standalone.md");
assert.equal(resolveThoughtTrailNodeFilePath(null, "edge-L1", targets), null);
```

- [ ] **Step 5: Run the focused test to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/thoughtTrailNodeLinks.test.js
```

Expected: all `thoughtTrailNodeLinks` tests pass.

### Task 2: Bind native tooltips through the shared renderer path

**Files:**
- Modify: `tests/sidebarThoughtTrailRendererSource.test.mjs`
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts`

- [ ] **Step 1: Write the failing renderer-wiring test**

Add a source-level regression test proving the renderer imports Obsidian's native tooltip API, resolves the path through the shared helper, and binds it inside the existing shared node loop:

```js
test("clickable thought trail nodes receive native full-path tooltips", () => {
    assert.match(
        source,
        /import\s*\{[\s\S]*?setTooltip,[\s\S]*?\}\s*from\s*"obsidian";/,
        "renderer should use Obsidian's native tooltip API",
    );
    assert.match(
        source,
        /const filePath = resolveThoughtTrailNodeFilePath\([\s\S]*?element\.getAttribute\("data-id"\),[\s\S]*?element\.getAttribute\("id"\),[\s\S]*?clickTargets,[\s\S]*?\);/,
        "renderer should resolve each node through the shared click-target owner",
    );
    assert.match(
        source,
        /if \(filePath\) \{\s*setTooltip\(element as HTMLElement, filePath\);\s*\}/,
        "renderer should attach the complete resolved path to the clickable node",
    );
});
```

- [ ] **Step 2: Run the wiring test to verify RED**

Run:

```bash
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
```

Expected: the new test fails because `setTooltip` and `resolveThoughtTrailNodeFilePath` are not wired into the renderer.

- [ ] **Step 3: Implement the shared tooltip binding**

Add `setTooltip` to the existing Obsidian import and `resolveThoughtTrailNodeFilePath` to the `thoughtTrailNodeLinks` import. Inside the existing `mermaidEl.querySelectorAll(".node, [data-id]")` loop, retain the node-ID and click-target guard, then add:

```ts
const filePath = resolveThoughtTrailNodeFilePath(
    element.getAttribute("data-id"),
    element.getAttribute("id"),
    clickTargets,
);
if (filePath) {
    setTooltip(element as HTMLElement, filePath);
}
```

Keep this in `bindThoughtTrailNodeLinks`, which is called after `renderThoughtTrailMermaid`; do not add renderer-specific branches or change visible Mermaid labels.

- [ ] **Step 4: Run focused verification to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/thoughtTrailNodeLinks.test.js
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 5: Review the focused diff**

Run:

```bash
git diff --check
git diff -- src/ui/views/thoughtTrailNodeLinks.ts src/ui/views/sidebarThoughtTrailRenderer.ts tests/thoughtTrailNodeLinks.test.ts tests/sidebarThoughtTrailRendererSource.test.mjs
```

Expected: no whitespace errors; the diff contains one pure resolver, one shared native-tooltip binding, and focused regression coverage only.

### Task 3: Verify and close implementation tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-thought-trail-node-path-tooltip-design.md`

- [ ] **Step 1: Run the complete build**

Run:

```bash
npm run build
```

Expected: tests, lint, type checking, Obsidian compliance, production bundle, and release-artifact inspection all exit successfully. The artifact guard must confirm that `main.js`, `manifest.json`, and `styles.css` expose no source map references, embedded sources, raw TypeScript/JSX-family files, or secret-bearing files.

- [ ] **Step 2: Recheck the requested behavior against the code and tests**

Run:

```bash
rg -n "resolveThoughtTrailNodeFilePath|setTooltip\(element as HTMLElement, filePath\)|shortest unique path suffix|complete vault-relative file path" src tests docs/superpowers/specs/2026-08-07-thought-trail-node-path-tooltip-design.md
```

Expected: the shared resolver, its binder call, focused tests, and the tracked design requirements are all present; there are no duplicated direct/fallback tooltip implementations.

- [ ] **Step 3: Mark the spec checklist complete**

After Steps 1 and 2 pass, change the applicable `### To Implement` and `### Verification` checkboxes in `docs/superpowers/specs/2026-08-07-thought-trail-node-path-tooltip-design.md` from `[ ]` to `[x]`. Do not mark any item complete before its evidence exists.

- [ ] **Step 4: Commit the verified implementation**

Run:

```bash
git add src/ui/views/thoughtTrailNodeLinks.ts src/ui/views/sidebarThoughtTrailRenderer.ts tests/thoughtTrailNodeLinks.test.ts tests/sidebarThoughtTrailRendererSource.test.mjs docs/superpowers/specs/2026-08-07-thought-trail-node-path-tooltip-design.md
git commit -m "feat(thought-trail): show node paths on hover"
```

- [ ] **Step 5: Verify the committed tree**

Run:

```bash
git status --short
git show --stat --oneline --summary HEAD
```

Expected: the worktree is clean and the feature commit contains only the implementation, tests, and completed spec tracking.
