# Private Publish Manifest And Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first private publish slice: parse `public/auth.md`, resolve inherited permissions, maintain `public/index.md`, and select publishable file/folder paths under `public/`.

**Architecture:** Keep deterministic private-publish policy in small dependency-free modules under `src/core/publish/`. Do not touch Cloudflare deployment, OAuth, D1, or UI actions in this plan; those depend on these core units and get their own later plans. Use TDD for each module and keep existing public publish behavior unchanged.

**Tech Stack:** TypeScript, Node test runner, existing `tsconfig.test.json`, existing publish path/settings helpers.

---

## Scope Boundary

This plan implements the first independently testable slice from `docs/superpowers/specs/2026-07-26-private-published-wiki-design.md`.

Implemented here:

- `public/auth.md` table parsing.
- Google and WeChat provider rows in the parser.
- WeChat rows marked unsupported for V1 without being discarded.
- Google email normalization.
- `view < comment < full` permission ordering.
- Folder inheritance and specificity override.
- `public/index.md` managed section creation and update.
- Folder/file publish selection helpers that exclude private control files.

Deferred to later plans:

- Obsidian UI actions for folder publishing.
- PublicHtmlPublishController integration.
- Generated three-pane shell assets.
- Generated Pages Functions middleware/auth routes.
- Google OAuth implementation.
- D1 comment API.
- Local remote-comment sync import.
- Comment author metadata.

## File Structure

- Create `src/core/publish/privatePublishAuth.ts`
  - Owns auth table parsing, path normalization, provider support flags, permission rank, and inherited permission resolution.
- Create `src/core/publish/privatePublishIndex.ts`
  - Owns `public/index.md` managed section formatting and safe replacement.
- Create `src/core/publish/privatePublishSelection.ts`
  - Owns deterministic file/folder selection for private folder publish snapshots.
- Create `tests/privatePublishAuth.test.ts`
  - Tests parsing, validation, unsupported provider handling, and permission inheritance.
- Create `tests/privatePublishIndex.test.ts`
  - Tests create/update behavior and preservation of user content.
- Create `tests/privatePublishSelection.test.ts`
  - Tests folder selection, whole-root selection, and control-file exclusion.

## Task 1: Auth Table Parser

**Files:**
- Create: `tests/privatePublishAuth.test.ts`
- Create: `src/core/publish/privatePublishAuth.ts`

- [ ] **Step 1: Write failing parser tests**

Create `tests/privatePublishAuth.test.ts` with these tests:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
	parsePrivatePublishAuthMarkdown,
	resolvePrivatePublishPermission,
} from "../src/core/publish/privatePublishAuth";

const AUTH_TABLE = [
	"| provider | identity | path | permission |",
	"| --- | --- | --- | --- |",
	"| google | Alice@Example.COM | / | view |",
	"| google | alice@example.com | investors/ | comment |",
	"| google | alice@example.com | investors/board.md | full |",
	"| wechat | wx_openid_123 | / | view |",
].join("\n");

test("parsePrivatePublishAuthMarkdown parses auth rows and normalizes google identities", () => {
	const parsed = parsePrivatePublishAuthMarkdown(AUTH_TABLE);

	assert.deepEqual(parsed.issues, [{
		lineNumber: 6,
		severity: "warning",
		message: "WeChat auth rows are parsed but not supported by the V1 published site runtime.",
	}]);
	assert.deepEqual(parsed.rules, [{
		provider: "google",
		identity: "alice@example.com",
		path: "/",
		pathKind: "root",
		permission: "view",
		supported: true,
		lineNumber: 3,
	}, {
		provider: "google",
		identity: "alice@example.com",
		path: "investors/",
		pathKind: "folder",
		permission: "comment",
		supported: true,
		lineNumber: 4,
	}, {
		provider: "google",
		identity: "alice@example.com",
		path: "investors/board.md",
		pathKind: "file",
		permission: "full",
		supported: true,
		lineNumber: 5,
	}, {
		provider: "wechat",
		identity: "wx_openid_123",
		path: "/",
		pathKind: "root",
		permission: "view",
		supported: false,
		lineNumber: 6,
	}]);
});

