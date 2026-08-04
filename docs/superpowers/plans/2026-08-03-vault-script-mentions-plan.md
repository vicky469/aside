# Vault Script Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make direct JavaScript files in the active vault's `🛠️ scripts/` folder immediately available as `@script-name` side-note directives that run against the current note without invoking an agent.

**Architecture:** A shared CommonJS policy owns the one user-facing folder and filename rules. A pure in-memory registry feeds the draft mention UI, while a dedicated persisted script-run store and controller route saved entries before agent dispatch, execute Node without a shell, and expose explicit Regenerate behavior to the existing sidebar footer. Main remains the Obsidian adapter for vault events, filesystem paths, and Electron Node modules.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13 APIs, Node `child_process.execFile`, CommonJS shared policy modules, Node test runner, esbuild.

---

## File Structure

### New files

- `shared/vaultScriptPolicy.js` — single source of truth for the vault-relative folder, supported filenames, exclusions, and mention identities.
- `shared/vaultScriptPolicy.d.ts` — typed contract for TypeScript consumers.
- `src/core/comments/savedUserEntry.ts` — runtime-neutral saved-entry event shared by agent and script controllers.
- `src/core/scripts/scriptRuns.ts` — persisted script-run types and lookup/clone helpers.
- `src/vaultScripts/vaultScriptRegistry.ts` — live, in-memory registry derived only from vault-relative paths.
- `src/vaultScripts/scriptRunStorePlanner.ts` — persisted-data validation and normalization.
- `src/vaultScripts/scriptRunStore.ts` — immutable run storage over plugin data.
- `src/vaultScripts/vaultScriptRuntime.ts` — contained-path validation and shell-free Node execution.
- `src/vaultScripts/scriptDirectives.ts` — saved-text routing for script, agent, mixed, ambiguous, and ordinary mentions.
- `src/vaultScripts/commentScriptController.ts` — idempotent dispatch, serial execution, result persistence, and regeneration.
- `src/ui/editor/commentMentionSuggestions.ts` — open-mention parsing, replacement, and filtered suggestion planning.
- `src/ui/modals/SideNoteMentionSuggestModal.ts` — Obsidian suggestion modal for built-ins and scripts.
- `tests/vaultScriptPolicy.test.mjs` — shared policy and prompt-policy coverage.
- `tests/vaultScriptRegistry.test.ts` — seed/create/rename/delete/collision behavior.
- `tests/commentMentionSuggestions.test.ts` — mention query, filtering, and replacement behavior.
- `tests/scriptRunStorePlanner.test.ts` — persisted record normalization.
- `tests/vaultScriptRuntime.test.ts` — exact invocation, containment, timeout, and output limits.
- `tests/scriptDirectives.test.ts` — routing and agent-bypass decisions.
- `tests/commentScriptController.test.ts` — automatic run-once behavior, failures, and regeneration.

### Modified files

- `shared/sideNotePromptPolicy.js` — tell agents that reusable user scripts belong under the active vault's `🛠️ scripts/`.
- `tests/sideNotePromptPolicy.test.mjs` — verify vault-vs-repository wording.
- `src/agents/commentAgentController.ts` — consume the shared saved-entry event type.
- `src/comments/commentMutationController.ts` — consume the shared saved-entry event type.
- `src/settings/indexNoteSettingsPlanner.ts` — admit `scriptRuns` in persisted plugin data.
- `src/main.ts` — seed/update the registry, host the controller/runtime adapter, route before agents, and expose script runs/retry to views.
- `src/app/pluginLifecycleController.ts` — rename script-run note paths with source-note renames.
- `src/ui/views/sidebarDraftEditor.ts` — coordinate the mention modal with link/tag modals.
- `src/ui/views/sidebarDraftComment.ts` — open mention suggestions on `@` and Tab.
- `src/ui/views/AsideView.ts` — provide live suggestions and per-thread script runs to renderers.
- `src/ui/views/sidebarPersistedComment.ts` — label script output, keep it visible, and wire Regenerate.
- `tests/sidebarDraftEditor.test.ts` — controller integration for mention insertion.
- `tests/sidebarPersistedComment.test.ts` — script attribution, visibility, busy state, and Regenerate wiring.
- `tests/pluginLifecycleController.test.ts` — source-note rename propagation for script runs.
- `tests/asideSettingCatalog.test.ts` — assert that no vault-script setting appears.
- `tests/sidebarModeTabs.test.ts` — assert that no Scripts tab appears.
- `tsconfig.test.json` — include the new shared policy module in test compilation.

## Task 1: Centralize the user-facing vault script policy

**Files:**
- Create: `shared/vaultScriptPolicy.js`
- Create: `shared/vaultScriptPolicy.d.ts`
- Modify: `shared/sideNotePromptPolicy.js`
- Modify: `tests/sideNotePromptPolicy.test.mjs`
- Create: `tests/vaultScriptPolicy.test.mjs`
- Modify: `tsconfig.test.json`

- [x] **Step 1: Write failing shared-policy tests**

Create `tests/vaultScriptPolicy.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import vaultScriptPolicy from "../shared/vaultScriptPolicy.js";

test("parseVaultScriptPath accepts only direct user-facing JavaScript files", () => {
    assert.deepEqual(vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/clean-links.mjs"), {
        path: "🛠️ scripts/clean-links.mjs",
        fileName: "clean-links.mjs",
        mentionName: "clean-links",
        normalizedMentionName: "clean-links",
    });
    assert.equal(vaultScriptPolicy.parseVaultScriptPath("scripts/clean-links.mjs"), null);
    assert.equal(vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/nested/clean-links.mjs"), null);
    assert.equal(vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/.hidden.mjs"), null);
    assert.equal(vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/clean-links.test.mjs"), null);
    assert.equal(vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/clean-links.spec.js"), null);
    assert.equal(vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/clean-links.ts"), null);
});

test("collectVaultScriptRegistrations withholds case-insensitive collisions", () => {
    assert.deepEqual(vaultScriptPolicy.collectVaultScriptRegistrations([
        "🛠️ scripts/Clean.mjs",
        "🛠️ scripts/clean.js",
        "🛠️ scripts/format.cjs",
    ]), {
        runnable: [{
            path: "🛠️ scripts/format.cjs",
            fileName: "format.cjs",
            mentionName: "format",
            normalizedMentionName: "format",
        }],
        ambiguousMentionNames: ["clean"],
    });
});
```

Extend `tests/sideNotePromptPolicy.test.mjs`:

```js
test("buildSideNotePrompt directs reusable scripts to the active vault only", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "@codex write a reusable cleanup script",
        rootLabel: "vault root",
        rootPath: "/vault",
    });

    assert.match(prompt, /active vault's `🛠️ scripts\/`/u);
    assert.match(prompt, /not the plugin repository's internal `scripts\/`/u);
});
```

