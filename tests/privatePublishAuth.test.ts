import * as assert from "node:assert/strict";
import test from "node:test";
import {
	parsePrivatePublishAuthMarkdown,
	resolvePrivatePublishPermission,
	type PrivatePublishAuthRule,
} from "../src/core/publish/privatePublishAuth";

test("parsePrivatePublishAuthMarkdown parses a standard auth table", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| roadmap.md | google | ada@example.com | comment |",
		"| investors/ | wechat | wx-42 | full |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "comment",
			line: 3,
		},
		{
			path: "investors/",
			provider: "wechat",
			identifier: "wx-42",
			access: "full",
			line: 4,
		},
	]);
});

test("resolvePrivatePublishPermission inherits folder rules and prefers more-specific paths", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "docs/",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 3,
		},
		{
			path: "docs/secret.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "full",
			line: 4,
		},
	];

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "ada@example.com",
	}, "docs/guide.md"), {
		canView: true,
		canComment: false,
		canManage: false,
		rule: rules[0],
	});

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "ada@example.com",
	}, "docs/secret.md"), {
		canView: true,
		canComment: true,
		canManage: true,
		rule: rules[1],
	});
});

test("resolvePrivatePublishPermission applies access implication levels", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "comment.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "comment",
			line: 3,
		},
		{
			path: "full.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "full",
			line: 4,
		},
	];

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "ada@example.com",
	}, "comment.md"), {
		canView: true,
		canComment: true,
		canManage: false,
		rule: rules[0],
	});

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "ada@example.com",
	}, "full.md"), {
		canView: true,
		canComment: true,
		canManage: true,
		rule: rules[1],
	});
});

test("resolvePrivatePublishPermission denies unauthenticated identities", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "full",
			line: 3,
		},
	];

	assert.deepEqual(resolvePrivatePublishPermission(rules, undefined, "roadmap.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
});

test("resolvePrivatePublishPermission returns fresh denied permissions", () => {
	const rules: PrivatePublishAuthRule[] = [];
	const permission = resolvePrivatePublishPermission(rules, undefined, "roadmap.md");
	permission.canView = true;

	assert.deepEqual(resolvePrivatePublishPermission(rules, undefined, "roadmap.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
});

test("parsePrivatePublishAuthMarkdown ignores invalid paths and unknown values", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| ../secret.md | google | ada@example.com | view |",
		"| folder/./secret.md | google | ada@example.com | view |",
		"| folder/../secret.md | google | ada@example.com | view |",
		"| %2e%2e/secret.md | google | ada@example.com | view |",
		"| %252e%252e/secret.md | google | ada@example.com | view |",
		"| / | google | ada@example.com | view |",
		"| file:/secret.md | google | ada@example.com | view |",
		"| ./file:/secret.md | google | ada@example.com | view |",
		"| ./C:/secret.md | google | ada@example.com | view |",
		"| ./https:/secret.md | google | ada@example.com | view |",
		"| file%3a/secret.md | google | ada@example.com | view |",
		"| public/secret.md | google | ada@example.com | view |",
		"| p%75blic/secret.md | google | ada@example.com | view |",
		"| folder/..\\\\secret.md | google | ada@example.com | view |",
		"| roadmap.md | github | ada@example.com | view |",
		"| roadmap.md | google | ada@example.com | edit |",
		"| roadmap.md | google | ada@example.com | view |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 19,
		},
	]);
});

test("parsePrivatePublishAuthMarkdown normalizes provider and access while preserving trimmed identifiers", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| Roadmap.md | Google | Ada@Example.com | COMMENT |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "Roadmap.md",
			provider: "google",
			identifier: "Ada@Example.com",
			access: "comment",
			line: 3,
		},
	]);

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "ada@example.com",
	}, "Roadmap.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "Ada@Example.com",
	}, "Roadmap.md"), {
		canView: true,
		canComment: true,
		canManage: false,
		rule: rules[0],
	});
});

test("parsePrivatePublishAuthMarkdown scopes rows to contiguous auth tables", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| roadmap.md | google | ada@example.com | view |",
		"",
		"| notes.md | google | ada@example.com | full |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 3,
		},
	]);
});

test("parsePrivatePublishAuthMarkdown requires a complete table separator", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"| path | provider | identifier | access |",
		"| --- |",
		"| roadmap.md | google | ada@example.com | full |",
	].join("\n"));

	assert.deepEqual(rules, []);
});

