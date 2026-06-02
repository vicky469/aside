import assert from "node:assert/strict";
import test from "node:test";
import sideNotePromptPolicy from "../shared/sideNotePromptPolicy.js";

test("buildSideNotePrompt applies the provided root label and path", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex generate a math diagram",
        rootLabel: "workspace root",
        rootPath: "/vault",
    });

    assert.match(prompt, /Attachments\/` at the active workspace root/i);
    assert.match(prompt, /The active workspace root is: \/vault/);
});

test("buildSideNotePrompt falls back cleanly when no root path is provided", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex explain this",
        rootLabel: "vault root",
    });

    assert.match(prompt, /Attachments\/` at the active vault root/i);
    assert.doesNotMatch(prompt, /The active vault root is:/);
});

test("buildSideNotePrompt carries built-in Aside write-mode terminology", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex add side comments for each point",
        rootLabel: "vault root",
        rootPath: "/vault",
    });

    assert.match(prompt, /Use the built-in Aside workflow/i);
    assert.match(prompt, /side note and side comment both mean an Aside thread or entry/i);
    assert.match(prompt, /A page note is scoped to the current markdown page/i);
    assert.match(prompt, /in-note agent requests default to write mode/i);
    assert.match(prompt, /@codex, @claude, or future agent directives/i);
    assert.match(prompt, /Do not claim that side notes were added, updated, or resolved unless you actually made the change/i);
});
