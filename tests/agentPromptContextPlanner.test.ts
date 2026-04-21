import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment, type CommentThread } from "../src/commentManager";
import { buildAgentPromptContext } from "../src/control/agentPromptContextPlanner";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "Alpha",
        selectedTextHash: overrides.selectedTextHash ?? "hash:alpha",
        comment: overrides.comment ?? "@codex explain this",
        timestamp: overrides.timestamp ?? 10,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

function createThread(overrides: Partial<Comment> = {}): CommentThread {
    return commentToThread(createComment(overrides));
}

test("buildAgentPromptContext uses anchor scope for selection threads and includes transcript plus headings", () => {
    const thread = {
        ...createThread({
            anchorKind: "selection",
            startLine: 5,
            selectedText: "Important API contract",
            comment: "Please summarize the current contract.",
        }),
        entries: [
            {
                id: "thread-1",
                body: "Please summarize the current contract.",
                timestamp: 10,
            },
            {
                id: "entry-2",
                body: "Old answer from Codex.",
                timestamp: 11,
            },
            {
                id: "entry-3",
                body: "@codex update this with the latest thread context.",
                timestamp: 12,
            },
        ],
    };

    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: [
            "# Project",
            "",
            "Intro text",
            "",
            "## APIs",
            "",
            "Important API contract",
            "Supporting detail",
            "",
            "## Later",
            "",
            "Ignore this later section body.",
        ].join("\n"),
        thread,
        triggerEntryId: "entry-3",
        fallbackPromptText: "@codex fallback",
        threadAgentRuns: [{
            requestedAgent: "codex",
            outputEntryId: "entry-2",
        }],
    });

    assert.equal(context.scope, "anchor");
    assert.match(context.promptText, /Note path: Folder\/Note\.md/);
    assert.match(context.promptText, /Scope: anchor/);
    assert.match(context.promptText, /Anchor:\n<<<\nImportant API contract\n>>>/);
    assert.match(context.promptText, /Headings: # Project \| ## APIs \| ## Later/);
    assert.match(context.promptText, /Thread:\n- You: Please summarize the current contract\.\n- Codex: Old answer from Codex\.\n- You \(current\): @codex update this with the latest thread context\./);
    assert.match(context.promptText, /Request:\n<<<\n@codex update this with the latest thread context\.\n>>>/);
    assert.doesNotMatch(context.promptText, /Section:/);
    assert.doesNotMatch(context.promptText, /Ignore this later section body\./);
    assert.equal(context.byteLength, Buffer.byteLength(context.promptText, "utf8"));
});

test("buildAgentPromptContext uses section scope for page threads and strips hidden comment blocks", () => {
    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: [
            "# Project",
            "",
            "Overview",
            "",
            "## Focus",
            "",
            "Alpha detail",
            "Beta detail",
            "",
            "## Later",
            "",
            "Gamma detail",
            "",
            "<!-- SideNote2 comments",
            "[]",
            "-->",
        ].join("\n"),
        thread: createThread({
            anchorKind: "page",
            startLine: 4,
            selectedText: "Note",
            comment: "@codex summarize the focus section",
        }),
        triggerEntryId: "thread-1",
        fallbackPromptText: "@codex fallback",
    });

    assert.equal(context.scope, "section");
    assert.match(context.promptText, /Scope: section/);
    assert.match(context.promptText, /Section:\n<<<\n## Focus\n\nAlpha detail\nBeta detail\n>>>/);
    assert.match(context.promptText, /Headings: # Project \| ## Focus \| ## Later/);
    assert.doesNotMatch(context.promptText, /Gamma detail/);
    assert.doesNotMatch(context.promptText, /SideNote2 comments/);
    assert.equal(context.byteLength, Buffer.byteLength(context.promptText, "utf8"));
});

test("buildAgentPromptContext falls back cleanly when note content is unavailable", () => {
    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: null,
        thread: createThread({
            filePath: "Folder/Note.md",
            anchorKind: "selection",
            selectedText: "Page 4 chart",
            comment: "@codex explain this chart",
        }),
        triggerEntryId: "thread-1",
        fallbackPromptText: "@codex explain this chart",
    });

    assert.equal(context.scope, "anchor");
    assert.match(context.promptText, /Note path: Folder\/Note\.md/);
    assert.match(context.promptText, /Anchor:\n<<<\nPage 4 chart\n>>>/);
    assert.doesNotMatch(context.promptText, /Headings:/);
    assert.equal(context.byteLength, Buffer.byteLength(context.promptText, "utf8"));
});
