import * as assert from "node:assert/strict";
import test from "node:test";
import {
    canonicalizeTagSearchText,
    rankExistingTags,
} from "../src/core/text/tagSearch";

test("rankExistingTags returns no suggestions before typing", () => {
    assert.deepEqual(
        rankExistingTags({
            query: "",
            tags: [{ tag: "#project", usageCount: 2 }],
        }),
        [],
    );
    assert.deepEqual(
        rankExistingTags({
            query: "  #  ",
            tags: [{ tag: "#project", usageCount: 2 }],
        }),
        [],
    );
});

test("rankExistingTags can preserve the editor's empty-query suggestions", () => {
    assert.deepEqual(
        rankExistingTags({
            query: "",
            tags: [
                { tag: "#zeta", usageCount: 1 },
                { tag: "#alpha", usageCount: 2 },
            ],
            includeAllWhenEmpty: true,
        }).map((entry) => entry.tag),
        ["#alpha", "#zeta"],
    );
});

test("rankExistingTags ranks exact prefix segment substring and typo matches", () => {
    const result = rankExistingTags({
        query: "project",
        tags: [
            { tag: "#my-project-notes", usageCount: 99 },
            { tag: "#beta/project", usageCount: 2 },
            { tag: "#project/alpha", usageCount: 1 },
            { tag: "#project", usageCount: 1 },
            { tag: "#projcet", usageCount: 1 },
        ],
    });

    assert.deepEqual(result.map((entry) => entry.tag), [
        "#project",
        "#project/alpha",
        "#beta/project",
        "#my-project-notes",
        "#projcet",
    ]);
});

test("rankExistingTags suppresses fuzzy noise below four characters", () => {
    assert.deepEqual(
        rankExistingTags({
            query: "prj",
            tags: [{ tag: "#project", usageCount: 100 }],
        }),
        [],
    );
});

test("rankExistingTags uses usage only after textual relevance", () => {
    const result = rankExistingTags({
        query: "proj",
        tags: [
            { tag: "#project-zeta", usageCount: 1 },
            { tag: "#project-beta", usageCount: 8 },
            { tag: "#xproj", usageCount: 100 },
        ],
    });

    assert.deepEqual(result.map((entry) => entry.tag), [
        "#project-beta",
        "#project-zeta",
        "#xproj",
    ]);
});

test("rankExistingTags deduplicates canonical variants and returns snapshots", () => {
    const tags = [
        { tag: "#an-apple", usageCount: 2 },
        { tag: "#An-Apple", usageCount: 3 },
    ];
    const result = rankExistingTags({ query: "anapple", tags });

    assert.deepEqual(result, [{
        tag: "#an-apple",
        tagKey: "anapple",
        usageCount: 5,
    }]);
    result[0].tag = "#changed";
    assert.equal(rankExistingTags({ query: "anapple", tags })[0].tag, "#an-apple");
});

test("rankExistingTags applies a deterministic default limit", () => {
    const tags = Array.from({ length: 45 }, (_, index) => ({
        tag: `#project-${String(index).padStart(2, "0")}`,
        usageCount: 1,
    }));

    const result = rankExistingTags({ query: "project", tags });

    assert.equal(result.length, 40);
    assert.equal(result[0].tag, "#project-00");
    assert.equal(result.at(-1)?.tag, "#project-39");
});

test("canonicalizeTagSearchText ignores leading hashes case and hyphens", () => {
    assert.equal(canonicalizeTagSearchText(" ##An-Apple "), "anapple");
});