test("parsePrivatePublishAuthMarkdown reports invalid rows without dropping valid rows", () => {
	const parsed = parsePrivatePublishAuthMarkdown([
		"| provider | identity | path | permission |",
		"| --- | --- | --- | --- |",
		"| google | bob@example.com | roadmap.md | comment |",
		"| github | octo | roadmap.md | view |",
		"| google | | roadmap.md | view |",
		"| google | bob@example.com | ../secret.md | view |",
		"| google | bob@example.com | public/roadmap.md | view |",
		"| google | bob@example.com | roadmap.md | owner |",
	].join("\n"));

	assert.deepEqual(parsed.rules, [{
		provider: "google",
		identity: "bob@example.com",
		path: "roadmap.md",
		pathKind: "file",
		permission: "comment",
		supported: true,
		lineNumber: 3,
	}]);
	assert.deepEqual(parsed.issues, [{
		lineNumber: 4,
		severity: "error",
		message: "Unsupported auth provider: github.",
	}, {
		lineNumber: 5,
		severity: "error",
		message: "Auth identity is required.",
	}, {
		lineNumber: 6,
		severity: "error",
		message: "Auth path must stay inside the published root.",
	}, {
		lineNumber: 7,
		severity: "error",
		message: "Auth paths are relative to public/. Use roadmap.md instead of public/roadmap.md.",
	}, {
		lineNumber: 8,
		severity: "error",
		message: "Unsupported permission: owner.",
	}]);
});

test("resolvePrivatePublishPermission applies inheritance and specific overrides", () => {
	const parsed = parsePrivatePublishAuthMarkdown(AUTH_TABLE);

	assert.deepEqual(resolvePrivatePublishPermission(parsed.rules, {
		provider: "google",
		identity: "ALICE@example.com",
		path: "roadmap.md",
	}), {
		permission: "view",
		rule: parsed.rules[0],
	});
	assert.deepEqual(resolvePrivatePublishPermission(parsed.rules, {
		provider: "google",
		identity: "alice@example.com",
		path: "investors/memo.md",
	}), {
		permission: "comment",
		rule: parsed.rules[1],
	});
	assert.deepEqual(resolvePrivatePublishPermission(parsed.rules, {
		provider: "google",
		identity: "alice@example.com",
		path: "investors/board.md",
	}), {
		permission: "full",
		rule: parsed.rules[2],
	});
	assert.equal(resolvePrivatePublishPermission(parsed.rules, {
		provider: "google",
		identity: "nobody@example.com",
		path: "investors/board.md",
	}), null);
});

test("resolvePrivatePublishPermission uses strongest permission for equally specific rows", () => {
	const parsed = parsePrivatePublishAuthMarkdown([
		"| provider | identity | path | permission |",
		"| --- | --- | --- | --- |",
		"| google | dana@example.com | roadmap.md | view |",
		"| google | dana@example.com | roadmap.md | comment |",
	].join("\n"));

	assert.deepEqual(resolvePrivatePublishPermission(parsed.rules, {
		provider: "google",
		identity: "dana@example.com",
		path: "roadmap.md",
	}), {
		permission: "comment",
		rule: parsed.rules[1],
	});
});
```

- [ ] **Step 2: Run parser tests to verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/privatePublishAuth.test.js
```

Expected: TypeScript fails with `Cannot find module '../src/core/publish/privatePublishAuth'` or equivalent missing export errors.

- [ ] **Step 3: Implement the parser module**

Create `src/core/publish/privatePublishAuth.ts`:

