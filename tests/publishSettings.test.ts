import * as assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_PUBLISH_SETTINGS,
	normalizePublishSettings,
	validatePublishSettings,
} from "../src/core/publish/publishSettings";

test("normalizePublishSettings returns safe non-secret defaults", () => {
	assert.deepEqual(normalizePublishSettings({}), DEFAULT_PUBLISH_SETTINGS);
});

test("normalizePublishSettings trims operational Cloudflare Pages settings", () => {
	const normalized = normalizePublishSettings({
		publishEnabled: true,
		publishPagesProjectName: " Publish-Site ",
		publishBaseUrl: " https://publish.example.com/ ",
		publishAllowedRoot: " share ",
		publishWranglerCommand: " /opt/homebrew/bin/wrangler ",
	} as Parameters<typeof normalizePublishSettings>[0]);

	assert.deepEqual(normalized, {
		publishEnabled: true,
		publishPagesProjectName: "publish-site",
		publishBaseUrl: "https://publish.example.com",
		publishAllowedRoot: "public/",
	});
	assert.equal("publishWranglerCommand" in normalized, false);
});

test("normalizePublishSettings keeps the publish folder fixed to public", () => {
	assert.equal(normalizePublishSettings({
		publishAllowedRoot: "share/",
	}).publishAllowedRoot, "public/");
	assert.equal(normalizePublishSettings({
		publishAllowedRoot: "../share",
	}).publishAllowedRoot, "public/");
});

test("normalizePublishSettings preserves configured Pages project for custom domains", () => {
	const normalized = normalizePublishSettings({
		publishEnabled: true,
		publishPagesProjectName: "fdechina-publish",
		publishBaseUrl: " https://publish.fdechina.com/ ",
		publishAllowedRoot: "public/",
	} as Parameters<typeof normalizePublishSettings>[0]);

	assert.deepEqual(normalized, {
		publishEnabled: true,
		publishPagesProjectName: "fdechina-publish",
		publishBaseUrl: "https://publish.fdechina.com",
		publishAllowedRoot: "public/",
	});
});

test("normalizePublishSettings derives Pages project from pages.dev publishing URL", () => {
	const normalized = normalizePublishSettings({
		publishEnabled: true,
		publishPagesProjectName: "stale-project",
		publishBaseUrl: " https://lean-startup.pages.dev/ ",
		publishAllowedRoot: "public/",
	} as Parameters<typeof normalizePublishSettings>[0]);

	assert.deepEqual(normalized, {
		publishEnabled: true,
		publishPagesProjectName: "lean-startup",
		publishBaseUrl: "https://lean-startup.pages.dev",
		publishAllowedRoot: "public/",
	});
});

test("normalizePublishSettings infers publish base URL from project name", () => {
	const normalized = normalizePublishSettings({
		publishEnabled: true,
		publishPagesProjectName: "My Vault",
		publishAllowedRoot: "public/",
	} as Parameters<typeof normalizePublishSettings>[0]);

	assert.deepEqual(normalized, {
		publishEnabled: true,
		publishPagesProjectName: "my-vault",
		publishBaseUrl: "https://my-vault.pages.dev",
		publishAllowedRoot: "public/",
	});
});

test("validatePublishSettings treats disabled publishing as explicitly off", () => {
	assert.deepEqual(validatePublishSettings(DEFAULT_PUBLISH_SETTINGS), {
		ok: false,
		notice: "Turn on Publishing in Aside settings first.",
	});
});

test("validatePublishSettings accepts complete non-secret Cloudflare Pages config", () => {
	assert.deepEqual(validatePublishSettings(normalizePublishSettings({
		publishEnabled: true,
		publishBaseUrl: "https://publish.example.com",
		publishAllowedRoot: "public/",
	})), {
		ok: true,
	});
});

test("validatePublishSettings rejects incomplete or unsafe publish settings", () => {
	assert.deepEqual(validatePublishSettings(normalizePublishSettings({
		publishEnabled: true,
		publishPagesProjectName: "bad_project",
		publishBaseUrl: "http://publish.example.com/path?token=secret",
		publishAllowedRoot: "../share",
	})), {
		ok: false,
		notice: "Publish settings are invalid: Publish base URL must be an https:// origin with no path, query, or fragment.",
	});
});
