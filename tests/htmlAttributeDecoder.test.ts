import * as assert from "node:assert/strict";
import test from "node:test";
import { decodeHtmlAttributeReferences } from "../src/core/publish/htmlAttributeDecoder";

test("HTML attribute decoder handles named and numeric references without a DOM", () => {
	assert.equal(
		decodeHtmlAttributeReferences("a&amp;b&#47;c&sol;d&colon;e&quot;f&apos;g"),
		"a&b/c/d:e\"f'g",
	);
	assert.equal(
		decodeHtmlAttributeReferences("&#x1f680;&#128;&#0;&#xD800;&#x110000;"),
		"🚀€���",
	);
});

test("HTML attribute decoder leaves unknown and ambiguous names unchanged", () => {
	assert.equal(decodeHtmlAttributeReferences("a&unknown;b&copy=1&amp=2"), "a&unknown;b&copy=1&amp=2");
});

test("HTML attribute decoder prefers an available native attribute parser", () => {
	const calls: string[] = [];
	assert.equal(decodeHtmlAttributeReferences("&colon;", (value) => {
		calls.push(value);
		return "native";
	}), "native");
	assert.deepEqual(calls, ["&colon;"]);
});

test("HTML attribute decoder falls back when no native parser is available", () => {
	assert.equal(decodeHtmlAttributeReferences("a&amp;b", () => null), "a&b");
});
