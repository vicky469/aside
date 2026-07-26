import * as assert from "node:assert/strict";
import test from "node:test";
import {
	PublicHtmlPublishController,
	type PublicHtmlPublishSnapshotFile,
} from "../src/publish/publicHtmlPublishController";
import type { PublishSettings } from "../src/core/publish/publishSettings";
import {
	FeatureFlag,
	type FeatureFlags,
} from "../src/core/config/featureFlags";

const settings: PublishSettings = {
	publishEnabled: true,
	publishPagesProjectName: "publish-site",
	publishBaseUrl: "https://publish.example.com",
	publishAllowedRoot: "public/",
	publishRemotePurgeEnabled: true,
	publishPurgeBrokerUrl: "https://purge.example.workers.dev/purge",
	publishPurgeBrokerSecretName: "aside-purge-broker",
};

function createHarness(options: {
	settings?: PublishSettings;
	featureFlags?: FeatureFlags;
	files?: Record<string, string>;
	binaryFiles?: Record<string, string>;
	publishedArtifactPaths?: string[];
	deployResult?: { ok: true } | { ok: false; notice: string };
	purgeResult?: { ok: true } | { ok: false; notice: string };
} = {}) {
	const files = new Map(Object.entries(options.files ?? {
		"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n",
		"public/page.html": "<!doctype html><html><body>Page</body></html>",
	}));
	const binaryFiles = new Map(Object.entries(options.binaryFiles ?? {}));
	let publishedArtifactPaths = [...(options.publishedArtifactPaths ?? [])];
	const writes: Array<{ path: string; contents: string }> = [];
	const deployCalls: PublicHtmlPublishSnapshotFile[][] = [];
	const purgeCalls: Array<{ url: string; sourcePath: string; event: "unpublish" | "republish" }> = [];
	const host = {
		getSettings: () => options.settings ?? settings,
		getFeatureFlags: () => options.featureFlags ?? { [FeatureFlag.publish]: true },
		getVaultConfigDir: () => ".obsidian",
		listMarkdownFiles: async (rootPath: string) => Array.from(files.keys())
			.filter((path) => path.startsWith(rootPath) && path.endsWith(".md")),
		listVaultFiles: async (rootPath: string) => [...new Set([
			...Array.from(files.keys()),
			...Array.from(binaryFiles.keys()),
		])]
			.filter((path) => path.startsWith(rootPath))
			.sort(),
		fileExists: async (path: string) => files.has(path) || binaryFiles.has(path),
		readVaultFile: async (path: string) => {
			const contents = files.get(path);
			if (contents === undefined) {
				throw new Error(`Missing file: ${path}`);
			}
			return contents;
		},
		readVaultBinaryFile: async (path: string) => {
			const contents = binaryFiles.get(path);
			if (contents === undefined) {
				throw new Error(`Missing binary file: ${path}`);
			}
			return new TextEncoder().encode(contents).buffer;
		},
		writeVaultFile: async (path: string, contents: string) => {
			writes.push({ path, contents });
			files.set(path, contents);
		},
		writeOrCreateVaultFile: async (path: string, contents: string) => {
			writes.push({ path, contents });
			files.set(path, contents);
		},
		getPublishedArtifactPaths: () => publishedArtifactPaths,
		setPublishedArtifactPaths: async (paths: string[]) => {
			publishedArtifactPaths = [...paths];
		},
		getCurrentTimestamp: () => "2026-07-26T08:00:00.000Z",
		deploySnapshot: async (snapshotFiles: PublicHtmlPublishSnapshotFile[]) => {
			deployCalls.push(snapshotFiles);
			return options.deployResult ?? { ok: true };
		},
		purgePublicUrlFromCache: async (input: { url: string; sourcePath: string; event: "unpublish" | "republish" }) => {
			purgeCalls.push(input);
			return options.purgeResult ?? { ok: true };
		},
	};
	const controller = new PublicHtmlPublishController(host);

	return {
		controller,
		files,
		getPublishedArtifactPaths: () => publishedArtifactPaths,
		writes,
		deployCalls,
		purgeCalls,
	};
}

function decodeSnapshotContents(file: PublicHtmlPublishSnapshotFile): string {
	return typeof file.contents === "string"
		? file.contents
		: new TextDecoder().decode(file.contents);
}

