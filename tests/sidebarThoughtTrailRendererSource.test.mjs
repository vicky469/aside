import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/ui/views/sidebarThoughtTrailRenderer.ts", "utf8");

test("tag related files render as a semantic list with non-clickable current file", () => {
    assert.match(
        source,
        /createEl\("ul",\s*\{\s*cls:\s*"aside-tag-related-files"/,
        "root tag related files container should be a list",
    );
    assert.match(
        source,
        /createEl\("li",\s*\{\s*cls:\s*"aside-tag-related-file-row aside-tag-related-file-row--current"/,
        "current file should be rendered as a non-button list row",
    );
    assert.match(
        source,
        /createEl\("li",\s*\{\s*cls:\s*"aside-tag-related-files-group"/,
        "each tag group should be a list row",
    );
    assert.match(
        source,
        /createEl\("ul",\s*\{\s*cls:\s*"aside-tag-related-files-list"/,
        "related files inside a tag group should be a nested list",
    );
    assert.match(
        source,
        /createEl\("li",\s*\{\s*cls:\s*"aside-tag-related-file-row"/,
        "each related file should be a list row",
    );
    assert.match(
        source,
        /createEl\("button",\s*\{\s*cls:\s*"aside-tag-related-file-link"/,
        "clickable related files should be text-like controls inside list rows",
    );
    assert.doesNotMatch(
        source,
        /cls:\s*"aside-tag-related-file-item"/,
        "tag related files should not use the old card-like item class",
    );
});