```ts
import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";

export type PrivatePublishProvider = "google" | "wechat";
export type PrivatePublishPermission = "view" | "comment" | "full";
export type PrivatePublishPathKind = "root" | "folder" | "file";

export interface PrivatePublishAuthRule {
	provider: PrivatePublishProvider;
	identity: string;
	path: string;
	pathKind: PrivatePublishPathKind;
	permission: PrivatePublishPermission;
	supported: boolean;
	lineNumber: number;
}

export interface PrivatePublishAuthIssue {
	lineNumber: number;
	severity: "error" | "warning";
	message: string;
}

export interface ParsedPrivatePublishAuth {
	rules: PrivatePublishAuthRule[];
	issues: PrivatePublishAuthIssue[];
}

export interface ResolvePrivatePublishPermissionInput {
	provider: PrivatePublishProvider;
	identity: string;
	path: string;
}

export interface ResolvedPrivatePublishPermission {
	permission: PrivatePublishPermission;
	rule: PrivatePublishAuthRule;
}

const REQUIRED_AUTH_COLUMNS = ["provider", "identity", "path", "permission"] as const;
const PERMISSION_RANK: Record<PrivatePublishPermission, number> = {
	view: 1,
	comment: 2,
	full: 3,
};

function splitMarkdownTableRow(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/u, "")
		.replace(/\|$/u, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function normalizeProvider(value: string): PrivatePublishProvider | null {
	const normalized = value.trim().toLowerCase();
	return normalized === "google" || normalized === "wechat" ? normalized : null;
}

function normalizePermission(value: string): PrivatePublishPermission | null {
	const normalized = value.trim().toLowerCase();
	return normalized === "view" || normalized === "comment" || normalized === "full"
		? normalized
		: null;
}

function normalizeIdentity(provider: PrivatePublishProvider, value: string): string {
	const normalized = value.trim();
	return provider === "google" ? normalized.toLowerCase() : normalized;
}

function isProviderSupported(provider: PrivatePublishProvider): boolean {
	return provider === "google";
}

function normalizeAuthPath(value: string): {
	ok: true;
	path: string;
	pathKind: PrivatePublishPathKind;
} | {
	ok: false;
	message: string;
} {
	const trimmed = value.trim().replace(/\\/gu, "/");
	if (!trimmed) {
		return {
			ok: false,
			message: "Auth path is required.",
		};
	}
	if (trimmed === "/") {
		return {
			ok: true,
			path: "/",
			pathKind: "root",
		};
	}
	if (/^public(?:\/|$)/iu.test(trimmed)) {
		const withoutRoot = trimmed.replace(/^public\/?/iu, "") || "/";
		return {
			ok: false,
			message: `Auth paths are relative to public/. Use ${withoutRoot} instead of ${trimmed}.`,
		};
	}
	if (trimmed.startsWith("/")) {
		return {
			ok: false,
			message: "Auth path must be / or relative to the published root.",
		};
	}

	const normalized = normalizeVaultRelativePublishPath(trimmed);
	if (!normalized.ok || normalized.path !== trimmed.replace(/\/+/gu, "/").replace(/^\.\//u, "")) {
		return {
			ok: false,
			message: "Auth path must stay inside the published root.",
		};
	}

	const isFolder = trimmed.endsWith("/");
	return {
		ok: true,
		path: isFolder ? `${normalized.path.replace(/\/+$/u, "")}/` : normalized.path,
		pathKind: isFolder ? "folder" : "file",
	};
}

function findHeader(lines: readonly string[]): {
	headerLineIndex: number;
	columns: string[];
} | null {
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line.trim().startsWith("|")) {
			continue;
		}
		const columns = splitMarkdownTableRow(line).map((cell) => cell.toLowerCase());
		if (REQUIRED_AUTH_COLUMNS.every((column) => columns.includes(column))) {
			return {
				headerLineIndex: index,
				columns,
			};
		}
	}
	return null;
}

function buildRowRecord(columns: readonly string[], cells: readonly string[]): Record<string, string> {
	const record: Record<string, string> = {};
	for (let index = 0; index < columns.length; index += 1) {
		record[columns[index]] = cells[index] ?? "";
	}
	return record;
}

export function parsePrivatePublishAuthMarkdown(markdown: string): ParsedPrivatePublishAuth {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const header = findHeader(lines);
	if (!header) {
		return {
			rules: [],
			issues: [],
		};
	}

	const rules: PrivatePublishAuthRule[] = [];
	const issues: PrivatePublishAuthIssue[] = [];
	for (let index = header.headerLineIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line.trim()) {
			continue;
		}
		if (!line.trim().startsWith("|")) {
			break;
		}

		const cells = splitMarkdownTableRow(line);
		if (isSeparatorRow(cells)) {
			continue;
		}

		const lineNumber = index + 1;
		const record = buildRowRecord(header.columns, cells);
		const provider = normalizeProvider(record.provider ?? "");
		if (!provider) {
			issues.push({
				lineNumber,
				severity: "error",
				message: `Unsupported auth provider: ${(record.provider ?? "").trim() || "<empty>"}.`,
			});
			continue;
		}

		const identity = normalizeIdentity(provider, record.identity ?? "");
		if (!identity) {
			issues.push({
				lineNumber,
				severity: "error",
				message: "Auth identity is required.",
			});
			continue;
		}

		const path = normalizeAuthPath(record.path ?? "");
		if (!path.ok) {
			issues.push({
				lineNumber,
				severity: "error",
				message: path.message,
			});
			continue;
		}

		const permission = normalizePermission(record.permission ?? "");
		if (!permission) {
			issues.push({
				lineNumber,
				severity: "error",
				message: `Unsupported permission: ${(record.permission ?? "").trim() || "<empty>"}.`,
			});
			continue;
		}

		const supported = isProviderSupported(provider);
		if (!supported) {
			issues.push({
				lineNumber,
				severity: "warning",
				message: "WeChat auth rows are parsed but not supported by the V1 published site runtime.",
			});
		}

		rules.push({
			provider,
			identity,
			path: path.path,
			pathKind: path.pathKind,
			permission,
			supported,
			lineNumber,
		});
	}

	return {
		rules,
		issues,
	};
}

function normalizeRequestPath(value: string): string | null {
	const trimmed = value.trim().replace(/\\/gu, "/").replace(/^\/+/u, "");
	const normalized = normalizeVaultRelativePublishPath(trimmed);
	return normalized.ok ? normalized.path : null;
}

function ruleMatchesPath(rule: PrivatePublishAuthRule, requestedPath: string): boolean {
	if (rule.pathKind === "root") {
		return true;
	}
	if (rule.pathKind === "file") {
		return requestedPath === rule.path;
	}
	return requestedPath === rule.path.slice(0, -1) || requestedPath.startsWith(rule.path);
}

function getRuleSpecificity(rule: PrivatePublishAuthRule): number {
	if (rule.pathKind === "root") {
		return 0;
	}
	return rule.path.length;
}

export function resolvePrivatePublishPermission(
	rules: readonly PrivatePublishAuthRule[],
	input: ResolvePrivatePublishPermissionInput,
): ResolvedPrivatePublishPermission | null {
	const requestedProvider = input.provider;
	const requestedIdentity = normalizeIdentity(requestedProvider, input.identity);
	const requestedPath = normalizeRequestPath(input.path);
	if (!requestedIdentity || !requestedPath) {
		return null;
	}

	let best: ResolvedPrivatePublishPermission | null = null;
	let bestSpecificity = -1;
	for (const rule of rules) {
		if (!rule.supported || rule.provider !== requestedProvider || rule.identity !== requestedIdentity) {
			continue;
		}
		if (!ruleMatchesPath(rule, requestedPath)) {
			continue;
		}

		const specificity = getRuleSpecificity(rule);
		const isBetter = !best
			|| specificity > bestSpecificity
			|| (
				specificity === bestSpecificity
				&& PERMISSION_RANK[rule.permission] >= PERMISSION_RANK[best.permission]
			);
		if (isBetter) {
			best = {
				permission: rule.permission,
				rule,
			};
			bestSpecificity = specificity;
		}
	}

	return best;
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/privatePublishAuth.test.js
```

Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit auth parser slice**

