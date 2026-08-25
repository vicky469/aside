# Recursive HTML Publish Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every real published HTML entry deploy with the recursively reachable local CSS, JavaScript, image, font, media, and other web assets it statically references.

**Architecture:** Keep HTML/PDF entry selection unchanged, but split entry eligibility from shared artifact safety. Add a dependency-free reference parser/resolver and an async graph builder under `src/core/publish/`; the publish controller seeds the graph with enabled real HTML entries, appends the safe dependency closure to the existing snapshot, inspects the exact completed snapshot, and only then invokes the existing Cloudflare Pages deploy host.

**Tech Stack:** TypeScript 5.9, Obsidian Vault API, Node test runner, existing publish controller and artifact guard, esbuild, Cloudflare Pages Direct Upload through Wrangler.

---

## Starting State

- Branch at planning time: `main`
- Approved design: `docs/superpowers/specs/2026-08-25-recursive-html-publish-dependencies-design.md`
- Design commit: `25fc922`
- Implementation worktree: create with the `using-git-worktrees` skill before Task 1.
- Fresh baseline: `npm test` passes with 1,246 TypeScript tests and 98 repository-policy tests.
- Production repro: `/public/pigeon-plan/` returns 200 while `pigeon-mocks-v7.css` and `assets/pigeon-logo.svg` return 404.
- Scope guard: do not add folder publishing, remote downloads, JavaScript execution, a user manifest, direct publish actions for asset files, or new Cloudflare configuration.

### Task 1: Separate entry eligibility from dependency safety

**Files:**

- Modify: `tests/publishArtifactGuard.test.ts`
- Modify: `src/core/publish/publishArtifactGuard.ts`

- [ ] **Step 1: Write failing dependency-policy tests**

Import a new `inspectPublishDependency` export and add focused cases while retaining every existing entry-artifact assertion:

```ts
import {
	inspectPublishArtifact,
	inspectPublishDependency,
} from "../src/core/publish/publishArtifactGuard";

function inspectDependency(
	vaultRelativePath: string,
	contents: string | ArrayBuffer = "asset",
) {
	return inspectPublishDependency({
		vaultRelativePath,
		allowedRoot: "share/",
		configDir: ".obsidian",
		contents,
	});
}

test("inspectPublishDependency allows reachable web assets", () => {
	for (const path of [
		"share/site.css",
		"share/app.js",
		"share/logo.svg",
		"share/icon.png",
		"share/font.woff2",
		"share/site.webmanifest",
		"share/module.wasm",
	]) {
		assert.deepEqual(inspectDependency(path), { ok: true }, path);
	}
});

test("inspectPublishDependency blocks raw source files", () => {
	for (const path of [
		"share/readme.md",
		"share/component.mdx",
		"share/app.ts",
		"share/app.tsx",
		"share/component.jsx",
	]) {
		assert.deepEqual(inspectDependency(path), {
			ok: false,
			notice: "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published.",
		}, path);
	}
});

test("entry selection remains limited to HTML and PDF", () => {
	assert.deepEqual(inspect("share/site.css", "body {}"), {
		ok: false,
		notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
	});
	assert.deepEqual(inspectDependency("share/site.css", "body {}"), { ok: true });
});
```

Also exercise `.env`, `.npmrc`, keys, certificates, `.map`, source-map markers, logs, outside-root paths, and nested `.obsidian` paths through both public functions so shared safety cannot drift.

