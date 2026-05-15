import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("comment persistence startup scans use the commentable file policy", () => {
    const source = readFileSync("src/comments/commentPersistenceController.ts", "utf8");

    assert.equal(
        source.includes(".filter((file) => !this.host.isAllCommentsNotePath(file.path))"),
        false,
    );
});
