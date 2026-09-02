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

test("source availability disables empty sources when another source has results", () => {
    const tagsOnly = { wikilinks: false, tags: true, attachments: false };

    assert.equal(isThoughtTrailSourceAvailable("wikilinks", tagsOnly), false);
    assert.equal(isThoughtTrailSourceAvailable("tags", tagsOnly), true);
    assert.equal(isThoughtTrailSourceAvailable("attachments", tagsOnly), false);
});

test("all-empty availability keeps only wikilinks enabled", () => {
    const empty = { wikilinks: false, tags: false, attachments: false };

    assert.equal(isThoughtTrailSourceAvailable("wikilinks", empty), true);
    assert.equal(isThoughtTrailSourceAvailable("tags", empty), false);
    assert.equal(isThoughtTrailSourceAvailable("attachments", empty), false);
});

test("source resolution uses populated priority and preserves an available selection", () => {
    assert.equal(
        resolveAvailableThoughtTrailSource("wikilinks", { wikilinks: false, tags: true, attachments: true }),
        "tags",
    );
    assert.equal(
        resolveAvailableThoughtTrailSource("wikilinks", { wikilinks: false, tags: false, attachments: true }),
        "attachments",
    );
    assert.equal(
        resolveAvailableThoughtTrailSource("attachments", { wikilinks: true, tags: true, attachments: true }),
        "attachments",
    );
    assert.equal(
        resolveAvailableThoughtTrailSource("tags", { wikilinks: true, tags: false, attachments: true }),
        "wikilinks",
    );
    assert.equal(
        resolveAvailableThoughtTrailSource("attachments", { wikilinks: false, tags: false, attachments: false }),
        "wikilinks",
    );
});

test("getDefaultThoughtTrailSource starts fresh views from wikilinks", () => {
    assert.equal(getDefaultThoughtTrailSource(), "wikilinks");
});

test("normalizeThoughtTrailSource preserves the deprecated nullable contract", () => {
    for (const definition of SIDEBAR_THOUGHT_TRAIL_SOURCES) {
        assert.equal(normalizeThoughtTrailSource(definition.id), definition.id);
    }
    assert.equal(normalizeThoughtTrailSource("links"), null);
    assert.equal(normalizeThoughtTrailSource(undefined), null);
    assert.equal(normalizeThoughtTrailSource("invalid"), null);
});

test("resolveAvailableThoughtTrailSource falls back to wikilinks when every source is empty", () => {
    assert.equal(
        resolveAvailableThoughtTrailSource("tags", { wikilinks: false, tags: false, attachments: false }),
        "wikilinks",
    );
    assert.equal(
        resolveAvailableThoughtTrailSource("tags", { wikilinks: false, tags: true, attachments: false }),
        "tags",
    );
    assert.equal(
        resolveAvailableThoughtTrailSource("wikilinks", { wikilinks: false, tags: false, attachments: false }),
        "wikilinks",
    );
});

test("does not treat ambiguous boolean availability as attachment availability", () => {
    assert.equal(resolveAvailableThoughtTrailSource("attachments", true as never), "wikilinks");
});
