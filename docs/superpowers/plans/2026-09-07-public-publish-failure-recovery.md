# Public Publish Failure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent prototype-named JavaScript identifiers from crashing publish dependency discovery and guarantee that every publish action exits its loading state with useful failure reporting.

**Architecture:** Keep dependency semantics inside the existing JavaScript lexer, replacing prototype-sensitive delimiter storage with an explicit `Map`. Keep UI loading ownership in `PublicFilePublishActionController`; exceptional rejections cross a typed host callback so `main.ts` can show a generic notice and send the original error through sanitized logging.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, esbuild, Cloudflare Pages via Wrangler.

---

### Task 1: Make delimiter indexing prototype-safe

**Files:**
- Modify: `tests/javascriptDependencyLexer.test.ts`
- Modify: `tests/publishDependencyReferences.test.ts`
- Modify: `src/core/publish/javascriptDependencyLexer.ts:485-501`

- [x] **Step 1: Add a failing direct lexer regression**

Add this test after the existing property-access test in `tests/javascriptDependencyLexer.test.ts`:

```ts
test("JavaScript dependency lexer ignores prototype-named identifiers during delimiter indexing", () => {
	assert.deepEqual(references(`
Object.prototype.hasOwnProperty.call(record, "key");
record.constructor;
record.toString();
record.__proto__;
import "./real.js";
`), ["./real.js"]);
});
```

- [x] **Step 2: Add a failing dependency-facade regression**

Add this test after the existing property-access test in `tests/publishDependencyReferences.test.ts`:

```ts
test("JavaScript extraction ignores prototype-named identifiers during delimiter indexing", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/prototype-names.js",
		contents: `Object.prototype.hasOwnProperty.call(record, "key");
record.constructor;
record.toString();
record.__proto__;
import "./real.js";`,
	}).references, ["./real.js"]);
});
```

- [x] **Step 3: Compile and run the regressions to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "prototype-named identifiers" .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js
```

Expected: both tests fail with `TypeError: stacks[value].push is not a function`; the facade may report the same underlying rejection.

- [x] **Step 4: Replace prototype-sensitive records with explicit maps**

Replace `indexClosingDelimiters` in `src/core/publish/javascriptDependencyLexer.ts` with:

```ts
function indexClosingDelimiters(tokens: readonly JavascriptToken[]): Map<number, number> {
	const closingByOpening = new Map<number, number>();
	const stacks = new Map<string, number[]>([
		["(", []],
		["[", []],
		["{", []],
	]);
	const openingByClosing = new Map<string, string>([
		[")", "("],
		["]", "["],
		["}", "{"],
	]);
	for (let index = 0; index < tokens.length; index += 1) {
		const value = tokens[index].value;
		const openingStack = stacks.get(value);
		if (openingStack) {
			openingStack.push(index);
			continue;
		}
		const opening = openingByClosing.get(value);
		if (opening) {
			const openingIndex = stacks.get(opening)?.pop();
			if (openingIndex !== undefined) closingByOpening.set(openingIndex, index);
		}
	}
	return closingByOpening;
}
```

- [x] **Step 5: Re-run focused lexer and facade tests to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js
```

Expected: all selected tests pass with zero failures.

- [x] **Step 6: Commit the parser repair**

```bash
git add src/core/publish/javascriptDependencyLexer.ts tests/javascriptDependencyLexer.test.ts tests/publishDependencyReferences.test.ts
git commit -m "fix(publish): isolate delimiter stacks"
```

### Task 2: Guarantee publish-action recovery

**Files:**
- Modify: `tests/publicFilePublishActions.test.ts`
- Modify: `src/ui/views/publicFilePublishActions.ts:21-26,352-371`
- Modify: `src/main.ts:664-671`

- [x] **Step 1: Extend the fake action element for loading cleanup assertions**

Add this method beside `addClass` in `tests/publicFilePublishActions.test.ts`:

```ts
	public removeClass(className: string): void {
		this.classes.delete(className);
		const remaining = (this.attributes.get("class") ?? "")
			.split(/\s+/u)
			.filter((item) => item && item !== className);
		if (remaining.length === 0) {
			this.attributes.delete("class");
			return;
		}
		this.attributes.set("class", remaining.join(" "));
	}
```

