# Registered Vault Script Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight a slash mention in Aside comments only when the complete standalone token resolves to one currently registered runnable vault script.

**Architecture:** Keep `commentEditorStyling.ts` as the single tokenization and decoration owner. The plugin exposes a read-only registry-backed predicate, `AsideView` adapts it into the existing draft and persisted rendering hosts, and both hosts pass it to the shared highlighter; `@` mentions remain unconditional and missing predicates conservatively reject slash mentions.

**Tech Stack:** TypeScript, Obsidian plugin API, Node test runner, existing fake/source-contract test patterns, ESLint, esbuild.

---

## File Structure

- Modify `src/ui/editor/commentEditorStyling.ts`: own slash-token boundaries, predicate filtering, draft HTML/fragment rendering, and persisted DOM decoration.
- Modify `src/vaultScripts/vaultScriptRegistry.ts`: expose a boolean read-only resolution query without returning mutable registry state.
- Modify `src/main.ts`: expose the registry query to views.
- Modify `src/ui/views/AsideView.ts`: provide one thin live-registry callback to draft, inline-edit, and persisted hosts.
- Modify `src/ui/views/sidebarDraftComment.ts`: declare and consume the host predicate when rendering draft previews.
- Modify `src/ui/views/sidebarPersistedComment.ts`: declare and consume the host predicate after Markdown rendering.
- Modify `tests/commentEditorFormatting.test.ts`: test shared token policy and registry lifecycle outcomes.
- Modify `tests/vaultScriptRegistry.test.ts`: test the boolean registry query for current, removed, and ambiguous registrations.
- Create `tests/commentMentionHighlightingWiring.test.ts`: source-contract checks that both rendering adapters consume the same host predicate and that `AsideView` provides it from the plugin.
- Modify `docs/superpowers/specs/2026-08-08-registered-vault-script-highlighting-design.md`: mark implementation and verification items only after their evidence exists.

### Task 1: Define the shared registry-aware highlighting policy

**Files:**
- Modify: `tests/commentEditorFormatting.test.ts`
- Modify: `src/ui/editor/commentEditorStyling.ts`

- [x] **Step 1: Write failing shared-policy tests**

Add tests that inject an allow-list predicate and assert the exact HTML output:

```ts
const registeredScripts = new Set(["/clean-youtube-transcript"]);
const isRunnableVaultScriptMention = (mention: string) => registeredScripts.has(mention.toLowerCase());

test("renderStyledDraftCommentHtml highlights registered standalone slash mentions", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Run /CLEAN-YOUTUBE-TRANSCRIPT now", isRunnableVaultScriptMention),
        "Run <span class=\"aside-editor-token-mention\">/CLEAN-YOUTUBE-TRANSCRIPT</span> now",
    );
});

test("renderStyledDraftCommentHtml leaves unregistered slash mentions plain", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Run /missing now", isRunnableVaultScriptMention),
        "Run /missing now",
    );
});

test("renderStyledDraftCommentHtml does not partially highlight paths or urls", () => {
    const acceptEveryCandidate = () => true;
    const value = "/Users/wenqingli/note.md folder/clean https://example.com/path C:/Users/name";
    assert.equal(renderStyledDraftCommentHtml(value, acceptEveryCandidate), value);
});

test("renderStyledDraftCommentHtml keeps at mentions independent of the script registry", () => {
    assert.equal(
        renderStyledDraftCommentHtml("@todo /missing", () => false),
        "<span class=\"aside-editor-token-mention\">@todo</span> /missing",
    );
});
```

Also assert that omitting the predicate leaves `/clean` plain, establishing the conservative default.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentEditorFormatting.test.js
```

Expected: FAIL because `renderStyledDraftCommentHtml` does not accept a predicate and currently highlights slash-shaped path segments.

- [x] **Step 3: Implement one shared mention iterator**

In `commentEditorStyling.ts`, add the shared predicate type and keep separate boundary semantics for the two mention families:

```ts
export type RunnableVaultScriptMentionPredicate = (mention: string) => boolean;

const COMMENT_MENTION_PATTERN = /(^|[^\w<])(@[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_/-]+)*)|(^|[^\w</])(\/[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)*)(?![A-Za-z0-9_./-])/g;

interface CommentMentionMatch {
    index: number;
    end: number;
    prefix: string;
    mention: string;
}