- [x] **Step 2: Run the tests and verify the missing module/policy failures**

Run:

```bash
node --test tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs
```

Expected: FAIL because `shared/vaultScriptPolicy.js` does not exist and the prompt lacks the vault-script instruction.

- [x] **Step 3: Implement the shared policy and prompt consumption**

Create `shared/vaultScriptPolicy.js`:

```js
const VAULT_SCRIPT_FOLDER_PATH = "🛠️ scripts";
const SUPPORTED_VAULT_SCRIPT_EXTENSIONS = Object.freeze([".mjs", ".js", ".cjs"]);
const TEST_SCRIPT_PATTERN = /\.(?:test|spec)\.(?:mjs|js|cjs)$/iu;

function normalizeVaultPath(value) {
    return typeof value === "string"
        ? value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "")
        : "";
}

function parseVaultScriptPath(value) {
    const path = normalizeVaultPath(value);
    const prefix = `${VAULT_SCRIPT_FOLDER_PATH}/`;
    if (!path.startsWith(prefix)) return null;
    const fileName = path.slice(prefix.length);
    if (!fileName || fileName.includes("/") || fileName.startsWith(".") || TEST_SCRIPT_PATTERN.test(fileName)) {
        return null;
    }
    const extension = SUPPORTED_VAULT_SCRIPT_EXTENSIONS.find((candidate) =>
        fileName.toLowerCase().endsWith(candidate)
    );
    if (!extension) return null;
    const mentionName = fileName.slice(0, -extension.length);
    if (!mentionName || !/^[A-Za-z0-9_.-]+$/u.test(mentionName)) return null;
    return {
        path,
        fileName,
        mentionName,
        normalizedMentionName: mentionName.toLowerCase(),
    };
}

function collectVaultScriptRegistrations(paths) {
    const grouped = new Map();
    for (const path of paths) {
        const script = parseVaultScriptPath(path);
        if (!script) continue;
        const group = grouped.get(script.normalizedMentionName) ?? [];
        group.push(script);
        grouped.set(script.normalizedMentionName, group);
    }
    const ambiguousMentionNames = [];
    const runnable = [];
    for (const [mentionName, scripts] of grouped) {
        if (scripts.length > 1) ambiguousMentionNames.push(mentionName);
        else runnable.push(scripts[0]);
    }
    runnable.sort((left, right) => left.mentionName.localeCompare(right.mentionName));
    ambiguousMentionNames.sort((left, right) => left.localeCompare(right));
    return { runnable, ambiguousMentionNames };
}

module.exports = {
    VAULT_SCRIPT_FOLDER_PATH,
    SUPPORTED_VAULT_SCRIPT_EXTENSIONS,
    collectVaultScriptRegistrations,
    parseVaultScriptPath,
};
```

Create `shared/vaultScriptPolicy.d.ts`:

```ts
export const VAULT_SCRIPT_FOLDER_PATH: string;
export const SUPPORTED_VAULT_SCRIPT_EXTENSIONS: readonly string[];

export interface VaultScriptRegistration {
    path: string;
    fileName: string;
    mentionName: string;
    normalizedMentionName: string;
}

export interface VaultScriptRegistrationSet {
    runnable: VaultScriptRegistration[];
    ambiguousMentionNames: string[];
}

export function parseVaultScriptPath(value: unknown): VaultScriptRegistration | null;
export function collectVaultScriptRegistrations(paths: readonly unknown[]): VaultScriptRegistrationSet;
```

In `shared/sideNotePromptPolicy.js`, import `VAULT_SCRIPT_FOLDER_PATH` and add this exact prompt line after the file-change rule:

```js
`If the user asks you to create a reusable script for their vault, place it directly under the active vault's \`${VAULT_SCRIPT_FOLDER_PATH}/\`, not the plugin repository's internal \`scripts/\`.`,
```

Add `"shared/vaultScriptPolicy.js"` to `tsconfig.test.json`'s `include` array.

- [x] **Step 4: Run the shared-policy tests**

Run:

```bash
node --test tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs
```

Expected: all policy and prompt tests PASS.

- [x] **Step 5: Commit the policy slice**

```bash
git add shared/vaultScriptPolicy.js shared/vaultScriptPolicy.d.ts shared/sideNotePromptPolicy.js tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs tsconfig.test.json
git commit -m "feat(scripts): define vault script policy"
```

## Task 2: Build the live vault script registry

**Files:**
- Create: `src/vaultScripts/vaultScriptRegistry.ts`
- Create: `tests/vaultScriptRegistry.test.ts`

- [x] **Step 1: Write failing registry tests**

Create tests that seed irrelevant and valid paths, add a new direct script, rename it, delete it, and introduce/remove a duplicate name:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";

test("registry reflects seed, create, rename, and delete immediately", () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["Note.md", "scripts/dev.mjs", "🛠️ scripts/clean.mjs"]);
    assert.deepEqual(registry.getRunnableScripts().map((script) => script.mentionName), ["clean"]);
    registry.upsert("🛠️ scripts/format.js");
    assert.deepEqual(registry.getRunnableScripts().map((script) => script.mentionName), ["clean", "format"]);
    registry.rename("🛠️ scripts/format.js", "🛠️ scripts/rewrite.js");
    assert.deepEqual(registry.getRunnableScripts().map((script) => script.mentionName), ["clean", "rewrite"]);
    registry.remove("🛠️ scripts/clean.mjs");
    assert.deepEqual(registry.getRunnableScripts().map((script) => script.mentionName), ["rewrite"]);
});

test("registry withholds collisions until one path is removed", () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["🛠️ scripts/Clean.mjs", "🛠️ scripts/clean.js"]);
    assert.deepEqual(registry.getRunnableScripts(), []);
    assert.deepEqual(registry.getAmbiguousMentionNames(), ["clean"]);
    registry.remove("🛠️ scripts/clean.js");
    assert.equal(registry.resolve("@clean")?.path, "🛠️ scripts/Clean.mjs");
});
```

- [x] **Step 2: Run the compiled test and verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/vaultScriptRegistry.test.js
```

Expected: FAIL because `VaultScriptRegistry` does not exist.

- [x] **Step 3: Implement the minimal registry**

Implement `src/vaultScripts/vaultScriptRegistry.ts`:

```ts
import {
    collectVaultScriptRegistrations,
    type VaultScriptRegistration,
} from "../../shared/vaultScriptPolicy.js";

function normalizeMention(value: string): string {
    return value.trim().replace(/^@/u, "").toLowerCase();
}

export class VaultScriptRegistry {
    private readonly paths = new Set<string>();
    private runnable: VaultScriptRegistration[] = [];
    private ambiguousMentionNames: string[] = [];