- [x] **Step 2: Add a failing rejected-action lifecycle test**

Append this test to `tests/publicFilePublishActions.test.ts`:

```ts
test("PublicFilePublishActionController clears loading and reports rejected actions", async () => {
	const htmlView = createView("public/page.html");
	const failure = new Error("dependency scan failed");
	let stateReads = 0;
	let reportedFile: TFile | null = null;
	let reportedError: unknown;
	const host = {
		getAllowedRoot: () => "public/",
		getPublishActionStates: async () => {
			stateReads += 1;
			return [{
				kind: "update-publish" as const,
				label: "Republish HTML",
				icon: "upload-cloud",
				disabled: false as const,
			}];
		},
		runPublishAction: async () => {
			throw failure;
		},
		showNotice: () => {},
		reportPublishActionError: (file: TFile, error: unknown) => {
			reportedFile = file;
			reportedError = error;
		},
	};
	const controller = new PublicFilePublishActionController(host);

	await controller.refreshViews([htmlView]);
	const action = htmlView.actions[0];
	action.callback({ preventDefault: () => {} } as MouseEvent);
	await new Promise<void>((resolve) => setImmediate(resolve));

	assert.equal(action.element.classes.has("is-loading"), false);
	assert.equal(reportedFile, htmlView.file);
	assert.equal(reportedError, failure);
	assert.equal(stateReads, 1);
});
```

- [x] **Step 3: Compile and run the lifecycle regression to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "clears loading and reports rejected actions" .test-dist/tests/publicFilePublishActions.test.js
```

Expected: the test fails because the rejected action is not reported and `is-loading` remains set.

- [x] **Step 4: Add the typed error-reporting boundary**

Add this required method to `PublicFilePublishActionHost` in `src/ui/views/publicFilePublishActions.ts`:

```ts
	reportPublishActionError(file: TFile, error: unknown): void;
```

Add `reportPublishActionError: () => {}` to the pre-existing test hosts in `tests/publicFilePublishActions.test.ts`.

Wire the production host in `src/main.ts` beside `showNotice`:

```ts
        reportPublishActionError: (file, error) => {
            this.showNotice(
                "Publish failed unexpectedly. Check Aside logs for details.",
                "publish",
                "publish.html.action.error",
                {
                    vaultRelativePath: file.path,
                    error,
                },
            );
        },
```

This keeps the transient notice generic while `logEvent` sanitizes the original error payload.

- [x] **Step 5: Make loading cleanup unconditional**

Replace the enabled-action body at the end of `handleAction` with:

```ts
		actionEl.addClass("is-loading");
		try {
			await this.host.runPublishAction(file, state.kind);
		} catch (error) {
			this.host.reportPublishActionError(file, error);
			return;
		} finally {
			actionEl.removeClass("is-loading");
		}
		await this.refreshView(view);
```

- [x] **Step 6: Re-run the complete publish-action test file to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/publicFilePublishActions.test.js
```

Expected: all tests pass with zero failures, including the rejection lifecycle test.

- [x] **Step 7: Commit the action-lifecycle repair**

```bash
git add src/main.ts src/ui/views/publicFilePublishActions.ts tests/publicFilePublishActions.test.ts
git commit -m "fix(publish): recover failed actions"
```

### Task 3: Verify the complete publish surface and artifacts

**Files:**
- Verify: `src/core/publish/javascriptDependencyLexer.ts`
- Verify: `src/core/publish/publishDependencyReferences.ts`
- Verify: `src/ui/views/publicFilePublishActions.ts`
- Verify: `src/main.ts`
- Verify: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [x] **Step 1: Run the combined focused publish suites**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/javascriptDependencyLexer.test.js .test-dist/tests/publishDependencyReferences.test.js .test-dist/tests/publishDependencyGraph.test.js .test-dist/tests/publicFilePublishActions.test.js .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: all selected tests pass with zero failures.

- [x] **Step 2: Run the complete build**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, bundle-size check, and release-artifact inspection all succeed.

- [x] **Step 3: Inspect the exact installable artifact**

