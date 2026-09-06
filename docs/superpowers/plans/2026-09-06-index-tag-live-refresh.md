# Index Tag Live Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh a visible index Tags query immediately after Obsidian reports changed tag metadata, without rerendering unrelated sidebar content.

**Architecture:** Route one narrow notification from the metadata callback through `WorkspaceViewController` to index Aside views. Let `AsideView` guard its own Tags-mode DOM state, rebuild the cached query model from `VaultCapabilityIndex`, and rerender only the existing Tags body.

**Tech Stack:** TypeScript, Obsidian workspace and metadata-cache APIs, native DOM, Node test runner.

---

### Task 1: Route index tag refreshes through the workspace view layer

**Files:**
- Modify: `tests/workspaceViewController.test.ts`
- Modify: `src/app/workspaceViewController.ts:25-30,220-250`

- [ ] **Step 1: Extend the test sidebar helper and write the failing routing test**

Extend `createSidebarView` in `tests/workspaceViewController.test.ts`:

```ts
function createSidebarView(
	renderCalls: number[],
	file: TFile | null = null,
	refreshIndexTagSearch?: () => void,
) {
	return {
		file,
		getViewType: () => "aside-view",
		renderComments: async () => {
			renderCalls.push(renderCalls.length + 1);
		},
		...(refreshIndexTagSearch ? { refreshIndexTagSearch } : {}),
	};
}
```

Add the test:

```ts
test("workspace view controller refreshes index tag views only", () => {
	const indexFile = createFile("Aside index.md");
	const noteFile = createFile("docs/note.md");
	const noteTagRefreshes: number[] = [];
	const indexTagRefreshes: number[] = [];
	const harness = createHarness({
		leaves: [
			{ view: createSidebarView([], noteFile, () => noteTagRefreshes.push(1)) },
			{ view: createSidebarView([], indexFile, () => indexTagRefreshes.push(1)) },
		],
		files: [indexFile, noteFile],
	});

	const refreshIndexTagSearchViews = (
		harness.controller as unknown as { refreshIndexTagSearchViews?: () => void }
	).refreshIndexTagSearchViews;
	assert.equal(typeof refreshIndexTagSearchViews, "function");
	refreshIndexTagSearchViews?.call(harness.controller);

	assert.deepEqual(noteTagRefreshes, []);
	assert.deepEqual(indexTagRefreshes, [1]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "refreshes index tag views only" .test-dist/tests/workspaceViewController.test.js
```

Expected: the new test fails because `refreshIndexTagSearchViews` is `undefined`.

- [ ] **Step 3: Add the narrow workspace route**

Extend `SidebarViewLike` in `src/app/workspaceViewController.ts`:

```ts
interface SidebarViewLike {
	getViewType(): string;
	renderComments(options?: { skipDataRefresh?: boolean }): Promise<void>;
	refreshIndexTagSearch?(): void;
	file?: TFile | null | undefined;
}
```

Add beside the existing sidebar refresh methods:

```ts
public refreshIndexTagSearchViews(): void {
	const leaves = this.host.app.workspace.getLeavesOfType("aside-view");
	for (const leaf of leaves) {
		if (
			isSidebarViewLike(leaf.view)
			&& this.host.isAllCommentsNotePath(leaf.view.file?.path ?? "")
		) {
			leaf.view.refreshIndexTagSearch?.();
		}
	}
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: the matching test passes with zero failures.

- [ ] **Step 5: Commit the route**

```bash
git add src/app/workspaceViewController.ts tests/workspaceViewController.test.ts
git commit -m "fix(index): route tag metadata refreshes"
```

### Task 2: Refresh only the connected Tags body and wire metadata changes

**Files:**
- Modify: `tests/sidebarIndexTagSearchRenderer.test.mjs`
- Modify: `tests/pluginStartupOrder.test.ts`
- Modify: `src/ui/views/AsideView.ts:1345-1382`
- Modify: `src/main.ts:865-871`

- [ ] **Step 1: Write the failing AsideView source contract**

Add to `tests/sidebarIndexTagSearchRenderer.test.mjs`:

```js
test("metadata refresh keeps the current tag query on the body-only path", () => {
	const refreshSource = asideViewSource.match(
		/public refreshIndexTagSearch\(\): void \{[\s\S]*?\n {4}\}/,
	)?.[0];

	assert.ok(refreshSource, "missing public index tag refresh hook");
	assert.match(refreshSource, /indexSidebarMode !== "tags"/);
	assert.match(refreshSource, /bodyEl\?\.isConnected/);
	assert.match(refreshSource, /refreshIndexTagSearchResult/);
	assert.match(refreshSource, /renderIndexTagSearchBody/);
	assert.doesNotMatch(refreshSource, /renderComments/);
});
```

- [ ] **Step 2: Write the failing metadata-wiring contract**

Add to `tests/pluginStartupOrder.test.ts`:

```ts
test("metadata changes update tag membership before refreshing visible tag results", () => {
	const source = readFileSync("src/main.ts", "utf8");
	const callbackStart = source.indexOf('this.registerEvent(this.app.metadataCache.on("changed"');
	const callbackEnd = source.indexOf("}));", callbackStart);
	const callbackSource = source.slice(callbackStart, callbackEnd);
	const upsertIndex = callbackSource.indexOf("this.vaultCapabilityIndex.upsert(");
	const refreshIndex = callbackSource.indexOf("this.workspaceViewController.refreshIndexTagSearchViews();");

	assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
	assert.ok(upsertIndex >= 0);
	assert.ok(refreshIndex > upsertIndex);
});
```

- [ ] **Step 3: Run both focused tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/pluginStartupOrder.test.js tests/sidebarIndexTagSearchRenderer.test.mjs
```

