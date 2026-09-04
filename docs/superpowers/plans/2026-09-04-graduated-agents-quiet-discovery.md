# Graduated Agents and Quiet Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the agents feature flag while keeping the default UI quiet, preserving the existing mention autocomplete, lazily creating the vault script folder, and labeling the workspace view consistently as Aside.

**Architecture:** Remove availability booleans at their source instead of replacing them with always-true adapters. Keep explicit user intent as the activation boundary: the existing editor dropdown handles `@` and `/`, command controllers dispatch only saved directives, the Agent tab remains a default-off visibility preference, and a focused script-folder provisioner performs one idempotent Vault API preflight before `/create-script` dispatch.

**Tech Stack:** TypeScript, Obsidian API, Node test runner, esbuild, ESLint

---

## File Structure

- Modify `src/core/config/featureFlags.ts`: retain only the publishing flag and normalize legacy agent keys away.
- Keep `src/core/config/featureFlagStorageSync.ts`: continue generic synchronization for the remaining publishing flag.
- Delete `src/core/agents/agentsFeaturePolicy.ts`: remove the obsolete disabled-experiment notice.
- Modify `src/core/text/actionableMentions.ts`: make the shared built-in registry unconditionally actionable.
- Modify `src/ui/editor/commentMentionSuggestions.ts`: remove the availability argument while preserving the existing `@`/`/` filtering and autocomplete choices.
- Modify `src/ui/modals/SideNoteMentionSuggestModal.ts`: remove the availability option from the disconnected fallback modal.
- Modify `src/ui/views/sidebarDraftComment.ts`: use the exact neutral new-comment placeholder and remove its feature adapter.
- Modify `src/ui/views/sidebarModeTabs.ts`: make Agent-tab visibility depend only on the persisted toggle.
- Modify `src/ui/settings/asideSettingCatalog.ts`: always expose Scripts and **Show agent tab** settings.
- Modify `src/ui/settings/AsideSetting.ts`: default the Agent tab off.
- Modify `src/settings/indexNoteSettingsPlanner.ts`: normalize missing or invalid Agent-tab settings to off while preserving explicit booleans.
- Modify `src/agents/createScriptCommandController.ts`: remove the flag gate and ensure the script folder before dispatch.
- Modify `src/agents/updateScriptCommandController.ts`: remove the flag gate.
- Modify `src/agents/pdfToMarkdownCommandController.ts`: remove the flag gate.
- Modify `src/agents/commentAgentController.ts`: remove redundant agent capability gates while preserving runtime diagnostics and failure cards.
- Create `src/vaultScripts/vaultScriptFolderProvisioner.ts`: own idempotent and race-safe `🛠️ scripts/` provisioning outcomes.
- Modify `src/main.ts`: wire the provisioner to Obsidian's Vault API and remove all agent-feature adapters.
- Modify `src/ui/views/AsideView.ts`: consume the simplified APIs and return `Aside` as the workspace display text.
- Create `SCRIPTS.md`: document supported local agents, script workflows, settings, folder creation, and the non-sandboxed execution boundary.
- Modify `README.md`: make agents and scripts visible in normal onboarding and link the focused guide.
- Modify `EXPERIMENTAL_FEATURES.md`: leave only still-experimental publishing documentation.
- Modify focused tests under `tests/`: replace disabled-feature expectations with graduated behavior, prove migration, preserve autocomplete, and cover folder provisioning.

### Task 1: Preserve Mention Autocomplete While Removing UI Capability Gates

**Files:**
- Modify: `tests/actionableMentions.test.ts`
- Modify: `tests/commentMentionSuggestions.test.ts`
- Modify: `tests/commentEditorFormatting.test.ts`
- Modify: `tests/commentEditorPersistedMentions.test.ts`
- Modify: `tests/sidebarDraftEditor.test.ts`
- Modify: `tests/sidebarDraftComment.test.ts`
- Modify: `tests/sidebarModeTabs.test.ts`
- Modify: `tests/asideSettingCatalog.test.ts`
- Modify: `src/core/text/actionableMentions.ts`
- Modify: `src/ui/editor/commentMentionSuggestions.ts`
- Modify: `src/ui/modals/SideNoteMentionSuggestModal.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `src/ui/views/sidebarModeTabs.ts`
- Modify: `src/ui/settings/asideSettingCatalog.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Rewrite focused tests around the graduated interfaces**