Run:

```bash
npm run release:artifacts:check
git status --short
find . -maxdepth 1 -type f \( -name '*.map' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' -o -name '*.crt' \) -print
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
```

Expected: the guard passes; the exact shipped set remains `main.js`, `manifest.json`, and `styles.css`; no source maps, embedded sources, raw TypeScript/JSX-family source, secrets, private keys, or certificates are included.

- [x] **Step 4: Install the verified build into the test vault**

Run:

```bash
npm run dev:install-built -- --vault /path/to/lean-startup
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: installed `main.js`, `manifest.json`, and `styles.css` match the inspected build byte-for-byte and Aside reloads without a developer error.

- [x] **Step 5: Republish Pigeon through Aside**

Use the Pigeon file-view `Republish HTML` action after confirming the exact snapshot still passes Aside's runtime artifact guard.

Expected: the action stops loading, dependency discovery completes, Wrangler starts, and Aside emits `publish.html.updated` for `public/pigeon-plan/index.html`.

- [x] **Step 6: Verify hosted freshness**

Download the hosted entry and dependencies without altering the source vault. Compare the HTML and CSS cache-busting references and SHA-256 hashes with the current local files.

Expected: hosted Pigeon HTML contains the current `clickedInsidePanel` behavior and references `pigeon-mocks-v7.css?v=7def22cf` plus `pigeon-mobile-v7.css?v=4ebb930d`; all referenced dependencies return successfully.

### Task 4: Record completion

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-public-publish-failure-recovery-design.md`
- Modify: `docs/superpowers/plans/2026-09-07-public-publish-failure-recovery.md`

- [x] **Step 1: Update implementation tracking with verified evidence**

Mark only completed implementation and verification items `[x]`. Add a dated verification-evidence section recording focused-test totals, full-build totals, artifact inspection, installed-build parity, publish event, and hosted hash checks.

- [x] **Step 2: Self-review the tracked documents**

Run:

```bash
rg -n "TB[D]|TO[D]O|PLACEHOLD[E]R|\[ \]" docs/superpowers/specs/2026-09-07-public-publish-failure-recovery-design.md docs/superpowers/plans/2026-09-07-public-publish-failure-recovery.md
git diff --check
```

Expected: no placeholders remain; unchecked items exist only for genuinely incomplete verification; the diff has no whitespace errors.

- [x] **Step 3: Commit the verification record**

```bash
git add docs/superpowers/specs/2026-09-07-public-publish-failure-recovery-design.md docs/superpowers/plans/2026-09-07-public-publish-failure-recovery.md
git commit -m "docs(publish): record recovery verification"
```

## Execution Evidence — 2026-09-07

- RED: both prototype-name tests failed with the reproduced delimiter-stack `TypeError`.
- GREEN: 67 lexer/reference tests and 7 publish-action tests passed independently.
- Publish surface: 133 focused tests passed.
- Review correction: the new failure event was initially suppressed by the central notice policy; its regression failed with `false !== true`, then passed after the exact publish error event was allowlisted.
- Final review: ready to merge, with no remaining critical, important, or minor findings; 136 relevant tests and the integrated diff check passed independently.
- Final full build: 1,691 tests passed; lint, typecheck, compliance, bundle size, bundling, and the artifact guard passed.
- Artifact security: exact install set `main.js`, `manifest.json`, and `styles.css`; no source exposure or secret-bearing files found; final `main.js` SHA-256 `140c4cc338ff2ef5d3e8fb009699882a951d4edd34b014a048414bdf13f53359`.
- Installation: all three installed plugin files matched the inspected build byte-for-byte.
- Snapshot: 16 runtime-inspected files; Pigeon HTML SHA-256 `56d47e0684974f6580aec33a73b2c10a9ad67cf473a9681a74dc7558b04c31ca`.
- Deployment: Aside event `publish.html.updated` at `2026-09-07T00:32:33.762Z`; Cloudflare production deployment `5144dc91-c934-4122-82a2-9821ff2b2709`.
- Hosted output: CSS and SVG byte-identical; HTML byte-identical after removing Cloudflare's 938-byte challenge-script injection.
