# Update Script and Actionable Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict `/update-script /script-name <request>` execution and make autocomplete, draft rendering, persisted rendering, and routing share one actionable-mention policy.

**Architecture:** A pure core policy derives active built-ins from the agent actor registry, feature state, and live vault-script resolver. A dedicated update-script parser and command controller validate the strict grammar before the existing `CommentAgentController` persists and executes a typed update run through the shared prompt builder.

**Tech Stack:** TypeScript, CommonJS shared policy modules, Obsidian plugin APIs, Node.js test runner, ESLint, esbuild.

---

## File Structure

- Create `src/core/text/updateScriptDirective.ts` for strict command parsing and update-specific user copy.
- Create `src/core/text/actionableMentions.ts` for built-in definitions, reserved names, active candidates, and token validation.
- Create `src/agents/updateScriptCommandController.ts` for saved-entry validation and early returns before agent selection.
- Create `tests/updateScriptDirective.test.ts`, `tests/actionableMentions.test.ts`, and `tests/updateScriptCommandController.test.ts` for the new pure seams.
- Modify `src/ui/editor/commentMentionSuggestions.ts` and `src/ui/editor/commentEditorStyling.ts` so suggestions and both render paths consume the shared policy.
- Modify `src/vaultScripts/vaultScriptRegistry.ts` so command reservation comes from the shared policy.
- Modify `src/core/agents/agentRuns.ts`, `src/agents/agentRunStorePlanner.ts`, `src/agents/agentRuntimeAdapter.ts`, `shared/sideNotePromptPolicy.js`, and `shared/sideNotePromptPolicy.d.ts` for typed update-run persistence and one provider-neutral prompt contract.
- Modify `src/agents/commentAgentController.ts`, `src/vaultScripts/commentScriptController.ts`, and `src/main.ts` for update dispatch, vault-root execution, and Regenerate.
- Modify the sidebar host adapters and tests so draft and persisted rendering receive one `isActionableMention` predicate.
- Modify editor and settings copy to name both script-authoring commands.

### Task 1: Parse the strict update-script grammar

**Files:**
- Create: `src/core/text/updateScriptDirective.ts`
- Create: `tests/updateScriptDirective.test.ts`

- [ ] **Step 1: Write the failing parser tests**

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { parseUpdateScriptDirective } from "../src/core/text/updateScriptDirective";

test("update-script parser extracts the registered-script argument and request", () => {
    assert.deepEqual(parseUpdateScriptDirective(
        "/update-script /embed-image-urls make the default size reasonable. currently too big.",
    ), {
        kind: "request",
        targetMention: "/embed-image-urls",
        requestText: "make the default size reasonable. currently too big.",
    });
});

test("update-script parser enforces command, target, and request positions", () => {
    assert.deepEqual(parseUpdateScriptDirective("/update-script"), { kind: "empty" });
    assert.deepEqual(parseUpdateScriptDirective("/update-script /clean"), { kind: "empty" });
    assert.equal(parseUpdateScriptDirective("/update-script clean change it").kind, "rejected");
    assert.equal(parseUpdateScriptDirective("please /update-script /clean change it").kind, "rejected");
});