Change actionable-mention tests to construct only the live-script predicate and call the built-in registry without a boolean:

```ts
const context = {
    isRunnableVaultScriptMention: (mention: string) => mention.toLowerCase() === "/clean",
};

assert.equal(isActionableMention("@codex", context), true);
assert.equal(isActionableMention("/create-script", context), true);
assert.deepEqual(
    getActionableBuiltInMentions().map((item) => item.mention),
    ["@todo", "@codex", "@claude", "@cursor", "@gemini", "@deepseek", "/create-script", "/update-script", "/pdf-to-markdown"],
);
```

Change mention-suggestion tests to call `buildMentionSuggestions(scripts, query)` and retain the current provider scoping:

```ts
assert.deepEqual(
    buildMentionSuggestions([cleanLinksScript], "@co").map((item) => item.mention),
    ["@codex"],
);
assert.deepEqual(
    buildMentionSuggestions([cleanLinksScript], "/").map((item) => item.mention),
    ["/create-script", "/update-script", "/pdf-to-markdown", "/clean-links"],
);
```

Keep the existing `sidebarDraftEditor` tests proving that `@` and `/` open the inline dropdown, continued typing filters it, Arrow keys move selection, and Enter or Tab calls the existing replacement path. Remove only obsolete boolean arguments.

Change draft presentation tests to expect exact neutral copy for new drafts and the existing reply copy for append drafts:

```ts
assert.equal(
    buildDraftCommentPresentation(createDraft({ mode: "new" }), null).placeholder,
    "add a comment",
);
assert.equal(
    buildDraftCommentPresentation(createDraft({ mode: "append" }), null).placeholder,
    "Add another entry to this thread.",
);
```

Change sidebar-mode tests so Agent visibility depends only on `showAgentSidebarTab`, and change catalog tests to prove `default-agent` and `show-agent-tab` have no visibility predicate.

- [ ] **Step 2: Run the focused test compile and confirm the old signatures fail**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL with argument-count or missing-property errors involving `agentsFeatureAvailable` and `isAgentsFeatureAvailable`.

- [ ] **Step 3: Simplify the shared mention policy**

Replace conditional built-ins with one unconditional definition:

```ts
export interface ActionableBuiltInMention {
    mention: `@${string}` | `/${string}`;
    label: string;
}

export interface ActionableMentionContext {
    isRunnableVaultScriptMention(mention: string): boolean;
}

export function getActionableBuiltInMentions(): ActionableBuiltInMention[] {
    return [
        { mention: "@todo", label: "Todo" },
        ...getSupportedAgentActors().map((actor) => ({
            mention: actor.directive,
            label: actor.label,
        })),
        { mention: CREATE_SCRIPT_DIRECTIVE, label: "Create script" },
        { mention: UPDATE_SCRIPT_DIRECTIVE, label: "Update script" },
        { mention: PDF_TO_MARKDOWN_DIRECTIVE, label: "PDF to Markdown" },
    ];
}
```

Have `isActionableMention` check `getActionableBuiltInMentions()` directly, then fall back to the live script registry.

- [ ] **Step 4: Preserve the existing dropdown while removing its boolean input**

Change the suggestion builder signature and built-in source exactly as follows:

```ts
export function getMentionSuggestionPlaceholder(): string {
    return "Mention an agent, command, todo, or vault script";
}

export function buildMentionSuggestions(
    scripts: readonly VaultScriptRegistration[],
    rawQuery: string,
): SideNoteMentionSuggestion[] {
    const normalizedRawQuery = rawQuery.trim();
    const query = normalizedRawQuery.replace(/^[@/]/u, "").toLowerCase();
    const shouldIncludeScripts = !normalizedRawQuery.startsWith("@");
    const shouldIncludeAtBuiltIns = !normalizedRawQuery.startsWith("/");
    const shouldIncludeSlashBuiltIns = !normalizedRawQuery.startsWith("@");
    const shouldFilterBuiltInsByQuery = query.length > 0;
    const builtInCandidates: SideNoteMentionSuggestion[] = getActionableBuiltInMentions()
```

