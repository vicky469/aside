# Production Bundle Size Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce production `main.js` from 871,084 bytes to at most 750,000 bytes without removing or changing user-facing behavior.

**Architecture:** Keep `extractPublishDependencyReferences` as the stable facade. Replace its general-purpose JavaScript and HTML entity dependencies with focused internal modules, move the production target to ES2020, and enforce the result with source and artifact size gates.

**Tech Stack:** TypeScript, Node.js test runner, esbuild, Obsidian browser runtime, npm.

---

### Task 1: Lock the bundle and dependency budgets

**Files:**
- Create: `scripts/check-bundle-size.mjs`
- Create: `tests/checkBundleSize.test.mjs`

- [ ] **Step 1: Write the failing size-policy test**

Create a temporary `main.js` and verify the policy accepts 750,000 bytes, rejects 750,001 bytes, and reports both values:

```js
test("bundle size policy enforces the production byte ceiling", () => {
    withBundleOfSize(750_000, (bundlePath) => {
        assert.deepEqual(inspectBundleSize(bundlePath), []);
    });
    withBundleOfSize(750_001, (bundlePath) => {
        assert.deepEqual(inspectBundleSize(bundlePath), [
            "main.js is 750001 bytes; maximum is 750000 bytes (1 bytes over)",
        ]);
    });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/checkBundleSize.test.mjs`

Expected: FAIL because `scripts/check-bundle-size.mjs` does not exist.

- [ ] **Step 3: Implement the size policy**

Export `MAX_MAIN_BUNDLE_BYTES = 750_000` and `inspectBundleSize(bundlePath = "main.js")`. Use `statSync` and return an issue when the file is absent, not a regular file, or over budget. The CLI prints the actual byte count on success and exits nonzero with every issue on failure.

- [ ] **Step 4: Verify the real baseline is RED**

Run: `node scripts/check-bundle-size.mjs main.js`

Expected: FAIL and report that the 871,084-byte release bundle exceeds 750,000 bytes. Do not wire the gate into `npm run build` until Task 4 makes it green.

- [ ] **Step 5: Commit the policy slice**

```bash
git add scripts/check-bundle-size.mjs tests/checkBundleSize.test.mjs
git commit -m "test(build): enforce bundle size budget"
```

### Task 2: Replace the HTML entity table

**Files:**
- Create: `src/core/publish/htmlAttributeDecoder.ts`
- Create: `tests/htmlAttributeDecoder.test.ts`
- Modify: `src/core/publish/publishDependencyReferences.ts`
- Modify: `tests/publishDependencyReferences.test.ts`

- [ ] **Step 1: Add decoder contract tests**

Cover raw text, the five XML names, `sol`, `colon`, decimal/hex numeric references, astral numeric references, invalid numeric references, unknown names, and attribute-context ambiguous ampersands. Expose an injectable native parser so the native branch is tested without a DOM:

```ts
assert.equal(decodeHtmlAttributeReferences("a&amp;b&#47;c&sol;d"), "a&b/c/d");
assert.equal(decodeHtmlAttributeReferences("a&unknown;b"), "a&unknown;b");
assert.equal(decodeHtmlAttributeReferences("x&copy=1"), "x&copy=1");
assert.equal(decodeHtmlAttributeReferences("&colon;", () => "native"), "native");
```

- [ ] **Step 2: Run the decoder test and verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/htmlAttributeDecoder.test.js`

Expected: FAIL because the decoder module does not exist.

- [ ] **Step 3: Implement the focused decoder**

Use one public function:

```ts
export type NativeHtmlAttributeDecoder = (value: string) => string | null;

export function decodeHtmlAttributeReferences(
    value: string,
    nativeDecoder: NativeHtmlAttributeDecoder = decodeWithDetachedTemplate,
): string;
```

`decodeWithDetachedTemplate` must feature-detect `globalThis.document`, create a detached `template`, encode raw `"` and `<` delimiters, parse one `data-aside-value` attribute, and return its attribute value without attaching the template. The pure fallback performs a single-pass replacement of numeric references and a frozen URL-safe named map. Unknown or context-ambiguous names remain unchanged.

- [ ] **Step 4: Switch the facade to the internal decoder**

Replace the `entities` import with:

```ts
import { decodeHtmlAttributeReferences } from "./htmlAttributeDecoder";
```

Delete the local forwarding function with the same name and leave `scanHtmlAttributes` behavior unchanged.