    public seed(paths: readonly string[]): void {
        this.paths.clear();
        paths.forEach((path) => this.paths.add(path));
        this.rebuild();
    }

    public upsert(path: string): void {
        this.paths.add(path);
        this.rebuild();
    }

    public rename(previousPath: string, nextPath: string): void {
        this.paths.delete(previousPath);
        this.paths.add(nextPath);
        this.rebuild();
    }

    public remove(path: string): void {
        this.paths.delete(path);
        this.rebuild();
    }

    public getRunnableScripts(): VaultScriptRegistration[] {
        return this.runnable.map((script) => ({ ...script }));
    }

    public getAmbiguousMentionNames(): string[] {
        return this.ambiguousMentionNames.slice();
    }

    public resolve(mention: string): VaultScriptRegistration | null {
        const normalized = normalizeMention(mention);
        const script = this.runnable.find((candidate) => candidate.normalizedMentionName === normalized);
        return script ? { ...script } : null;
    }

    public isAmbiguous(mention: string): boolean {
        return this.ambiguousMentionNames.includes(normalizeMention(mention));
    }

    private rebuild(): void {
        const next = collectVaultScriptRegistrations(Array.from(this.paths));
        this.runnable = next.runnable;
        this.ambiguousMentionNames = next.ambiguousMentionNames;
    }
}
```

- [x] **Step 4: Run the registry tests**

Run the Task 2 command again. Expected: PASS.

- [x] **Step 5: Commit the registry slice**

```bash
git add src/vaultScripts/vaultScriptRegistry.ts tests/vaultScriptRegistry.test.ts
git commit -m "feat(scripts): add live vault registry"
```

## Task 3: Add `@` mention suggestions to the draft editor

**Files:**
- Create: `src/ui/editor/commentMentionSuggestions.ts`
- Create: `src/ui/modals/SideNoteMentionSuggestModal.ts`
- Modify: `src/ui/views/sidebarDraftEditor.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `src/ui/views/AsideView.ts`
- Create: `tests/commentMentionSuggestions.test.ts`
- Modify: `tests/sidebarDraftEditor.test.ts`

- [x] **Step 1: Write failing pure mention tests**

Create `tests/commentMentionSuggestions.test.ts` covering a collapsed selection after `@`, an existing `@query`, whitespace boundaries, surrounding text preservation, case-insensitive ranking, and built-in directives before scripts:

```ts
const query = findOpenMentionQuery("please @cle now", 11, 11);
assert.deepEqual(query, { start: 7, end: 11, query: "cle" });
assert.deepEqual(replaceOpenMentionQuery("please @cle now", query!, "@clean-links"), {
    value: "please @clean-links now",
    selectionStart: 19,
    selectionEnd: 19,
});
assert.deepEqual(buildMentionSuggestions([
    { path: "🛠️ scripts/clean-links.mjs", fileName: "clean-links.mjs", mentionName: "clean-links", normalizedMentionName: "clean-links" },
], "cl").map((item) => item.mention), ["@claude", "@clean-links"]);
```

Extend `tests/sidebarDraftEditor.test.ts` with a host spy proving `openDraftMentionSuggest()` replaces the query and updates the draft.

- [x] **Step 2: Compile and verify the missing API failures**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftEditor.test.js
```

Expected: FAIL because the mention helpers and controller method do not exist.

- [x] **Step 3: Implement pure mention parsing and ranking**

Implement the pure helpers in `commentMentionSuggestions.ts`:

```ts
import type { VaultScriptRegistration } from "../../../shared/vaultScriptPolicy.js";
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import type { TextEditResult } from "./commentEditorFormatting";

export interface OpenMentionQuery { start: number; end: number; query: string }
export type SideNoteMentionSuggestion =
    | { kind: "built-in"; mention: "@todo" | `@${string}`; label: string }
    | { kind: "script"; mention: `@${string}`; label: string; scriptPath: string };

export function findOpenMentionQuery(
    value: string,
    selectionStart: number,
    selectionEnd: number,
): OpenMentionQuery | null {
    if (selectionStart !== selectionEnd) return null;
    const prefix = value.slice(0, selectionStart);
    const match = /(^|[^\w])@([A-Za-z0-9_.-]*)$/u.exec(prefix);
    if (!match) return null;
    const start = selectionStart - (match[2]?.length ?? 0) - 1;
    return { start, end: selectionStart, query: match[2] ?? "" };
}

export function replaceOpenMentionQuery(
    value: string,
    query: OpenMentionQuery,
    mention: string,
): TextEditResult {
    const normalizedMention = mention.startsWith("@") ? mention : `@${mention}`;
    const cursor = query.start + normalizedMention.length;
    return {
        value: `${value.slice(0, query.start)}${normalizedMention}${value.slice(query.end)}`,
        selectionStart: cursor,
        selectionEnd: cursor,
    };
}

