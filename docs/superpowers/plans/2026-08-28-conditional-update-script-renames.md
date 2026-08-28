# Conditional Update-Script Renames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/update-script` perform a true script-and-test rename only when the user's request explicitly asks for one, while keeping every ordinary update strictly in place.

**Architecture:** Keep natural-language rename intent inside the one shared `sideNotePromptPolicy` consumed by every local CLI runtime. Strengthen that contract with guarded move, paired-test, collision, and pre-reply verification rules; rely on the existing Obsidian rename-event registry reseed to remove the old slash command and register the new filename-derived command.

**Tech Stack:** CommonJS shared prompt policy, TypeScript runtime adapter, Node test runner, Obsidian vault file events, npm build/compliance/artifact checks.

---

## File Map

- `shared/sideNotePromptPolicy.js` — owns the provider-neutral `/update-script` file-change contract.
- `tests/sideNotePromptPolicy.test.mjs` — directly proves ordinary-update and explicit-rename prompt behavior.
- `tests/agentRuntimeAdapter.test.ts` — proves the TypeScript adapter still forwards update requests into the shared policy.
- `docs/superpowers/specs/2026-08-28-conditional-update-script-renames-design.md` — tracked implementation and verification checklist.

No registry, directive-parser, controller, or provider-specific adapter code should change. The registry already derives mentions from filenames and reseeds on Obsidian rename events; the natural-language request must remain opaque to plugin routing.

### Task 1: Add the conditional shared prompt contract with TDD

**Files:**
- Modify: `tests/sideNotePromptPolicy.test.mjs:135-148`
- Modify: `tests/agentRuntimeAdapter.test.ts:1505-1516`
- Modify: `shared/sideNotePromptPolicy.js:86-94`

- [x] **Step 1: Replace the single prompt-policy expectation with separate ordinary-update and explicit-rename regressions**

Replace the existing `buildSideNotePrompt adds one exact in-place update-script contract` test in `tests/sideNotePromptPolicy.test.mjs` with:

```js
test("buildSideNotePrompt keeps ordinary update-script requests in place by default", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "make the default size reasonable",
        rootLabel: "vault root",
        rootPath: "/vault",
        requestKind: "update-script",
        targetScriptPath: "🛠️ scripts/embed-image-urls.mjs",
    });

    assert.match(prompt, /exact target.*in place/is);
    assert.match(prompt, /do not rename.*unless.*explicitly asks/is);
    assert.match(prompt, /do not.*unrelated vault files/is);
    assert.match(prompt, /current-note positional argument/is);
});

test("buildSideNotePrompt permits an explicit true rename only with guarded verification", () => {
    const prompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "rename the script name to clean-google-ai-summary",
        rootLabel: "vault root",
        rootPath: "/vault",
        requestKind: "update-script",
        targetScriptPath: "🛠️ scripts/compact-google-ai-images.mjs",
    });

    assert.match(prompt, /explicitly asks.*rename/is);
    assert.match(prompt, /move the existing script/is);
    assert.match(prompt, /case-insensitive.*collision/is);
    assert.match(prompt, /paired.*test/is);
    assert.match(prompt, /update.*imports.*path.*name/is);
    assert.match(prompt, /do not.*alias.*scriptName export/is);
    assert.match(prompt, /new script exists.*old script does not exist/is);
    assert.match(prompt, /slash invocation.*filename/is);
    assert.match(prompt, /before reporting rename success.*tests pass/is);
});
```

- [x] **Step 2: Strengthen the adapter regression before changing production code**

Replace the existing `buildSideNotePrompt forwards the exact update-script target to the shared policy` test in `tests/agentRuntimeAdapter.test.ts` with:

```ts
test("buildSideNotePrompt forwards update-script target and rename policy to the shared contract", () => {
    const prompt = buildSideNotePrompt({
        promptText: "rename the script name to clean-google-ai-summary",
        vaultRootPath: "/vault",
        requestKind: "update-script",
        targetScriptPath: "🛠️ scripts/compact-google-ai-images.mjs",
    });

    assert.match(prompt, /exact target `🛠️ scripts\/compact-google-ai-images\.mjs`/is);
    assert.match(prompt, /do not rename.*unless.*explicitly asks/is);
    assert.match(prompt, /move the existing script/is);
    assert.match(prompt, /paired.*test/is);
    assert.match(prompt, /rename the script name to clean-google-ai-summary/is);
    assert.doesNotMatch(prompt, /exact source PDF/i);
});
```

