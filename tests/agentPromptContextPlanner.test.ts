import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment, type CommentThread } from "../src/commentManager";
import { buildAgentPromptContext } from "../src/agents/agentPromptContextPlanner";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";

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

test("buildAgentPromptContext uses page scope for page threads", () => {
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

    assert.equal(context.scope, "page");
    assert.match(context.promptText, /Scope: page/);
    assert.match(context.promptText, /Page:\n<<<\n# Project\n\nOverview\n\n## Focus\n\nAlpha detail\nBeta detail\n\n## Later\n\nGamma detail\n>>>/);
    assert.match(context.promptText, /Headings: # Project \| ## Focus \| ## Later/);
    assert.doesNotMatch(context.promptText, /Aside comments/);
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

test("buildAgentPromptContext preserves full agent responses for every provider", () => {
    const targets: Array<[AsideAgentTarget, string]> = [
        ["codex", "Codex"],
        ["claude", "Claude Code"],
        ["cursor", "Cursor"],
        ["gemini", "Gemini"],
        ["deepseek", "DeepSeek"],
    ];

    for (const [requestedAgent, label] of targets) {
        const longReply = `${"agent response ".repeat(30)}END-${requestedAgent}`;
        const thread = {
            ...createThread({ comment: "Translate the reply above" }),
            entries: [
                { id: `output-${requestedAgent}`, body: longReply, timestamp: 10 },
                { id: `follow-up-${requestedAgent}`, body: "Translate the reply above", timestamp: 11 },
            ],
        };

        const context = buildAgentPromptContext({
            filePath: "Folder/Note.md",
            noteContent: "# Note",
            thread,
            triggerEntryId: `follow-up-${requestedAgent}`,
            fallbackPromptText: "Translate the reply above",
            threadAgentRuns: [{ requestedAgent, outputEntryId: `output-${requestedAgent}` }],
        });

        assert.ok(context.promptText.includes(`- ${label}: ${longReply}`));
    }
});

test("buildAgentPromptContext bounds oversized agent transcripts by UTF-8 bytes", () => {
    const oversizedReply = `${"界".repeat(40_000)}AGENT-END`;
    const thread = {
        ...createThread({ comment: "Continue from the reply" }),
        entries: [
            { id: "agent-output", body: oversizedReply, timestamp: 10 },
            { id: "follow-up", body: "Continue from the reply", timestamp: 11 },
        ],
    };

    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: "# Note",
        thread,
        triggerEntryId: "follow-up",
        fallbackPromptText: "Continue from the reply",
        threadAgentRuns: [{ requestedAgent: "codex", outputEntryId: "agent-output" }],
    });

    assert.ok(context.byteLength <= 24_000, `context was ${context.byteLength} bytes`);
    assert.doesNotMatch(context.promptText, /AGENT-END/u);
    assert.match(context.promptText, /truncated/u);
    assert.match(context.promptText, /Request:\n<<<\nContinue from the reply/u);
});

test("buildAgentPromptContext clips long user transcript entries", () => {
    const longUserBody = `${"user text ".repeat(45)}USER-END`;
    const thread = {
        ...createThread(),
        entries: [
            { id: "long-user", body: longUserBody, timestamp: 10 },
            { id: "follow-up", body: "Follow up", timestamp: 11 },
        ],
    };

    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: "# Note",
        thread,
        triggerEntryId: "follow-up",
        fallbackPromptText: "Follow up",
    });

    assert.match(context.promptText, new RegExp(`- You(?: \\(current\\))?: ${"user text ".repeat(36).trimEnd()}\\.\\.\\.`));
    assert.doesNotMatch(context.promptText, /USER-END/);
});

test("buildAgentPromptContext keeps only the latest eight transcript entries", () => {
    const thread = {
        ...createThread(),
        entries: Array.from({ length: 10 }, (_, index) => ({
            id: `entry-${index + 1}`,
            body: `entry-${index + 1}`,
            timestamp: index + 1,
        })),
    };

    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: "# Note",
        thread,
        triggerEntryId: "entry-10",
        fallbackPromptText: "entry-10",
    });

    for (let index = 3; index <= 10; index += 1) {
        assert.match(context.promptText, new RegExp(`- (?:You|You \\(current\\)): entry-${index}`));
    }
    assert.doesNotMatch(context.promptText, /entry-1\b/);
    assert.doesNotMatch(context.promptText, /entry-2\b/);
});