test("public html publish controller fails closed when the publish feature flag is disabled", async () => {
	const harness = createHarness({
		featureFlags: {
			[FeatureFlag.publish]: false,
		},
	});

	assert.deepEqual(await harness.controller.publishHtmlFile("public/page.html"), {
		ok: false,
		notice: "Publishing feature is disabled. Run the Aside CLI to enable it.",
	});
	assert.deepEqual(await harness.controller.getHtmlFileActionState("public/page.html"), {
		kind: "disabled",
		label: "Publish HTML",
		icon: "upload-cloud",
		disabled: true,
		notice: "Publishing feature is disabled. Run the Aside CLI to enable it.",
	});
	assert.deepEqual(harness.deployCalls, []);
	assert.deepEqual(harness.writes, []);
});

test("public html publish controller creates a private publish index file", async () => {
	const harness = createHarness({
		files: {},
	});

	assert.deepEqual(await harness.controller.ensurePrivatePublishIndex(), {
		ok: true,
		path: "public/index.md",
	});
	assert.equal(harness.files.get("public/index.md"), [
		"# Published Index",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"<!-- /Aside publish index -->",
		"",
	].join("\n"));
});

test("public html publish controller publishes one html pair and records enabled frontmatter", async () => {
	const harness = createHarness();

	const result = await harness.controller.publishHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.writes.map((write) => write.path), [
		"public/page.md",
		"public/index.md",
	]);
	assert.match(harness.writes[0].contents, /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public\/page\.html/u);
	assert.match(harness.writes[1].contents, /\| page\.html \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.deepEqual(harness.deployCalls, [[{
		vaultRelativePath: "public/page.html",
		contents: "<!doctype html><html><body>Page</body></html>",
	}]]);
});

test("public html publish controller rejects root files even when the vault folder is named public", async () => {
	const harness = createHarness({
		files: {
			"page.md": "# Root page\n",
			"page.html": "<!doctype html><html><body>Root page</body></html>",
			"public/page.md": "# Public page\n",
			"public/page.html": "<!doctype html><html><body>Public page</body></html>",
		},
	});

	assert.deepEqual(await harness.controller.publishHtmlFile("page.html"), {
		ok: false,
		notice: "Publish file must be inside public/.",
	});
	assert.deepEqual(harness.deployCalls, []);
	assert.deepEqual(harness.writes, []);
});

test("public html publish controller removes stale standalone ownership when publishing a paired html file", async () => {
	const harness = createHarness({
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: ["public/page.html", "public/report.pdf"],
	});

	const result = await harness.controller.publishHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/report.pdf"]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
		"public/report.pdf",
	]);
});

test("public html publish controller resolves markdown source files to generated html actions", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
	});

	assert.deepEqual(await harness.controller.getFileActionStates("public/page.md"), [{
		kind: "unpublish",
		label: "Unpublish Markdown",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish Markdown",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published Markdown",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/page",
	}]);
});

test("public html publish controller publishes markdown as generated html", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n\nBody text.\n",
		},
	});

	const result = await harness.controller.publishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: true\n  htmlEnabled: false/u);
	assert.match(harness.files.get("public/index.md") ?? "", /\| page\.md \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
	]);
	const html = decodeSnapshotContents(harness.deployCalls.at(-1)![0]);
	assert.match(html, /<h1>Page<\/h1>/u);
	assert.match(html, /<p>Body text\.<\/p>/u);
	assert.doesNotMatch(html, /asidePublish/u);
});

test("public html publish controller removes stale standalone html ownership when publishing markdown", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Standalone</body></html>",
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: ["public/page.html", "public/report.pdf"],
	});

	const result = await harness.controller.publishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/report.pdf"]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
		"public/report.pdf",
	]);
	const pageArtifacts = harness.deployCalls.at(-1)?.filter((file) => file.vaultRelativePath === "public/page.html") ?? [];
	assert.equal(pageArtifacts.length, 1);
	assert.match(decodeSnapshotContents(pageArtifacts[0]), /<h1>Page<\/h1>/u);
});

