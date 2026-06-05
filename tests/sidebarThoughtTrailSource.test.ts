import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getDefaultThoughtTrailSource,
    normalizeThoughtTrailSource,
    resolveAvailableThoughtTrailSource,
} from "../src/ui/views/sidebarThoughtTrailSource";

test("getDefaultThoughtTrailSource starts fresh views from wikilinks", () => {
    assert.equal(getDefaultThoughtTrailSource(), "wikilinks");
});

test("normalizeThoughtTrailSource accepts only supported sources", () => {
    assert.equal(normalizeThoughtTrailSource("wikilinks"), "wikilinks");
    assert.equal(normalizeThoughtTrailSource("tags"), "tags");
    assert.equal(normalizeThoughtTrailSource("links"), null);
    assert.equal(normalizeThoughtTrailSource(undefined), null);
});

test("resolveAvailableThoughtTrailSource falls back to wikilinks when tag graph is unavailable", () => {
    assert.equal(resolveAvailableThoughtTrailSource("tags", false), "wikilinks");
    assert.equal(resolveAvailableThoughtTrailSource("tags", true), "tags");
    assert.equal(resolveAvailableThoughtTrailSource("wikilinks", false), "wikilinks");
});