test("update-script parser keeps request tokens opaque and ignores longer names", () => {
    assert.deepEqual(
        parseUpdateScriptDirective("/update-script /clean explain /update-script and @codex"),
        {
            kind: "request",
            targetMention: "/clean",
            requestText: "explain /update-script and @codex",
        },
    );
    assert.deepEqual(parseUpdateScriptDirective("/update-script-extra /clean x"), { kind: "none" });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `src/core/text/updateScriptDirective.ts` does not exist.

- [ ] **Step 3: Implement the parser and shared update copy**

```ts
export const UPDATE_SCRIPT_DIRECTIVE = "/update-script";
export const UPDATE_SCRIPT_USAGE = "Use /update-script /script-name followed by the change you want.";
export const UPDATE_SCRIPT_NO_AGENT = "No agent is available to update the script.";

export type UpdateScriptDirectiveResolution =
    | { kind: "none" }
    | { kind: "empty" }
    | { kind: "request"; targetMention: string; requestText: string }
    | { kind: "rejected"; message: string };

const UPDATE_SCRIPT_PATTERN = /(^|[^\w/])\/update-script(?=$|\s)/iu;
const LEADING_UPDATE_SCRIPT_PATTERN = /^\s*\/update-script(?=$|\s)/iu;
const TARGET_AND_REQUEST_PATTERN = /^(\/[A-Za-z0-9_.-]+)(?:\s+([\s\S]+))?$/u;

export function parseUpdateScriptDirective(value: string): UpdateScriptDirectiveResolution {
    const leadingMatch = LEADING_UPDATE_SCRIPT_PATTERN.exec(value);
    if (!leadingMatch && !UPDATE_SCRIPT_PATTERN.test(value)) {
        return { kind: "none" };
    }
    if (!leadingMatch) {
        return { kind: "rejected", message: UPDATE_SCRIPT_USAGE };
    }

    const remainder = value.slice(leadingMatch[0].length).trim();
    const targetAndRequest = TARGET_AND_REQUEST_PATTERN.exec(remainder);
    if (!targetAndRequest) {
        return remainder ? { kind: "rejected", message: UPDATE_SCRIPT_USAGE } : { kind: "empty" };
    }

    const requestText = (targetAndRequest[2] ?? "").trim();
    return requestText
        ? { kind: "request", targetMention: targetAndRequest[1] ?? "", requestText }
        : { kind: "empty" };
}
```

- [ ] **Step 4: Run the parser test and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/updateScriptDirective.test.js
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the parser slice**

```bash
git add src/core/text/updateScriptDirective.ts tests/updateScriptDirective.test.ts
git commit -m "feat(scripts): parse update-script command"
```

### Task 2: Centralize actionable mentions

**Files:**
- Create: `src/core/text/actionableMentions.ts`
- Create: `tests/actionableMentions.test.ts`
- Modify: `src/ui/editor/commentMentionSuggestions.ts`
- Modify: `tests/commentMentionSuggestions.test.ts`
- Modify: `src/vaultScripts/vaultScriptRegistry.ts`
- Modify: `tests/vaultScriptRegistry.test.ts`
- Modify: `src/core/text/createScriptDirective.ts`

- [ ] **Step 1: Write failing shared-policy, suggestion, and reservation tests**

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getActionableBuiltInMentions,
    isActionableMention,
    RESERVED_BUILT_IN_MENTION_NAMES,
} from "../src/core/text/actionableMentions";

test("actionable mentions follow active built-ins and live scripts", () => {
    const liveScripts = new Set(["/clean"]);
    const enabled = {
        agentsFeatureAvailable: true,
        isRunnableVaultScriptMention: (mention: string) => liveScripts.has(mention.toLowerCase()),
    };
    assert.equal(isActionableMention("@todo", enabled), true);
    assert.equal(isActionableMention("@codex", enabled), true);
    assert.equal(isActionableMention("/create-script", enabled), true);
    assert.equal(isActionableMention("/update-script", enabled), true);
    assert.equal(isActionableMention("/clean", enabled), true);
    assert.equal(isActionableMention("@hi", enabled), false);
    assert.equal(isActionableMention("/missing", enabled), false);
});

test("disabled Agents keeps only todo and live scripts actionable", () => {
    const disabled = {
        agentsFeatureAvailable: false,
        isRunnableVaultScriptMention: (mention: string) => mention.toLowerCase() === "/clean",
    };
    assert.equal(isActionableMention("@todo", disabled), true);
    assert.equal(isActionableMention("/clean", disabled), true);
    assert.equal(isActionableMention("@codex", disabled), false);
    assert.equal(isActionableMention("/update-script", disabled), false);
});

test("built-in candidates and reservations share one definition", () => {
    assert.deepEqual(
        getActionableBuiltInMentions(true).map((item) => item.mention),
        ["@todo", "@codex", "@claude", "@gemini", "/create-script", "/update-script"],
    );
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("update-script"));
});
```

Extend `tests/commentMentionSuggestions.test.ts` to expect `/update-script` after `/create-script` for unfiltered slash results and to expect no script-authoring commands when Agents is disabled. Extend the reserved-name fixtures in `tests/vaultScriptRegistry.test.ts` with `🛠️ scripts/update-script.mjs` and assert it is not runnable.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because the actionable-mention module and update-script suggestion do not exist.

- [ ] **Step 3: Implement the shared policy**

```ts
import { getSupportedAgentActors } from "../agents/agentActorRegistry";
import { CREATE_SCRIPT_DIRECTIVE } from "./createScriptDirective";
import { UPDATE_SCRIPT_DIRECTIVE } from "./updateScriptDirective";

