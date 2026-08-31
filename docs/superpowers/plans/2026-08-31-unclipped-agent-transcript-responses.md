# Unclipped Agent Transcript Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve complete agent response-card bodies in later agent prompt context while retaining the 360-character cap for user entries and the eight-entry transcript window.

**Architecture:** Keep the change inside the provider-neutral prompt-context builder. Classify each retained thread entry through the existing agent-run `outputEntryId`, use the matching run for both the author label and the clipping decision, and leave provider runtimes, persistence, and UI code unchanged.

**Tech Stack:** TypeScript, Node test runner, repository TypeScript test build, npm build pipeline.

---

## File Map

- Modify `tests/agentPromptContextPlanner.test.ts`: add regression coverage for complete agent replies, bounded user entries, provider parity, and the eight-entry window.
- Modify `src/agents/agentPromptContextPlanner.ts`: bypass per-entry clipping only for entries owned by an agent run.
- Modify `docs/superpowers/specs/2026-08-31-unclipped-agent-transcript-responses-design.md`: mark implementation and verification items complete only after fresh test and build evidence.

### Task 1: Preserve complete agent entries in prompt context

**Files:**
- Modify: `tests/agentPromptContextPlanner.test.ts`
- Modify: `src/agents/agentPromptContextPlanner.ts:179-202`

- [ ] **Step 1: Import the provider identity type in the focused test**

Add this import beside the existing imports in `tests/agentPromptContextPlanner.test.ts`:

```ts
import type { AsideAgentTarget } from "../src/core/config/agentTargets";
```

- [ ] **Step 2: Write the failing provider-parity regression test**

Append this test to `tests/agentPromptContextPlanner.test.ts`:

```ts
test("buildAgentPromptContext preserves complete response bodies for every agent provider", () => {
    const agentCases: readonly [AsideAgentTarget, string][] = [
        ["codex", "Codex"],
        ["claude", "Claude Code"],
        ["gemini", "Gemini"],
        ["deepseek", "DeepSeek"],
    ];

    for (const [requestedAgent, label] of agentCases) {
        const outputEntryId = `agent-${requestedAgent}`;
        const sentinel = `END-${requestedAgent}`;
        const longReply = `Agent reply ${"x".repeat(400)} ${sentinel}`;
        const requestEntryId = `request-${requestedAgent}`;
        const thread = {
            ...createThread({ comment: "Initial question" }),
            entries: [
                { id: "thread-1", body: "Initial question", timestamp: 10 },
                { id: outputEntryId, body: longReply, timestamp: 11 },
                { id: requestEntryId, body: "Translate the reply above", timestamp: 12 },
            ],
        };

        const context = buildAgentPromptContext({
            filePath: "Folder/Note.md",
            noteContent: null,
            thread,
            triggerEntryId: requestEntryId,
            fallbackPromptText: "Translate the reply above",
            threadAgentRuns: [{ requestedAgent, outputEntryId }],
        });

        assert.equal(
            context.promptText.includes(`- ${label}: ${longReply}`),
            true,
            `${label} response should remain complete through ${sentinel}`,
        );
    }
});
```

- [ ] **Step 3: Add characterization tests for the retained boundaries**

Append these tests to the same file:

```ts
test("buildAgentPromptContext keeps clipping long user entries", () => {
    const sentinel = "USER-END";
    const longUserBody = `${"u".repeat(400)} ${sentinel}`;
    const thread = {
        ...createThread({ comment: longUserBody }),
        entries: [
            { id: "thread-1", body: longUserBody, timestamp: 10 },
            { id: "entry-2", body: "@codex respond", timestamp: 11 },
        ],
    };

    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: null,
        thread,
        triggerEntryId: "entry-2",
        fallbackPromptText: "@codex respond",
    });

    assert.equal(context.promptText.includes(sentinel), false);
    assert.equal(
        context.promptText.includes(`- You: ${"u".repeat(360)}...`),
        true,
    );
});

test("buildAgentPromptContext retains only the latest eight thread entries", () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
        id: `entry-${index + 1}`,
        body: `Unique body ${index + 1}`,
        timestamp: index + 1,
    }));
    const thread = {
        ...createThread({ comment: entries[0].body }),
        entries,
    };

    const context = buildAgentPromptContext({
        filePath: "Folder/Note.md",
        noteContent: null,
        thread,
        triggerEntryId: "entry-10",
        fallbackPromptText: "Unique body 10",
    });

    assert.equal(context.promptText.includes("Unique body 1\n"), false);
    assert.equal(context.promptText.includes("Unique body 2\n"), false);
    for (let index = 3; index <= 10; index += 1) {
        assert.equal(context.promptText.includes(`Unique body ${index}`), true);
    }
});
```