- [ ] **Step 2: Run the guard test and confirm red**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publishArtifactGuard.test.js
```

Expected: TypeScript fails because `inspectPublishDependency` does not exist.

- [ ] **Step 3: Extract common safety and add dependency inspection**

Refactor `publishArtifactGuard.ts` around this exact public shape:

```ts
function inspectPublishPathAndContents(
	options: InspectPublishArtifactOptions,
): PublishArtifactInspection {
	const normalizedPath = normalizeVaultRelativePublishPath(options.vaultRelativePath);
	if (!normalizedPath.ok) {
		return {
			ok: false,
			notice: "Publish failed: selected path must stay inside the current vault.",
		};
	}

	const allowedRoot = normalizePublishAllowedRoot(options.allowedRoot);
	if (!normalizedPath.path.startsWith(allowedRoot)) {
		return {
			ok: false,
			notice: `Publish failed: artifact path is outside the configured publish folder: ${allowedRoot}`,
		};
	}
	if (containsPathSegments(normalizedPath.path, options.configDir)) {
		return {
			ok: false,
			notice: "Publish failed: Obsidian configuration files cannot be published.",
		};
	}
	if (isSecretBearingPath(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: secret-bearing files cannot be published.",
		};
	}
	if (isKeyOrCertificatePath(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: key and certificate files cannot be published.",
		};
	}
	if (/\.map$/iu.test(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: source maps cannot be published.",
		};
	}
	if (typeof options.contents === "string"
		&& getSourceMapContentMarkers().some((marker) => options.contents.includes(marker))) {
		return {
			ok: false,
			notice: "Publish failed: source-map references cannot be published.",
		};
	}
	if (/\.log$/iu.test(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: log files cannot be published.",
		};
	}
	return { ok: true };
}

export function inspectPublishArtifact(
	options: InspectPublishArtifactOptions,
): PublishArtifactInspection {
	const safety = inspectPublishPathAndContents(options);
	if (!safety.ok) return safety;
	if (!(/\.html?$/iu.test(options.vaultRelativePath) || /\.pdf$/iu.test(options.vaultRelativePath))) {
		return {
			ok: false,
			notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
		};
	}
	return { ok: true };
}

export function inspectPublishDependency(
	options: InspectPublishArtifactOptions,
): PublishArtifactInspection {
	const safety = inspectPublishPathAndContents(options);
	if (!safety.ok) return safety;
	if (/\.(?:md|mdx|ts|tsx|jsx)$/iu.test(options.vaultRelativePath)) {
		return {
			ok: false,
			notice: "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published.",
		};
	}
	return { ok: true };
}
```

Keep the existing helper implementations and notices unchanged. The refactor must not weaken entry selection or duplicate common checks.

- [ ] **Step 4: Run the guard test and confirm green**

Run the Step 2 command. Expected: all artifact guard tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/publish/publishArtifactGuard.ts tests/publishArtifactGuard.test.ts
git commit -m "refactor(publish): split dependency safety"
```

### Task 2: Extract and resolve static local references

**Files:**

- Create: `src/core/publish/publishDependencyReferences.ts`
- Create: `tests/publishDependencyReferences.test.ts`

- [ ] **Step 1: Write failing extraction tests**

Cover HTML/SVG attributes, `srcset`, inline styles, `<style>`, inline scripts, CSS imports/URLs, JavaScript modules, comment suppression, de-duplication, and text-kind selection:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
	extractPublishDependencyReferences,
	getPublishDependencyTextKind,
	resolvePublishDependencyReference,
} from "../src/core/publish/publishDependencyReferences";

test("HTML extraction finds direct, inline CSS, and inline module references", () => {
	const extracted = extractPublishDependencyReferences({
		vaultRelativePath: "public/site/index.html",
		contents: `
			<base href="./app/">
			<link rel="stylesheet" href="../site.css?v=2">
			<img src="images/logo.svg#mark" srcset="images/logo@2x.png 2x, images/logo@3x.png 3x">
			<video poster="images/poster.jpg"></video>
			<div style="background-image:url('images/paper.png')"></div>
			<style>@import "theme.css"; @font-face { src: url(font.woff2); }</style>
			<script>import "./boot.js"; new URL("./worker.wasm", import.meta.url);</script>
		`,
	});

	assert.equal(extracted.baseHref, "./app/");
	assert.deepEqual(extracted.references, [
		"../site.css?v=2",
		"images/logo.svg#mark",
		"images/logo@2x.png",
		"images/logo@3x.png",
		"images/poster.jpg",
		"images/paper.png",
		"theme.css",
		"font.woff2",
		"./boot.js",
		"./worker.wasm",
	]);
});

test("CSS and JavaScript extraction ignores comments and de-duplicates references", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/site/app.css",
		contents: `/* url(ignored.png) */ @import "theme.css"; .a{background:url("logo.svg")} .b{background:url(logo.svg)}`,
	}).references, ["theme.css", "logo.svg"]);

	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/site/app.js",
		contents: `// import "ignored.js"\nimport "./boot.js"; export { value } from "./value.js"; import("./lazy.js"); new URL("./icon.svg", import.meta.url);`,
	}).references, ["./boot.js", "./value.js", "./lazy.js", "./icon.svg"]);
});

