import * as assert from "node:assert/strict";
import test from "node:test";
import { retargetPathInFolder } from "../src/core/files/pathScope";

test("retargetPathInFolder maps descendants once without matching sibling prefixes", () => {
    assert.equal(
        retargetPathInFolder("Drafts/nested/note.md", "Drafts", "Published"),
        "Published/nested/note.md",
    );
    assert.equal(retargetPathInFolder("Draftsness/note.md", "Drafts", "Published"), null);
    assert.equal(retargetPathInFolder("Drafts", "Drafts", "Published"), null);
});