export function buildMentionSuggestions(
    scripts: readonly VaultScriptRegistration[],
    rawQuery: string,
): SideNoteMentionSuggestion[] {
    const query = rawQuery.trim().replace(/^@/u, "").toLowerCase();
    const builtIns: SideNoteMentionSuggestion[] = [
        { kind: "built-in", mention: "@todo", label: "Todo" },
        ...getSupportedAgentActors().map((actor) => ({
            kind: "built-in" as const,
            mention: actor.directive,
            label: actor.label,
        })),
    ];
    const candidates: SideNoteMentionSuggestion[] = builtIns.concat(scripts.map((script) => ({
        kind: "script" as const,
        mention: `@${script.mentionName}` as `@${string}`,
        label: script.fileName,
        scriptPath: script.path,
    })));
    const score = (mention: string): number => {
        const name = mention.slice(1).toLowerCase();
        if (!query || name === query) return 0;
        if (name.startsWith(query)) return 1;
        return name.includes(query) ? 2 : Number.POSITIVE_INFINITY;
    };
    return candidates
        .map((candidate, index) => ({ candidate, index, score: score(candidate.mention) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => left.score - right.score || left.index - right.index)
        .map((item) => item.candidate);
}
```

- [x] **Step 4: Implement the modal and controller wiring**

Create `SideNoteMentionSuggestModal` with this complete behavior:

```ts
import { App, SuggestModal } from "obsidian";
import type { SideNoteMentionSuggestion } from "../editor/commentMentionSuggestions";

export interface SideNoteMentionSuggestModalOptions {
    initialQuery: string;
    getSuggestions(query: string): SideNoteMentionSuggestion[];
    onChooseMention(mention: string): void | Promise<void>;
    onCloseModal(): void;
}

export default class SideNoteMentionSuggestModal extends SuggestModal<SideNoteMentionSuggestion> {
    constructor(app: App, private readonly options: SideNoteMentionSuggestModalOptions) {
        super(app);
        this.limit = 40;
        this.setPlaceholder("Mention an agent, todo, or vault script");
        this.emptyStateText = "No matching mention.";
    }

    onOpen(): void {
        void super.onOpen();
        this.setTitle("Insert mention");
        this.inputEl.value = this.options.initialQuery;
        this.inputEl.dispatchEvent(new Event("input"));
        this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
    }

    onClose(): void {
        super.onClose();
        this.options.onCloseModal();
    }

    getSuggestions(query: string): SideNoteMentionSuggestion[] {
        return this.options.getSuggestions(query);
    }

    renderSuggestion(suggestion: SideNoteMentionSuggestion, el: HTMLElement): void {
        el.createDiv({ text: suggestion.mention });
        el.createDiv({
            cls: "aside-mention-suggest-note",
            text: suggestion.kind === "script" ? suggestion.scriptPath : suggestion.label,
        });
    }

    onChooseSuggestion(suggestion: SideNoteMentionSuggestion): void {
        void this.options.onChooseMention(suggestion.mention);
    }
}
```

Extend `SidebarDraftEditorHost` with `getMentionSuggestions(query)` and `openMentionSuggestModal(options)`, add `"mention"` to `activeInlineSuggest`, and implement this controller method:

```ts
public openDraftMentionSuggest(comment: DraftComment, textarea: HTMLTextAreaElement, isEditMode: boolean): boolean {
    if (this.activeInlineSuggest) return false;
    const mentionQuery = findOpenMentionQuery(textarea.value, textarea.selectionStart, textarea.selectionEnd);
    if (!mentionQuery) return false;
    const initialValue = textarea.value;
    const initialCursor = mentionQuery.end;
    let inserted = false;
    this.activeInlineSuggest = "mention";
    this.host.openMentionSuggestModal({
        initialQuery: mentionQuery.query,
        getSuggestions: (query) => this.host.getMentionSuggestions(query),
        onChooseMention: async (mention) => {
            inserted = true;
            const edit = replaceOpenMentionQuery(initialValue, mentionQuery, mention);
            if (textarea.isConnected) {
                this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
                textarea.focus();
            } else {
                this.host.updateDraftCommentText(comment.id, edit.value);
                await this.host.renderComments();
                this.host.scheduleDraftFocus(comment.id);
            }
        },
        onCloseModal: () => {
            this.activeInlineSuggest = null;
            if (!inserted && textarea.isConnected) {
                window.requestAnimationFrame(() => {
                    textarea.focus();
                    textarea.setSelectionRange(initialCursor, initialCursor);
                });
            }
        },
    });
    return true;
}
```

In `sidebarDraftComment.ts`, open mention suggestions when `InputEvent.data === "@"`; on Tab, try mention before link and tag. In `AsideView.ts`, build suggestions from `plugin.getRunnableVaultScripts()` and open the modal.

- [x] **Step 5: Run the mention-editor tests**

Run the Task 3 command again. Expected: PASS.

- [x] **Step 6: Commit the suggestion slice**

```bash
git add src/ui/editor/commentMentionSuggestions.ts src/ui/modals/SideNoteMentionSuggestModal.ts src/ui/views/sidebarDraftEditor.ts src/ui/views/sidebarDraftComment.ts src/ui/views/AsideView.ts tests/commentMentionSuggestions.test.ts tests/sidebarDraftEditor.test.ts
git commit -m "feat(scripts): suggest vault script mentions"
```

## Task 4: Persist independent script-run records

**Files:**
- Create: `src/core/comments/savedUserEntry.ts`
- Create: `src/core/scripts/scriptRuns.ts`
- Create: `src/vaultScripts/scriptRunStorePlanner.ts`
- Create: `src/vaultScripts/scriptRunStore.ts`
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/comments/commentMutationController.ts`
- Modify: `src/settings/indexNoteSettingsPlanner.ts`
- Create: `tests/scriptRunStorePlanner.test.ts`

- [x] **Step 1: Write failing normalization and lookup tests**

Cover malformed-record rejection, valid queued/succeeded records, optional retry lineage, output-entry lookup, latest-trigger lookup, and cloning. Use this record shape:

```ts
{
    id: "script-run-1",
    threadId: "thread-1",
    triggerEntryId: "entry-1",
    filePath: "Note.md",
    scriptPath: "🛠️ scripts/clean.mjs",
    mentionName: "clean",
    status: "succeeded",
    promptText: "@clean",
    createdAt: 100,
    startedAt: 101,
    endedAt: 102,
    outputEntryId: "entry-2",
}
```

- [x] **Step 2: Compile and verify missing-type failures**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/scriptRunStorePlanner.test.js
```

Expected: FAIL because script-run modules do not exist.

- [x] **Step 3: Implement script-run types, planner, and store**

Create `src/core/comments/savedUserEntry.ts`:

```ts
export interface SavedUserEntryEvent {
    threadId: string;
    entryId: string;
    filePath: string;
    body: string;
}
```

Create the core run contract in `src/core/scripts/scriptRuns.ts`:

```ts
export type ScriptRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface ScriptRunRecord {
    id: string;
    threadId: string;
    triggerEntryId: string;
    filePath: string;
    scriptPath: string;
    mentionName: string;
    status: ScriptRunStatus;
    promptText: string;
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    retryOfRunId?: string;
    outputEntryId?: string;
    error?: string;
}

export const cloneScriptRunRecord = (run: ScriptRunRecord): ScriptRunRecord => ({ ...run });
export const cloneScriptRunRecords = (runs: readonly ScriptRunRecord[]): ScriptRunRecord[] =>
    runs.map(cloneScriptRunRecord);
export const getScriptRunById = (runs: readonly ScriptRunRecord[], runId: string): ScriptRunRecord | null =>
    runs.find((run) => run.id === runId) ?? null;
export const getScriptRunByOutputEntryId = (runs: readonly ScriptRunRecord[], entryId: string): ScriptRunRecord | null =>
    runs.findLast((run) => run.outputEntryId === entryId) ?? null;
export const getLatestScriptRunForTriggerEntry = (
    runs: readonly ScriptRunRecord[], triggerEntryId: string,
): ScriptRunRecord | null => runs.findLast((run) => run.triggerEntryId === triggerEntryId) ?? null;
export const getScriptRunsForThread = (
    runs: readonly ScriptRunRecord[], thread: { id: string },
): ScriptRunRecord[] => runs.filter((run) => run.threadId === thread.id).map(cloneScriptRunRecord);
```

Implement `normalizePersistedScriptRuns()` with strict field checks:

```ts
export function normalizePersistedScriptRuns(value: unknown): ScriptRunRecord[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const raw = item as Record<string, unknown>;
        const status = raw.status === "queued" || raw.status === "running"
            || raw.status === "succeeded" || raw.status === "failed" ? raw.status : null;
        const requiredStrings = ["id", "threadId", "triggerEntryId", "filePath", "scriptPath", "mentionName"] as const;
        if (!status || requiredStrings.some((key) => typeof raw[key] !== "string" || !(raw[key] as string).trim())) {
            return [];
        }
        if (typeof raw.promptText !== "string" || typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) {
            return [];
        }
        const optionalString = (key: string): string | undefined =>
            typeof raw[key] === "string" && (raw[key] as string).trim() ? raw[key] as string : undefined;
        const optionalNumber = (key: string): number | undefined =>
            typeof raw[key] === "number" && Number.isFinite(raw[key]) ? raw[key] as number : undefined;
        return [{
            id: raw.id as string,
            threadId: raw.threadId as string,
            triggerEntryId: raw.triggerEntryId as string,
            filePath: raw.filePath as string,
            scriptPath: raw.scriptPath as string,
            mentionName: raw.mentionName as string,
            status,
            promptText: raw.promptText,
            createdAt: raw.createdAt,
            startedAt: optionalNumber("startedAt"),
            endedAt: optionalNumber("endedAt"),
            retryOfRunId: optionalString("retryOfRunId"),
            outputEntryId: optionalString("outputEntryId"),
            error: optionalString("error"),
        }];
    });
}
```

Implement `ScriptRunStore` with immutable replacements and one `persist()` owner:

```ts
export class ScriptRunStore {
    private runs: ScriptRunRecord[] = [];
    constructor(private readonly host: ScriptRunStoreHost) {}
    public load(): void {
        this.runs = normalizePersistedScriptRuns(this.host.readPersistedPluginData()?.scriptRuns);
    }
    public getRuns(): ScriptRunRecord[] { return cloneScriptRunRecords(this.runs); }
    public getRunById(id: string): ScriptRunRecord | null {
        const run = getScriptRunById(this.runs, id);
        return run ? cloneScriptRunRecord(run) : null;
    }
    public async addRun(run: ScriptRunRecord): Promise<ScriptRunRecord> {
        this.runs = this.runs.concat(cloneScriptRunRecord(run));
        await this.persist();
        return cloneScriptRunRecord(run);
    }
    public async updateRun(id: string, update: (run: ScriptRunRecord) => ScriptRunRecord): Promise<ScriptRunRecord | null> {
        let result: ScriptRunRecord | null = null;
        this.runs = this.runs.map((run) => run.id === id ? (result = cloneScriptRunRecord(update(run))) : run);
        if (!result) return null;
        await this.persist();
        return cloneScriptRunRecord(result);
    }
    public async failPendingRuns(error: string, endedAt: number): Promise<boolean> {
        let changed = false;
        this.runs = this.runs.map((run) => {
            if (run.status !== "queued" && run.status !== "running") return run;
            changed = true;
            return { ...run, status: "failed", endedAt, error };
        });
        if (changed) await this.persist();
        return changed;
    }
    public async renameFile(from: string, to: string): Promise<boolean> {
        let changed = false;
        this.runs = this.runs.map((run) => run.filePath === from
            ? (changed = true, { ...run, filePath: to })
            : run);
        if (changed) await this.persist();
        return changed;
    }
    private async persist(): Promise<void> {
        const data = this.host.readPersistedPluginData() ?? {};
        await this.host.writePersistedPluginData({ ...data, scriptRuns: cloneScriptRunRecords(this.runs) });
    }
}
```

Update the agent and mutation controllers to import `SavedUserEntryEvent` from its new core file. Add `scriptRuns?: unknown` to `PersistedPluginData`.

- [x] **Step 4: Run planner tests plus existing agent tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/scriptRunStorePlanner.test.js .test-dist/tests/agentRunStorePlanner.test.js .test-dist/tests/commentAgentController.test.js
```

