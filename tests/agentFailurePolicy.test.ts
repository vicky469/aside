import assert from "node:assert/strict";
import test from "node:test";
import {
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