Run:

```bash
git add src/core/publish/privatePublishAuth.ts tests/privatePublishAuth.test.ts
git commit -m "feat(publish): parse private auth rules"
```

## Task 2: Publish Index Managed Section

**Files:**
- Create: `tests/privatePublishIndex.test.ts`
- Create: `src/core/publish/privatePublishIndex.ts`

- [ ] **Step 1: Write failing index tests**

Create `tests/privatePublishIndex.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
	ensurePrivatePublishIndexMarkdown,
} from "../src/core/publish/privatePublishIndex";

const entries = [{
	path: "roadmap.md",
	type: "file" as const,
	status: "published" as const,
	permissionSource: "auth.md",
	lastPublishedAt: "2026-07-26T07:20:00.000Z",
}, {
	path: "investors/",
	type: "folder" as const,
	status: "published" as const,
	permissionSource: "auth.md",
	lastPublishedAt: "2026-07-26T07:21:00.000Z",
}];

test("ensurePrivatePublishIndexMarkdown creates a missing index file", () => {
	assert.equal(ensurePrivatePublishIndexMarkdown(null, entries), [
		"# Published Index",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| investors/ | folder | published | auth.md | 2026-07-26T07:21:00.000Z |",
		"| roadmap.md | file | published | auth.md | 2026-07-26T07:20:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
	].join("\n"));
});

test("ensurePrivatePublishIndexMarkdown replaces only the managed section", () => {
	const existing = [
		"# My Wiki",
		"",
		"Owner notes stay here.",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| old.md | file | published | auth.md | 2026-01-01T00:00:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
		"More owner notes.",
		"",
	].join("\n");

	assert.equal(ensurePrivatePublishIndexMarkdown(existing, entries), [
		"# My Wiki",
		"",
		"Owner notes stay here.",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| investors/ | folder | published | auth.md | 2026-07-26T07:21:00.000Z |",
		"| roadmap.md | file | published | auth.md | 2026-07-26T07:20:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
		"More owner notes.",
		"",
	].join("\n"));
});

test("ensurePrivatePublishIndexMarkdown appends a managed section to an unmanaged file", () => {
	assert.equal(ensurePrivatePublishIndexMarkdown("# Existing\n", [entries[0]]), [
		"# Existing",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| roadmap.md | file | published | auth.md | 2026-07-26T07:20:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
	].join("\n"));
});
```

