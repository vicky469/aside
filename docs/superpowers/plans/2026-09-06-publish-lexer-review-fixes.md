# Publish Lexer Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair three reviewed JavaScript dependency-scanner regressions without restoring a general-purpose parser or increasing the production bundle beyond its budget.

**Architecture:** Keep `javascriptDependencyLexer.ts` as the single lexical owner and `extractPublishDependencyReferences` as the public facade. Add paired direct and facade fixtures before each minimal semantic repair so internal behavior and integration wiring remain aligned.

**Tech Stack:** TypeScript, Node test runner, existing Aside publish dependency scanner, esbuild production bundle.

---

### Task 1: Preserve division after returned identifiers

**Files:**
- Modify: `tests/javascriptDependencyLexer.test.ts`
- Modify: `tests/publishDependencyReferences.test.ts`
- Modify: `src/core/publish/javascriptDependencyLexer.ts:43-47,313-332`

- [x] **Step 1: Write the failing direct and facade tests**

Add to `tests/javascriptDependencyLexer.test.ts`:

```ts
test("JavaScript dependency lexer keeps division after returned identifiers", () => {
	assert.deepEqual(references(`function load() {
		return value
		/ import("./asset.js") / divisor;
	}`), ["./asset.js"]);
});
```

Add to `tests/publishDependencyReferences.test.ts`:

```ts
test("JavaScript extraction keeps division after returned identifiers", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/return-division.js",
		contents: `function load() {
			return value
			/ import("./asset.js") / divisor;
		}`,
	}).references, ["./asset.js"]);
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "keeps division after returned identifiers" .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js
```

Expected: both new tests fail because the scanner returns `[]`.

- [x] **Step 3: Implement the restricted-label distinction**

Add a dedicated label-owner set beside the existing restricted-line set:

```ts
const RESTRICTED_LINE_KEYWORDS = new Set(["break", "continue", "debugger", "return"]);
const LABELLED_LINE_KEYWORDS = new Set(["break", "continue"]);
```

Use it only for the identifier-plus-line-break branch:

```ts
if (previous.kind === "identifier"
	&& state.pendingLineBreak
	&& !previous.lineBreakBefore
	&& LABELLED_LINE_KEYWORDS.has(tokens[tokens.length - 2]?.value ?? "")) return true;
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: both matching tests pass with zero failures.

- [x] **Step 5: Commit the slice**

```bash
git add src/core/publish/javascriptDependencyLexer.ts tests/javascriptDependencyLexer.test.ts tests/publishDependencyReferences.test.ts
git commit -m "fix(publish): preserve return division imports"
```

### Task 2: Decode valid surrogate escapes

**Files:**
- Modify: `tests/javascriptDependencyLexer.test.ts`
- Modify: `tests/publishDependencyReferences.test.ts`
- Modify: `src/core/publish/javascriptDependencyLexer.ts:109-125`

- [x] **Step 1: Write the failing direct and facade tests**

Add to `tests/javascriptDependencyLexer.test.ts`:

```ts
test("JavaScript dependency lexer cooks surrogate escape pairs", () => {
	assert.deepEqual(
		references(`import("./\\uD83D\\uDE80.js");`),
		["./🚀.js"],
	);
});
```

Add to `tests/publishDependencyReferences.test.ts`:

```ts
test("JavaScript extraction cooks surrogate escape pairs", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/surrogate-escape.js",
		contents: `import("./\\uD83D\\uDE80.js");`,
	}).references, ["./🚀.js"]);
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "cooks surrogate escape pairs" .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js
```

Expected: both new tests fail because the scanner returns `[]`.

- [x] **Step 3: Accept JavaScript surrogate values**

Keep the upper-bound validation but remove the surrogate rejection from fixed and braced Unicode decoding:

```ts
const codePoint = Number.parseInt(digits, 16);
if (codePoint > 0x10ffff) return null;
return { end: offset + length, value: String.fromCodePoint(codePoint) };
```

```ts
const codePoint = Number.parseInt(digits, 16);
if (codePoint > 0x10ffff) return null;
return { end: closing + 1, value: String.fromCodePoint(codePoint) };
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: both matching tests pass with zero failures.

- [x] **Step 5: Commit the slice**

```bash
git add src/core/publish/javascriptDependencyLexer.ts tests/javascriptDependencyLexer.test.ts tests/publishDependencyReferences.test.ts
git commit -m "fix(publish): decode surrogate escapes"
```

### Task 3: Reject property access named `new`

**Files:**
- Modify: `tests/javascriptDependencyLexer.test.ts`
- Modify: `tests/publishDependencyReferences.test.ts`
- Modify: `src/core/publish/javascriptDependencyLexer.ts:563-580`

- [x] **Step 1: Write the failing direct and facade tests**

Add to `tests/javascriptDependencyLexer.test.ts`:

```ts
test("JavaScript dependency lexer ignores property access named new", () => {
	assert.deepEqual(references(`registry.new
	URL("./phantom.js", import.meta.url);`), []);
});
```

Add to `tests/publishDependencyReferences.test.ts`:

```ts
test("JavaScript extraction ignores property access named new", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/property-new.js",
		contents: `registry.new
		URL("./phantom.js", import.meta.url);`,
	}).references, []);
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "ignores property access named new" .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js
```

Expected: both new tests fail because the scanner returns `["./phantom.js"]`.

- [x] **Step 3: Apply the existing property-access guard**

Change the `new` branch in `collectReferences`:

```ts
} else if (token.value === "new" && !isPropertyAccess(tokens, index)) {
	literal = matchNewImportMetaUrl(tokens, index, closingByOpening);
}
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: both matching tests pass with zero failures.

- [x] **Step 5: Commit the slice**

```bash
git add src/core/publish/javascriptDependencyLexer.ts tests/javascriptDependencyLexer.test.ts tests/publishDependencyReferences.test.ts
git commit -m "fix(publish): ignore property new references"
```

### Task 4: Audit and verify the publish surface

**Files:**
- Verify: `src/core/publish/javascriptDependencyLexer.ts`
- Verify: `src/core/publish/publishDependencyReferences.ts`
- Verify: `tests/javascriptDependencyLexer.test.ts`
- Verify: `tests/publishDependencyReferences.test.ts`

- [x] **Step 1: Re-run the change-surface search**

Run:

```bash
rg -n "RESTRICTED_LINE_KEYWORDS|LABELLED_LINE_KEYWORDS|readFixedHex|readUnicodeEscape|matchNewImportMetaUrl|scanJavascriptDependencies|extractPublishDependencyReferences" src tests
```

Expected: lexical decisions remain owned by `javascriptDependencyLexer.ts`; the facade only consumes scanner output; direct and facade fixtures contain the reviewed cases.

- [x] **Step 2: Run the complete publish-focused tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js .test-dist/tests/publishDependencyGraph.test.js
```

Expected: all selected tests pass with zero failures.
