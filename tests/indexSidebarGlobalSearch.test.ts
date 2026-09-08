import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildIndexSidebarGlobalSearchNotice,
    resolveIndexSidebarGlobalSearchResultLimit,
} from "../src/ui/views/indexSidebarGlobalSearch";

test("global search bounds active Todo and defensive List queries", () => {
    for (const mode of ["todo", "list"] as const) {
        assert.equal(resolveIndexSidebarGlobalSearchResultLimit({
            mode,
            rootFilePath: null,
            query: "design",
        }), 100);
    }
    assert.equal(resolveIndexSidebarGlobalSearchResultLimit({
        mode: "todo",
        rootFilePath: "docs/a.md",
        query: "design",
    }), undefined);
    assert.equal(resolveIndexSidebarGlobalSearchResultLimit({
        mode: "agent",
        rootFilePath: null,
        query: "design",
    }), undefined);
});

test("global search owns its complete-match notice", () => {
    assert.deepEqual(buildIndexSidebarGlobalSearchNotice({
        visibleCount: 100,
        hiddenCount: 37,
        totalCount: 137,
        query: "design",
        rootFilePath: null,
    }), {
        primary: "100 of 137 matches shown.",
        secondary: "Refine your search or select a file.",
    });
    assert.equal(buildIndexSidebarGlobalSearchNotice({
        visibleCount: 137,
        hiddenCount: 0,
        totalCount: 137,
        query: "design",
        rootFilePath: null,
    }), null);
    assert.equal(buildIndexSidebarGlobalSearchNotice({
        visibleCount: 100,
        hiddenCount: 37,
        totalCount: 137,
        query: "design",
        rootFilePath: "docs/a.md",
    }), null);
});