test("text-kind selection limits recursive scanning", () => {
	assert.equal(getPublishDependencyTextKind("public/index.html"), "html");
	assert.equal(getPublishDependencyTextKind("public/icon.svg"), "html");
	assert.equal(getPublishDependencyTextKind("public/site.css"), "css");
	assert.equal(getPublishDependencyTextKind("public/app.mjs"), "javascript");
	assert.equal(getPublishDependencyTextKind("public/app.cjs"), "javascript");
	assert.equal(getPublishDependencyTextKind("public/photo.png"), null);
});
```

- [ ] **Step 2: Write failing URL-resolution tests**

Add table-driven expectations for relative, base-relative, root-relative, query/fragment removal, percent-decoding, ignored schemes, malformed encoding, traversal, and outside-root paths:

```ts
test("local references resolve with browser path semantics", () => {
	for (const [reference, baseHref, path] of [
		["pigeon.css?v=7#top", null, "public/site/pigeon.css"],
		["assets/pigeon%20logo.svg", null, "public/site/assets/pigeon logo.svg"],
		["../shared.css", "./app/", "public/site/shared.css"],
		["/public/global.css", null, "public/global.css"],
	] as const) {
		assert.deepEqual(resolvePublishDependencyReference({
			referrerPath: "public/site/index.html",
			reference,
			baseHref,
			allowedRoot: "public/",
		}), { ok: true, kind: "local", path });
	}
});

test("non-local references are ignored without network access", () => {
	for (const reference of [
		"https://cdn.example.com/app.css",
		"//cdn.example.com/app.css",
		"data:image/svg+xml;base64,AA==",
		"blob:https://example.com/id",
		"mailto:hello@example.com",
		"tel:+123456",
		"#workspaces",
		"?preview=true",
	]) {
		assert.deepEqual(resolvePublishDependencyReference({
			referrerPath: "public/site/index.html",
			reference,
			baseHref: null,
			allowedRoot: "public/",
		}), { ok: true, kind: "ignored" }, reference);
	}
});

test("outside-root and malformed local references fail closed", () => {
	const outside = resolvePublishDependencyReference({
		referrerPath: "public/site/index.html",
		reference: "../../secret.css",
		baseHref: null,
		allowedRoot: "public/",
	});
	assert.equal(outside.ok, false);
	assert.match(outside.ok ? "" : outside.notice, /outside the configured publish folder/u);

	const malformed = resolvePublishDependencyReference({
		referrerPath: "public/site/index.html",
		reference: "bad%ZZ.css",
		baseHref: null,
		allowedRoot: "public/",
	});
	assert.equal(malformed.ok, false);
	assert.match(malformed.ok ? "" : malformed.notice, /invalid local asset URL/u);
});
```

- [ ] **Step 3: Run the focused test and confirm red**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publishDependencyReferences.test.js
```

Expected: TypeScript fails because the module and exports do not exist.

- [ ] **Step 4: Implement deterministic reference extraction**

Create the module with these public types and exports:

```ts
export type PublishDependencyTextKind = "html" | "css" | "javascript";

export interface ExtractPublishDependencyReferencesInput {
	vaultRelativePath: string;
	contents: string;
}

export interface ExtractPublishDependencyReferencesResult {
	baseHref: string | null;
	references: string[];
}

export function getPublishDependencyTextKind(path: string): PublishDependencyTextKind | null {
	if (/\.(?:html?|svg)$/iu.test(path)) return "html";
	if (/\.css$/iu.test(path)) return "css";
	if (/\.(?:js|mjs|cjs)$/iu.test(path)) return "javascript";
	return null;
}
```

Use one ordered-set helper so every extractor preserves first appearance and removes duplicates:

```ts
function appendUnique(target: string[], seen: Set<string>, value: string | undefined): void {
	const trimmed = value?.trim() ?? "";
	if (!trimmed || seen.has(trimmed)) return;
	seen.add(trimmed);
	target.push(trimmed);
}
```

Implement HTML/SVG extraction by tokenizing start tags with a tag-name plus raw-attribute scanner. Only collect attributes from this tag policy, avoiding generic `data-*` values:

