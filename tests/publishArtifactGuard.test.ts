import * as assert from "node:assert/strict";
import test from "node:test";
import {
	inspectPublishArtifact,
	inspectPublishDependency,
} from "../src/core/publish/publishArtifactGuard";

function inspect(vaultRelativePath: string, contents = "<!doctype html><html></html>") {
	return inspectPublishArtifact({
		vaultRelativePath,
		allowedRoot: "share/",
		configDir: ".obsidian",
		contents,
	});
}

function inspectDependency(vaultRelativePath: string, contents: string | ArrayBuffer = "asset") {
	return inspectPublishDependency({
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

test("inspectPublishArtifact checks normalized HTML and PDF entry paths", () => {
	assert.deepEqual(inspect(" share\\site.html "), { ok: true });
	assert.deepEqual(inspect("share\\report.pdf\\.", "%PDF-1.7"), { ok: true });
});

test("inspectPublishArtifact blocks raw Markdown files as publish artifacts", () => {
	assert.deepEqual(inspect("share/page.md", "# Draft"), {
		ok: false,
		notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
	});
});

test("inspectPublishArtifact allows generated Markdown HTML files under the configured publish root", () => {
	assert.deepEqual(inspect("share/page.html", "<!doctype html><html><body><h1>Draft</h1></body></html>"), { ok: true });
});

test("inspectPublishArtifact blocks unsupported public file types", () => {
	assert.deepEqual(inspect("share/page.css", "body {}"), {
		ok: false,
		notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
	});
});

test("inspectPublishDependency allows reachable web assets", () => {
	for (const vaultRelativePath of [
		"share/site.css",
		"share/app.js",
		"share/logo.svg",
		"share/icon.png",
		"share/font.woff2",
		"share/site.webmanifest",
		"share/module.wasm",
	]) {
		assert.deepEqual(inspectDependency(vaultRelativePath), { ok: true });
	}
});

test("inspectPublishDependency blocks raw source files", () => {
	for (const vaultRelativePath of [
		"share/readme.MD",
		"share/component.MdX",
		"share/app.Ts",
		"share/app.tSX",
		"share/component.JsX",
	]) {
		assert.deepEqual(inspectDependency(vaultRelativePath), {
			ok: false,
			notice: "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published.",
		});
	}
});

test("inspectPublishDependency blocks normalized raw-source aliases", () => {
	for (const vaultRelativePath of [
		"share/readme.md/.",
		"share\\component.Ts\\.",
		"share\\component.JSX\\",
	]) {
		assert.deepEqual(inspectDependency(vaultRelativePath), {
			ok: false,
			notice: "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published.",
		});
	}
});

test("inspectPublishArtifact remains limited to HTML and PDF entries while dependencies allow CSS", () => {
	assert.deepEqual(inspect("share/site.css", "body {}"), {
		ok: false,
		notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
	});
	assert.deepEqual(inspectDependency("share/site.css", "body {}"), { ok: true });
});

test("publish artifact and dependency inspections share path and content safety checks", () => {
	const safetyCases = [
		{
			vaultRelativePath: "../outside.html",
			contents: "<!doctype html><html></html>",
			notice: "Publish failed: selected path must stay inside the current vault.",
		},
		{
			vaultRelativePath: "page.html",
			contents: "<!doctype html><html></html>",
			notice: "Publish failed: artifact path is outside the configured publish folder: share/",
		},
		{
			vaultRelativePath: "share/.obsidian/plugins/aside/data.json",
			contents: "asset",
			notice: "Publish failed: Obsidian configuration files cannot be published.",
		},
		{
			vaultRelativePath: "share/.env",
			contents: "asset",
			notice: "Publish failed: secret-bearing files cannot be published.",
		},
		{
			vaultRelativePath: "share/.npmrc",
			contents: "asset",
			notice: "Publish failed: secret-bearing files cannot be published.",
		},
		{
			vaultRelativePath: "share/private.key",
			contents: "asset",
			notice: "Publish failed: key and certificate files cannot be published.",
		},
		{
			vaultRelativePath: "share/certificate.pem",
			contents: "asset",
			notice: "Publish failed: key and certificate files cannot be published.",
		},
		{
			vaultRelativePath: "share/main.js.map",
			contents: "asset",
			notice: "Publish failed: source maps cannot be published.",
		},
		{
			vaultRelativePath: "share/page.html",
			contents: "<script></script>\n//# sourceMappingURL=main.js.map",
			notice: "Publish failed: source-map references cannot be published.",
		},
		{
			vaultRelativePath: "share/debug.log",
			contents: "asset",
			notice: "Publish failed: log files cannot be published.",
		},
	] as const;

	for (const { vaultRelativePath, contents, notice } of safetyCases) {
		const expected = { ok: false as const, notice };
		assert.deepEqual(inspectPublishArtifact({
			vaultRelativePath,
			allowedRoot: "share/",
			configDir: ".obsidian",
			contents,
		}), expected);
		assert.deepEqual(inspectDependency(vaultRelativePath, contents), expected);
	}
});
