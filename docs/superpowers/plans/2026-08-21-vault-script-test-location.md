# Vault Script Test Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every agent-authored vault-script test is created under `🛠️ scripts/tests/`, with the directory created when absent and no test/spec files placed beside runnable scripts.

**Architecture:** Add one canonical derived test-folder constant to the shared vault-script policy. Consume it once in the provider-neutral side-note prompt so ordinary agent requests, `/create-script`, and `/update-script` all receive identical guidance without provider or request-kind duplication.

**Tech Stack:** CommonJS shared policy modules, TypeScript declarations, Node.js test runner, ESLint, esbuild.

---

## File Structure

- Modify `shared/vaultScriptPolicy.js` to own and export the canonical vault-script test-folder path.
- Modify `shared/vaultScriptPolicy.d.ts` to expose the literal test-folder path to TypeScript consumers.
- Modify `shared/sideNotePromptPolicy.js` to add one general test-placement rule beside the existing reusable-script rule.
- Modify `tests/vaultScriptPolicy.test.mjs` to lock the derived shared path.
- Modify `tests/sideNotePromptPolicy.test.mjs` to verify ordinary, create-script, and update-script prompts each receive the rule exactly once.
- Modify `docs/superpowers/specs/2026-08-21-vault-script-test-location-design.md` only after implementation and verification pass.

### Task 1: Add the shared vault-script test location

**Files:**
- Modify: `tests/vaultScriptPolicy.test.mjs`
- Modify: `tests/sideNotePromptPolicy.test.mjs`
- Modify: `shared/vaultScriptPolicy.js`
- Modify: `shared/vaultScriptPolicy.d.ts`
- Modify: `shared/sideNotePromptPolicy.js`

- [ ] **Step 1: Write the failing shared-policy and prompt tests**

Add the canonical-path assertion to `tests/vaultScriptPolicy.test.mjs`:

```js
assert.equal(
    vaultScriptPolicy.VAULT_SCRIPT_TEST_FOLDER_PATH,
    "🛠️ scripts/tests",
);
```

Add this test to `tests/sideNotePromptPolicy.test.mjs`:

```js
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
        assert.match(prompt, /do not place `\.test\.\*` or `\.spec\.\*` files directly under `🛠️ scripts\/`/iu);
        assert.equal(prompt.match(/`🛠️ scripts\/tests\/`/gu)?.length, 1);
    }
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs
```

Expected: FAIL because `VAULT_SCRIPT_TEST_FOLDER_PATH` is undefined and the prompt has no test-folder rule.

- [ ] **Step 3: Add the canonical test-folder constant**

In `shared/vaultScriptPolicy.js`, derive the path directly from the runnable folder and export it:

```js
const VAULT_SCRIPT_FOLDER_PATH = "🛠️ scripts";
const VAULT_SCRIPT_TEST_FOLDER_PATH = `${VAULT_SCRIPT_FOLDER_PATH}/tests`;
```

```js
module.exports = {
    VAULT_SCRIPT_FOLDER_PATH,
    VAULT_SCRIPT_TEST_FOLDER_PATH,
    VAULT_SCRIPT_EXTENSIONS,
    parseVaultScriptPath,
    collectVaultScriptRegistrations,
};
```

In `shared/vaultScriptPolicy.d.ts`, add:

```ts
export const VAULT_SCRIPT_TEST_FOLDER_PATH: "🛠️ scripts/tests";
```

- [ ] **Step 4: Add one provider-neutral prompt rule**

Change the import in `shared/sideNotePromptPolicy.js`:

```js
const {
    VAULT_SCRIPT_FOLDER_PATH,
    VAULT_SCRIPT_TEST_FOLDER_PATH,
} = require("./vaultScriptPolicy.js");
```

Immediately after the existing reusable-script location instruction, add:

```js
`If you create tests for a vault script, place every test under the active vault's \`${VAULT_SCRIPT_TEST_FOLDER_PATH}/\`, create that folder if needed, and do not place \`.test.*\` or \`.spec.*\` files directly under \`${VAULT_SCRIPT_FOLDER_PATH}/\` beside runnable scripts.`,
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
node --test tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs
```

Expected: all selected tests pass, including the three-path exactly-once assertions.

- [ ] **Step 6: Commit the policy change**

```bash
git add shared/vaultScriptPolicy.js shared/vaultScriptPolicy.d.ts shared/sideNotePromptPolicy.js tests/vaultScriptPolicy.test.mjs tests/sideNotePromptPolicy.test.mjs
git commit -m "feat(scripts): isolate vault script tests"
```

### Task 2: Verify the complete change and update tracked status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-vault-script-test-location-design.md`

- [ ] **Step 1: Audit the shared rule surface**

Run:

```bash
rg -n "VAULT_SCRIPT_TEST_FOLDER_PATH|🛠️ scripts/tests|create that folder if needed|\.test\.\*|\.spec\.\*" shared src tests
```

Expected: one canonical path constant, one provider-neutral prompt instruction, declarations, and tests; no provider-adapter copy.

- [ ] **Step 2: Run the full automated checks**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
```

Expected: every command exits 0 with no failures or lint/type errors.

- [ ] **Step 3: Build and inspect the exact public artifact**

Run:

```bash
npm run bundle
npm run release:artifacts:check
```

Expected: the production bundle succeeds; the guard inspects only `main.js`, `manifest.json`, and `styles.css` and finds no source map, embedded source, raw TypeScript/JSX-family source, local path, or secret-bearing material.

- [ ] **Step 4: Update the tracked spec**

In `docs/superpowers/specs/2026-08-21-vault-script-test-location-design.md`:

- Change the status to `Implemented and verified`.
- Mark all `To Implement` and `Verification` checkboxes `[x]` only after Steps 1-3 pass.

- [ ] **Step 5: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-21-vault-script-test-location-design.md
git commit -m "docs: verify vault script test location"
```