test("public html publish controller publishes a folder selection and updates the private index", async () => {
	const harness = createHarness({
		files: {
			"public/index.md": [
				"# Published Index",
				"",
				"Owner notes stay here.",
				"",
				"<!-- Aside publish index -->",
				"| path | type | status | permission_source | last_published_at |",
				"| --- | --- | --- | --- | --- |",
				"| old.md | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
				"<!-- /Aside publish index -->",
				"",
			].join("\n"),
			"public/auth.md": "| provider | identity | path | permission |\n",
			"public/docs/a.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# A\n",
			"public/docs/page.html": "<!doctype html><html><body>Page</body></html>",
			"public/docs/raw.txt": "Raw",
			"public/other.md": "# Other\n",
		},
		binaryFiles: {
			"public/docs/report.pdf": "PDF bytes",
		},
	});

	const result = await harness.controller.publishFolder("public/docs");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/docs",
		notice: "Published 3 files from public/docs/.",
	});
	assert.match(harness.files.get("public/docs/a.md") ?? "", /asidePublish:\n  markdownEnabled: true\n  htmlEnabled: false/u);
	assert.deepEqual(harness.getPublishedArtifactPaths(), [
		"public/docs/page.html",
		"public/docs/report.pdf",
	]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/docs/a.html",
		"public/docs/page.html",
		"public/docs/report.pdf",
	]);
	const indexMarkdown = harness.files.get("public/index.md") ?? "";
	assert.match(indexMarkdown, /Owner notes stay here\./u);
	assert.match(indexMarkdown, /\| docs\/ \| folder \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| docs\/a\.md \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| docs\/page\.html \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| docs\/report\.pdf \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| old\.md \| file \| published \| auth\.md \| 2026-07-26T07:00:00\.000Z \|/u);
	assert.doesNotMatch(indexMarkdown, /raw\.txt/u);
});

test("public html publish controller lets selected markdown own generated html during folder publish", async () => {
	const harness = createHarness({
		files: {
			"public/docs/page.md": "# Markdown Page\n",
			"public/docs/page.html": "<!doctype html><html><body>Standalone</body></html>",
		},
	});

	const result = await harness.controller.publishFolder("public/docs");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/docs",
		notice: "Published 1 files from public/docs/.",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), []);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/docs/page.html",
	]);
	assert.match(decodeSnapshotContents(harness.deployCalls.at(-1)![0]), /<h1>Markdown Page<\/h1>/u);
	assert.doesNotMatch(harness.files.get("public/index.md") ?? "", /\| docs\/page\.html \| file \|/u);
	assert.match(harness.files.get("public/index.md") ?? "", /\| docs\/page\.md \| file \| published \| auth\.md \|/u);
});

test("public html publish controller publishes the configured root and excludes root control files", async () => {
	const harness = createHarness({
		files: {
			"public/index.md": "# Published Index\n",
			"public/auth.md": "| provider | identity | path | permission |\n",
			"public/a.md": "# A\n",
			"public/nested/index.md": "# Nested Index\n",
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
	});

	const result = await harness.controller.publishRoot();

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public",
		notice: "Published 3 files from public/.",
	});
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/a.html",
		"public/nested/index.html",
		"public/report.pdf",
	]);
	const indexMarkdown = harness.files.get("public/index.md") ?? "";
	assert.match(indexMarkdown, /\| \/ \| folder \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| a\.md \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| nested\/index\.md \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.match(indexMarkdown, /\| report\.pdf \| file \| published \| auth\.md \| 2026-07-26T08:00:00\.000Z \|/u);
	assert.doesNotMatch(indexMarkdown, /\| auth\.md \| file \|/u);
	assert.doesNotMatch(indexMarkdown, /\| index\.md \| file \|/u);
});

test("public html publish controller rejects repointing one markdown file to another html file", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
			"public/other.html": "<!doctype html><html><body>Other</body></html>",
		},
	});

	const result = await harness.controller.publishHtmlFile("public/other.html", {
		sourcePath: "public/page.md",
	});

	assert.deepEqual(result, {
		ok: false,
		notice: "This Markdown file is already paired with public/page.html. Aside uses one Markdown file for one public HTML file; create another Markdown file for another HTML page.",
	});
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.deployCalls, []);
});

test("public html publish controller rejects publishing a html already paired with another markdown", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/other.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Other\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
	});

	const result = await harness.controller.publishHtmlFile("public/page.html", {
		sourcePath: "public/other.md",
	});

	assert.deepEqual(result, {
		ok: false,
		notice: "This Markdown file is already paired with public/page.html. Aside uses one Markdown file for one public HTML file; create another Markdown file for another HTML page.",
	});
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.deployCalls, []);
});