Expected: PASS.

- [x] **Step 5: Commit the persistence slice**

```bash
git add src/core/comments/savedUserEntry.ts src/core/scripts/scriptRuns.ts src/vaultScripts/scriptRunStorePlanner.ts src/vaultScripts/scriptRunStore.ts src/agents/commentAgentController.ts src/comments/commentMutationController.ts src/settings/indexNoteSettingsPlanner.ts tests/scriptRunStorePlanner.test.ts
git commit -m "feat(scripts): persist script run records"
```

## Task 5: Implement contained, shell-free Node execution

**Files:**
- Create: `src/vaultScripts/vaultScriptRuntime.ts`
- Create: `tests/vaultScriptRuntime.test.ts`

- [x] **Step 1: Write failing runtime tests with injected modules**

Test that a valid call invokes exactly:

```ts
assert.deepEqual(invocation, {
    file: "node",
    args: ["/vault/🛠️ scripts/clean.mjs", "/vault/Folder/Note.md"],
    options: {
        cwd: "/vault",
        timeout: 60_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
    },
});
```

Also test repository `scripts/`, subfolders, unsupported extensions, non-markdown targets, `realpath` escapes, non-zero exits with stderr, output overflow, and empty success.

- [x] **Step 2: Compile and verify missing-runtime failures**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/vaultScriptRuntime.test.js
```

Expected: FAIL because `runVaultScript` does not exist.

- [x] **Step 3: Implement the runtime contract**

Export injectable interfaces and implement the runtime as follows:

```ts
import { parseVaultScriptPath } from "../../shared/vaultScriptPolicy.js";

export const VAULT_SCRIPT_TIMEOUT_MS = 60_000;
export const VAULT_SCRIPT_MAX_BUFFER_BYTES = 64 * 1024;

export interface VaultScriptRuntimeInvocation {
    vaultRootPath: string;
    scriptPath: string;
    notePath: string;
}

export interface VaultScriptRuntimeResult {
    stdout: string;
    stderr: string;
}

export interface VaultScriptRuntimeModules {
    isScriptLaunchAllowed(scriptPath: string): boolean;
    nodeExecutable: string;
    processEnv: Readonly<Record<string, string | undefined>>;
    childProcess: {
        execFile(
            file: string,
            args: string[],
            options: {
                cwd: string;
                timeout: number;
                maxBuffer: number;
                windowsHide: boolean;
                env: Record<string, string | undefined>;
            },
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ): unknown;
    };
    fsPromises: { realpath(path: string): Promise<string> };
    path: {
        isAbsolute(path: string): boolean;
        relative(from: string, to: string): string;
        resolve(...paths: string[]): string;
        sep: string;
    };
}

function assertContained(modules: VaultScriptRuntimeModules, root: string, target: string): void {
    const relative = modules.path.relative(root, target);
    if (!relative || relative === ".." || relative.startsWith(`..${modules.path.sep}`) || modules.path.isAbsolute(relative)) {
        throw new Error("Vault script target escapes the active vault.");
    }
}