function getCommentMentionMatches(
    value: string,
    isRunnableVaultScriptMention?: RunnableVaultScriptMentionPredicate,
): CommentMentionMatch[] {
    const matches: CommentMentionMatch[] = [];
    COMMENT_MENTION_PATTERN.lastIndex = 0;
    for (let match = COMMENT_MENTION_PATTERN.exec(value); match; match = COMMENT_MENTION_PATTERN.exec(value)) {
        const prefix = match[1] ?? match[3] ?? "";
        const mention = match[2] ?? match[4] ?? "";
        if (mention.startsWith("/") && !isRunnableVaultScriptMention?.(mention)) {
            continue;
        }
        matches.push({
            index: match.index,
            end: match.index + match[0].length,
            prefix,
            mention,
        });
    }
    return matches;
}
```

Refactor `appendMentionNodes`, `renderMentionHtml`, and `createMentionFragment` to consume `getCommentMentionMatches`. Add the optional predicate parameter to `renderStyledDraftCommentFragment`, `renderStyledDraftCommentHtml`, and `decorateRenderedCommentMentions`, and thread it into all three shared rendering paths. Do not change CSS classes or bold-marker behavior.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentEditorFormatting.test.js
```

Expected: all `commentEditorFormatting` tests PASS, including absolute-path and URL regressions.

- [x] **Step 5: Commit the shared policy**

```bash
git add src/ui/editor/commentEditorStyling.ts tests/commentEditorFormatting.test.ts
git commit -m "fix: validate highlighted script mentions"
```

### Task 2: Expose the live registry predicate and wire both renderers

**Files:**
- Modify: `tests/vaultScriptRegistry.test.ts`
- Create: `tests/commentMentionHighlightingWiring.test.ts`
- Modify: `src/vaultScripts/vaultScriptRegistry.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`

- [x] **Step 1: Write failing registry and wiring tests**

Add this behavior test to `vaultScriptRegistry.test.ts`:

```ts
test("isRunnableMention follows unique live registry state", () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["🛠️ scripts/Clean.mjs"]);
    assert.equal(registry.isRunnableMention("/clean"), true);
    assert.equal(registry.isRunnableMention("/CLEAN"), true);

    registry.upsert("🛠️ scripts/clean.js");
    assert.equal(registry.isRunnableMention("/clean"), false);

    registry.remove("🛠️ scripts/clean.js");
    assert.equal(registry.isRunnableMention("/clean"), true);

    registry.remove("🛠️ scripts/Clean.mjs");
    assert.equal(registry.isRunnableMention("/clean"), false);
});
```

Create `commentMentionHighlightingWiring.test.ts` using `readFileSync` and assert these representative contracts:

```ts
test("draft and persisted renderers consume the host script predicate", () => {
    const draftSource = readFileSync("src/ui/views/sidebarDraftComment.ts", "utf8");
    const persistedSource = readFileSync("src/ui/views/sidebarPersistedComment.ts", "utf8");
    assert.match(draftSource, /renderStyledDraftCommentFragment\([\s\S]*host\.isRunnableVaultScriptMention/);
    assert.match(persistedSource, /decorateRenderedCommentMentions\(container, host\.isRunnableVaultScriptMention\)/);
});

test("AsideView supplies the plugin live-registry predicate to comment hosts", () => {
    const source = readFileSync("src/ui/views/AsideView.ts", "utf8");
    const adapters = source.match(/isRunnableVaultScriptMention:\s*\(mention\)\s*=>\s*this\.plugin\.isRunnableVaultScriptMention\(mention\)/g) ?? [];
    assert.equal(adapters.length, 3);
});
```

