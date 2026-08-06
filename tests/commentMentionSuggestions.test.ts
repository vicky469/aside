import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildMentionSuggestions,
    findOpenMentionQuery,
    replaceOpenMentionQuery,
} from "../src/ui/editor/commentMentionSuggestions";

const cleanLinksScript = {
    path: "🛠️ scripts/clean-links.mjs",
    fileName: "clean-links.mjs",
    mentionName: "clean-links",
    normalizedMentionName: "clean-links",
};

test("findOpenMentionQuery finds a collapsed cursor immediately after /", () => {
    assert.deepEqual(findOpenMentionQuery("/", 1, 1), {
        start: 0,
        end: 1,
        query: "",
        trigger: "/",
    });
});

test("findOpenMentionQuery finds an existing query at a whitespace boundary", () => {
    assert.deepEqual(findOpenMentionQuery("please /cle now", 11, 11), {
        start: 7,
        end: 11,
        query: "cle",
        trigger: "/",
    });
    assert.equal(findOpenMentionQuery("email@cle", 9, 9), null);
    assert.equal(findOpenMentionQuery("please @cle now", 11, 12), null);
    assert.equal(findOpenMentionQuery("please / cle now", 12, 12), null);
});

test("replaceOpenMentionQuery preserves surrounding text", () => {
    const query = findOpenMentionQuery("please /cle now", 11, 11);
    assert.ok(query);

    assert.deepEqual(replaceOpenMentionQuery("please /cle now", query, "/clean-links"), {
        value: "please /clean-links now",
        selectionStart: 19,
        selectionEnd: 19,
    });
});

test("buildMentionSuggestions matches case-insensitively and ranks exact before prefix before substring", () => {
    const scripts = [
        cleanLinksScript,
        {
            path: "🛠️ scripts/reclean.mjs",
            fileName: "reclean.mjs",
            mentionName: "reclean",
            normalizedMentionName: "reclean",
        },
        {
            path: "🛠️ scripts/cl.mjs",
            fileName: "cl.mjs",
            mentionName: "cl",
            normalizedMentionName: "cl",
        },
    ];

    assert.deepEqual(
        buildMentionSuggestions(scripts, "/CL").map((item) => item.mention),
        ["/cl", "/clean-links", "/reclean"],
    );
});

test("buildMentionSuggestions keeps todo and supported agents before live scripts", () => {
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "").map((item) => item.mention),
        ["@todo", "@codex", "@claude", "/clean-links"],
    );
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "cl").map((item) => item.mention),
        ["@claude", "/clean-links"],
    );
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "/cl").map((item) => item.mention),
        ["/clean-links"],
    );
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "@cl").map((item) => item.mention),
        ["@todo", "@codex", "@claude"],
    );
});

test("buildMentionSuggestions omits scripts whose normalized mentions are reserved", () => {
    const scripts = [
        cleanLinksScript,
        {
            path: "🛠️ scripts/ToDo.mjs",
            fileName: "ToDo.mjs",
            mentionName: "ToDo",
            normalizedMentionName: "todo",
        },
        {
            path: "🛠️ scripts/CODEX.js",
            fileName: "CODEX.js",
            mentionName: "CODEX",
            normalizedMentionName: "codex",
        },
        {
            path: "🛠️ scripts/Claude.cjs",
            fileName: "Claude.cjs",
            mentionName: "Claude",
            normalizedMentionName: "claude",
        },
    ];

    assert.deepEqual(
        buildMentionSuggestions(scripts, "").map((item) => item.mention),
        ["@todo", "@codex", "@claude", "/clean-links"],
    );
});