export async function runVaultScript(
    modules: VaultScriptRuntimeModules,
    invocation: VaultScriptRuntimeInvocation,
): Promise<VaultScriptRuntimeResult> {
    const registration = parseVaultScriptPath(invocation.scriptPath);
    if (!registration) throw new Error("Script is not a registered direct child of the vault's 🛠️ scripts/ folder.");
    if (!/\.md$/iu.test(invocation.notePath)) throw new Error("Vault scripts require a markdown note target.");

    const realVaultRoot = await modules.fsPromises.realpath(invocation.vaultRootPath);
    const realScriptPath = await modules.fsPromises.realpath(
        modules.path.resolve(realVaultRoot, ...registration.path.split("/")),
    );
    const realNotePath = await modules.fsPromises.realpath(
        modules.path.resolve(realVaultRoot, ...invocation.notePath.split("/")),
    );
    assertContained(modules, realVaultRoot, realScriptPath);
    assertContained(modules, realVaultRoot, realNotePath);
    const expectedRelativeScriptPath = registration.path.split("/").join(modules.path.sep);
    if (modules.path.relative(realVaultRoot, realScriptPath) !== expectedRelativeScriptPath) {
        throw new Error("Registered vault script resolves outside its direct user-facing path.");
    }

    return await new Promise<VaultScriptRuntimeResult>((resolve, reject) => {
        modules.childProcess.execFile(
            modules.nodeExecutable,
            [realScriptPath, realNotePath],
            {
                cwd: realVaultRoot,
                timeout: VAULT_SCRIPT_TIMEOUT_MS,
                maxBuffer: VAULT_SCRIPT_MAX_BUFFER_BYTES,
                windowsHide: true,
                env: { ...modules.processEnv },
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                    return;
                }
                resolve({ stdout, stderr });
            },
        );
    });
}
```

- [x] **Step 4: Run the runtime tests**

Run the Task 5 command again. Expected: PASS.

- [x] **Step 5: Commit the runtime slice**

```bash
git add src/vaultScripts/vaultScriptRuntime.ts tests/vaultScriptRuntime.test.ts
git commit -m "feat(scripts): run vault scripts safely"
```

## Task 6: Route saved entries through the script controller before agents

**Files:**
- Create: `src/vaultScripts/scriptDirectives.ts`
- Create: `src/vaultScripts/commentScriptController.ts`
- Create: `tests/scriptDirectives.test.ts`
- Create: `tests/commentScriptController.test.ts`
- Modify: `src/main.ts`

- [x] **Step 1: Write failing directive-routing tests**

Use a registry containing `clean` and an ambiguous `format`. Assert these outcomes:

```ts
assert.deepEqual(resolveScriptDirective("run @clean", registry), {
    kind: "script",
    script: registry.resolve("clean"),
});
assert.equal(resolveScriptDirective("ordinary @person", registry).kind, "none");
assert.equal(resolveScriptDirective("@clean and @codex", registry).kind, "rejected");
assert.equal(resolveScriptDirective("@clean then @other-script", registry).kind, "rejected");
assert.equal(resolveScriptDirective("@format", registry).kind, "rejected");
```

The rejected result must include a stable user-facing message and the involved normalized mention names.

- [x] **Step 2: Write failing controller tests**

Build a harness like `commentAgentController.test.ts` with an in-memory `CommentManager`, `ScriptRunStore`, fake registry, injected `runVaultScript`, append/edit spies, and a fixed clock/id source. Cover:

- first save creates one run and one output entry;
- repeated handling of the same trigger entry creates no second process;
- a queued run whose mention becomes missing, ambiguous, or resolves to a different path fails without launching;
- success prefixes output with `Script @clean:`;
- empty success reports completion;
- failure persists `failed` and writes a concise result;
- mixed/multiple/ambiguous directives create one rejected failed record and never call the runtime;
- `retryRun` creates a linked run, clears/reuses the prior output entry, and reads the latest registered path/current note;
- busy runs cannot be retried;
- missing scripts fail regeneration without invoking an agent.

- [x] **Step 3: Compile and verify the new tests fail**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/scriptDirectives.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: FAIL because routing and controller modules do not exist.

- [x] **Step 4: Implement routing and controller behavior**

Implement boundary-safe saved-entry routing in `scriptDirectives.ts`:

```ts
import { parseAgentDirectives } from "../core/text/agentDirectives";
import type { VaultScriptRegistration } from "../../shared/vaultScriptPolicy.js";
import type { VaultScriptRegistry } from "./vaultScriptRegistry";

type ScriptDirectiveResolution =
    | { kind: "none" }
    | { kind: "script"; script: VaultScriptRegistration }
    | { kind: "rejected"; mentionName: string; message: string };

const MENTION_PATTERN = /(^|[^\w])@([A-Za-z0-9_.-]+)/gu;

export function resolveScriptDirective(text: string, registry: VaultScriptRegistry): ScriptDirectiveResolution {
    const runnable = new Map<string, VaultScriptRegistration>();
    const ambiguous = new Set<string>();
    MENTION_PATTERN.lastIndex = 0;
    for (let match = MENTION_PATTERN.exec(text); match; match = MENTION_PATTERN.exec(text)) {
        const name = (match[2] ?? "").toLowerCase();
        const script = registry.resolve(name);
        if (script) runnable.set(script.normalizedMentionName, script);
        if (registry.isAmbiguous(name)) ambiguous.add(name);
    }
    if (ambiguous.size > 0) {
        const mentionName = Array.from(ambiguous).sort()[0];
        return { kind: "rejected", mentionName, message: `Script @${mentionName} matches more than one vault file.` };
    }
    const scripts = Array.from(runnable.values());
    if (scripts.length === 0) return { kind: "none" };
    if (scripts.length > 1) {
        return { kind: "rejected", mentionName: scripts[0].mentionName, message: "Use only one vault script per side note." };
    }
    if (parseAgentDirectives(text).matchedTargets.length > 0) {
        return { kind: "rejected", mentionName: scripts[0].mentionName, message: "Use a vault script or an agent, not both." };
    }
    return { kind: "script", script: scripts[0] };
}
```

Implement the controller's automatic entrypoint with an explicit idempotency return:

```ts
public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
    const resolution = resolveScriptDirective(event.body, this.host.getRegistry());
    if (resolution.kind === "none") return false;
    if (getLatestScriptRunForTriggerEntry(this.store.getRuns(), event.entryId)) return true;
    if (resolution.kind === "rejected") {
        const rejected = this.buildRejectedRun(event, resolution);
        await this.store.addRun(rejected);
        const outputEntryId = await this.writeOutput(
            rejected,
            formatScriptResult(resolution.mentionName, resolution.message, true),
        );
        await this.store.updateRun(rejected.id, (current) => ({ ...current, outputEntryId }));
        await this.host.refreshCommentViews();
        return true;
    }
    const run = this.buildQueuedRun(event, resolution);
    await this.store.addRun(run);
    await this.enqueue(run);
    return true;
}