Update `createRenderHost` and the two explicitly typed persisted hosts with a default `isRunnableVaultScriptMention: () => false` so the test suite expresses the required host contract.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/vaultScriptRegistry.test.js .test-dist/tests/commentMentionHighlightingWiring.test.js
```

Expected: FAIL because the boolean registry query and the render-host adapters do not exist.

- [x] **Step 3: Implement the registry query and plugin adapter**

Add the read-only query to `VaultScriptRegistry`:

```ts
isRunnableMention(mention: string): boolean {
    return this.resolve(mention) !== null;
}
```

Expose it from `Aside` in `main.ts`:

```ts
public isRunnableVaultScriptMention(mention: string): boolean {
    return this.vaultScriptRegistry.isRunnableMention(mention);
}
```

Add the same method signature to `AsideWithVaultScriptMentions` in `AsideView.ts`.

- [x] **Step 4: Wire the shared predicate through both host types**

Add this required member to `SidebarDraftCommentHost` and `SidebarPersistedCommentHost`:

```ts
isRunnableVaultScriptMention(mention: string): boolean;
```

Pass it into the shared functions:

```ts
renderStyledDraftCommentFragment(
    preview.ownerDocument,
    textarea.value,
    host.isRunnableVaultScriptMention,
)
```

```ts
decorateRenderedCommentMentions(container, host.isRunnableVaultScriptMention);
```

In all three relevant `AsideView` host objects—persisted card, draft card, and inline-edit draft—provide:

```ts
isRunnableVaultScriptMention: (mention) => this.plugin.isRunnableVaultScriptMention(mention),
```

- [x] **Step 5: Run focused registry, shared-policy, persisted-renderer, and wiring tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/commentEditorFormatting.test.js \
  .test-dist/tests/vaultScriptRegistry.test.js \
  .test-dist/tests/commentMentionHighlightingWiring.test.js \
  .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all selected tests PASS.

- [x] **Step 6: Re-run the change-surface audit**

Run:

```bash
rg -n "COMMENT_MENTION_PATTERN|renderStyledDraftCommentFragment|decorateRenderedCommentMentions|isRunnableVaultScriptMention" src tests
```

Expected: `commentEditorStyling.ts` remains the only slash-highlighting policy owner; draft/persisted files are thin consumers; `agentDirectives.ts` remains the intentional `@`-only parser.

- [x] **Step 7: Commit the live registry wiring**

```bash
git add \
  src/main.ts \
  src/vaultScripts/vaultScriptRegistry.ts \
  src/ui/views/AsideView.ts \
  src/ui/views/sidebarDraftComment.ts \
  src/ui/views/sidebarPersistedComment.ts \
  tests/commentMentionHighlightingWiring.test.ts \
  tests/sidebarPersistedComment.test.ts \
  tests/vaultScriptRegistry.test.ts
git commit -m "fix: wire live script mention highlighting"
```

### Task 3: Verify the complete plugin and update tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-registered-vault-script-highlighting-design.md`

- [x] **Step 1: Run the complete build and artifact inspection**

Run:

```bash
npm run build
```

Expected: the full test suite, lint, typecheck, Obsidian compliance check, production bundle, and `release:artifacts:check` all PASS. Confirm the exact public artifacts are `main.js`, `manifest.json`, and `styles.css`, with no source map markers, embedded sources, raw TypeScript/JSX-family files, local paths, or secret-bearing files.

- [x] **Step 2: Install the verified build into the `lean-startup` vault**

Run from the worktree:

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
obsidian vault=lean-startup plugin:reload id=aside
```

Expected: only the verified `main.js`, `manifest.json`, and `styles.css` are installed, and Obsidian reloads Aside successfully.

- [x] **Step 3: Smoke-check the reported case and a registered script**

Open the Aside sidebar for `/Users/wenqingli/Obsidian/lean-startup/Raw/The New Era of Startup Funding Has Just Begun.md`. Confirm an Aside draft or persisted comment containing the absolute path renders `/Users` as ordinary text. Find one unique current file under `lean-startup/🛠️ scripts/`, enter its `/script-name` mention, and confirm the full standalone token receives the existing mention styling.

- [x] **Step 4: Update the spec tracking with fresh evidence**

Change every completed `## Implementation Tracking` item to `[x]` only after Steps 1–3 supply its evidence. If GUI smoke automation is unavailable, leave only that smoke item unchecked and report it explicitly instead of claiming completion.

- [x] **Step 5: Commit the verified tracking update**

```bash
git add -f \
  docs/superpowers/specs/2026-08-08-registered-vault-script-highlighting-design.md \
  docs/superpowers/plans/2026-08-08-registered-vault-script-highlighting-plan.md
git commit -m "docs: track script highlighting implementation"
```

- [x] **Step 6: Review the final branch diff**

Run:

```bash
git status --short
git diff main...HEAD --check
git diff main...HEAD --stat
git log --oneline main..HEAD
```

Expected: the worktree is clean; the diff contains only the approved highlighting policy, registry/view adapters, regression tests, and tracked docs; whitespace checks pass.