- [ ] **Step 2: Run index tests to verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/privatePublishIndex.test.js
```

Expected: TypeScript fails with `Cannot find module '../src/core/publish/privatePublishIndex'` or equivalent missing export errors.

- [ ] **Step 3: Implement index module**

Create `src/core/publish/privatePublishIndex.ts`:

```ts
export type PrivatePublishIndexEntryType = "file" | "folder";
export type PrivatePublishIndexEntryStatus = "published" | "unpublished";

export interface PrivatePublishIndexEntry {
	path: string;
	type: PrivatePublishIndexEntryType;
	status: PrivatePublishIndexEntryStatus;
	permissionSource: string;
	lastPublishedAt: string | null;
}

const MANAGED_START = "<!-- Aside publish index -->";
const MANAGED_END = "<!-- /Aside publish index -->";

function normalizeMarkdown(value: string): string {
	return value.replace(/\r\n/g, "\n").trimEnd();
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}

function sortEntries(entries: readonly PrivatePublishIndexEntry[]): PrivatePublishIndexEntry[] {
	return entries.slice().sort((left, right) => left.path.localeCompare(right.path));
}

function formatManagedSection(entries: readonly PrivatePublishIndexEntry[]): string {
	const lines = [
		MANAGED_START,
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
	];
	for (const entry of sortEntries(entries)) {
		lines.push([
			"",
			escapeTableCell(entry.path),
			entry.type,
			entry.status,
			escapeTableCell(entry.permissionSource),
			entry.lastPublishedAt ?? "",
			"",
		].join(" | "));
	}
	lines.push(MANAGED_END);
	return lines.join("\n");
}

export function ensurePrivatePublishIndexMarkdown(
	existingMarkdown: string | null | undefined,
	entries: readonly PrivatePublishIndexEntry[],
): string {
	const section = formatManagedSection(entries);
	if (existingMarkdown === null || existingMarkdown === undefined || !existingMarkdown.trim()) {
		return [
			"# Published Index",
			"",
			section,
			"",
		].join("\n");
	}

	const existing = normalizeMarkdown(existingMarkdown);
	const startIndex = existing.indexOf(MANAGED_START);
	const endIndex = existing.indexOf(MANAGED_END);
	if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
		const before = existing.slice(0, startIndex).trimEnd();
		const after = existing.slice(endIndex + MANAGED_END.length).trimStart();
		return [
			before,
			section,
			after,
		].filter((part) => part.length > 0).join("\n\n") + "\n";
	}

	return [
		existing,
		"",
		section,
		"",
	].join("\n");
}
```

- [ ] **Step 4: Run index tests to verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/privatePublishIndex.test.js
```

Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit index slice**

Run:

```bash
git add src/core/publish/privatePublishIndex.ts tests/privatePublishIndex.test.ts
git commit -m "feat(publish): maintain private publish index"
```

## Task 3: Folder Publish Selection Helpers

**Files:**
- Create: `tests/privatePublishSelection.test.ts`
- Create: `src/core/publish/privatePublishSelection.ts`

- [ ] **Step 1: Write failing selection tests**