test("public html publish controller stages all enabled html files", async () => {
	const harness = createHarness({
		files: {
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/nested/b.html\n---\n# B\n",
			"public/nested/b.html": "<!doctype html><html><body>B</body></html>",
			"public/c.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n  html: public/c.html\n---\n# C\n",
			"public/c.html": "<!doctype html><html><body>C</body></html>",
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: ["public/report.pdf"],
	});

	await harness.controller.publishHtmlFile("public/a.html");

	const lastDeploy = harness.deployCalls.at(-1) ?? [];
	assert.deepEqual(lastDeploy.map((file) => file.vaultRelativePath), [
		"public/a.html",
		"public/nested/b.html",
		"public/report.pdf",
	]);
	assert.deepEqual(lastDeploy.slice(0, 2), [{
		vaultRelativePath: "public/a.html",
		contents: "<!doctype html><html><body>A</body></html>",
	}, {
		vaultRelativePath: "public/nested/b.html",
		contents: "<!doctype html><html><body>B</body></html>",
	}]);
	assert.equal(decodeSnapshotContents(lastDeploy.at(-1)!), "PDF bytes");
});

test("public html publish controller publishes a PDF artifact and remembers it for future snapshots", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
	});

	const result = await harness.controller.publishFile("public/report.pdf");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/report.pdf",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/report.pdf"]);
	const lastDeploy = harness.deployCalls.at(-1) ?? [];
	assert.deepEqual(lastDeploy.map((file) => file.vaultRelativePath), [
		"public/page.html",
		"public/report.pdf",
	]);
	assert.equal(decodeSnapshotContents(lastDeploy[1]), "PDF bytes");
});

test("public html publish controller exposes unpublish and update actions for published PDFs", async () => {
	const harness = createHarness({
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: ["public/report.pdf"],
	});

	assert.deepEqual(await harness.controller.getFileActionStates("public/report.pdf"), [{
		kind: "unpublish",
		label: "Unpublish PDF",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish PDF",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published PDF",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/report.pdf",
	}]);
});

test("public html publish controller marks a PDF index row unpublished", async () => {
	const harness = createHarness({
		files: {
			"public/index.md": [
				"# Published Index",
				"",
				"<!-- Aside publish index -->",
				"| path | type | status | permission_source | last_published_at |",
				"| --- | --- | --- | --- | --- |",
				"| report.pdf | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
				"<!-- /Aside publish index -->",
				"",
			].join("\n"),
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: ["public/report.pdf"],
	});

	const result = await harness.controller.unpublishFile("public/report.pdf");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/report.pdf",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), []);
	assert.match(harness.files.get("public/index.md") ?? "", /\| report\.pdf \| file \| unpublished \| auth\.md \|  \|/u);
});

test("public html publish controller rejects unpublishing an unpublished PDF without changing the index", async () => {
	const existingIndexMarkdown = [
		"# Published Index",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| report.pdf | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
	].join("\n");
	const harness = createHarness({
		files: {
			"public/index.md": existingIndexMarkdown,
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: [],
	});

	assert.deepEqual(await harness.controller.unpublishFile("public/report.pdf"), {
		ok: false,
		notice: "Publish this PDF before unpublishing it.",
	});
	assert.deepEqual(harness.deployCalls, []);
	assert.equal(harness.files.get("public/index.md"), existingIndexMarkdown);
});

test("public html publish controller unpublishes by disabling frontmatter and redeploying remaining html", async () => {
	const harness = createHarness({
		files: {
			"public/index.md": [
				"# Published Index",
				"",
				"Owner notes.",
				"",
				"<!-- Aside publish index -->",
				"| path | type | status | permission_source | last_published_at |",
				"| --- | --- | --- | --- | --- |",
				"| a.html | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
				"| old.md | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
				"<!-- /Aside publish index -->",
				"",
			].join("\n"),
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
			"public/b.html": "<!doctype html><html><body>B</body></html>",
		},
	});

	const result = await harness.controller.unpublishHtmlFile("public/a.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/a",
	});
	assert.equal(harness.writes[0].path, "public/a.md");
	assert.match(harness.writes[0].contents, /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n  html: public\/a\.html/u);
	assert.deepEqual(harness.deployCalls.at(-1), [{
		vaultRelativePath: "public/b.html",
		contents: "<!doctype html><html><body>B</body></html>",
	}]);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/a",
		sourcePath: "public/a.md",
		event: "unpublish",
	}]);
	const indexMarkdown = harness.files.get("public/index.md") ?? "";
	assert.match(indexMarkdown, /Owner notes\./u);
	assert.match(indexMarkdown, /\| a\.html \| file \| unpublished \| auth\.md \|  \|/u);
	assert.match(indexMarkdown, /\| old\.md \| file \| published \| auth\.md \| 2026-07-26T07:00:00\.000Z \|/u);
});

