import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    buildTagSuggestions,
    getTagSuggestionPresentation,
} from "../src/ui/editor/commentTagSuggestions";

test("tag suggestions ignore case and hyphens", () => {
    const suggestions = buildTagSuggestions({
        query: "AnApple",
        vaultTags: [{ tag: "#an-apple", usageCount: 3 }],
    });

    assert.deepEqual(suggestions[0], { type: "existing", tag: "#an-apple" });
});

test("tag suggestions rank exact prefix segment and substring matches", () => {
    const suggestions = buildTagSuggestions({
        query: "project",
        vaultTags: [
            { tag: "#my-project-notes", usageCount: 99 },
            { tag: "#beta/project", usageCount: 2 },
            { tag: "#project/alpha", usageCount: 1 },
            { tag: "#project", usageCount: 1 },
        ],
    }).filter((suggestion) => suggestion.type === "existing");

    assert.deepEqual(suggestions.map((suggestion) => suggestion.tag), [
        "#project",
        "#project/alpha",
        "#beta/project",
        "#my-project-notes",
    ]);
});

test("tag suggestions tolerate bounded common typos", () => {
    const cases = [
        ["projct", "#project"],
        ["projecct", "#project"],
        ["projevt", "#project"],
        ["proejct", "#project"],
        ["architectuer", "#architecture"],
    ] as const;
    const vaultTags = [
        { tag: "#project", usageCount: 1 },
        { tag: "#architecture", usageCount: 1 },
    ];

    for (const [query, expected] of cases) {
        const first = buildTagSuggestions({ query, vaultTags })
            .find((suggestion) => suggestion.type === "existing");
        assert.equal(first?.tag, expected, query);
    }
});

test("tag suggestions suppress fuzzy noise below four characters", () => {
    const suggestions = buildTagSuggestions({
        query: "prj",
        vaultTags: [{ tag: "#project", usageCount: 100 }],
    });

    assert.equal(suggestions.some((suggestion) => suggestion.type === "existing"), false);
});

test("tag suggestions use hidden usage only after textual relevance", () => {
    const suggestions = buildTagSuggestions({
        query: "proj",
        vaultTags: [
            { tag: "#project-zeta", usageCount: 1 },
            { tag: "#project-beta", usageCount: 8 },
            { tag: "#xproj", usageCount: 100 },
        ],
    }).filter((suggestion) => suggestion.type === "existing");

    assert.deepEqual(suggestions.map((suggestion) => suggestion.tag), [
        "#project-beta",
        "#project-zeta",
        "#xproj",
    ]);
});

test("tag suggestions use tag text as the deterministic final tie-breaker", () => {
    const suggestions = buildTagSuggestions({
        query: "proj",
        vaultTags: [
            { tag: "#project-zeta", usageCount: 1 },
            { tag: "#project-beta", usageCount: 1 },
        ],
    }).filter((suggestion) => suggestion.type === "existing");

    assert.deepEqual(suggestions.map((suggestion) => suggestion.tag), [
        "#project-beta",
        "#project-zeta",
    ]);
});

test("tag suggestions deduplicate canonical variants and create only new tags", () => {
    const existing = buildTagSuggestions({
        query: "ANAPPLE",
        vaultTags: [{ tag: "#an-apple", usageCount: 2 }],
        extraTags: ["#An-Apple"],
    });

    assert.equal(existing.filter((item) => item.type === "existing").length, 1);
    assert.equal(existing.some((item) => item.type === "create"), false);
    assert.deepEqual(
        buildTagSuggestions({ query: "fresh-tag", vaultTags: [] })[0],
        { type: "create", tag: "#fresh-tag" },
    );
});

test("tag presentation hides usage and keeps create guidance", () => {
    assert.deepEqual(
        getTagSuggestionPresentation({ type: "existing", tag: "#project" }),
        { title: "#project" },
    );
    assert.deepEqual(
        getTagSuggestionPresentation({ type: "create", tag: "#fresh" }),
        { title: "Create tag: #fresh", note: "Insert this new tag into the comment." },
    );
});

test("tag modal delegates ranking and hides usage detail", () => {
    const source = readFileSync("src/ui/modals/SideNoteTagSuggestModal.ts", "utf8");

    assert.match(source, /buildTagSuggestions\(/u);
    assert.match(source, /getTagSuggestionPresentation\(/u);
    assert.doesNotMatch(source, /Used once|usageCount\s*===|function getMatchScore/u);
});
