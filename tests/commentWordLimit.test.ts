import * as assert from "node:assert/strict";
import test from "node:test";
import { MAX_SIDENOTE_WORDS, countCommentWords, exceedsCommentWordLimit } from "../src/core/text/commentWordLimit";

test("comment word limit is 200 words", () => {
    assert.equal(MAX_SIDENOTE_WORDS, 200);
});

test("exceedsCommentWordLimit allows 200 words and rejects 201", () => {
    const withinLimit = Array.from({ length: 200 }, (_, index) => `word${index}`).join(" ");
    const overLimit = `${withinLimit} extra`;

    assert.equal(countCommentWords(withinLimit), 200);
    assert.equal(exceedsCommentWordLimit(withinLimit), false);
    assert.equal(countCommentWords(overLimit), 201);
    assert.equal(exceedsCommentWordLimit(overLimit), true);
});