test("public html publish controller unpublishes markdown and purges its public URL", async () => {
	const harness = createHarness({
		files: {
			"public/index.md": [
				"# Published Index",
				"",
				"<!-- Aside publish index -->",
				"| path | type | status | permission_source | last_published_at |",
				"| --- | --- | --- | --- | --- |",
				"| page.md | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
				"<!-- /Aside publish index -->",
				"",
			].join("\n"),
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
	});

	const result = await harness.controller.unpublishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: false/u);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page",
		sourcePath: "public/page.md",
		event: "unpublish",
	}]);
	assert.match(harness.files.get("public/index.md") ?? "", /\| page\.md \| file \| unpublished \| auth\.md \|  \|/u);
});

test("public html publish controller keeps unpublish when cache purge fails", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
		purgeResult: {
			ok: false,
			notice: "Cache purge broker request failed: socket closed",
		},
	});

	const result = await harness.controller.unpublishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
		notice: "Unpublished, but remote cache purge failed: Cache purge broker request failed: socket closed",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: false/u);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page",
		sourcePath: "public/page.md",
		event: "unpublish",
	}]);
});

test("public html publish controller skips cache purge when remote purge is disabled", async () => {
	const harness = createHarness({
		settings: {
			...settings,
			publishRemotePurgeEnabled: false,
			publishPurgeBrokerUrl: "",
			publishPurgeBrokerSecretName: "",
		},
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
	});

	assert.deepEqual(await harness.controller.unpublishFile("public/page.md"), {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.purgeCalls, []);
});

test("public html publish controller unpublishes paired html without redeploying a stale standalone artifact", async () => {
	const harness = createHarness({
		files: {
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
			"public/b.html": "<!doctype html><html><body>B</body></html>",
		},
		binaryFiles: {
			"public/report.pdf": "PDF bytes",
		},
		publishedArtifactPaths: ["public/a.html", "public/report.pdf"],
	});

	const result = await harness.controller.unpublishHtmlFile("public/a.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/a",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/report.pdf"]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/b.html",
		"public/report.pdf",
	]);
});

test("public html publish controller keeps unpublish frontmatter enabled when deployment fails", async () => {
	const existingIndexMarkdown = [
		"# Published Index",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| a.html | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
	].join("\n");
	const harness = createHarness({
		files: {
			"public/index.md": existingIndexMarkdown,
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
			"public/b.html": "<!doctype html><html><body>B</body></html>",
		},
		deployResult: {
			ok: false,
			notice: "Wrangler is not logged in.",
		},
	});

	const result = await harness.controller.unpublishHtmlFile("public/a.html");

	assert.deepEqual(result, {
		ok: false,
		notice: "Wrangler is not logged in.",
	});
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.purgeCalls, []);
	assert.match(harness.files.get("public/a.md") ?? "", /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public\/a\.html/u);
	assert.equal(harness.files.get("public/index.md"), existingIndexMarkdown);
	assert.deepEqual(harness.deployCalls.at(-1), [{
		vaultRelativePath: "public/b.html",
		contents: "<!doctype html><html><body>B</body></html>",
	}]);
});

test("public html publish controller fails closed when publishing is disabled", async () => {
	const harness = createHarness({
		settings: {
			...settings,
			publishEnabled: false,
		},
	});

	assert.deepEqual(await harness.controller.publishHtmlFile("public/page.html"), {
		ok: false,
		notice: "Turn on Publishing in Aside settings first.",
	});
});

test("public html publish controller reports a publish action for unpublished html pairs", async () => {
	const harness = createHarness();

	assert.deepEqual(await harness.controller.getHtmlFileActionState("public/page.html"), {
		kind: "publish",
		label: "Publish HTML",
		icon: "upload-cloud",
		disabled: false,
	});
});