Create `tests/privatePublishSelection.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
	selectPrivatePublishPaths,
} from "../src/core/publish/privatePublishSelection";

const vaultFiles = [
	"public/index.md",
	"public/auth.md",
	"public/roadmap.md",
	"public/roadmap.html",
	"public/investors/memo.md",
	"public/investors/deck.pdf",
	"public/investors/private.env",
	"public/assets/style.css",
	"docs/outside.md",
];

test("selectPrivatePublishPaths selects a single publishable file", () => {
	assert.deepEqual(selectPrivatePublishPaths({
		targetPath: "public/roadmap.md",
		allFilePaths: vaultFiles,
		allowedRoot: "public/",
	}), {
		ok: true,
		rootPath: "public/roadmap.md",
		rootKind: "file",
		paths: ["public/roadmap.md"],
	});
});

test("selectPrivatePublishPaths selects supported files under a folder and excludes control files", () => {
	assert.deepEqual(selectPrivatePublishPaths({
		targetPath: "public/investors",
		allFilePaths: vaultFiles,
		allowedRoot: "public/",
	}), {
		ok: true,
		rootPath: "public/investors/",
		rootKind: "folder",
		paths: [
			"public/investors/deck.pdf",
			"public/investors/memo.md",
		],
	});
});

test("selectPrivatePublishPaths can select the whole public root", () => {
	assert.deepEqual(selectPrivatePublishPaths({
		targetPath: "public/",
		allFilePaths: vaultFiles,
		allowedRoot: "public/",
	}), {
		ok: true,
		rootPath: "public/",
		rootKind: "folder",
		paths: [
			"public/investors/deck.pdf",
			"public/investors/memo.md",
			"public/roadmap.html",
			"public/roadmap.md",
		],
	});
});

test("selectPrivatePublishPaths rejects paths outside the publish root", () => {
	assert.deepEqual(selectPrivatePublishPaths({
		targetPath: "docs/outside.md",
		allFilePaths: vaultFiles,
		allowedRoot: "public/",
	}), {
		ok: false,
		notice: "Private publish target must be inside public/.",
	});
});
```

- [ ] **Step 2: Run selection tests to verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/privatePublishSelection.test.js
```

Expected: TypeScript fails with `Cannot find module '../src/core/publish/privatePublishSelection'` or equivalent missing export errors.

- [ ] **Step 3: Implement selection module**

Create `src/core/publish/privatePublishSelection.ts`:

```ts
import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";
import {
	normalizePublishAllowedRoot,
} from "./publishSettings";

export type PrivatePublishSelectionResult =
	| {
		ok: true;
		rootPath: string;
		rootKind: "file" | "folder";
		paths: string[];
	}
	| {
		ok: false;
		notice: string;
	};

export interface SelectPrivatePublishPathsOptions {
	targetPath: string;
	allFilePaths: readonly string[];
	allowedRoot: string;
}

function normalizeTargetPath(value: string): string | null {
	const normalized = normalizeVaultRelativePublishPath(value);
	return normalized.ok ? normalized.path : null;
}

function isSupportedPrivatePublishFile(path: string): boolean {
	return /\.(?:md|html?|pdf)$/iu.test(path);
}

function isPrivatePublishControlFile(path: string, allowedRoot: string): boolean {
	const relativePath = path.slice(allowedRoot.length).toLowerCase();
	return relativePath === "auth.md" || relativePath === "index.md";
}

function normalizeFolderPath(path: string): string {
	return path.replace(/\/+$/u, "") + "/";
}

function isPathInsideRoot(path: string, rootPath: string): boolean {
	return path === rootPath.slice(0, -1) || path.startsWith(rootPath);
}

function normalizeAllFilePaths(paths: readonly string[]): string[] {
	const normalizedPaths = new Set<string>();
	for (const path of paths) {
		const normalized = normalizeTargetPath(path);
		if (normalized) {
			normalizedPaths.add(normalized);
		}
	}
	return [...normalizedPaths].sort((left, right) => left.localeCompare(right));
}

