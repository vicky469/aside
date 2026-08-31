import * as assert from "node:assert/strict";
import test from "node:test";
import {
    SIDEBAR_THOUGHT_TRAIL_SOURCES,
    getDefaultSidebarThoughtTrailSource,
    getDefaultThoughtTrailSource,
    getThoughtTrailSourceDefinition,
    isThoughtTrailSourceAvailable,
    normalizeSidebarThoughtTrailSource,
    normalizeThoughtTrailSource,
    resolveAvailableThoughtTrailSource,
} from "../src/ui/views/sidebarThoughtTrailSource";

test("defines wikilinks, tags, and attachments in the supported order", () => {
    assert.deepEqual(SIDEBAR_THOUGHT_TRAIL_SOURCES, [
        { id: "wikilinks", label: "Wikilinks", scope: "Vault" },
        { id: "tags", label: "Tags", scope: "Vault" },
        { id: "attachments", label: "Attachments", scope: "File" },
    ]);
});

test("getDefaultSidebarThoughtTrailSource starts from wikilinks", () => {
    assert.equal(getDefaultSidebarThoughtTrailSource(), "wikilinks");
});

test("normalizeSidebarThoughtTrailSource accepts all sources and defaults invalid values", () => {
    for (const definition of SIDEBAR_THOUGHT_TRAIL_SOURCES) {
        assert.equal(normalizeSidebarThoughtTrailSource(definition.id), definition.id);
    }
    assert.equal(normalizeSidebarThoughtTrailSource("links"), "wikilinks");
    assert.equal(normalizeSidebarThoughtTrailSource(undefined), "wikilinks");
});

test("source definitions can be looked up by source", () => {
    assert.deepEqual(getThoughtTrailSourceDefinition("attachments"), {
        id: "attachments",
        label: "Attachments",
        scope: "File",
    });
});

test("availability independently controls tags and attachments", () => {
    const availability = { tags: false, attachments: true };

    assert.equal(isThoughtTrailSourceAvailable("wikilinks", availability), true);
    assert.equal(isThoughtTrailSourceAvailable("tags", availability), false);
    assert.equal(isThoughtTrailSourceAvailable("attachments", availability), true);
    assert.equal(resolveAvailableThoughtTrailSource("tags", availability), "wikilinks");
    assert.equal(resolveAvailableThoughtTrailSource("attachments", availability), "attachments");

    assert.equal(isThoughtTrailSourceAvailable("tags", { tags: true, attachments: false }), true);
    assert.equal(isThoughtTrailSourceAvailable("attachments", { tags: true, attachments: false }), false);
    assert.equal(resolveAvailableThoughtTrailSource("attachments", { tags: true, attachments: false }), "wikilinks");
    assert.equal(resolveAvailableThoughtTrailSource("wikilinks", { tags: false, attachments: false }), "wikilinks");
});

test("getDefaultThoughtTrailSource starts fresh views from wikilinks", () => {
    assert.equal(getDefaultThoughtTrailSource(), "wikilinks");
});

test("normalizeThoughtTrailSource delegates to the supported source policy", () => {
    for (const definition of SIDEBAR_THOUGHT_TRAIL_SOURCES) {
        assert.equal(normalizeThoughtTrailSource(definition.id), definition.id);
    }
    assert.equal(normalizeThoughtTrailSource("links"), "wikilinks");
    assert.equal(normalizeThoughtTrailSource(undefined), "wikilinks");
});

test("resolveAvailableThoughtTrailSource falls back to wikilinks when tag graph is unavailable", () => {
    assert.equal(resolveAvailableThoughtTrailSource("tags", { tags: false, attachments: false }), "wikilinks");
    assert.equal(resolveAvailableThoughtTrailSource("tags", { tags: true, attachments: false }), "tags");
    assert.equal(resolveAvailableThoughtTrailSource("wikilinks", { tags: false, attachments: false }), "wikilinks");
});

test("does not treat ambiguous boolean availability as attachment availability", () => {
    assert.equal(resolveAvailableThoughtTrailSource("attachments", true as never), "wikilinks");
});