test("public html publish controller exposes only publish while unpublished", async () => {
	const harness = createHarness();

	assert.deepEqual(await harness.controller.getHtmlFileActionStates("public/page.html"), [{
		kind: "publish",
		label: "Publish HTML",
		icon: "upload-cloud",
		disabled: false,
	}]);
});

test("public html publish controller exposes standalone artifact actions when an implicit markdown pair is disabled", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
		publishedArtifactPaths: ["public/page.html"],
	});

	assert.deepEqual(await harness.controller.getHtmlFileActionStates("public/page.html"), [{
		kind: "unpublish",
		label: "Unpublish HTML",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish HTML",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published HTML",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/page",
	}]);
});

test("public html publish controller unpublishes standalone html when an implicit markdown pair is disabled", async () => {
	const harness = createHarness({
		files: {
			"public/index.md": [
				"# Published Index",
				"",
				"<!-- Aside publish index -->",
				"| path | type | status | permission_source | last_published_at |",
				"| --- | --- | --- | --- | --- |",
				"| page.html | file | published | auth.md | 2026-07-26T07:00:00.000Z |",
				"<!-- /Aside publish index -->",
				"",
			].join("\n"),
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
		publishedArtifactPaths: ["public/page.html"],
	});

	const result = await harness.controller.unpublishHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), []);
	assert.deepEqual(harness.deployCalls.at(-1), []);
	assert.match(harness.files.get("public/index.md") ?? "", /\| page\.html \| file \| unpublished \| auth\.md \|  \|/u);
});

test("public html publish controller reports an unpublish action for enabled html pairs", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
	});

	assert.deepEqual(await harness.controller.getHtmlFileActionState("public/page.html"), {
		kind: "unpublish",
		label: "Unpublish HTML",
		icon: "cloud-off",
		disabled: false,
	});
});

test("public html publish controller exposes unpublish and update actions while published", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
	});

	assert.deepEqual(await harness.controller.getHtmlFileActionStates("public/page.html"), [{
		kind: "unpublish",
		label: "Unpublish HTML",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish HTML",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published HTML",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/page",
	}]);
});

test("public html publish controller resolves language-suffixed html to the base markdown control file", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.zh.html\n---\n# Page\n",
			"public/page.zh.html": "<!doctype html><html><body>Page</body></html>",
		},
	});

	assert.deepEqual(await harness.controller.getHtmlFileActionStates("public/page.zh.html"), [{
		kind: "unpublish",
		label: "Unpublish HTML",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish HTML",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published HTML",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/page.zh",
	}]);
});

test("public html publish controller resolves explicit frontmatter html paths from the html side", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/generated/page.html\n---\n# Page\n",
			"public/generated/page.html": "<!doctype html><html><body>Page</body></html>",
		},
	});

	assert.deepEqual(await harness.controller.getHtmlFileActionStates("public/generated/page.html"), [{
		kind: "unpublish",
		label: "Unpublish HTML",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish HTML",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published HTML",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/generated/page",
	}]);
});

test("public html publish controller updates a published html pair without rewriting frontmatter", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Updated page</body></html>",
		},
	});

	const result = await harness.controller.updatePublishedHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.deployCalls.at(-1), [{
		vaultRelativePath: "public/page.html",
		contents: "<!doctype html><html><body>Updated page</body></html>",
	}]);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page",
		sourcePath: "public/page.md",
		event: "republish",
	}]);
});

test("public html publish controller updates markdown by deploying generated html", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n\nUpdated.\n",
		},
	});

	const result = await harness.controller.updatePublishedFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page",
	});
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page",
		sourcePath: "public/page.md",
		event: "republish",
	}]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
	]);
	const html = decodeSnapshotContents(harness.deployCalls.at(-1)![0]);
	assert.match(html, /<p>Updated\.<\/p>/u);
});

test("public html publish controller publishes a standalone html without a markdown pair", async () => {
	const harness = createHarness({
		files: {
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
	});

	assert.deepEqual(await harness.controller.getHtmlFileActionState("public/page.html"), {
		kind: "publish",
		label: "Publish HTML",
		icon: "upload-cloud",
		disabled: false,
	});
});