export function selectPrivatePublishPaths(options: SelectPrivatePublishPathsOptions): PrivatePublishSelectionResult {
	const allowedRoot = normalizePublishAllowedRoot(options.allowedRoot);
	const normalizedTarget = normalizeTargetPath(options.targetPath);
	if (!normalizedTarget || !normalizedTarget.startsWith(allowedRoot)) {
		return {
			ok: false,
			notice: `Private publish target must be inside ${allowedRoot}.`,
		};
	}

	const allFilePaths = normalizeAllFilePaths(options.allFilePaths);
	const targetIsKnownFile = allFilePaths.includes(normalizedTarget);
	const rootKind = targetIsKnownFile ? "file" : "folder";
	const rootPath = rootKind === "file" ? normalizedTarget : normalizeFolderPath(normalizedTarget);
	const candidatePaths = rootKind === "file"
		? [normalizedTarget]
		: allFilePaths.filter((path) => isPathInsideRoot(path, rootPath));
	const paths = candidatePaths
		.filter((path) => path.startsWith(allowedRoot))
		.filter((path) => isSupportedPrivatePublishFile(path))
		.filter((path) => !isPrivatePublishControlFile(path, allowedRoot))
		.sort((left, right) => left.localeCompare(right));

	return {
		ok: true,
		rootPath,
		rootKind,
		paths,
	};
}
```

- [ ] **Step 4: Run selection tests to verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/privatePublishSelection.test.js
```

Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit selection slice**

Run:

```bash
git add src/core/publish/privatePublishSelection.ts tests/privatePublishSelection.test.ts
git commit -m "feat(publish): select private publish paths"
```

## Task 4: Slice Verification And Spec Update

**Files:**
- Modify: `docs/superpowers/specs/2026-07-26-private-published-wiki-design.md`

- [ ] **Step 1: Run all targeted tests together**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json \
	&& node --test .test-dist/tests/privatePublishAuth.test.js \
	&& node --test .test-dist/tests/privatePublishIndex.test.js \
	&& node --test .test-dist/tests/privatePublishSelection.test.js
```

Expected: all three test files report zero failures.

- [ ] **Step 2: Run existing publish-adjacent tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json \
	&& node --test .test-dist/tests/publishPath.test.js \
	&& node --test .test-dist/tests/publishSettings.test.js \
	&& node --test .test-dist/tests/publishedPublicArtifacts.test.js \
	&& node --test .test-dist/tests/publishFrontmatter.test.js \
	&& node --test .test-dist/tests/publishPair.test.js
```

Expected: existing publish-adjacent tests still pass.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: full Node test suite passes.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: test, lint, typecheck, Obsidian compliance, bundle, and release artifact checks pass.

- [ ] **Step 5: Update implementation tracking in the spec**

In `docs/superpowers/specs/2026-07-26-private-published-wiki-design.md`, mark these implementation items complete only after Steps 1-4 pass:

```md
- [x] Add `public/auth.md` parsing for Google and WeChat identities, public-root-relative paths, and `view`, `comment`, and `full` permissions.
- [x] Add inherited permission resolution where folder rows apply downward and more specific rows override broader rows for the same identity.
- [x] Create `public/index.md` when publishing is enabled or a folder publish begins and the file does not exist.
- [x] Keep `public/index.md` updated as the owner-visible publish inventory and status table.
```

Mark these verification items complete only after the matching commands pass:

```md
- [x] Unit tests cover `auth.md` table parsing, validation errors, unsupported provider handling, and path normalization.
- [x] Unit tests cover inherited permission resolution, specificity overrides, and permission ordering.
- [x] Unit tests cover `public/index.md` creation and status-table updates without overwriting unrelated user content.
- [x] `npm run build` passes.
```

Do not mark folder publish actions, site manifest generation, Cloudflare Functions, D1, remote sync import, or manual Cloudflare verification complete in this slice.

- [ ] **Step 6: Commit verification/spec update**

Run:

```bash
git add docs/superpowers/specs/2026-07-26-private-published-wiki-design.md
git commit -m "docs: update private publish core tracking"
```

## Self-Review Notes

- Spec coverage: this plan covers the first four unchecked implementation items and the first three verification items from the approved spec, plus full build verification for the slice.
- Intentional gaps: generated private site manifest, three-pane shell, auth middleware, OAuth, D1 APIs, remote sync import, and author metadata remain unplanned here because they are separate subsystems.
- Type consistency: all new APIs use the `PrivatePublish*` prefix and live under `src/core/publish/`.
- Test strategy: every production module in this plan starts with failing tests, then minimal implementation, then targeted and full verification.