All code after the `getActionableBuiltInMentions()` call remains unchanged, including trigger-scope filtering, candidate mapping, reserved-name exclusion, exact/prefix/substring scoring, and stable sorting. The only deleted expressions are the third function parameter and the argument previously passed to `getActionableBuiltInMentions`.

Update the modal constructor call to:

```ts
new SideNoteMentionSuggestModal(this.app, options).open();
```

Remove `agentsFeatureAvailable` from `SideNoteMentionSuggestModalOptions`. In `AsideView`, continue calling the same inline suggestion controller, but pass only scripts and the trigger-prefixed query. Do not add another menu, event listener, or completion path.

- [ ] **Step 5: Remove presentation gates and apply the neutral placeholder**

Change `buildDraftCommentPresentation` to accept `(comment, activeCommentId, isSaving = false)` and set:

```ts
placeholder: comment.mode === "append"
    ? "Add another entry to this thread."
    : "add a comment",
```

Remove `isAgentsFeatureAvailable` from `SidebarDraftCommentHost`. In `sidebarModeTabs.ts`, remove `agentsFeatureAvailable` from `SidebarModeVisibility`; show Agent when `showAgentSidebarTab` is true and fall back to List only when it is false.

Remove the agent visibility predicates from `default-agent` and `show-agent-tab` catalog entries. Keep **Show agent tab** in the existing `sidebar` section and keep its toggle implementation unchanged.

Remove matching adapters from `AsideView` and change `Aside.isActionableMention` to pass only `isRunnableVaultScriptMention`.

- [ ] **Step 6: Run focused tests and confirm the existing dropdown behavior passes**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/actionableMentions.test.js \
  .test-dist/tests/commentMentionSuggestions.test.js \
  .test-dist/tests/commentEditorFormatting.test.js \
  .test-dist/tests/commentEditorPersistedMentions.test.js \
  .test-dist/tests/sidebarDraftEditor.test.js \
  .test-dist/tests/sidebarDraftComment.test.js \
  .test-dist/tests/sidebarModeTabs.test.js \
  .test-dist/tests/asideSettingCatalog.test.js
```

Expected: PASS, including the existing inline dropdown, filtering, keyboard selection, and autocomplete tests.

- [ ] **Step 7: Commit the UI capability-gate removal**

```bash
git add src/core/text/actionableMentions.ts src/ui/editor/commentMentionSuggestions.ts src/ui/modals/SideNoteMentionSuggestModal.ts src/ui/views/sidebarDraftComment.ts src/ui/views/sidebarModeTabs.ts src/ui/settings/asideSettingCatalog.ts src/ui/views/AsideView.ts src/main.ts tests/actionableMentions.test.ts tests/commentMentionSuggestions.test.ts tests/commentEditorFormatting.test.ts tests/commentEditorPersistedMentions.test.ts tests/sidebarDraftEditor.test.ts tests/sidebarDraftComment.test.ts tests/sidebarModeTabs.test.ts tests/asideSettingCatalog.test.ts
git commit -m "refactor(agents): remove UI capability gates"
```

### Task 2: Remove Execution Gates and the Agent Feature Flag

**Files:**
- Create: `tests/agentFeatureGraduation.test.mjs`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `tests/createScriptCommandController.test.ts`
- Modify: `tests/updateScriptCommandController.test.ts`
- Modify: `tests/pdfToMarkdownCommandController.test.ts`
- Modify: `tests/featureFlags.test.ts`
- Modify: `tests/featureFlagStorageSync.test.ts`
- Modify: `tests/indexNoteSettingsController.test.ts`
- Modify: `tests/publicHtmlPublishController.test.ts`
- Modify: `tests/publishSettings.test.ts`
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/agents/createScriptCommandController.ts`
- Modify: `src/agents/updateScriptCommandController.ts`
- Modify: `src/agents/pdfToMarkdownCommandController.ts`
- Delete: `src/core/agents/agentsFeaturePolicy.ts`
- Modify: `src/core/config/featureFlags.ts`
- Modify: `src/ui/settings/AsideSetting.ts`
- Modify: `src/settings/indexNoteSettingsPlanner.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add a source-level graduation guard and update behavior tests**

Create `tests/agentFeatureGraduation.test.mjs`:

```js
import * as assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const productionFiles = readdirSync("src", { recursive: true })
    .filter((path) => typeof path === "string" && path.endsWith(".ts"))
    .map((path) => join("src", path));

