# Create-Script Preview Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the built-in `/create-script` directive like registered vault-script mentions in live draft and saved-comment previews.

**Architecture:** Keep the vault-script registry reserved-name policy unchanged. Extend the shared comment mention matcher to accept names from the existing built-in slash-directive policy before it asks the injected live-registry predicate, so every preview renderer inherits one classification rule.

**Tech Stack:** TypeScript, Node test runner, Obsidian DOM rendering, esbuild

---

### Task 1: Lock Built-In Preview Classification

**Files:**
- Modify: `tests/commentEditorFormatting.test.ts`
- Modify: `src/ui/editor/commentEditorStyling.ts`

- [ ] **Step 1: Write the failing renderer regression test**

Add a focused assertion beside the registered slash-mention tests:

```ts
test("renderStyledDraftCommentHtml highlights built-in create-script without registry registration", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Use /create-script to build it", () => false),
        "Use <span class=\"aside-editor-token-mention\">/create-script</span> to build it",
    );
});
```

The injected predicate deliberately rejects every token. This proves the command is classified by the built-in policy instead of accidentally entering the vault-script registry.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentEditorFormatting.test.js
```

Expected: FAIL because the actual HTML leaves `/create-script` as plain text.

- [ ] **Step 3: Implement the minimal shared matcher rule**

Import `RESERVED_BUILT_IN_SLASH_MENTION_NAMES` from `src/core/text/createScriptDirective.ts`. Add one private classifier in `commentEditorStyling.ts`:

```ts
function isSupportedSlashMention(
    mention: string,
    isRunnableVaultScriptMention?: RunnableVaultScriptMentionPredicate,
): boolean {
    const normalizedMention = mention.slice(1).toLowerCase();
    return RESERVED_BUILT_IN_SLASH_MENTION_NAMES.has(normalizedMention)
        || Boolean(isRunnableVaultScriptMention?.(mention));
}
```

Use it in `getCommentMentionMatches` for slash tokens. Do not change `VaultScriptRegistry`, directive routing, CSS, or persisted settings.

- [ ] **Step 4: Run the focused renderer and wiring tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentEditorFormatting.test.js .test-dist/tests/commentMentionHighlightingWiring.test.js
npx eslint src/ui/editor/commentEditorStyling.ts tests/commentEditorFormatting.test.ts --max-warnings 0
```

Expected: all focused tests pass and ESLint reports no warnings.

- [ ] **Step 5: Audit the change surface**

Run:

```bash
rg -n "RESERVED_BUILT_IN_SLASH_MENTION_NAMES|create-script|isRunnableVaultScriptMention" src tests shared
```

Expected: the built-in name remains owned by `createScriptDirective.ts`; the editor matcher consumes that policy; the registry still filters reserved names; draft and saved preview adapters remain thin consumers.

- [ ] **Step 6: Commit the regression fix**

```bash
git add src/ui/editor/commentEditorStyling.ts tests/commentEditorFormatting.test.ts
git commit -m "fix(editor): highlight create-script mention"
```

### Task 2: Verify and Install the Aside Build

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-default-agent-script-creation-design.md`
- Generated: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Run the complete repository gate**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
npm run bundle
npm run release:artifacts:check
```

Expected: zero test failures, zero lint warnings, successful typecheck and Obsidian compliance, a successful production bundle, and exact allowlisted release artifacts.

- [ ] **Step 2: Inspect the exact generated assets**

Inspect `main.js`, `manifest.json`, and `styles.css`. Fail if `main.js.map` exists or if any shipped asset contains `sourceMappingURL`, `sourcesContent`, obvious private-key material, or obvious access-key markers.

- [ ] **Step 3: Install and byte-compare the verified build**

Run:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
cmp -s main.js /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: the installer copies exactly three files and every comparison exits zero.

- [ ] **Step 4: Record automated verification**

Mark the preview implementation and regression-test checklist items complete in the associated spec. Leave installed frontend acceptance pending until the user reloads Aside and confirms `/create-script` is blue in both draft and saved previews.

- [ ] **Step 5: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-19-default-agent-script-creation-design.md
git commit -m "docs(scripts): track preview fix"
```