```ts
const RESOURCE_ATTRIBUTES_BY_TAG: Readonly<Record<string, readonly string[]>> = {
	a: ["href"],
	area: ["href"],
	audio: ["src"],
	embed: ["src"],
	iframe: ["src"],
	image: ["href", "xlink:href"],
	img: ["src", "srcset"],
	input: ["src"],
	link: ["href"],
	object: ["data"],
	script: ["src"],
	source: ["src", "srcset"],
	track: ["src"],
	use: ["href", "xlink:href"],
	video: ["src", "poster"],
};
```

The attribute tokenizer must support double-quoted, single-quoted, and unquoted values; lowercase names; read only the first local `<base href>` as `baseHref`; split `srcset` into URL candidates before descriptors; pass every `style` attribute and `<style>` body through the CSS extractor; and pass every inline `<script>` body through the JavaScript extractor. Tag-shaped strings inside inline templates are intentionally discoverable static references.

Implement CSS extraction after replacing `/* ... */` comments with whitespace. Match quoted/unquoted `url(...)` plus quoted and `url(...)` `@import` syntax, feeding every result through `appendUnique`.

Implement JavaScript extraction after a character-state pass replaces line and block comments with whitespace while preserving quoted and template-string contents. Match static side-effect/import-from declarations, export-from declarations, literal dynamic imports, and literal `new URL(path, import.meta.url)` calls. Do not match variables, template expressions, `fetch`, workers, or arbitrary string construction.

`extractPublishDependencyReferences` dispatches on `getPublishDependencyTextKind`; unsupported formats return `{ baseHref: null, references: [] }`.

- [ ] **Step 5: Implement local URL resolution**

Add these result types:

```ts
export type ResolvePublishDependencyReferenceResult =
	| { ok: true; kind: "ignored" }
	| { ok: true; kind: "local"; path: string }
	| { ok: false; notice: string };

export interface ResolvePublishDependencyReferenceInput {
	referrerPath: string;
	reference: string;
	baseHref: string | null;
	allowedRoot: string;
}
```

Implementation rules are exact:

1. Trim the reference and reject ASCII control characters.
2. Return `ignored` for empty, fragment-only, query-only, protocol-relative, or explicitly schemed references.
3. Normalize the referrer with `normalizeVaultRelativePublishPath`.
4. Encode each referrer path segment and create a document URL under `https://aside-publish.invalid/`.
5. Resolve a non-empty `baseHref` against the document URL, then resolve the reference against that base.
6. Return `ignored` if the resolved origin is no longer the synthetic local origin.
7. Decode the resolved pathname with `decodeURIComponent`, remove its leading slash, and normalize it with `normalizeVaultRelativePublishPath`.
8. Require the normalized path to start with `normalizePublishAllowedRoot(allowedRoot)`.
9. Return `{ ok: true, kind: "local", path }`; convert URL, decoding, normalization, and root failures into notices that name the referrer and original reference.

Import the two existing normalizers rather than duplicating their path policy:

```ts
import { normalizeVaultRelativePublishPath } from "./publishPath";
import { normalizePublishAllowedRoot } from "./publishSettings";
```

- [ ] **Step 6: Run the focused test and confirm green**