test("parsePrivatePublishAuthMarkdown ignores tables in fenced code blocks", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"````md",
		"<!--",
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| example.md | google | ada@example.com | full |",
		"-->",
		"```",
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| still-example.md | google | ada@example.com | full |",
		"````",
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| live.md | google | ada@example.com | view |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "live.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 14,
		},
	]);
});

test("parsePrivatePublishAuthMarkdown ignores tables in html comments", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"<!--",
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| commented.md | google | ada@example.com | full |",
		"-->",
		"<!-- | inline.md | google | ada@example.com | full | -->",
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| live.md | google | ada@example.com | view |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "live.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 9,
		},
	]);
});

test("parsePrivatePublishAuthMarkdown ignores tables in indented code blocks", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"    | path | provider | identifier | access |",
		"    | --- | --- | --- | --- |",
		"    | example.md | google | ada@example.com | full |",
		"\t| path | provider | identifier | access |",
		"\t| --- | --- | --- | --- |",
		"\t| tabbed.md | google | ada@example.com | full |",
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| live.md | google | ada@example.com | view |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "live.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 9,
		},
	]);
});

test("parsePrivatePublishAuthMarkdown supports multiple auth tables with reordered columns", () => {
	const rules = parsePrivatePublishAuthMarkdown([
		"| path | provider | identifier | access |",
		"| --- | --- | --- | --- |",
		"| first.md | google | ada@example.com | view |",
		"",
		"| provider | access | path | identifier |",
		"| --- | --- | --- | --- |",
		"| wechat | full | second.md | wx-42 |",
	].join("\n"));

	assert.deepEqual(rules, [
		{
			path: "first.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 3,
		},
		{
			path: "second.md",
			provider: "wechat",
			identifier: "wx-42",
			access: "full",
			line: 7,
		},
	]);
});

test("resolvePrivatePublishPermission matches folder rules on exact folder boundaries", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "investors/",
			provider: "wechat",
			identifier: "wx-42",
			access: "full",
			line: 3,
		},
	];

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "wechat",
		identifier: "wx-42",
	}, "investors/"), {
		canView: true,
		canComment: true,
		canManage: true,
		rule: rules[0],
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "wechat",
		identifier: "wx-42",
	}, "investors/memo.md"), {
		canView: true,
		canComment: true,
		canManage: true,
		rule: rules[0],
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "wechat",
		identifier: "wx-42",
	}, "investors"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "wechat",
		identifier: "wx-42",
	}, "investors-q1.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
});

test("resolvePrivatePublishPermission rejects unsafe request paths", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "secret.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "full",
			line: 3,
		},
	];
	const identity = {
		provider: "google" as const,
		identifier: "ada@example.com",
	};

	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "folder\\..\\secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "folder/../secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "folder/./secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "%2e%2e/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "%252e%252e/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "file:/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "./file:/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "./C:/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "./https:/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "file%3a/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "public/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "p%75blic/secret.md"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
});

test("resolvePrivatePublishPermission keeps file and folder requests distinct", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "investors",
			provider: "google",
			identifier: "ada@example.com",
			access: "full",
			line: 3,
		},
	];
	const identity = {
		provider: "google" as const,
		identifier: "ada@example.com",
	};

	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "investors"), {
		canView: true,
		canComment: true,
		canManage: true,
		rule: rules[0],
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "investors/"), {
		canView: false,
		canComment: false,
		canManage: false,
	});
	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "investors/."), {
		canView: false,
		canComment: false,
		canManage: false,
	});
});

test("resolvePrivatePublishPermission returns cloned matched rules", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 3,
		},
	];
	const identity = {
		provider: "google" as const,
		identifier: "ada@example.com",
	};
	const permission = resolvePrivatePublishPermission(rules, identity, "roadmap.md");
	if (!permission.rule) {
		assert.fail("Expected matched rule");
	}

	permission.rule.access = "full";

	assert.deepEqual(resolvePrivatePublishPermission(rules, identity, "roadmap.md"), {
		canView: true,
		canComment: false,
		canManage: false,
		rule: rules[0],
	});
});

test("resolvePrivatePublishPermission uses the later rule for equal-specificity matches", () => {
	const rules: PrivatePublishAuthRule[] = [
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "view",
			line: 3,
		},
		{
			path: "roadmap.md",
			provider: "google",
			identifier: "ada@example.com",
			access: "full",
			line: 4,
		},
	];

	assert.deepEqual(resolvePrivatePublishPermission(rules, {
		provider: "google",
		identifier: "ada@example.com",
	}, "roadmap.md"), {
		canView: true,
		canComment: true,
		canManage: true,
		rule: rules[1],
	});
});
