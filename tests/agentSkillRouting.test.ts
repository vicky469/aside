import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestedAgentRunSkills } from "../src/core/agents/agentSkillRouting";

test("resolveRequestedAgentRunSkills requests the Excalidraw subskill for drawing work", () => {
    assert.deepEqual(
        resolveRequestedAgentRunSkills({
            filePath: "Excalidraw/Drawing 2026-07-23 12.57.34.excalidraw.md",
            promptText: "@codex create some arts in excalidraw",
        }),
        [{ name: "obsidian-excalidraw", source: "requested" }],
    );
    assert.deepEqual(
        resolveRequestedAgentRunSkills({
            filePath: "Notes/Prompt.md",
            promptText: "@codex write an ExcalidrawAutomate script",
        }),
        [{ name: "obsidian-excalidraw", source: "requested" }],
    );
});

test("resolveRequestedAgentRunSkills requests the canvas design subskill for canvas boards", () => {
    assert.deepEqual(
        resolveRequestedAgentRunSkills({
            filePath: "Maps/Strategy.canvas",
            promptText: "@codex clean up this board",
        }),
        [{ name: "canvas-design", source: "requested" }],
    );
    assert.deepEqual(
        resolveRequestedAgentRunSkills({
            filePath: "Notes/Prompt.md",
            promptText: "@codex make this into an Obsidian canvas map",
        }),
        [{ name: "canvas-design", source: "requested" }],
    );
});

test("resolveRequestedAgentRunSkills leaves ordinary notes without requested subskills", () => {
    assert.deepEqual(
        resolveRequestedAgentRunSkills({
            filePath: "Folder/Note.md",
            promptText: "@codex review this note",
        }),
        [],
    );
});