test("graduated agents have no feature-availability residue", () => {
    const source = productionFiles.map((path) => readFileSync(path, "utf8")).join("\n");
    assert.doesNotMatch(source, /FeatureFlag\.agents|isAgentsFeatureAvailable|agentsFeatureAvailable|AGENTS_EXPERIMENT_DISABLED_NOTICE/u);
    assert.equal(existsSync("src/core/agents/agentsFeaturePolicy.ts"), false);
});
```

Remove disabled-feature harness options and tests. Retain positive dispatch, runtime-unavailable failure-card, duplicate suppression, persistence, regenerate, and cancellation tests.

Change feature-flag expectations to:

```ts
assert.deepEqual(FEATURE_FLAG_KEYS, [FeatureFlag.publish]);
assert.deepEqual(DEFAULT_FEATURE_FLAGS, { publish: false });
assert.deepEqual(normalizeFeatureFlags({ publish: true, agents: true }), { publish: true });
assert.equal(
    shouldRewriteNormalizedFeatureFlags({ publish: true, agents: true }, { publish: true }),
    true,
);
```

Update publish-related fixtures so every `FeatureFlags` value contains only `publish`.

Add settings-resolution expectations:

```ts
assert.equal(resolveLoadedSettings({}, createSettings()).settings.showAgentSidebarTab, false);
assert.equal(resolveLoadedSettings({ showAgentSidebarTab: true }, createSettings()).settings.showAgentSidebarTab, true);
assert.equal(resolveLoadedSettings({ showAgentSidebarTab: false }, createSettings()).settings.showAgentSidebarTab, false);
assert.equal(resolveLoadedSettings({ showAgentSidebarTab: "no" }, createSettings()).settings.showAgentSidebarTab, false);
```

- [ ] **Step 2: Run the guard and focused compile to verify failure**

Run:

```bash
node --test tests/agentFeatureGraduation.test.mjs
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: the source guard FAILS on existing availability identifiers, and TypeScript reports remaining agent flag or host properties until implementation is complete.

- [ ] **Step 3: Remove agent gates from command and runtime controllers**

Delete the policy import, `isAgentsFeatureAvailable`, and `showNotice` members used only by that policy from the three built-in command hosts. Let validated commands proceed to their existing validation or dispatch path.

In `CommentAgentHost`, remove `isAgentsFeatureAvailable`. Delete only the five disabled-experiment early returns in direct dispatch, create, update, PDF conversion, and regenerate preparation. Keep `resolveAgentRuntimeSelection`, `resolveDefaultAgentRuntimeSelection`, and their existing visible preflight failure persistence unchanged.

- [ ] **Step 4: Collapse the feature registry to publishing**

Change `featureFlags.ts` to:

```ts
export const FeatureFlag = {
    publish: "publish",
} as const;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
    [FeatureFlag.publish]: false,
};

export function normalizeFeatureFlags(value: unknown): FeatureFlags {
    const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        [FeatureFlag.publish]: source[FeatureFlag.publish] === true,
    };
}
```

Keep the generic storage synchronizer unchanged; its only caller loop now receives the single publish key. Remove the agent-specific storage tests and keep all read, persist, rollback, mirror, and error tests for publishing.

Remove `Aside.isAgentsFeatureAvailable`, the runtime-diagnostics disabled branch, obsolete host adapters, and the deleted policy import from `main.ts`.

- [ ] **Step 5: Default only Agent-tab visibility off**

Set `DEFAULT_SETTINGS.showAgentSidebarTab` to `false`. Give the two sidebar settings explicit normalization defaults:

```ts
function normalizeSidebarTabToggle(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

const showTodoSidebarTab = hasTodoSidebarTabSetting
    ? normalizeSidebarTabToggle(loaded?.showTodoSidebarTab, true)
    : true;
const showAgentSidebarTab = hasAgentSidebarTabSetting
    ? normalizeSidebarTabToggle(loaded?.showAgentSidebarTab, false)
    : false;
```

Keep the existing rewrite conditions so missing or invalid persisted values are saved in normalized form. Do not change the Todo-tab default.

- [ ] **Step 6: Run focused graduation and settings tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  tests/agentFeatureGraduation.test.mjs \
  .test-dist/tests/commentAgentController.test.js \
  .test-dist/tests/createScriptCommandController.test.js \
  .test-dist/tests/updateScriptCommandController.test.js \
  .test-dist/tests/pdfToMarkdownCommandController.test.js \
  .test-dist/tests/featureFlags.test.js \
  .test-dist/tests/featureFlagStorageSync.test.js \
  .test-dist/tests/indexNoteSettingsController.test.js \
  .test-dist/tests/publicHtmlPublishController.test.js \
  .test-dist/tests/publishSettings.test.js
```

Expected: PASS. The source guard finds none of the four removed identifiers, agent commands still dispatch, unavailable runtimes still persist failure cards, and publishing flag behavior is unchanged.

- [ ] **Step 7: Commit the graduated capability model**

```bash
git add tests/agentFeatureGraduation.test.mjs tests/commentAgentController.test.ts tests/createScriptCommandController.test.ts tests/updateScriptCommandController.test.ts tests/pdfToMarkdownCommandController.test.ts tests/featureFlags.test.ts tests/featureFlagStorageSync.test.ts tests/indexNoteSettingsController.test.ts tests/publicHtmlPublishController.test.ts tests/publishSettings.test.ts src/agents/commentAgentController.ts src/agents/createScriptCommandController.ts src/agents/updateScriptCommandController.ts src/agents/pdfToMarkdownCommandController.ts src/core/config/featureFlags.ts src/ui/settings/AsideSetting.ts src/settings/indexNoteSettingsPlanner.ts src/main.ts
git add -u src/core/agents/agentsFeaturePolicy.ts
git commit -m "feat(agents): graduate local agent support"
```

### Task 3: Lazily Provision the Vault Script Folder

**Files:**
- Create: `src/vaultScripts/vaultScriptFolderProvisioner.ts`
- Create: `tests/vaultScriptFolderProvisioner.test.ts`
- Modify: `src/agents/createScriptCommandController.ts`
- Modify: `tests/createScriptCommandController.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write provisioner and sequencing tests**

Create a harness whose `getPathKind` can return `missing`, `folder`, or `occupied`, and whose `createFolder` can succeed, fail, or simulate a concurrent creator. Assert:

```ts
assert.deepEqual(await ensureVaultScriptFolder(folderHarness("folder").host), { ok: true });
assert.deepEqual(missing.createdPaths, [VAULT_SCRIPT_FOLDER_PATH]);
assert.deepEqual(await ensureVaultScriptFolder(occupied.host), {
    ok: false,
    message: `Couldn’t create ${VAULT_SCRIPT_FOLDER_PATH}/ because a file already uses that path.`,
});
assert.deepEqual(await ensureVaultScriptFolder(concurrent.host), { ok: true });
assert.deepEqual(await ensureVaultScriptFolder(failed.host), {
    ok: false,
    message: `Couldn’t create ${VAULT_SCRIPT_FOLDER_PATH}/. Check that the vault is writable and try again.`,
});
```

Extend the create-command harness with `ensureScriptFolder` and an operation log. Assert a valid request records `ensure-folder` before `dispatch`, invalid or mixed requests never ensure the folder, a failed ensure appends exactly one returned message, and a duplicate saved-entry event neither ensures nor dispatches twice.

- [ ] **Step 2: Run focused tests and verify the missing API fails compilation**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `ensureVaultScriptFolder` and `CreateScriptCommandHost.ensureScriptFolder` do not exist.

- [ ] **Step 3: Implement the focused idempotent provisioner**