export interface ActionableBuiltInMention {
    mention: `@${string}` | `/${string}`;
    label: string;
    requiresAgents: boolean;
}

export interface ActionableMentionContext {
    agentsFeatureAvailable: boolean;
    isRunnableVaultScriptMention(mention: string): boolean;
}

function getAllBuiltInMentions(): ActionableBuiltInMention[] {
    return [
        { mention: "@todo", label: "Todo", requiresAgents: false },
        ...getSupportedAgentActors().map((actor) => ({
            mention: actor.directive,
            label: actor.label,
            requiresAgents: true,
        })),
        { mention: CREATE_SCRIPT_DIRECTIVE, label: "Create script", requiresAgents: true },
        { mention: UPDATE_SCRIPT_DIRECTIVE, label: "Update script", requiresAgents: true },
    ];
}

export const RESERVED_BUILT_IN_MENTION_NAMES = new Set(
    getAllBuiltInMentions().map((item) => item.mention.slice(1).toLowerCase()),
);

export function getActionableBuiltInMentions(
    agentsFeatureAvailable: boolean,
): ActionableBuiltInMention[] {
    return getAllBuiltInMentions().filter(
        (item) => agentsFeatureAvailable || !item.requiresAgents,
    );
}

export function isActionableMention(
    mention: string,
    context: ActionableMentionContext,
): boolean {
    const normalized = mention.trim().toLowerCase();
    if (getActionableBuiltInMentions(context.agentsFeatureAvailable)
        .some((item) => item.mention === normalized)) {
        return true;
    }
    return normalized.startsWith("/")
        && context.isRunnableVaultScriptMention(normalized);
}
```

Remove `RESERVED_BUILT_IN_SLASH_MENTION_NAMES` from `createScriptDirective.ts`. Import `RESERVED_BUILT_IN_MENTION_NAMES` in `VaultScriptRegistry`. In `commentMentionSuggestions.ts`, derive built-in candidates and reserved names from `getActionableBuiltInMentions(agentsFeatureAvailable)` and the exported reservation set instead of constructing todo, agents, and create-script locally.

- [ ] **Step 4: Run policy, suggestion, and registry tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/actionableMentions.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/vaultScriptRegistry.test.js
```

Expected: all selected tests pass, including `/update-script` ordering and reservation.

- [ ] **Step 5: Commit the shared policy slice**

```bash
git add src/core/text/actionableMentions.ts src/core/text/createScriptDirective.ts src/ui/editor/commentMentionSuggestions.ts src/vaultScripts/vaultScriptRegistry.ts tests/actionableMentions.test.ts tests/commentMentionSuggestions.test.ts tests/vaultScriptRegistry.test.ts
git commit -m "refactor(editor): centralize actionable mentions"
```

### Task 3: Apply actionable validation to draft and persisted rendering

**Files:**
- Modify: `src/ui/editor/commentEditorStyling.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/settings/asideSettingCatalog.ts`
- Modify: `tests/commentEditorFormatting.test.ts`
- Modify: `tests/commentMentionHighlightingWiring.test.ts`
- Modify: `tests/sidebarDraftComment.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`

- [ ] **Step 1: Convert arbitrary-at tests into a failing regression**

Define one test predicate from the shared policy:

```ts
const isRecognizedMention = (mention: string) => new Set([
    "@todo",
    "@codex",
    "/create-script",
    "/update-script",
    "/clean-youtube-transcript",
]).has(mention.toLowerCase());
```

Update the renderer expectations so:

```ts
assert.equal(
    renderStyledDraftCommentHtml("@todo @codex @hi", isRecognizedMention),
    "<span class=\"aside-editor-token-mention\">@todo</span> "
        + "<span class=\"aside-editor-token-mention\">@codex</span> @hi",
);
assert.equal(
    renderStyledDraftCommentHtml("ping foo@example.com and @teammate", isRecognizedMention),
    "ping foo@example.com and @teammate",
);
```

Update `tests/commentMentionHighlightingWiring.test.ts` to require `host.isActionableMention` in both renderer calls and three AsideView host adapters.