Run the Step 3 command. Expected: all extraction and resolution tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/publish/publishDependencyReferences.ts tests/publishDependencyReferences.test.ts
git commit -m "feat(publish): resolve local asset references"
```

### Task 3: Build the recursive dependency closure

**Files:**

- Create: `src/core/publish/publishDependencyGraph.ts`
- Create: `tests/publishDependencyGraph.test.ts`

- [ ] **Step 1: Write the failing graph tests**

Build a real in-memory host with text and binary maps, call counts, and no mocks. Cover the production graph, nested CSS/JS, cycles, shared dependencies, remote URLs, binary bytes, missing files, outside-root failures, blocked files, and read errors:

```ts
test("dependency graph follows HTML through CSS, JavaScript, SVG, and binary assets", async () => {
	const binaryLogo = new Uint8Array([0, 1, 2, 255]).buffer;
	const harness = createGraphHarness({
		textFiles: {
			"public/pigeon/index.html": `
				<link rel="stylesheet" href="pigeon.css">
				<script type="module" src="app.js"></script>
				<img src="assets/logo.svg">
			`,
			"public/pigeon/pigeon.css": `@import "theme.css"; body { background:url("assets/bg.png") }`,
			"public/pigeon/theme.css": `.brand { mask:url("assets/logo.svg#mark") }`,
			"public/pigeon/app.js": `import "./module.js"; new URL("assets/worker.wasm", import.meta.url);`,
			"public/pigeon/module.js": `import "./app.js";`,
			"public/pigeon/assets/logo.svg": `<svg><image href="logo.png"></image></svg>`,
		},
		binaryFiles: {
			"public/pigeon/assets/bg.png": new Uint8Array([9]).buffer,
			"public/pigeon/assets/logo.png": binaryLogo,
			"public/pigeon/assets/worker.wasm": new Uint8Array([0, 97, 115, 109]).buffer,
		},
	});

	const result = await buildPublishDependencyGraph({
		entryFiles: [{
			vaultRelativePath: "public/pigeon/index.html",
			contents: harness.textFiles.get("public/pigeon/index.html")!,
		}],
		allowedRoot: "public/",
		configDir: ".obsidian",
		fileExists: harness.fileExists,
		readTextFile: harness.readTextFile,
		readBinaryFile: harness.readBinaryFile,
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.files.map((file) => file.vaultRelativePath), [
		"public/pigeon/pigeon.css",
		"public/pigeon/app.js",
		"public/pigeon/assets/logo.svg",
		"public/pigeon/theme.css",
		"public/pigeon/assets/bg.png",
		"public/pigeon/module.js",
		"public/pigeon/assets/worker.wasm",
		"public/pigeon/assets/logo.png",
	]);
	const logo = result.files.find((file) => file.vaultRelativePath.endsWith("logo.png"));
	assert.deepEqual(new Uint8Array(logo?.contents as ArrayBuffer), new Uint8Array(binaryLogo));
	assert.equal(harness.readCounts.get("public/pigeon/app.js"), 1);
	assert.equal(harness.readCounts.get("public/pigeon/assets/logo.svg"), 1);
});

test("dependency graph fails before returning a partial missing-asset graph", async () => {
	const harness = createGraphHarness({
		textFiles: {
			"public/site/index.html": `<link rel="stylesheet" href="missing.css">`,
		},
	});
	const result = await runGraph(harness, "public/site/index.html");
	assert.deepEqual(result, {
		ok: false,
		notice: "Publish failed: public/site/index.html references missing local asset public/site/missing.css.",
	});
});
```

Add separate assertions that external/data/blob URLs do not call `fileExists`, two entries sharing one asset read it once, a CSS cycle terminates, traversal fails, `.env`/`.map`/`.md`/`.ts` dependencies return guard failures, and thrown text/binary reads become concise unreadable-asset failures.

- [ ] **Step 2: Run the focused graph test and confirm red**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publishDependencyGraph.test.js
```

Expected: TypeScript fails because the graph module and exports do not exist.

- [ ] **Step 3: Implement the async graph builder**

Create these public contracts:

```ts
export interface PublishDependencyFile {
	vaultRelativePath: string;
	contents: string | ArrayBuffer;
}

export interface BuildPublishDependencyGraphInput {
	entryFiles: readonly Readonly<{ vaultRelativePath: string; contents: string }>[];
	allowedRoot: string;
	configDir: string;
	fileExists(path: string): Promise<boolean>;
	readTextFile(path: string): Promise<string>;
	readBinaryFile(path: string): Promise<ArrayBuffer>;
}

export type BuildPublishDependencyGraphResult =
	| { ok: true; files: PublishDependencyFile[] }
	| { ok: false; notice: string };
```

Implement breadth-first traversal with deterministic insertion order:

```ts
export async function buildPublishDependencyGraph(
	input: BuildPublishDependencyGraphInput,
): Promise<BuildPublishDependencyGraphResult> {
	const knownFiles = new Map<string, string | ArrayBuffer>();
	const dependencyFiles = new Map<string, PublishDependencyFile>();
	const queue: Array<{ path: string; contents: string }> = [];
	const scheduledTextPaths = new Set<string>();

	const scheduleText = (path: string, contents: string): void => {
		if (scheduledTextPaths.has(path)) return;
		scheduledTextPaths.add(path);
		queue.push({ path, contents });
	};

	for (const entry of input.entryFiles) {
		knownFiles.set(entry.vaultRelativePath, entry.contents);
		scheduleText(entry.vaultRelativePath, entry.contents);
	}

	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const current = queue[queueIndex];
		const extracted = extractPublishDependencyReferences({
			vaultRelativePath: current.path,
			contents: current.contents,
		});
		for (const reference of extracted.references) {
			const resolved = resolvePublishDependencyReference({
				referrerPath: current.path,
				reference,
				baseHref: extracted.baseHref,
				allowedRoot: input.allowedRoot,
			});
			if (!resolved.ok) return resolved;
			if (resolved.kind === "ignored" || resolved.path === current.path) continue;

			const knownContents = knownFiles.get(resolved.path);
			if (knownContents !== undefined) {
				if (typeof knownContents === "string"
					&& getPublishDependencyTextKind(resolved.path) !== null) {
					scheduleText(resolved.path, knownContents);
				}
				continue;
			}

			let exists: boolean;
			try {
				exists = await input.fileExists(resolved.path);
			} catch {
				return {
					ok: false,
					notice: `Publish failed: unable to inspect local asset ${resolved.path} referenced by ${current.path}.`,
				};
			}
			if (!exists) {
				return {
					ok: false,
					notice: `Publish failed: ${current.path} references missing local asset ${resolved.path}.`,
				};
			}

			const textKind = getPublishDependencyTextKind(resolved.path);
			let contents: string | ArrayBuffer;
			try {
				contents = textKind === null
					? await input.readBinaryFile(resolved.path)
					: await input.readTextFile(resolved.path);
			} catch {
				return {
					ok: false,
					notice: `Publish failed: unable to read local asset ${resolved.path} referenced by ${current.path}.`,
				};
			}

			const inspection = inspectPublishDependency({
				vaultRelativePath: resolved.path,
				allowedRoot: input.allowedRoot,
				configDir: input.configDir,
				contents,
			});
			if (!inspection.ok) {
				return {
					ok: false,
					notice: `${inspection.notice} Referenced by ${current.path}: ${reference}`,
				};
			}

			knownFiles.set(resolved.path, contents);
			dependencyFiles.set(resolved.path, {
				vaultRelativePath: resolved.path,
				contents,
			});
			if (typeof contents === "string" && textKind !== null) {
				scheduleText(resolved.path, contents);
			}
		}
	}

	return { ok: true, files: [...dependencyFiles.values()] };
}
```

Import the reference functions and `inspectPublishDependency`. Normalize entry paths before seeding; return a failure rather than accepting duplicate aliases. Keep graph state local to one call so every snapshot derives current dependencies.

- [ ] **Step 4: Run the graph and guard tests and confirm green**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/publishDependencyGraph.test.js \
  .test-dist/tests/publishDependencyReferences.test.js \
  .test-dist/tests/publishArtifactGuard.test.js
```

Expected: all focused dependency tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/publish/publishDependencyGraph.ts tests/publishDependencyGraph.test.ts
git commit -m "feat(publish): build recursive asset graph"
```

### Task 4: Add the dependency closure to every publish snapshot

**Files:**

- Modify: `src/publish/publicHtmlPublishController.ts`
- Modify: `tests/publicHtmlPublishController.test.ts`

- [ ] **Step 1: Write the production regression test first**

Add a standalone entry fixture matching the reported site:

```ts
test("public html publish controller bundles dependencies referenced by a standalone index", async () => {
	const harness = createHarness({
		files: {
			"public/pigeon-plan/index.html": `
				<!doctype html>
				<link rel="icon" href="assets/pigeon-logo.svg" type="image/svg+xml">
				<link rel="stylesheet" href="pigeon-mocks-v7.css">
				<img src="assets/pigeon-logo.svg" alt="">
			`,
			"public/pigeon-plan/pigeon-mocks-v7.css": `.brand { background-image:url("assets/paper.png") }`,
			"public/pigeon-plan/assets/pigeon-logo.svg": `<svg viewBox="0 0 10 10"></svg>`,
		},
		binaryFiles: {
			"public/pigeon-plan/assets/paper.png": "PNG bytes",
		},
	});

	const result = await harness.controller.publishFile("public/pigeon-plan/index.html");

	assert.equal(result.ok, true);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/pigeon-plan/index.html",
		"public/pigeon-plan/assets/pigeon-logo.svg",
		"public/pigeon-plan/pigeon-mocks-v7.css",
		"public/pigeon-plan/assets/paper.png",
	]);
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/pigeon-plan/index.html"]);
});
```

Add three integration cases:

1. A missing local CSS file returns the exact graph failure, makes no deploy call, writes no public index row, and does not change `publishedArtifactPaths`.
2. Two enabled HTML entries share one dependency; unpublishing one retains the shared file and removes its entry-only dependency.
3. A referenced `.md`, `.ts`, `.map`, or `.env` file aborts before `deploySnapshot`.

- [ ] **Step 2: Run the controller test and confirm red**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: the regression deploy contains only `index.html`; the CSS/SVG/PNG expectations fail.

- [ ] **Step 3: Compose snapshots through a path-keyed map**

Import the graph builder and dependency guard:

```ts
import { buildPublishDependencyGraph } from "../core/publish/publishDependencyGraph";
import {
	inspectPublishArtifact,
	inspectPublishDependency,
} from "../core/publish/publishArtifactGuard";
```

At the start of `deployEnabledSnapshot`, replace the array-only accumulator with:

```ts
const snapshotFilesByPath = new Map<string, PublicHtmlPublishSnapshotFile>();
const realHtmlEntryPaths = new Set<string>();
const addSnapshotFile = (
	file: PublicHtmlPublishSnapshotFile,
	options: { realHtmlEntry?: boolean } = {},
): void => {
	snapshotFilesByPath.set(file.vaultRelativePath, file);
	if (options.realHtmlEntry) realHtmlEntryPaths.add(file.vaultRelativePath);
};
```

Use `addSnapshotFile` for all three existing additions:

- Generated Markdown HTML: `realHtmlEntry: false`.
- Paired source HTML: `realHtmlEntry: true`.
- Direct artifact HTML: `realHtmlEntry: true`; direct PDF: `false`.

Do not mark generated Markdown HTML as a graph seed in this change. Keep the existing entry-specific `inspectPublishArtifact` calls before adding each selected entry.

- [ ] **Step 4: Resolve dependencies and inspect the exact final snapshot**

Immediately before `host.deploySnapshot`, add:

```ts
const entryFiles: Array<{ vaultRelativePath: string; contents: string }> = [];
for (const path of realHtmlEntryPaths) {
	const file = snapshotFilesByPath.get(path);
	if (!file || typeof file.contents !== "string") {
		return {
			ok: false,
			notice: `Publish failed: HTML entry is not readable as text: ${path}`,
		};
	}
	entryFiles.push({
		vaultRelativePath: path,
		contents: file.contents,
	});
}
const dependencyResult = await buildPublishDependencyGraph({
	entryFiles,
	allowedRoot: settings.publishAllowedRoot,
	configDir: this.host.getVaultConfigDir(),
	fileExists: (path) => this.host.fileExists(path),
	readTextFile: (path) => this.host.readVaultFile(path),
	readBinaryFile: (path) => this.host.readVaultBinaryFile(path),
});
if (!dependencyResult.ok) return dependencyResult;
for (const dependency of dependencyResult.files) {
	if (!snapshotFilesByPath.has(dependency.vaultRelativePath)) {
		snapshotFilesByPath.set(dependency.vaultRelativePath, dependency);
	}
}

const completedSnapshot = [...snapshotFilesByPath.values()];
for (const file of completedSnapshot) {
	const inspection = inspectPublishDependency({
		vaultRelativePath: file.vaultRelativePath,
		allowedRoot: settings.publishAllowedRoot,
		configDir: this.host.getVaultConfigDir(),
		contents: file.contents,
	});
	if (!inspection.ok) return inspection;
}
return this.host.deploySnapshot(completedSnapshot);
```

The final inspection loop is mandatory: it checks the exact deduplicated contents passed to the deploy host, including generated HTML, PDF entries, and every derived dependency.

- [ ] **Step 5: Run the controller test and confirm green**

Run the Step 2 command. Expected: the production fixture stages HTML, SVG, CSS, and PNG; missing/unsafe dependencies make no deploy call; shared assets follow reachability; all pre-existing controller tests remain green.

- [ ] **Step 6: Run all focused publish tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/publishArtifactGuard.test.js \
  .test-dist/tests/publishDependencyReferences.test.js \
  .test-dist/tests/publishDependencyGraph.test.js \
  .test-dist/tests/publicHtmlPublishController.test.js \
  .test-dist/tests/wranglerPagesPublisher.test.js
```

Expected: all focused publish tests pass with no warnings or failures.

- [ ] **Step 7: Commit**

```bash
git add src/publish/publicHtmlPublishController.ts tests/publicHtmlPublishController.test.ts
git commit -m "fix(publish): bundle referenced site assets"
```

### Task 5: Verify, install, republish, and close tracking

**Files:**

- Modify: `docs/superpowers/specs/2026-08-25-recursive-html-publish-dependencies-design.md`

- [ ] **Step 1: Run the full repository verification**

```bash
npm run build
```

Expected sequence and result:

- all TypeScript and `.mjs` tests pass;
- ESLint reports zero errors and zero warnings;
- TypeScript typecheck passes;
- Obsidian compliance passes;
- esbuild writes production `main.js` without a source map;
- the release artifact guard passes for exactly `main.js`, `manifest.json`, and `styles.css`.

- [ ] **Step 2: Inspect the exact plugin artifacts before local installation**

```bash
npm run release:artifacts:check
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name 'main.js.map' -o -name '.env*' -o -name '.npmrc' -o -name '*.key' -o -name '*.pem' \) -print
```

Expected: the guard passes; both scans print no source-map, secret, key, certificate, or unexpected map artifact. This is the required inspection of the exact three plugin files being copied into the vault.

- [ ] **Step 3: Install and reload the verified build**

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: the installer reports copying `main.js`, `manifest.json`, and `styles.css`; Obsidian reports the `aside` plugin reloaded.

- [ ] **Step 4: Republish through the installed Aside controller**

Use the Obsidian developer CLI so the real plugin builds and inspects the complete current snapshot before Wrangler uploads it:

```bash
obsidian eval vault=lean-startup code="(async () => await app.plugins.plugins.aside.publicHtmlPublishController.updatePublishedFile('public/pigeon-plan/index.html'))()"
```

Expected: `{ ok: true, url: "https://publish.fdechina.com/public/pigeon-plan/index" }` or the equivalent serialized result. Do not bypass Aside with a direct Wrangler command.

Before accepting success, inspect the newest sanitized publish log records and confirm no graph or artifact-guard failure occurred. The controller's final inspection loop is the source-exposure gate for the exact Pages snapshot.

- [ ] **Step 5: Verify the original production symptom is gone**

```bash
curl -I https://publish.fdechina.com/public/pigeon-plan/
curl -I https://publish.fdechina.com/public/pigeon-plan/pigeon-mocks-v7.css
curl -I https://publish.fdechina.com/public/pigeon-plan/assets/pigeon-logo.svg
```

Expected: all three return HTTP 200. Then open `https://publish.fdechina.com/public/pigeon-plan/#/workspaces` and confirm the page has computed styles and a loaded logo with no same-site 404s in the browser network/console view.

- [ ] **Step 6: Update the tracked spec from fresh evidence**

Mark implementation and verification checkboxes `[x]` only for behavior demonstrated by the focused tests, full build, artifact inspection, installed republish, HTTP checks, and browser check. Leave any unperformed manual item unchecked and explain it in the handoff.

- [ ] **Step 7: Run final diff and status checks**

```bash
git diff --check
git status --short
rg -n "\[DEBUG-" src tests
```

Expected: no whitespace errors, no debug instrumentation, and only the intended spec/plan tracking change remains after code commits.

- [ ] **Step 8: Commit tracking evidence**

```bash
git add -f docs/superpowers/specs/2026-08-25-recursive-html-publish-dependencies-design.md \
  docs/superpowers/plans/2026-08-25-recursive-html-publish-dependencies-plan.md
git commit -m "docs(publish): complete dependency bundling"
```

The completion report must state that the shipped plugin artifact guard inspected `main.js`, `manifest.json`, and `styles.css`; that source-map markers, embedded sources, secrets, and unexpected map files were absent; and that the Pages snapshot gate inspected every entry and reachable dependency before the production upload.