- [x] **Step 3: Run the direct shared-policy test and witness the expected RED failure**

Run:

```bash
node --test tests/sideNotePromptPolicy.test.mjs
```

Expected: FAIL because the current prompt still says `Do not rename it` unconditionally and contains none of the guarded move, paired-test, or old/new verification language.

- [x] **Step 4: Compile and run the adapter test and witness the expected RED failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: FAIL in the renamed update-script test because the shared prompt does not yet contain the conditional rename policy. Compilation itself must succeed.

- [x] **Step 5: Replace the unconditional production prompt with the minimal shared conditional contract**

Replace the `update-script` block in `shared/sideNotePromptPolicy.js` with:

```js
    if (options?.requestKind === "update-script" && targetScriptPath) {
        promptLines.push(
            `This is an /update-script request. Inspect and update the exact target \`${targetScriptPath}\` now.`,
            "By default, modify the exact target in place. Do not rename it or create a replacement unless the user's request explicitly asks to rename the script filename or slash invocation.",
            "If the request explicitly asks for a rename, move the existing script to one collision-free direct-child path under the vault script folder, preserve a supported extension, and leave no old-name alias.",
            "Reject reserved, hidden, nested, test/spec-suffixed, invalid, or case-insensitive script-name collisions instead of creating a substitute.",
            "If a paired tests/<old-script-stem>.test.<extension> file exists, move it to the matching new stem and update its imports plus exact path and name expectations.",
            "Do not represent a rename with an alias, wrapper, or scriptName export, and do not modify unrelated vault files.",
            "Preserve the script's current-note positional argument and vault-root working-directory contract.",
            "Before reporting rename success, run the paired tests and verify the new script exists, the old script does not exist, the slash invocation matches the new filename, no registration collision exists, and the tests pass.",
            "In the Aside reply, report the actual updated or renamed vault-relative path and its filename-derived /script-name invocation.",
            "If the target disappears, cannot be edited, cannot be renamed safely, or fails verification, state that plainly instead of creating a substitute or claiming success.",
        );
    }
```

Do not add an intent regex, a `renameAllowed` field, provider-specific prompt text, or registry mutation code.

- [x] **Step 6: Run both focused suites and witness GREEN**

Run:

```bash
node --test tests/sideNotePromptPolicy.test.mjs
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: all tests in both files pass with zero failures.

- [x] **Step 7: Inspect the focused diff and commit the behavior**

Run:

```bash
git diff --check
git diff -- shared/sideNotePromptPolicy.js tests/sideNotePromptPolicy.test.mjs tests/agentRuntimeAdapter.test.ts
git add shared/sideNotePromptPolicy.js tests/sideNotePromptPolicy.test.mjs tests/agentRuntimeAdapter.test.ts
git commit -m "fix(scripts): allow explicit script renames"
```

Expected: one focused commit containing only the shared contract and its regressions.

### Task 2: Run the complete verification and artifact-security pipeline

**Files:**
- Verify: `shared/sideNotePromptPolicy.js`
- Verify: `tests/sideNotePromptPolicy.test.mjs`
- Verify: `tests/agentRuntimeAdapter.test.ts`
- Verify exact shipped assets: `main.js`, `manifest.json`, `styles.css`

- [x] **Step 1: Run the full project build**

Run:

```bash
npm run build
```

Expected: 1,433 TypeScript-compiled tests and 105 `.mjs` tests pass, lint passes with zero warnings, typecheck passes, Obsidian compliance passes, production bundling succeeds, and the release-artifact guard reports `Release artifact inspection passed for main.js, manifest.json, styles.css`.

- [x] **Step 2: Independently inspect the exact shipped artifacts for source exposure and secrets**

Run:

```bash
wc -c main.js manifest.json styles.css
rg -n -F -e sourceMappingURL -e sourcesContent -e "-----BEGIN PRIVATE KEY-----" main.js manifest.json styles.css
rg -n -e "AKIA[0-9A-Z]{16}" -e "AIza[0-9A-Za-z_-]{35}" -e "gh[pousr]_[0-9A-Za-z]{20,}" -e "sk-[0-9A-Za-z]{20,}" main.js manifest.json styles.css
```

Expected: the size command lists exactly the three shipped assets; both `rg` commands return no matches. Do not publish or upload anything.

- [x] **Step 3: Confirm the worktree contains only intended committed changes**

Run:

```bash
git diff --check
git status --short --branch
git log -3 --oneline
```

