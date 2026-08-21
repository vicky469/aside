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
    assert.match(prompt, /explicit in-note agent directive/i);
    assert.doesNotMatch(prompt, /@codex, @claude, or future agent directives/i);
    assert.match(prompt, /create, append, or update Aside side notes/i);
    assert.match(prompt, /side notes were added or updated/i);
    assert.doesNotMatch(prompt, /\b(?:resolve|resolved|archive|archived)\b/i);
});

test("buildSideNotePrompt maps annotation requests to selection-anchored notes", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex 你看看这篇有哪里可以改进的。你可以加批注",
        rootLabel: "vault root",
        rootPath: "/vault",
    });

    assert.match(prompt, /add annotations/i);
    assert.match(prompt, /加批注/);
    assert.match(prompt, /selection-anchored Aside notes/i);
    assert.match(prompt, /Do not satisfy annotation requests with only a summary/i);
    assert.match(prompt, /could not create the anchored notes/i);
});

test("buildSideNotePrompt tells annotation agents to return plugin-owned annotation proposals", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex 给这篇加批注",
        rootLabel: "vault root",
        rootPath: "/vault",
    });

    assert.match(prompt, /aside-annotations/);
    assert.match(prompt, /exact source text/i);
    assert.match(prompt, /Aside will create the anchored notes/i);
});

test("buildSideNotePrompt keeps reusable scripts in the active vault script folder", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex create a reusable script",
        rootLabel: "vault root",
        rootPath: "/vault",
    });

    assert.match(prompt, /active vault(?:'s)? `🛠️ scripts\/`/i);
    assert.match(prompt, /not (?:in )?the plugin repository's internal `scripts\/`/i);
});

test("buildSideNotePrompt gives every script-authoring path one shared test-folder rule", () => {
    const prompts = [
        sideNotePromptPolicy.buildSideNotePrompt({
            promptText: "@codex add tests for a vault script",
            rootLabel: "vault root",
            rootPath: "/vault",
        }),
        sideNotePromptPolicy.buildSideNotePrompt({
            promptText: "build a cleaner and tests",
            rootLabel: "vault root",
            rootPath: "/vault",
            requestKind: "create-script",
        }),
        sideNotePromptPolicy.buildSideNotePrompt({
            promptText: "add regression tests",
            rootLabel: "vault root",
            rootPath: "/vault",
            requestKind: "update-script",
            targetScriptPath: "🛠️ scripts/embed-image-urls.mjs",
        }),
    ];

    for (const prompt of prompts) {
        assert.match(prompt, /`🛠️ scripts\/tests\/`/u);
        assert.match(prompt, /create that folder if needed/iu);
        assert.match(
            prompt,
            /do not place `\.test\.\*` or `\.spec\.\*` files directly under `🛠️ scripts\/`/iu,
        );
        assert.equal(prompt.match(/`🛠️ scripts\/tests\/`/gu)?.length, 1);
    }
});

test("buildSideNotePrompt adds the shared create-script contract only for create-script runs", () => {
    const createPrompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "build a cleaner",
        rootLabel: "vault root",
        rootPath: "/vault",
        requestKind: "create-script",
    });
    assert.match(createPrompt, /first positional argument/i);
    assert.match(createPrompt, /standard output/i);
    assert.match(createPrompt, /\/script-name/i);

    const ordinaryPrompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "explain this",
        rootLabel: "vault root",
        rootPath: "/vault",
    });
    assert.doesNotMatch(ordinaryPrompt, /first positional argument/i);
});

test("buildSideNotePrompt adds one exact in-place update-script contract", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "make the default size reasonable",
        rootLabel: "vault root",
        rootPath: "/vault",
        requestKind: "update-script",
        targetScriptPath: "🛠️ scripts/embed-image-urls.mjs",
    });

    assert.match(prompt, /modify `🛠️ scripts\/embed-image-urls\.mjs` in place/is);
    assert.match(prompt, /do not rename/is);
    assert.match(prompt, /do not rename[\s\S]*unrelated vault files/is);
    assert.match(prompt, /\/script-name invocation/is);
});