- [ ] **Step 2: Run the renderer tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentEditorFormatting.test.js .test-dist/tests/commentMentionHighlightingWiring.test.js
```

Expected: FAIL because `@hi` is still wrapped and the hosts still expose the script-only predicate.

- [ ] **Step 3: Make the renderer predicate generic and mandatory for matches**

Replace `RunnableVaultScriptMentionPredicate` with:

```ts
export type ActionableMentionPredicate = (mention: string) => boolean;
```

In `getCommentMentionMatches`, reject every candidate not accepted by the predicate:

```ts
if (!isActionableMention?.(mention)) {
    continue;
}
```

Pass that predicate unchanged through draft fragment rendering and persisted DOM decoration. Rename the sidebar host properties to `isActionableMention`.

Add the plugin adapter in `src/main.ts`:

```ts
public isActionableMention(mention: string): boolean {
    return isActionableMention(mention, {
        agentsFeatureAvailable: this.isAgentsFeatureAvailable(),
        isRunnableVaultScriptMention: (candidate) =>
            this.vaultScriptRegistry.isRunnableMention(candidate),
    });
}
```

Have all three `AsideView` host adapters call `this.plugin.isActionableMention(mention)`. Update persisted-comment test hosts to provide `isActionableMention: () => false`.

- [ ] **Step 4: Update compact user copy**

Use these exact enabled-state strings:

```ts
"Mention an agent, todo, /create-script, /update-script, or a vault script"
"Write a side note. Use B or H for styling, or type /create-script, /update-script, /script-name, @todo, @codex, @claude, or @gemini."
"Preferred local agent for /create-script and /update-script."
```

Retain the current disabled-state copy, which exposes only `@todo` and `/script-name`.

- [ ] **Step 5: Run renderer, sidebar, settings, and wiring tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentEditorFormatting.test.js .test-dist/tests/commentMentionHighlightingWiring.test.js .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/asideSettingCatalog.test.js
```

Expected: all selected tests pass; random at-tokens stay plain in shared rendering.

- [ ] **Step 6: Commit the renderer/UI slice**

```bash
git add src/main.ts src/ui/editor/commentEditorStyling.ts src/ui/editor/commentMentionSuggestions.ts src/ui/settings/asideSettingCatalog.ts src/ui/views/AsideView.ts src/ui/views/sidebarDraftComment.ts src/ui/views/sidebarPersistedComment.ts tests/commentEditorFormatting.test.ts tests/commentMentionHighlightingWiring.test.ts tests/commentMentionSuggestions.test.ts tests/sidebarDraftComment.test.ts tests/sidebarPersistedComment.test.ts
git commit -m "fix(editor): highlight actionable mentions only"
```

### Task 4: Validate update requests before agent selection

**Files:**
- Create: `src/agents/updateScriptCommandController.ts`
- Create: `tests/updateScriptCommandController.test.ts`

- [ ] **Step 1: Write failing controller tests**

Build a harness with a real `VaultScriptRegistry`, reply capture, notice capture, and dispatch capture. Cover the acceptance case:

```ts
test("update-script dispatches one resolved target and opaque request text", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/embed-image-urls.mjs"] });
    await harness.controller.handleSavedUserEntry(event(
        "/update-script /embed-image-urls make the default size reasonable. currently too big.",
    ));
    assert.deepEqual(harness.dispatchedRequests, [{
        requestText: "make the default size reasonable. currently too big.",
        scriptPath: "🛠️ scripts/embed-image-urls.mjs",
    }]);
    assert.deepEqual(harness.replies, []);
});
```

Add separate tests proving unknown, ambiguous, empty, malformed, misplaced, disabled, and duplicate-entry inputs dispatch nothing. Assert unknown and ambiguous targets append one compact reply, disabled Agents shows only `Agents experiment is disabled.`, and handling the same entry twice does not duplicate a reply. Add one positive case proving directive-like tokens after the target remain opaque request text.

- [ ] **Step 2: Run the controller test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `UpdateScriptCommandController` does not exist.

- [ ] **Step 3: Implement early validation and typed dispatch**