- [ ] **Step 5: Run focused extraction tests and verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/htmlAttributeDecoder.test.js .test-dist/tests/publishDependencyReferences.test.js`

Expected: all matching tests PASS with unchanged reference arrays.

- [ ] **Step 6: Commit the entity-decoder slice**

```bash
git add src/core/publish/htmlAttributeDecoder.ts src/core/publish/publishDependencyReferences.ts tests/htmlAttributeDecoder.test.ts tests/publishDependencyReferences.test.ts
git commit -m "refactor(publish): trim entity decoding"
```

### Task 3: Introduce the focused JavaScript dependency lexer

**Files:**
- Create: `src/core/publish/javascriptDependencyLexer.ts`
- Create: `tests/javascriptDependencyLexer.test.ts`
- Modify: `src/core/publish/publishDependencyReferences.ts`
- Modify: `tests/publishDependencyReferences.test.ts`

- [ ] **Step 1: Add direct lexer tests before integration**

Define the public result:

```ts
export interface JavascriptDependencyScanResult {
    references: Array<{ offset: number; value: string }>;
    markupFragments: Array<{ offset: number; contents: string }>;
}
```

Move the existing JavaScript extraction fixtures into table-driven direct lexer assertions while leaving facade tests in place. Add explicit cases for Unicode identifier boundaries, comments, strings, nested template expressions, regex character classes, control-statement regex bodies, division expressions, malformed suffix recovery, string escape cooking, import options, and legal trailing commas.

- [ ] **Step 2: Run the direct lexer test and verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/javascriptDependencyLexer.test.js`

Expected: FAIL because the focused lexer module does not exist.

- [ ] **Step 3: Implement one linear lexical pass**

Implement `scanJavascriptDependencies(contents)` with these private units:

```ts
interface JavascriptToken {
    kind: "identifier" | "keyword" | "string" | "punctuator";
    value: string;
    start: number;
    end: number;
    lineBreakBefore: boolean;
}

function readIdentifier(contents: string, offset: number): JavascriptToken;
function readString(contents: string, offset: number): JavascriptToken | null;
function skipLineComment(contents: string, offset: number): number;
function skipBlockComment(contents: string, offset: number): number;
function skipRegexLiteral(contents: string, offset: number): number | null;
function scanTemplate(contents: string, offset: number, result: JavascriptDependencyScanResult): number;
function matchStaticImport(tokens: readonly JavascriptToken[], index: number): JavascriptToken | null;
function matchExportFrom(tokens: readonly JavascriptToken[], index: number): JavascriptToken | null;
function matchDynamicImport(tokens: readonly JavascriptToken[], index: number): JavascriptToken | null;
function matchNewImportMetaUrl(tokens: readonly JavascriptToken[], index: number): JavascriptToken | null;
```

Read identifiers with Unicode `ID_Start`/`ID_Continue`. Cook string escapes while rejecting malformed escape sequences. Track delimiter pairs and the keyword that owns each control-condition parenthesis. Treat `/` as regex only in expression-start or statement-body contexts; if no valid closing slash exists, retain it as division punctuation. Scan `${...}` recursively while treating raw template segments as markup fragments only.

After tokenization, match only the four supported static forms. Reject member/private `import`, template arguments, constructed strings, extra import options, and `new URL` forms with another base.

- [ ] **Step 4: Verify the direct lexer**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/javascriptDependencyLexer.test.js`

Expected: all direct lexer cases PASS, including the 32 KB division and deep-chain performance cases.

- [ ] **Step 5: Integrate through the stable facade**

Replace Acorn AST/token helpers in `publishDependencyReferences.ts` with one adapter:

```ts
function collectJavascriptReferenceEvents(contents: string, target: ReferenceEvent[], baseOffset = 0) {
    const result = scanJavascriptDependencies(contents);
    for (const reference of result.references) {
        appendEvent(target, baseOffset + reference.offset, reference.value);
    }
    return result.markupFragments;
}
```

Feed returned markup fragments into the existing HTML fragment collector. Delete every Acorn type, parser, tokenizer, AST walk, and fallback helper.

- [ ] **Step 6: Run the complete publish extraction suite**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js`

Expected: all matching existing and new tests PASS without changed expectations.

- [ ] **Step 7: Commit the lexer slice**

```bash
git add src/core/publish/javascriptDependencyLexer.ts src/core/publish/publishDependencyReferences.ts tests/javascriptDependencyLexer.test.ts tests/publishDependencyReferences.test.ts
git commit -m "refactor(publish): replace general JS parser"
```