private async execute(run: ScriptRunRecord): Promise<void> {
    await this.store.updateRun(run.id, (current) => ({ ...current, status: "running", startedAt: this.host.now() }));
    try {
        const vaultRootPath = this.host.getVaultRootPath();
        if (!vaultRootPath) throw new Error("Vault scripts require desktop Obsidian with a filesystem-backed vault.");
        const result = await this.host.runVaultScript({
            vaultRootPath,
            scriptPath: run.scriptPath,
            notePath: run.filePath,
        });
        const body = formatScriptResult(run.mentionName, result.stdout, false);
        const outputEntryId = await this.writeOutput(run, body);
        await this.store.updateRun(run.id, (current) => ({
            ...current,
            status: "succeeded",
            endedAt: this.host.now(),
            outputEntryId,
        }));
    } catch (error) {
        const message = summarizeScriptError(error);
        const outputEntryId = await this.writeOutput(run, formatScriptResult(run.mentionName, message, true));
        await this.store.updateRun(run.id, (current) => ({
            ...current,
            status: "failed",
            endedAt: this.host.now(),
            outputEntryId,
            error: message,
        }));
    }
    await this.host.refreshCommentViews();
}
```

`buildRejectedRun()` creates a terminal failed record; `buildQueuedRun()` accepts only the script resolution. `enqueue()` chains executions through one private promise so vault mutations are serial. `formatScriptResult()` prefixes `Script @name:`, emits `Completed.` for empty stdout, retains at most 250 whitespace-delimited words, and appends `[output truncated]` when words are omitted. `writeOutput()` edits `run.outputEntryId` when present; otherwise it creates an id and calls `appendThreadEntry` with `insertAfterCommentId: run.triggerEntryId`.

Implement `retryRun(runId)` with this state flow:

```ts
public async retryRun(runId: string): Promise<boolean> {
    const previous = this.store.getRunById(runId);
    if (!previous || previous.status === "queued" || previous.status === "running") return false;
    await this.host.loadCommentsForFile(previous.filePath);
    const trigger = this.host.getCommentManager().getCommentById(previous.triggerEntryId);
    const thread = this.host.getCommentManager().getThreadById(previous.triggerEntryId);
    const script = this.host.getRegistry().resolve(previous.mentionName);
    if (!trigger || !thread || !script) {
        this.host.showNotice("Unable to rerun: the saved trigger or vault script is no longer available.");
        return false;
    }
    const next: ScriptRunRecord = {
        ...previous,
        id: this.host.createRunId(),
        threadId: thread.id,
        filePath: trigger.filePath,
        scriptPath: script.path,
        status: "queued",
        promptText: trigger.comment,
        createdAt: this.host.now(),
        retryOfRunId: previous.id,
        startedAt: undefined,
        endedAt: undefined,
        error: undefined,
    };
    if (next.outputEntryId && !(await this.host.editComment(next.outputEntryId, "", { skipCommentViewRefresh: true }))) {
        this.host.showNotice("Unable to replace the previous script result.");
        return false;
    }
    await this.store.addRun(next);
    await this.enqueue(next);
    return true;
}
```

In `main.ts`, change saved-entry routing to:

```ts
private async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void> {
    const handledByScript = await this.commentScriptController.handleSavedUserEntry(event);
    if (!handledByScript) {
        await this.commentAgentController.handleSavedUserEntry(event);
    }
}
```

- [x] **Step 5: Run controller tests including agent non-regression**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/scriptDirectives.test.js .test-dist/tests/commentScriptController.test.js .test-dist/tests/commentAgentController.test.js
```

Expected: PASS, including an explicit assertion that mixed script/agent entries never call the agent host.

- [x] **Step 6: Commit the routing slice**

```bash
git add src/vaultScripts/scriptDirectives.ts src/vaultScripts/commentScriptController.ts tests/scriptDirectives.test.ts tests/commentScriptController.test.ts src/main.ts
git commit -m "feat(scripts): dispatch saved script mentions"
```

## Task 7: Wire startup, live vault events, persistence, and desktop modules

**Files:**
- Modify: `src/main.ts`
- Modify: `src/app/pluginLifecycleController.ts`
- Modify: `tests/pluginLifecycleController.test.ts`

- [x] **Step 1: Add failing lifecycle assertions**

Extend lifecycle tests so a markdown rename calls both `renameAgentRuns(oldPath, newPath)` and `renameScriptRuns(oldPath, newPath)`. Keep non-commentable script-file renames out of comment persistence while registry refresh remains a main-level concern.

- [x] **Step 2: Compile and verify the missing host method failure**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/pluginLifecycleController.test.js
```

Expected: FAIL until `renameScriptRuns` is added to the lifecycle host and handler.

- [x] **Step 3: Complete main integration**

Add `VaultScriptRegistry`, `ScriptRunStore`, and `CommentScriptController` fields. The controller host must expose `createRunId: generateCommentId`, `now: Date.now`, `getVaultRootPath`, `getFileByPath`, `getCommentManager`, `loadCommentsForFile`, `appendThreadEntry`, `editComment`, `refreshCommentViews`, `showNotice`, `getRegistry`, and `runVaultScript`. Implement `getVaultScriptRuntimeModules()` through the existing Electron `getNodeRequire()` pattern. Resolve the user's login-shell `PATH` with the same environment helper as the agent runtimes, then execute external `node`; packaged Obsidian's renderer helper is not a usable Node CLI:

```ts
private async getVaultScriptRuntimeModules(): Promise<VaultScriptRuntimeModules | null> {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire || !(this.app.vault.adapter instanceof FileSystemAdapter)) return null;
    try {
        type AgentExecutionEnvModules = Parameters<typeof resolveAgentExecutionEnv>[0];
        const rawChildProcess = nodeRequire("node:child_process");
        const rawFsPromises = nodeRequire("node:fs/promises");
        const rawPath = nodeRequire("node:path");
        const executionEnvModules: AgentExecutionEnvModules = {
            childProcess: rawChildProcess as AgentExecutionEnvModules["childProcess"],
            fsPromises: rawFsPromises as AgentExecutionEnvModules["fsPromises"],
            os: nodeRequire("node:os") as AgentExecutionEnvModules["os"],
            path: rawPath as AgentExecutionEnvModules["path"],
        };
        return {
            isScriptLaunchAllowed: (scriptPath) => !this.unloaded
                && this.vaultScriptRegistry.getRunnableScripts().some((script) => script.path === scriptPath),
            childProcess: rawChildProcess as VaultScriptRuntimeModules["childProcess"],
            fsPromises: rawFsPromises as VaultScriptRuntimeModules["fsPromises"],
            path: rawPath as VaultScriptRuntimeModules["path"],
            nodeExecutable: "node",
            processEnv: await resolveAgentExecutionEnv(executionEnvModules, getProcessEnv()),
        };
    } catch {
        return null;
    }
}
```

During `onload()`:

```ts
this.vaultScriptRegistry.seed(this.app.vault.getFiles().map((file) => file.path));
this.scriptRunStore.load();
this.commentScriptController.initialize();
await this.commentScriptController.reconcilePendingRunsFromPreviousSession();
```

In the existing vault `create` listener, call `vaultScriptRegistry.upsert(file.path)` for every `TFile`. At the start of rename/delete routing, reseed from `app.vault.getFiles()` so folder moves and deletions are reflected synchronously. On external settings change, reload `scriptRunStore`. On unload, dispose the script controller before terminating tracked vault-script child processes so no queued work or late output persists. Add public getters for runnable scripts, all script runs, latest run for a thread, and `retryScriptRun`.

Pass `renameScriptRuns` into `PluginLifecycleController` and invoke it beside `renameAgentRuns` when a commentable source note is renamed.

- [x] **Step 4: Run lifecycle, registry, and controller tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/pluginLifecycleController.test.js .test-dist/tests/vaultScriptRegistry.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: PASS.

- [x] **Step 5: Commit the Obsidian integration slice**

```bash
git add src/main.ts src/app/pluginLifecycleController.ts tests/pluginLifecycleController.test.ts
git commit -m "feat(scripts): sync vault scripts live"
```

## Task 8: Render script provenance and Regenerate

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`