- [ ] **Step 4: Compile and run the focused tests to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentPromptContextPlanner.test.js
```

Expected: the provider-parity test fails first for Codex because the `END-codex` suffix occurs after character 360 and is absent from the generated prompt. The user-entry and eight-entry characterization tests pass.

- [ ] **Step 5: Implement agent-aware transcript formatting**

Replace `resolveTranscriptAuthorLabel` and the body of `buildThreadTranscript` in `src/agents/agentPromptContextPlanner.ts` with:

```ts
function buildThreadTranscript(
    thread: CommentThread,
    triggerEntryId: string,
    threadAgentRuns: readonly Pick<AgentRunRecord, "requestedAgent" | "outputEntryId">[],
): string[] {
    return thread.entries
        .slice(-MAX_TRANSCRIPT_ENTRIES)
        .map((entry) => {
            const matchingRun = threadAgentRuns.find((run) => run.outputEntryId === entry.id);
            const label = matchingRun
                ? getAgentActorLabel(matchingRun.requestedAgent)
                : "You";
            const currentSuffix = entry.id === triggerEntryId ? " (current)" : "";
            const body = matchingRun
                ? compactText(entry.body)
                : clipCompactText(entry.body, MAX_TRANSCRIPT_ENTRY_CHARS);
            return `${label}${currentSuffix}: ${body}`;
        })
        .filter((line) => !line.endsWith(": "));
}
```

This resolves the agent run once per entry, preserves the existing one-line normalization for agent replies, and leaves user clipping unchanged.

- [ ] **Step 6: Recompile and run the focused tests to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentPromptContextPlanner.test.js
```

Expected: all prompt-context tests pass with zero failures.

- [ ] **Step 7: Commit the tested implementation**

```bash
git add src/agents/agentPromptContextPlanner.ts tests/agentPromptContextPlanner.test.ts
git commit -m "fix(agents): preserve full response context"
```

### Task 2: Verify the repository and close implementation tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-unclipped-agent-transcript-responses-design.md`

- [ ] **Step 1: Run the full build**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, production bundle, and the exact release-artifact security check all complete successfully with exit code 0.

- [ ] **Step 2: Confirm the original truncation path is gone**

Run:

```bash
rg -n "MAX_TRANSCRIPT_ENTRY_CHARS|matchingRun|compactText\(entry\.body\)|clipCompactText\(entry\.body" src/agents/agentPromptContextPlanner.ts tests/agentPromptContextPlanner.test.ts
```

Expected: the shared 360-character constant remains; the agent-owned branch uses `compactText(entry.body)` and the user-owned branch uses `clipCompactText(entry.body, MAX_TRANSCRIPT_ENTRY_CHARS)`.

- [ ] **Step 3: Mark the tracked spec complete**

In `docs/superpowers/specs/2026-08-31-unclipped-agent-transcript-responses-design.md`, change every unchecked item under `### To Implement` and `### Verification` from `- [ ]` to `- [x]`. Do not change the goals, non-goals, or design narrative.

- [ ] **Step 4: Verify the final diff and worktree scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the tracked spec remains modified after the implementation commit. Generated build output must not introduce an unexpected tracked artifact.

- [ ] **Step 5: Commit verified tracking evidence**

```bash
git add docs/superpowers/specs/2026-08-31-unclipped-agent-transcript-responses-design.md
git commit -m "docs(agents): verify response context"
```

- [ ] **Step 6: Recheck final repository state**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: the worktree is clean and the latest commits are the verified tracking commit, the implementation commit, and this implementation-plan commit.
