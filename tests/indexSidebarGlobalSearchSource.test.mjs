import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dormant global search starts with the future-experience todo", () => {
    const source = readFileSync("src/ui/views/indexSidebarGlobalSearch.ts", "utf8");
    assert.match(
        source,
        /^\/\/ @todo Revisit unscoped global Index search after designing a dedicated global-search experience\.\n\/\/ The active product path requires a selected file; this module is a defensive fallback only\./,
    );
});
