import * as assert from "node:assert/strict";
import test from "node:test";
import { MAX_SIDENOTE_WORDS, countCommentWords, exceedsCommentWordLimit } from "../src/core/text/commentWordLimit";

test("comment word limit is 120 words", () => {
    assert.equal(MAX_SIDENOTE_WORDS, 120);
});

test("exceedsCommentWordLimit allows 120 words and rejects 121", () => {
    const withinLimit = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ");
    const overLimit = `${withinLimit} extra`;

    assert.equal(countCommentWords(withinLimit), 120);
    assert.equal(exceedsCommentWordLimit(withinLimit), false);
    assert.equal(countCommentWords(overLimit), 121);
    assert.equal(exceedsCommentWordLimit(overLimit), true);
});