Expected: the two new tests fail because neither refresh hook nor metadata notification exists.

- [ ] **Step 4: Add the guarded body-only refresh hook**

Add beside `refreshIndexTagSearchResult` in `src/ui/views/AsideView.ts`:

```ts
public refreshIndexTagSearch(): void {
	const bodyEl = this.indexSidebarShell?.commentsBodyEl;
	const currentFilePath = this.file?.path ?? null;
	if (
		!bodyEl?.isConnected
		|| !currentFilePath
		|| !this.plugin.isAllCommentsNotePath(currentFilePath)
		|| this.indexSidebarMode !== "tags"
	) {
		return;
	}

	this.refreshIndexTagSearchResult();
	this.renderIndexTagSearchBody(bodyEl);
}
```

- [ ] **Step 5: Notify visible index Tags views after index mutation**

Extend the existing metadata-cache callback in `src/main.ts`:

```ts
this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => {
	this.vaultCapabilityIndex.upsert(file, getAllTags(cache) ?? []);
	this.workspaceViewController.refreshIndexTagSearchViews();
}));
```

- [ ] **Step 6: Run both focused tests and verify GREEN**

Run the Step 3 command again.

Expected: all selected tests pass with zero failures.

- [ ] **Step 7: Commit the visible refresh slice**

```bash
git add src/main.ts src/ui/views/AsideView.ts tests/pluginStartupOrder.test.ts tests/sidebarIndexTagSearchRenderer.test.mjs
git commit -m "fix(index): refresh visible tag results"
```

### Task 3: Complete cross-surface verification and tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-local-review-fixes-design.md`
- Verify: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Re-run the metadata change-surface search**

Run:

```bash
rg -n "metadataCache\.on\(\"changed\"|refreshIndexTagSearchViews|refreshIndexTagSearch|refreshIndexTagSearchResult" src tests docs/superpowers/specs/2026-09-06-local-review-fixes-design.md
```

Expected: `main.ts` is the event adapter, `WorkspaceViewController` is the workspace route, `AsideView` owns the guarded body refresh, and tests cover each boundary.

- [ ] **Step 2: Run full release-quality verification**

Run:

```bash
npm run build
```

Expected: compiled and direct tests, lint, typecheck, Obsidian compliance, production bundle, 750,000-byte size guard, and exact release-artifact security inspection all pass.

- [ ] **Step 3: Inspect the exact generated artifact set**

Run:

```bash
ls -l main.js manifest.json styles.css
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name '*.map' -o -name '*.ts' -o -name '*.tsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
```

Expected: the three named artifacts exist; the source-map marker search returns no matches; no forbidden root artifact is listed.

- [ ] **Step 4: Update the tracked spec with measured evidence**

In `docs/superpowers/specs/2026-09-06-local-review-fixes-design.md`:

- change `**Status:** Approved for planning` to `**Status:** Implemented and verified`;
- mark every implemented and verified checklist item `[x]`;
- add a concise verification paragraph with the fresh test counts, bundle byte count, and artifact-inspection result from Steps 2-3.

- [ ] **Step 5: Commit verification tracking**

```bash
git add docs/superpowers/specs/2026-09-06-local-review-fixes-design.md
git commit -m "docs(review): verify regression repairs"
```