Create `src/vaultScripts/vaultScriptFolderProvisioner.ts`:

```ts
import { VAULT_SCRIPT_FOLDER_PATH } from "../../shared/vaultScriptPolicy.js";

export type VaultScriptFolderPathKind = "missing" | "folder" | "occupied";
export type VaultScriptFolderProvisionResult =
    | { ok: true }
    | { ok: false; message: string };

export interface VaultScriptFolderProvisionHost {
    getPathKind(path: string): VaultScriptFolderPathKind;
    createFolder(path: string): Promise<void>;
}

const conflictMessage = `Couldn’t create ${VAULT_SCRIPT_FOLDER_PATH}/ because a file already uses that path.`;
const failureMessage = `Couldn’t create ${VAULT_SCRIPT_FOLDER_PATH}/. Check that the vault is writable and try again.`;

export async function ensureVaultScriptFolder(
    host: VaultScriptFolderProvisionHost,
): Promise<VaultScriptFolderProvisionResult> {
    const existing = host.getPathKind(VAULT_SCRIPT_FOLDER_PATH);
    if (existing === "folder") return { ok: true };
    if (existing === "occupied") return { ok: false, message: conflictMessage };

    try {
        await host.createFolder(VAULT_SCRIPT_FOLDER_PATH);
        return { ok: true };
    } catch {
        const afterFailure = host.getPathKind(VAULT_SCRIPT_FOLDER_PATH);
        if (afterFailure === "folder") return { ok: true };
        return {
            ok: false,
            message: afterFailure === "occupied" ? conflictMessage : failureMessage,
        };
    }
}
```

Keep raw filesystem errors out of the persisted user reply so local paths or sensitive diagnostic content are not exposed.

- [ ] **Step 4: Sequence folder creation before create-script dispatch**

Add to `CreateScriptCommandHost`:

```ts
ensureScriptFolder(): Promise<VaultScriptFolderProvisionResult>;
```

After usage, rejection, mixed-script, and mixed-agent validation, add:

```ts
const folderResult = await this.host.ensureScriptFolder();
if (!folderResult.ok) {
    await this.host.appendReply(event, folderResult.message);
    return true;
}
await this.host.dispatchRequest(event, resolution.requestText);
```

In `main.ts`, wire the host through `ensureVaultScriptFolder`. Map the Obsidian entry to `folder` only for `TFolder`, `occupied` for any other existing abstract file, and `missing` for null:

```ts
ensureScriptFolder: () => ensureVaultScriptFolder({
    getPathKind: (path) => {
        const existing = this.app.vault.getAbstractFileByPath(path);
        return existing instanceof TFolder ? "folder" : existing ? "occupied" : "missing";
    },
    createFolder: (path) => this.app.vault.createFolder(path),
}),
```

- [ ] **Step 5: Run folder and create-command tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/vaultScriptFolderProvisioner.test.js \
  .test-dist/tests/createScriptCommandController.test.js