```ts
import type { VaultScriptRegistration } from "../../shared/vaultScriptPolicy.js";
import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import { AGENTS_EXPERIMENT_DISABLED_NOTICE } from "../core/agents/agentsFeaturePolicy";
import {
    UPDATE_SCRIPT_USAGE,
    parseUpdateScriptDirective,
} from "../core/text/updateScriptDirective";
import type { VaultScriptRegistry } from "../vaultScripts/vaultScriptRegistry";

export interface UpdateScriptCommandHost {
    getRegistry(): VaultScriptRegistry;
    isAgentsFeatureAvailable(): boolean;
    showNotice(message: string): void;
    appendReply(event: SavedUserEntryEvent, body: string): Promise<void>;
    dispatchRequest(
        event: SavedUserEntryEvent,
        requestText: string,
        targetScript: VaultScriptRegistration,
    ): Promise<void>;
}

export class UpdateScriptCommandController {
    private readonly handledEntryIds = new Set<string>();

    constructor(private readonly host: UpdateScriptCommandHost) {}

    public initialize(): void { this.handledEntryIds.clear(); }
    public dispose(): void { this.handledEntryIds.clear(); }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        const resolution = parseUpdateScriptDirective(event.body);
        if (resolution.kind === "none") return false;
        if (this.handledEntryIds.has(event.entryId)) return true;
        this.handledEntryIds.add(event.entryId);

        if (!this.host.isAgentsFeatureAvailable()) {
            this.host.showNotice(AGENTS_EXPERIMENT_DISABLED_NOTICE);
            return true;
        }
        if (resolution.kind === "empty") {
            await this.host.appendReply(event, UPDATE_SCRIPT_USAGE);
            return true;
        }
        if (resolution.kind === "rejected") {
            await this.host.appendReply(event, resolution.message);
            return true;
        }

        const registry = this.host.getRegistry();
        const targetScript = registry.resolve(resolution.targetMention);
        if (!targetScript) {
            await this.host.appendReply(
                event,
                `Script ${resolution.targetMention} is not available to update.`,
            );
            return true;
        }

        await this.host.dispatchRequest(event, resolution.requestText, targetScript);
        return true;
    }
}
```

- [ ] **Step 4: Run controller tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/updateScriptCommandController.test.js
```

Expected: all update-command validation tests pass.

- [ ] **Step 5: Commit the validation slice**

```bash
git add src/agents/updateScriptCommandController.ts tests/updateScriptCommandController.test.ts
git commit -m "feat(scripts): validate update-script targets"
```

### Task 5: Persist update targets and build one shared prompt

**Files:**
- Modify: `src/core/agents/agentRuns.ts`
- Modify: `src/agents/agentRunStorePlanner.ts`
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Modify: `shared/sideNotePromptPolicy.js`
- Modify: `shared/sideNotePromptPolicy.d.ts`
- Modify: `tests/agentRunStorePlanner.test.ts`
- Modify: `tests/sideNotePromptPolicy.test.mjs`
- Modify: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing persistence and prompt tests**

Add a persisted run fixture with:

```ts
requestKind: "update-script",
targetScriptPath: "🛠️ scripts/embed-image-urls.mjs",
```

Assert both fields normalize and survive cloning. Add a malformed update fixture without `targetScriptPath` and assert it does not retain `requestKind: "update-script"`.

Add a shared prompt test:

```js
const prompt = buildSideNotePrompt({
    promptText: "make the default size reasonable",
    rootLabel: "vault root",
    rootPath: "/vault",
    requestKind: "update-script",
    targetScriptPath: "🛠️ scripts/embed-image-urls.mjs",
});
assert.match(prompt, /modify.*🛠️ scripts\/embed-image-urls\.mjs.*in place/is);
assert.match(prompt, /do not rename/is);
```

Extend the adapter forwarding test to assert the target path appears in the prompt produced for an update request.

- [ ] **Step 2: Run persistence and prompt tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/agentRunStorePlanner.test.js .test-dist/tests/agentRuntimeAdapter.test.js && node --test tests/sideNotePromptPolicy.test.mjs
```

Expected: FAIL because `update-script` and `targetScriptPath` are not accepted or forwarded.

- [ ] **Step 3: Extend the typed run and runtime boundaries**

Use these types:

```ts
export type AgentRunRequestKind = "create-script" | "update-script";

export interface AgentRunRecord extends AgentRunMetadata {
    targetScriptPath?: string;
}
```

Add `targetScriptPath?: string` to `AgentRuntimeInvocation`, the `CommentAgentHost.runAgentRuntime` argument, the local `buildSideNotePrompt` options, and `shared/sideNotePromptPolicy.d.ts`. Normalize the target only for valid update runs:

```ts
const rawRequestKind = value.requestKind === "create-script"
    || value.requestKind === "update-script"
    ? value.requestKind
    : undefined;
const targetScriptPath = rawRequestKind === "update-script"
    ? normalizeOptionalString(value.targetScriptPath)
    : undefined;
const requestKind = rawRequestKind === "update-script" && !targetScriptPath
    ? undefined
    : rawRequestKind;
```