Expected: no unstaged implementation changes; the branch contains the design commit and behavior commit.

### Task 3: Run installed-plugin acceptance with a disposable vault script

**Files:**
- Temporarily create in the chosen test vault: `🛠️ scripts/aside-rename-smoke.mjs`
- Temporarily create in the chosen test vault: `🛠️ scripts/tests/aside-rename-smoke.test.mjs`
- Install exact built assets: `main.js`, `manifest.json`, `styles.css`

- [x] **Step 1: Install the verified build into the `lean-startup` vault and reload Aside**

Run from the feature worktree:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: only `main.js`, `manifest.json`, and `styles.css` are copied to `.obsidian/plugins/aside`, then Obsidian reports that plugin `aside` reloaded.

- [x] **Step 2: Create a disposable direct-child script and paired test**

Create `🛠️ scripts/aside-rename-smoke.mjs` with:

```js
#!/usr/bin/env node

export function smokeMessage() {
    return "conditional rename smoke passed";
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
    console.log(smokeMessage());
}
```

Create `🛠️ scripts/tests/aside-rename-smoke.test.mjs` with:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { smokeMessage } from "../aside-rename-smoke.mjs";

test("disposable rename smoke script reports success", () => {
    assert.equal(smokeMessage(), "conditional rename smoke passed");
});
```

Run:

```bash
node --test "/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/aside-rename-smoke.test.mjs"
```

Expected: one test passes and `/aside-rename-smoke` appears in Aside's slash suggestions.

- [x] **Step 3: Exercise an ordinary update before the rename**

In a disposable page-note thread, submit:

```text
/update-script /aside-rename-smoke change the message to conditional rename ordinary update passed
```

Expected: the agent edits both message expectations without moving either file; `/aside-rename-smoke` remains available and `/aside-renamed-smoke` is absent.

- [x] **Step 4: Exercise the explicit true rename**

In the same thread, submit:

```text
/update-script /aside-rename-smoke rename the script and slash command to aside-renamed-smoke
```

Expected: `🛠️ scripts/aside-renamed-smoke.mjs` and `🛠️ scripts/tests/aside-renamed-smoke.test.mjs` exist; both old paths are absent; the test imports the renamed script; `/aside-rename-smoke` disappears; `/aside-renamed-smoke` appears without restarting Obsidian.

- [x] **Step 5: Run the renamed test and slash command**

Run:

```bash
node --test "/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/aside-renamed-smoke.test.mjs"
```

Then submit `/aside-renamed-smoke` in the disposable Aside thread.

Expected: the paired test passes and the script result contains `conditional rename ordinary update passed`.

- [x] **Step 6: Remove the two disposable smoke files after recording the result**

Move the two disposable files to Trash or delete only these exact paths after confirming they are the smoke fixtures:

```text
/Users/example/Obsidian/lean-startup/🛠️ scripts/aside-renamed-smoke.mjs
/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/aside-renamed-smoke.test.mjs
```

Expected: no disposable old or new smoke files remain. Do not remove any other vault scripts or tests.

### Task 4: Close tracked documentation after verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-conditional-update-script-renames-design.md:3-32`
- Modify: `docs/superpowers/plans/2026-08-28-conditional-update-script-renames.md`

- [x] **Step 1: Mark only evidenced implementation and verification items complete**

Change the spec status to `Implemented; verified` only if Tasks 1-3 all passed. Mark every `To Implement` and `Verification` checkbox `[x]` only when its corresponding evidence exists. If installed acceptance was not run, leave that checkbox unchecked and use `Implemented; installed acceptance pending`.

- [x] **Step 2: Mark completed plan steps and run documentation checks**

Change completed plan checkboxes to `[x]`, then run:

```bash
rg -n "T[B]D|T[O]DO|implement lat[e]r|fill in detail[s]" docs/superpowers/specs/2026-08-28-conditional-update-script-renames-design.md docs/superpowers/plans/2026-08-28-conditional-update-script-renames.md
git diff --check
git status --short --branch
```

Expected: no placeholder matches, no whitespace errors, and only the two tracked documents are modified after the implementation commit.

- [x] **Step 3: Commit the verified tracking state**

Run:

```bash
git add -f docs/superpowers/specs/2026-08-28-conditional-update-script-renames-design.md docs/superpowers/plans/2026-08-28-conditional-update-script-renames.md
git commit -m "docs: verify conditional script renames"
```

Expected: a documentation-only commit that accurately reflects completed and pending verification.
