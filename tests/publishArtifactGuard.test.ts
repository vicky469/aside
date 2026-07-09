import * as assert from "node:assert/strict";
import test from "node:test";
import { inspectPublishArtifact } from "../src/core/publish/publishArtifactGuard";

function inspect(vaultRelativePath: string, contents = "<!doctype html><html></html>") {
	return inspectPublishArtifact({
		vaultRelativePath,
		allowedRoot: "share/",
		configDir: ".obsidian",
		contents,
	});
}

test("inspectPublishArtifact allows HTML files under the configured publish root", () => {
	assert.deepEqual(inspect("share/page.html"), { ok: true });
});

test("inspectPublishArtifact blocks private vault and plugin paths", () => {
	assert.deepEqual(inspectPublishArtifact({
		vaultRelativePath: "page.html",
		allowedRoot: "public/",
		configDir: ".obsidian",
		contents: "<!doctype html><html></html>",
	}), {
		ok: false,
		notice: "Publish failed: artifact path is outside the configured publish folder: public/",
	});

	assert.deepEqual(inspect(".obsidian/plugins/aside/data.json"), {
		ok: false,
		notice: "Publish failed: artifact path is outside the configured publish folder: share/",
	});
	assert.deepEqual(inspect("share/.obsidian/plugins/aside/data.json"), {
		ok: false,
		notice: "Publish failed: Obsidian configuration files cannot be published.",
	});
});

test("inspectPublishArtifact blocks common secret-bearing files", () => {
	assert.deepEqual(inspect("share/.env"), {
		ok: false,
		notice: "Publish failed: secret-bearing files cannot be published.",
	});
	assert.deepEqual(inspect("share/.env-local.md", "# env"), {
		ok: false,
		notice: "Publish failed: secret-bearing files cannot be published.",
	});
	assert.deepEqual(inspect("share/.envrc.html"), {
		ok: false,
		notice: "Publish failed: secret-bearing files cannot be published.",
	});
	assert.deepEqual(inspect("share/.npmrc"), {
		ok: false,
		notice: "Publish failed: secret-bearing files cannot be published.",
	});
	assert.deepEqual(inspect("share/private.key"), {
		ok: false,
		notice: "Publish failed: key and certificate files cannot be published.",
	});
	assert.deepEqual(inspect("share/certificate.pem"), {
		ok: false,
		notice: "Publish failed: key and certificate files cannot be published.",
	});
});

test("inspectPublishArtifact blocks source maps, source-map markers, and logs", () => {
	assert.deepEqual(inspect("share/main.js.map"), {
		ok: false,
		notice: "Publish failed: source maps cannot be published.",
	});
	assert.deepEqual(inspect("share/page.html", "<script></script>\n//# sourceMappingURL=main.js.map"), {
		ok: false,
		notice: "Publish failed: source-map references cannot be published.",
	});
	assert.deepEqual(inspect("share/debug.log"), {
		ok: false,
		notice: "Publish failed: log files cannot be published.",
	});
});

test("inspectPublishArtifact allows PDF files under the configured publish root", () => {
	assert.deepEqual(inspect("share/report.pdf", "%PDF-1.7"), { ok: true });
});

test("inspectPublishArtifact allows Markdown files under the configured publish root", () => {
	assert.deepEqual(inspect("share/page.md", "# Draft"), { ok: true });
});

test("inspectPublishArtifact blocks unsupported public file types", () => {
	assert.deepEqual(inspect("share/page.css", "body {}"), {
		ok: false,
		notice: "Publish failed: only .html, .htm, .md, and .pdf files can be published in this version.",
	});
});
