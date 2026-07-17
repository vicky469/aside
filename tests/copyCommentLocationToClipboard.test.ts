import * as assert from "node:assert/strict";
import test from "node:test";
import { copyCommentLocationToClipboard } from "../src/ui/copyCommentLocationToClipboard";

test("copyCommentLocationToClipboard writes the exact encoded Aside URI", async () => {
    const writes: string[] = [];
    const copied = await copyCommentLocationToClipboard(
        "dev vault",
        { filePath: "Folder/My Note.md", id: "comment 1" },
        async (text) => {
            writes.push(text);
            return true;
        },
    );

    assert.equal(copied, true);
    assert.deepEqual(writes, [
        "obsidian://aside-comment?vault=dev%20vault&file=Folder%2FMy%20Note.md&commentId=comment%201",
    ]);
});

test("copyCommentLocationToClipboard returns writer failure", async () => {
    assert.equal(await copyCommentLocationToClipboard(
        "vault",
        { filePath: "Note.md", id: "comment" },
        async () => false,
    ), false);
});