- [x] **Step 1: Write failing sidebar presentation tests**

Add a `createScriptRun()` fixture and assert:

- `resolveSidebarCommentAuthor` returns `{ kind: "script", label: "Script" }` for a script output entry;
- `getSidebarCommentRegenerateAction` returns `{ kind: "script-run", runId }` for the trigger/result pair;
- queued/running script runs disable Regenerate;
- clicking Regenerate calls `retryScriptRun`, not either agent retry method;
- script result children remain visible while nested comments are collapsed;
- script output is absent from Agent-mode classification and agent metadata.

- [x] **Step 2: Compile and verify presentation failures**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: FAIL because the sidebar host has no script-run awareness.

- [x] **Step 3: Extend the sidebar host and pure presentation helpers**

Extend author kind to `"user" | AsideAgentTarget | "script"`, add `threadScriptRuns: ScriptRunRecord[]` and `retryScriptRun(runId)` to the host, and extend the regenerate union:

```ts
export type SidebarCommentRegenerateAction =
    | { kind: "agent-run"; runId: string }
    | { kind: "agent-prompt" }
    | { kind: "script-run"; runId: string };
```

Resolve script output provenance before the default user author. Resolve script Regenerate before fallback agent-prompt parsing. Generalize the busy helper to accept `{ status: string }` or add `isRetryableScriptRunBusy`. In the click handler, dispatch `script-run` to `host.retryScriptRun`, `agent-run` to `host.retryAgentRun`, and only `agent-prompt` to `host.retryAgentPromptForComment`.

Count script output entries alongside agent output entries when deciding whether collapsed nested replies must remain visible.

- [x] **Step 4: Pass per-thread script runs from AsideView**

Read all script runs once per render next to `allAgentRuns`, derive `getScriptRunsForThread(allScriptRuns, thread)`, and pass the array through `renderPersistedComment()` into `renderPersistedCommentCard`. Wire `retryScriptRun` to the main plugin method.

- [x] **Step 5: Run sidebar and controller tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: PASS.

- [x] **Step 6: Commit the Regenerate UI slice**

```bash
git add src/ui/views/sidebarPersistedComment.ts src/ui/views/AsideView.ts tests/sidebarPersistedComment.test.ts
git commit -m "feat(scripts): regenerate script results"
```

## Task 9: Lock scope, run full verification, and smoke-test live registration

**Files:**
- Modify: `tests/asideSettingCatalog.test.ts`
- Modify: `tests/sidebarModeTabs.test.ts`
- Modify after verified implementation: `docs/superpowers/specs/2026-08-03-vault-script-mentions-design.md`

- [x] **Step 1: Add explicit no-tab/no-setting assertions**

In `asideSettingCatalog.test.ts` assert no key contains `script`; in `sidebarModeTabs.test.ts` assert no mode or label contains `script`. Keep the current exact expected arrays unchanged.

- [x] **Step 2: Run focused feature tests**

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/vaultScriptRegistry.test.js \
  .test-dist/tests/commentMentionSuggestions.test.js \
  .test-dist/tests/scriptRunStorePlanner.test.js \
  .test-dist/tests/vaultScriptRuntime.test.js \
  .test-dist/tests/scriptDirectives.test.js \
  .test-dist/tests/commentScriptController.test.js \
  .test-dist/tests/sidebarDraftEditor.test.js \
  .test-dist/tests/sidebarPersistedComment.test.js \
  .test-dist/tests/pluginLifecycleController.test.js \
  .test-dist/tests/asideSettingCatalog.test.js \
  .test-dist/tests/sidebarModeTabs.test.js
node --test tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs
```

Expected: all focused tests PASS.

- [x] **Step 3: Run repository verification**

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0. `npm run build` must also pass the Obsidian compliance and release-artifact guard; confirm `main.js`, `manifest.json`, and `styles.css` contain no source map markers, embedded sources, raw TypeScript, or secret-bearing files.

- [x] **Step 4: Install the built plugin and smoke-test the real vault flow**

With approval to modify the target vault, run:

```bash
npm run dev:install-built -- --vault "/Users/wenqingli/Obsidian/lean-startup"
```

Reload Aside, open `PDM software.md`, type `@`, and confirm `@clean-citation-links` is offered from `/Users/wenqingli/Obsidian/lean-startup/🛠️ scripts/clean-citation-links.mjs`. Create a temporary direct child `🛠️ scripts/aside-live-registry-smoke.mjs` through Obsidian, confirm `@aside-live-registry-smoke` appears without restarting, then move the temporary file to the system trash and confirm the suggestion disappears. Save `@clean-citation-links`, verify Node receives the current note path and no agent run is created, change the current note or script data, click Regenerate, and confirm the existing result entry is replaced from the new run.

- [x] **Step 5: Update the tracked spec only for verified work**

Mark an implementation or verification checkbox `[x]` only when the corresponding code is present and the listed automated/manual evidence has passed. Leave merge-dependent wording unchecked until the branch is integrated.

- [x] **Step 6: Commit verification guards and tracking evidence**

```bash
git add tests/asideSettingCatalog.test.ts tests/sidebarModeTabs.test.ts docs/superpowers/specs/2026-08-03-vault-script-mentions-design.md
git commit -m "test(scripts): verify vault script workflow"
```