Pass the field through all Codex, Claude Code, and Gemini calls to `buildSideNotePrompt`.

- [ ] **Step 4: Add the provider-neutral update contract**

In `shared/sideNotePromptPolicy.js`, only add the update block when both the request kind and target path are valid strings:

```js
if (options?.requestKind === "update-script" && targetScriptPath) {
    promptLines.push(
        `This is an /update-script request. Modify \`${targetScriptPath}\` in place now.`,
        "Inspect the existing script before editing it.",
        "Do not rename it, create a replacement, or edit unrelated vault files.",
        "Preserve the script's current-note positional argument and vault-root working-directory contract.",
        "In the Aside reply, report the updated vault-relative path and its /script-name invocation.",
        "If the target disappears or cannot be edited, state that plainly instead of creating a substitute.",
    );
}
```

Normalize `targetScriptPath` with the same trim-only string helper used for root paths. Do not copy this block into runtime adapters.

- [ ] **Step 5: Run persistence and prompt tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/agentRunStorePlanner.test.js .test-dist/tests/agentRuntimeAdapter.test.js && node --test tests/sideNotePromptPolicy.test.mjs
```

Expected: all selected tests pass and all three runtime transports share the same target-bearing prompt.

- [ ] **Step 6: Commit the persistence/prompt slice**

```bash
git add shared/sideNotePromptPolicy.d.ts shared/sideNotePromptPolicy.js src/agents/agentRunStorePlanner.ts src/agents/agentRuntimeAdapter.ts src/core/agents/agentRuns.ts tests/agentRunStorePlanner.test.ts tests/agentRuntimeAdapter.test.ts tests/sideNotePromptPolicy.test.mjs
git commit -m "feat(agents): add update-script run contract"
```

### Task 6: Dispatch, execute, and regenerate update-script runs

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/main.ts`
- Modify: `src/vaultScripts/commentScriptController.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `tests/commentScriptController.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`
- Modify: `tests/streamedAgentReplyController.test.ts`

- [ ] **Step 1: Write failing agent-controller acceptance tests**

Extend the comment-agent harness with a real `VaultScriptRegistry` callback. Add a valid dispatch test:

```ts
await harness.controller.handleUpdateScriptRequest(
    event({ body: "/update-script /embed-image-urls make the default size reasonable" }),
    "make the default size reasonable",
    {
        path: "🛠️ scripts/embed-image-urls.mjs",
        fileName: "embed-image-urls.mjs",
        mentionName: "embed-image-urls",
        normalizedMentionName: "embed-image-urls",
    },
);
const run = harness.store.getRuns().at(-1);
assert.equal(run?.requestKind, "update-script");
assert.equal(run?.targetScriptPath, "🛠️ scripts/embed-image-urls.mjs");
assert.equal(harness.runtimeCalls[0]?.cwd, "/vault");
assert.equal(harness.runtimeCalls[0]?.targetScriptPath, "🛠️ scripts/embed-image-urls.mjs");
```

Add Regenerate tests proving the controller reparses the latest trigger, re-resolves the current registration, uses a renamed target only when the latest command names it, and returns without runtime selection when the target was deleted or became ambiguous.

Update routing tests so the built-in controller list is tried in order and a handled update never reaches direct script execution.

- [ ] **Step 2: Run controller and routing tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: FAIL because update dispatch, target persistence, Regenerate, and multiple built-in routing are not wired.

- [ ] **Step 3: Add update dispatch to CommentAgentController**

Add a target resolver to `CommentAgentHost`:

```ts
resolveVaultScriptMention(mention: string): VaultScriptRegistration | null;
```

Add `handleUpdateScriptRequest(event, requestText, targetScript)` parallel to create-script dispatch. It must perform the existing feature gate and duplicate-run check, resolve the default agent, append `UPDATE_SCRIPT_NO_AGENT` when none is available, then call `buildQueuedRun` with:

```ts
requestKind: "update-script",
targetScriptPath: targetScript.path,
promptText: requestText,
```

Extend `buildQueuedRun` to accept and persist `targetScriptPath`; include the target path in `usedFiles` after the source note path. Treat both script-authoring request kinds as vault-root runs:

