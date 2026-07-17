import * as assert from "node:assert/strict";
import test from "node:test";
import {
	PublicHtmlPublishController,
	type PublicHtmlPublishSnapshotFile,
} from "../src/publish/publicHtmlPublishController";
import type { PublishSettings } from "../src/core/publish/publishSettings";

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
		getVaultConfigDir: () => ".obsidian",
		listMarkdownFiles: async (rootPath: string) => Array.from(files.keys())
			.filter((path) => path.startsWith(rootPath) && path.endsWith(".md")),
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
		getPublishedArtifactPaths: () => publishedArtifactPaths,
		setPublishedArtifactPaths: async (paths: string[]) => {
			publishedArtifactPaths = [...paths];
		},
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

test("public html publish controller publishes one html pair and records enabled frontmatter", async () => {
	const harness = createHarness();

	const result = await harness.controller.publishHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.html",
	});
	assert.equal(harness.writes.length, 1);
	assert.equal(harness.writes[0].path, "public/page.md");
	assert.match(harness.writes[0].contents, /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: true\n  html: public\/page\.html/u);
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
		url: "https://publish.example.com/public/page.html",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/report.pdf"]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
		"public/report.pdf",
	]);
});

test("public html publish controller resolves markdown source files to the paired html actions", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
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
		url: "https://publish.example.com/public/page.md",
	}]);
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
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/nested/b.html\n---\n# B\n",
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
		"public/a.md",
		"public/a.html",
		"public/b.md",
		"public/nested/b.html",
		"public/report.pdf",
	]);
	assert.deepEqual(lastDeploy.slice(0, 4), [{
		vaultRelativePath: "public/a.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
	}, {
		vaultRelativePath: "public/a.html",
		contents: "<!doctype html><html><body>A</body></html>",
	}, {
		vaultRelativePath: "public/b.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/nested/b.html\n---\n# B\n",
	}, {
		vaultRelativePath: "public/nested/b.html",
		contents: "<!doctype html><html><body>B</body></html>",
	}]);
	assert.equal(decodeSnapshotContents(lastDeploy.at(-1)!), "PDF bytes");
});

test("public html publish controller publishes a PDF artifact and remembers it for future snapshots", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
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
		"public/page.md",
		"public/page.html",
		"public/report.pdf",
	]);
	assert.equal(decodeSnapshotContents(lastDeploy[2]), "PDF bytes");
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

test("public html publish controller unpublishes by disabling frontmatter and redeploying remaining html", async () => {
	const harness = createHarness({
		files: {
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
			"public/b.html": "<!doctype html><html><body>B</body></html>",
		},
	});

	const result = await harness.controller.unpublishHtmlFile("public/a.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/a.html",
	});
	assert.equal(harness.writes[0].path, "public/a.md");
	assert.match(harness.writes[0].contents, /asidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n  html: public\/a\.html/u);
	assert.deepEqual(harness.deployCalls.at(-1), [{
		vaultRelativePath: "public/a.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n  html: public/a.html\n---\n# A\n",
	}, {
		vaultRelativePath: "public/b.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
	}, {
		vaultRelativePath: "public/b.html",
		contents: "<!doctype html><html><body>B</body></html>",
	}]);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/a.html",
		sourcePath: "public/a.md",
		event: "unpublish",
	}]);
});

test("public html publish controller unpublishes markdown and purges its public URL", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
	});

	const result = await harness.controller.unpublishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.md",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: false/u);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page.md",
		sourcePath: "public/page.md",
		event: "unpublish",
	}]);
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
		url: "https://publish.example.com/public/page.md",
		notice: "Unpublished, but remote cache purge failed: Cache purge broker request failed: socket closed",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: false/u);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page.md",
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
		url: "https://publish.example.com/public/page.md",
	});
	assert.deepEqual(harness.purgeCalls, []);
});

test("public html publish controller unpublishes paired html without redeploying a stale standalone artifact", async () => {
	const harness = createHarness({
		files: {
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
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
		url: "https://publish.example.com/public/a.html",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), ["public/report.pdf"]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/a.md",
		"public/b.md",
		"public/b.html",
		"public/report.pdf",
	]);
});

test("public html publish controller keeps unpublish frontmatter enabled when deployment fails", async () => {
	const harness = createHarness({
		files: {
			"public/a.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/a.html\n---\n# A\n",
			"public/a.html": "<!doctype html><html><body>A</body></html>",
			"public/b.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
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
	assert.match(harness.files.get("public/a.md") ?? "", /asidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public\/a\.html/u);
	assert.deepEqual(harness.deployCalls.at(-1), [{
		vaultRelativePath: "public/a.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n  html: public/a.html\n---\n# A\n",
	}, {
		vaultRelativePath: "public/b.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/b.html\n---\n# B\n",
	}, {
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
		url: "https://publish.example.com/public/page.html",
	}]);
});

test("public html publish controller unpublishes standalone html when an implicit markdown pair is disabled", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Page</body></html>",
		},
		publishedArtifactPaths: ["public/page.html"],
	});

	const result = await harness.controller.unpublishHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.html",
	});
	assert.deepEqual(harness.getPublishedArtifactPaths(), []);
	assert.deepEqual(harness.deployCalls.at(-1), []);
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
		url: "https://publish.example.com/public/page.html",
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
		url: "https://publish.example.com/public/page.zh.html",
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
		url: "https://publish.example.com/public/generated/page.html",
	}]);
});

test("public html publish controller updates a published html pair without rewriting frontmatter", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
			"public/page.html": "<!doctype html><html><body>Updated page</body></html>",
		},
	});

	const result = await harness.controller.updatePublishedHtmlFile("public/page.html");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.html",
	});
	assert.deepEqual(harness.writes, []);
	assert.deepEqual(harness.deployCalls.at(-1), [{
		vaultRelativePath: "public/page.md",
		contents: "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: true\n  html: public/page.html\n---\n# Page\n",
	}, {
		vaultRelativePath: "public/page.html",
		contents: "<!doctype html><html><body>Updated page</body></html>",
	}]);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page.html",
		sourcePath: "public/page.md",
		event: "republish",
	}]);
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
