import assert from "node:assert/strict";
import test from "node:test";
import {
    formatAgentPreflightFailureReply,
    formatKnownAgentFailureReply,
    isKnownAgentProviderFailure,
} from "../src/agents/agentFailurePolicy";

const supportedAgentFailureCases = [
    ["codex", "You have insufficient credits", "Codex"],
    ["claude", "Credit balance is too low", "Claude Code"],
    ["cursor", "Authentication failed: please log in", "Cursor"],
    ["gemini", "RESOURCE_EXHAUSTED: quota exceeded", "Gemini"],
    ["deepseek", "Rate limit exceeded", "DeepSeek"],
] as const;

for (const [target, diagnostic, label] of supportedAgentFailureCases) {
    test(`${target} receives the shared provider failure fallback`, () => {
        assert.equal(isKnownAgentProviderFailure(diagnostic), true);
        assert.equal(
            formatKnownAgentFailureReply(target, diagnostic),
            `${label} couldn’t complete this request. Try another agent.`,
        );
    });
}

test("known provider failure classifier covers billing and availability errors", () => {
    assert.equal(isKnownAgentProviderFailure("Billing is not enabled for this account"), true);
    assert.equal(isKnownAgentProviderFailure("The model is currently unavailable"), true);
    assert.equal(isKnownAgentProviderFailure("You are not logged in"), true);
});

test("known provider failure classifier covers supported CLI usage-limit wording", () => {
    assert.equal(isKnownAgentProviderFailure("You've hit your usage limit."), true);
    assert.equal(isKnownAgentProviderFailure("You exceeded your current quota."), true);
    assert.equal(isKnownAgentProviderFailure("429 Too Many Requests"), true);
    assert.equal(isKnownAgentProviderFailure("Resource has been exhausted (e.g. check quota)."), true);
});

test("ordinary agent prose is not classified as a provider failure", () => {
    assert.equal(isKnownAgentProviderFailure("Here is how API quotas work."), false);
    assert.equal(formatKnownAgentFailureReply("gemini", "Here is the answer."), null);
});

test("preflight failure reply keeps one actionable diagnostic line", () => {
    assert.equal(formatAgentPreflightFailureReply(
        "codex",
        "Error: Missing optional dependency @openai/codex-darwin-arm64.\n    at file:///opt/codex/bin.js:42:3\nError: Missing optional dependency @openai/codex-darwin-arm64.",
    ), "Missing optional dependency @openai/codex-darwin-arm64.");
});

test("preflight failure reply falls back when no useful diagnostic exists", () => {
    assert.equal(
        formatAgentPreflightFailureReply("codex", "\n    at file:///opt/codex/bin.js:42:3\n"),
        "Codex couldn’t complete this request. Try another agent.",
    );
});

test("preflight failure reply redacts obvious credentials", () => {
    const reply = formatAgentPreflightFailureReply(
        "gemini",
        "Authentication failed for sk-abcdefghijklmnopqrstuvwxyz123456",
    );

    assert.doesNotMatch(reply, /sk-abcdefghijklmnopqrstuvwxyz123456/u);
    assert.match(reply, /Authentication failed/u);
});

test("preflight failure reply redacts common credentials, credential urls, and home paths", () => {
    const reply = formatAgentPreflightFailureReply(
        "cursor",
        [
            "Error: Authentication failed:",
            "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz1234567890",
            "CURSOR_API_KEY=cursor_secret_abcdefghijklmnopqrstuvwxyz",
            "https://api.example.com/run?token=query-secret&key=value",
            ["", "Users", "alice", ".cursor", "config.json"].join("/"),
        ].join(" "),
    );

    assert.match(reply, /Authentication failed/u);
    assert.doesNotMatch(reply, /ghp_/u);
    assert.doesNotMatch(reply, /cursor_secret/u);
    assert.doesNotMatch(reply, /query-secret/u);
    assert.doesNotMatch(reply, /\/Users\/alice/u);
    assert.match(reply, /\[redacted\]/u);
});

test("preflight failure reply prefers an explicit error over preceding warnings", () => {
    assert.equal(formatAgentPreflightFailureReply(
        "codex",
        "npm warn Unknown user config.\nError: Missing optional dependency @openai/codex-darwin-arm64.",
    ), "Missing optional dependency @openai/codex-darwin-arm64.");
});

test("preflight failure reply rejects serialized diagnostic blobs", () => {
    assert.equal(
        formatAgentPreflightFailureReply("gemini", '{"error":{"code":500,"requestId":"internal"}}'),
        "Gemini couldn’t complete this request. Try another agent.",
    );
});

test("preflight failure reply replaces non-actionable probe placeholders", () => {
    for (const diagnostic of [
        "Codex could not be launched from this Obsidian environment.",
        "launch failed",
        "codex exited",
    ]) {
        assert.equal(
            formatAgentPreflightFailureReply("codex", diagnostic),
            "Codex couldn’t complete this request. Try another agent.",
        );
    }
});
