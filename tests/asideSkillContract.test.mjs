import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skill = await readFile(new URL("../skills/aside/SKILL.md", import.meta.url), "utf8");
const words = skill.trim().split(/\s+/u).filter(Boolean);

test("bundled Aside skill stays concise", () => {
    assert.ok(words.length <= 500, `Expected at most 500 words, found ${words.length}`);
});

test("bundled Aside skill retains its essential write-safety contract", () => {
    assert.match(skill, /obsidian:\/\/aside-comment/);
    assert.match(skill, /comment id/i);
    assert.match(skill, /current persisted side note data/i);
    assert.match(skill, /--hidden/);
    assert.match(skill, /Preserve existing entries/i);
    assert.match(skill, /aside-annotations/);
    assert.match(skill, /Do not hand-edit Aside JSON/i);
    assert.match(skill, /reply-based, not capability-limited/i);
    assert.match(skill, /Do not claim.*unless/i);
    assert.match(skill, /<=250 words/);
});

test("bundled Aside skill treats written artifacts as public", () => {
    assert.match(skill, /tracked content and commit history as public/i);
    assert.match(skill, /code, documentation, plans, tests, examples, logs, and release notes/i);
    assert.match(skill, /\/path\/to\/vault/u);
    assert.match(skill, /Never print or persist secrets/i);
    assert.match(skill, /scan the diff and staged content/i);
});
