import * as assert from "node:assert/strict";
import test from "node:test";
import {
	readAsidePublishFrontmatter,
	writeAsidePublishFrontmatter,
} from "../src/core/publish/publishFrontmatter";

test("readAsidePublishFrontmatter defaults to unpublished with inferred html", () => {
	assert.deepEqual(readAsidePublishFrontmatter("# Page\n"), {
		markdownEnabled: false,
		htmlEnabled: false,
		html: null,
	});
});

test("readAsidePublishFrontmatter parses managed aside publish fields", () => {
	assert.deepEqual(readAsidePublishFrontmatter([
		"---",
		"title: Page",
		"asidePublish:",
		"  htmlEnabled: true",
		"  markdownEnabled: false",
		"  html: public/page.html",
		"---",
		"# Page",
	].join("\n")), {
		markdownEnabled: false,
		htmlEnabled: true,
		html: "public/page.html",
	});
});

test("writeAsidePublishFrontmatter creates a managed block without changing body", () => {
	assert.equal(writeAsidePublishFrontmatter("# Page\n", {
		markdownEnabled: false,
		htmlEnabled: true,
		html: "public/page.html",
	}), [
		"---",
		"asidePublish:",
		"  markdownEnabled: false",
		"  htmlEnabled: true",
		"  html: public/page.html",
		"---",
		"# Page",
		"",
	].join("\n"));
});

test("writeAsidePublishFrontmatter updates existing managed block", () => {
	const input = [
		"---",
		"title: Page",
		"asidePublish:",
		"  enabled: true",
		"  html: public/page.html",
		"tags:",
		"  - public",
		"---",
		"# Page",
	].join("\n");

	assert.equal(writeAsidePublishFrontmatter(input, {
		markdownEnabled: true,
		htmlEnabled: false,
		html: "public/page.html",
	}), [
		"---",
		"title: Page",
		"tags:",
		"  - public",
		"asidePublish:",
		"  markdownEnabled: true",
		"  htmlEnabled: false",
		"  html: public/page.html",
		"---",
		"# Page",
	].join("\n"));
});

test("readAsidePublishFrontmatter maps legacy enabled into htmlEnabled", () => {
	assert.deepEqual(readAsidePublishFrontmatter([
		"---",
		"title: Page",
		"asidePublish:",
		"  enabled: true",
		"  html: public/page.html",
		"---",
		"# Page",
	].join("\n")), {
		markdownEnabled: false,
		htmlEnabled: true,
		html: "public/page.html",
	});
});