```ts
const workingDirectory = options.run.requestKind === "create-script"
    || options.run.requestKind === "update-script"
    ? vaultRootPath
    : this.host.getRuntimeWorkingDirectory(options.run.filePath);
```

Forward `targetScriptPath` to `runAgentRuntime`.

- [ ] **Step 4: Revalidate update requests on Regenerate**

In `retryPromptForCommentInternal`, add an update-script branch before ordinary explicit-agent parsing. Reparse with `parseUpdateScriptDirective`, resolve with `this.host.resolveVaultScriptMention`, fast-return with usage or unavailable-target copy when validation fails, then obtain fresh default-agent selection. Carry the current request text and resolved target path into the replacement run.

Use a local `targetScriptPath: string | undefined` beside `requestKind`, and pass it to `buildQueuedRun` only for the valid update branch.

- [ ] **Step 5: Route both built-in controllers before direct scripts**

Change `routeSavedUserEntry` to accept a readonly list:

```ts
export async function routeSavedUserEntry(
    event: SavedUserEntryEvent,
    builtInControllers: readonly SavedEntryBuiltInController[],
    scriptController: SavedEntryScriptController | null,
    agentController: SavedEntryAgentController,
): Promise<void> {
    for (const controller of builtInControllers) {
        if (await controller.handleSavedUserEntry(event)) return;
    }
    const handledByScript = await scriptController?.handleSavedUserEntry(event) ?? false;
    if (!handledByScript) await agentController.handleSavedUserEntry(event);
}
```

In `src/main.ts`, construct `UpdateScriptCommandController` with the same reply insertion behavior as create-script, dispatch valid requests to `commentAgentController.handleUpdateScriptRequest`, initialize and dispose it with the plugin lifecycle, and route `[updateScriptCommandController, createScriptCommandController]` before the direct script controller. Supply `resolveVaultScriptMention` and `targetScriptPath` through the comment-agent runtime host.

- [ ] **Step 6: Run controller, routing, persistence-view, and stream tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/updateScriptCommandController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: all selected tests pass; update requests route exactly once and Regenerate never uses a stale target.

- [ ] **Step 7: Commit the end-to-end update flow**

```bash
git add src/agents/commentAgentController.ts src/main.ts src/vaultScripts/commentScriptController.ts tests/commentAgentController.test.ts tests/commentScriptController.test.ts tests/sidebarPersistedComment.test.ts tests/streamedAgentReplyController.test.ts
git commit -m "feat(scripts): update registered scripts"
```

### Task 7: Verify the complete change and update tracked status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-update-script-actionable-mentions-design.md`

- [ ] **Step 1: Re-run the change-surface search**

Run:

```bash
rg -n "RESERVED_BUILT_IN_SLASH_MENTION_NAMES|isRunnableVaultScriptMention|@hi|@idea|@safe|/create-script|/update-script" src shared tests
```

Expected: no obsolete reserved-name export or renderer host predicate remains; intentional command copy appears only in shared policy, parsers, prompt policy, compact user guidance, and tests.

- [ ] **Step 2: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: all tests pass, 0 fail.

- [ ] **Step 3: Run lint and typecheck**

Run:

```bash
npm run lint && npm run typecheck
```

Expected: both commands exit 0 with no warnings or errors.

- [ ] **Step 4: Build and inspect the exact public artifact**

Run:

```bash
npm run bundle && npm run release:artifacts:check
```

Expected: the production bundle succeeds and the release artifact guard confirms only `main.js`, `manifest.json`, and `styles.css`; no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source, secret-bearing file, or local path is present.

- [ ] **Step 5: Perform installed-plugin frontend acceptance**

Run:

```bash
npm run dev:install-built -- --vault ..
obsidian plugin:reload id=aside vault=dev
```

Then submit `/update-script /embed-image-urls make the default size reasonable. currently too big.` in a real Aside thread. Confirm the existing script is edited in place, its next invocation uses the new default, `/update-script` and the registered target are blue, and `@hi` remains plain.

Expected: the command streams one agent run, edits only the registered target, and the rendering states match the shared actionable policy.

- [ ] **Step 6: Update the tracked spec**

Mark implemented checklist items and automated verification items `[x]` only after the commands above pass. Leave the installed-plugin smoke test unchecked until it is performed in Obsidian. Change the status to `Implemented; frontend acceptance pending` if only that smoke test remains.

- [ ] **Step 7: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-21-update-script-actionable-mentions-design.md
git commit -m "docs: record update-script verification"
```
