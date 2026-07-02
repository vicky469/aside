import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");

test("deleted toolbar mode renders the shared retention notice", () => {
    assert.match(asideViewSource, /getSoftDeleteRetentionMessage/);
    assert.match(asideViewSource, /aside-sidebar-deleted-retention-notice/);
    assert.match(asideViewSource, /isDeletedToolbarMode/);
});