### Task 4: Remove heavyweight dependencies and lower build overhead

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `esbuild.config.mjs`
- Create: `tests/bundleDependencyPolicy.test.mjs`

- [ ] **Step 1: Add the failing dependency-policy test**

Read `package.json`, `package-lock.json`, and every TypeScript file under `src/`. Assert that runtime dependencies and imports contain neither `acorn` nor `entities`:

```js
test("production source excludes heavyweight general-purpose parsers", () => {
    assert.equal(packageJson.dependencies?.acorn, undefined);
    assert.equal(packageJson.dependencies?.entities, undefined);
    assert.doesNotMatch(sourceText, /from\s+["'](?:acorn|entities)["']/u);
    assert.doesNotMatch(packageLockText, /node_modules\/(?:acorn|entities)/u);
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `node --test tests/bundleDependencyPolicy.test.mjs`

Expected: FAIL on the remaining runtime dependency declarations and lockfile entries.

- [ ] **Step 3: Remove runtime dependencies mechanically**

Run:

```bash
npm uninstall acorn entities --save
```

Expected: both packages disappear from `dependencies` and their unused lockfile entries disappear.

- [ ] **Step 4: Raise the esbuild target and wire the size gate**

Change:

```js
target: "es2020",
```

Keep CommonJS format, tree shaking, minification, externals, and source-map policy unchanged.

Add `"bundle:size:check": "node scripts/check-bundle-size.mjs"` to package scripts. Change `build` so the size check runs immediately after `npm run bundle` and before `npm run release:artifacts:check`.

- [ ] **Step 5: Verify the dependency policy turns GREEN**

Run: `node --test tests/bundleDependencyPolicy.test.mjs`

Expected: PASS with no runtime declaration, lockfile entry, or source import for either dependency.

- [ ] **Step 6: Bundle and verify the byte ceiling**

Run: `npm run bundle && npm run bundle:size:check`

Expected: PASS and report `main.js` at or below 750,000 bytes.

- [ ] **Step 7: Commit dependency and target cleanup**

```bash
git add package.json package-lock.json esbuild.config.mjs tests/bundleDependencyPolicy.test.mjs
git commit -m "perf(build): reduce production bundle"
```

### Task 5: Run full regression and artifact verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-bundle-size-cleanup-design.md`

- [ ] **Step 1: Run the full production gate**

Run: `npm run build`

Expected: all tests, lint, typecheck, Obsidian compliance, bundle size, bundle, and release artifact checks PASS.

- [ ] **Step 2: Inspect the exact artifact**

Run:

```bash
wc -c main.js manifest.json styles.css
npm run release:artifacts:check
test ! -e main.js.map
```

Expected: `main.js` is at most 750,000 bytes; the guard approves exactly `main.js`, `manifest.json`, and `styles.css`; no source map exists.

- [ ] **Step 3: Re-profile contributors**

Run the same in-memory esbuild metafile profiler used for the baseline. Expected: no `node_modules/acorn` or `node_modules/entities` input and a report of the new largest contributors.

- [ ] **Step 4: Update the spec tracking with measured evidence**

Mark every implemented item complete only after its verification passes. Add the final `main.js` byte count, reduction in bytes and percent, test totals, and artifact hashes.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/superpowers/specs/2026-09-04-bundle-size-cleanup-design.md
git commit -m "docs(build): verify bundle cleanup"
```

### Task 6: Install and verify the live build

**Files:**
- No tracked file changes expected.

- [ ] **Step 1: Install the exact build**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /path/to/vault
```

Use the configured `lean-startup` vault path locally; do not persist that private path in tracked content.

- [ ] **Step 2: Reload Aside**

Run: `obsidian plugin:reload id=aside vault=lean-startup`

Expected: command exits successfully.

- [ ] **Step 3: Compare all installed artifacts**

Compare `main.js`, `manifest.json`, and `styles.css` byte-for-byte against the installed plugin directory. Expected: all three match.

- [ ] **Step 4: Smoke-test preserved surfaces**

Open Aside and verify one existing comment thread, one agent reply card, one Thought Trail, and the public publish controls render without console errors. Publishing a real site is not required because the extraction and traversal suites cover that behavior without external mutation.

- [ ] **Step 5: Final repository audit**

Run:

```bash
git status --short
git diff --check
```

Expected: clean worktree and no whitespace errors.