```

Expected: PASS for existing folder, first creation, concurrent creation, occupied path, generic failure, validation-before-provisioning, and exactly-once dispatch.

- [ ] **Step 6: Commit lazy provisioning**

```bash
git add src/vaultScripts/vaultScriptFolderProvisioner.ts tests/vaultScriptFolderProvisioner.test.ts src/agents/createScriptCommandController.ts tests/createScriptCommandController.test.ts src/main.ts
git commit -m "feat(scripts): create vault folder on demand"
```

### Task 4: Standardize the Aside Workspace Label

**Files:**
- Modify: `tests/sidebarEmptyState.test.ts`
- Modify: `src/ui/views/AsideView.ts`

- [ ] **Step 1: Add a focused source contract for the workspace display text**

Extend the existing AsideView source test:

```ts
test("Aside workspace view uses the product name", () => {
    const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");
    assert.match(asideViewSource, /getDisplayText\(\)\s*\{\s*return "Aside";\s*\}/u);
    assert.doesNotMatch(asideViewSource, /getDisplayText\(\)\s*\{\s*return "Side notes";/u);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarEmptyState.test.js
```

Expected: FAIL because `AsideView.getDisplayText()` still returns `Side notes`.

- [ ] **Step 3: Change only the view identity label**

```ts
getDisplayText() {
    return "Aside";
}
```

Keep the view type, icon, manifest name, `Open Aside` ribbon tooltip, and semantic side-note copy unchanged.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarEmptyState.test.js .test-dist/tests/pluginRegistrationController.test.js
```

Expected: PASS and the ribbon remains `Open Aside`.

- [ ] **Step 5: Commit the workspace label**

```bash
git add src/ui/views/AsideView.ts tests/sidebarEmptyState.test.ts
git commit -m "fix(sidebar): label workspace view Aside"
```

### Task 5: Publish Normal User Documentation for Agents and Scripts

**Files:**
- Create: `SCRIPTS.md`
- Modify: `README.md`
- Modify: `EXPERIMENTAL_FEATURES.md`
- Create: `tests/agentScriptsDocumentation.test.mjs`

- [ ] **Step 1: Add documentation contract tests**

Create `tests/agentScriptsDocumentation.test.mjs`:

```js
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync("README.md", "utf8");
const guide = readFileSync("SCRIPTS.md", "utf8");
const experimental = readFileSync("EXPERIMENTAL_FEATURES.md", "utf8");

test("README exposes supported agents and scripts", () => {
    assert.match(readme, /@codex[\s\S]*@claude[\s\S]*@cursor[\s\S]*@gemini[\s\S]*@deepseek/u);
    assert.match(readme, /\[Agents and scripts\]\(\.\/SCRIPTS\.md\)/u);
});

test("scripts guide documents discovery, settings, creation, and security", () => {
    assert.match(guide, /\/create-script/u);
    assert.match(guide, /Show agent tab/u);
    assert.match(guide, /🛠️ scripts\//u);
    assert.match(guide, /not sandboxed/iu);
    assert.match(guide, /local account permissions/iu);
});

test("experimental docs no longer classify scripts as experimental", () => {
    assert.doesNotMatch(experimental, /Vault Scripts/u);
    assert.match(experimental, /Cloudflare Pages Publishing/u);
});
```

- [ ] **Step 2: Run the documentation tests and verify they fail**

Run:

```bash
node --test tests/agentScriptsDocumentation.test.mjs
```

Expected: FAIL because `SCRIPTS.md` does not exist and the README does not yet link it.

- [ ] **Step 3: Write the focused scripts guide without private information**

Create `SCRIPTS.md` with this complete user-facing structure and copy:

```markdown
# Agents and Scripts

Aside supports Codex, Claude Code, Cursor, Gemini, and DeepSeek through local command-line tools on desktop Obsidian with a filesystem-backed vault. Aside does not bundle those tools or send requests to its own agent service.

## Ask an Agent

Type `@codex`, `@claude`, `@cursor`, `@gemini`, or `@deepseek` in a side note and save it. Install and sign in to that agent's CLI first. Aside uses the selected CLI's own account, configuration, model, and permissions.

The Agent tab is optional and hidden by default. Use **Settings → Sidebar tabs → Show agent tab** to show or hide it. This setting changes visibility only; agents still reply in the normal List view.

## Create and Update Scripts

Use `/create-script <request>` to ask the default local agent to create a reusable script. Aside creates `🛠️ scripts/` when the first valid create request needs it. Use `/update-script /script-name <request>` to update an existing script. Choose the default local agent under **Settings → Scripts**.

Use `/pdf-to-markdown` in a side note attached to a PDF to create Markdown through the default agent.

## Run a Script

1. Open the Markdown note the script should process.
2. Add or reply to an Aside comment.
3. Type `/` and select a script, or enter its command directly, such as `/clean-citations`.
4. Save the comment. Aside runs the script and adds its output to the thread.

Regenerate runs the latest version of the script against the current note. Use one vault-script command per comment and do not combine it with an agent command.

## Supported Scripts

- Put scripts directly under `🛠️ scripts/`; nested folders are ignored.
- Use `.mjs`, `.js`, or `.cjs`.
- Do not use spaces in filenames. A filename such as `clean-citations.mjs` becomes `/clean-citations`.
- Hidden files and names ending in `.test` or `.spec` are ignored.
- Commands are case-insensitive. Duplicate names and reserved built-in names are not runnable.

Aside keeps the command list current when files are created, renamed, or deleted.

## Security

Vault scripts are not sandboxed. They run through local Node with your local account permissions and inherited environment. Aside starts Node without a shell, uses the vault root as the working directory, passes the absolute current-note path as the script's automatic argument, limits captured output, and stops runs after 60 seconds. Those controls do not prevent a script from reading, changing, or sending data that your account can access.

Review and trust a script before invoking it. Do not put credentials in a script or side note.
```

Use only vault-relative examples and placeholders; do not include usernames, home directories, real vault names, credentials, tokens, logs, or screenshots containing private data.

- [ ] **Step 4: Link normal onboarding and narrow experimental docs**

Make these exact README content changes:

```markdown
- Built-in agent help on desktop Obsidian. Type `@codex`, `@claude`, `@cursor`, `@gemini`, or `@deepseek` in a thread to get a reply, create anchored side notes, or apply explicit edits to the source note.
- Reusable [agents and vault scripts](./SCRIPTS.md), including `/create-script`, `/update-script`, `/pdf-to-markdown`, and `/script-name` commands.
```

Change the workflow table's agent row to the same five-agent list and add: `The Agent tab is optional and hidden by default; enable **Show agent tab** under Aside settings when you want the focused agent view.`

In `EXPERIMENTAL_FEATURES.md`, delete the Vault Scripts table row and the complete `## Vault Scripts` section through its security warning. Keep the introduction, Cloudflare Pages row, separator, and publishing sections unchanged.

- [ ] **Step 5: Run documentation and compliance tests**

Run:

```bash
node --test tests/agentScriptsDocumentation.test.mjs tests/checkObsidianCompliance.test.mjs
```

Expected: PASS, including the repository guard that rejects personal home-directory paths in code and docs.

- [ ] **Step 6: Commit the user documentation**

```bash
git add SCRIPTS.md README.md EXPERIMENTAL_FEATURES.md tests/agentScriptsDocumentation.test.mjs
git commit -m "docs(scripts): publish agent workflows"
```

### Task 6: Full Verification and Specification Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-graduated-agents-quiet-discovery-design.md`

- [ ] **Step 1: Prove removed residue is absent everywhere maintained**

Run:

```bash
rg -n 'FeatureFlag\.agents|isAgentsFeatureAvailable|agentsFeatureAvailable|AGENTS_EXPERIMENT_DISABLED_NOTICE|Agents experiment is disabled' src tests
```

Expected: no matches.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run lint, typecheck, and Obsidian compliance**

Run:

```bash
npm run lint
npm run typecheck
npm run check:obsidian
```

Expected: all commands exit zero.

- [ ] **Step 4: Build and inspect the exact release assets**

Run:

```bash
npm run bundle
npm run bundle:size:check
npm run release:artifacts:check
```

Expected: `main.js` remains within the existing 750,000-byte ceiling, and the exact `main.js`, `manifest.json`, and `styles.css` inspection reports no source map, embedded source, raw TypeScript/JSX, secret-bearing file, or local path exposure.

- [ ] **Step 5: Update the tracked specification with verified evidence**

Mark each completed **To Implement** item `[x]`, change status to `Implemented and verified`, and add measured test counts, bundle bytes, and artifact inspection results. Do not include a username, absolute local path, private vault name, token, or other private information.

- [ ] **Step 6: Review the complete branch diff**

Run:

```bash
git diff main...HEAD --check
git diff main...HEAD --stat
git status --short
```

Expected: no whitespace errors, only planned files, and only the tracked spec update remains uncommitted.

- [ ] **Step 7: Commit verification evidence**

```bash
git add -f docs/superpowers/specs/2026-09-04-graduated-agents-quiet-discovery-design.md
git commit -m "docs(agents): record graduation verification"
```

- [ ] **Step 8: Confirm the feature branch is clean**

Run:

```bash
git status --short
git log --oneline main..HEAD
```

Expected: an empty status and the planned focused commits. Do not install into a user vault, push, tag, or release without separate authorization.
