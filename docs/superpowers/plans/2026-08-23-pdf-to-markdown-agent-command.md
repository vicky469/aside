# PDF-to-Markdown Agent Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable physical PDF conversion vault script with a one-token `/pdf-to-markdown` built-in that routes the current PDF to Aside's configured default agent under a strict, non-overwriting conversion contract.

**Architecture:** Add a pure command parser and a thin built-in controller before the existing vault-script router. Dispatch valid PDF requests into `CommentAgentController` with a durable `pdf-to-markdown` request kind, and keep conversion policy in the shared provider-independent side-note prompt. The physical vault script and its dedicated test are removed only after the built-in path passes regression tests.

**Tech Stack:** TypeScript 5.9, Node test runner, Obsidian plugin API, shared CommonJS prompt policy, esbuild, npm build and artifact-security checks.

---

## File Structure

### New files

- `src/core/text/pdfToMarkdownDirective.ts` — pure command grammar and stable user-facing copy.
- `src/agents/pdfToMarkdownCommandController.ts` — idempotent built-in validation and typed dispatch.
- `tests/pdfToMarkdownDirective.test.ts` — exact grammar regressions.
- `tests/pdfToMarkdownCommandController.test.ts` — PDF validation, disabled-agent handling, and dispatch regressions.

### Modified files

- `src/core/text/actionableMentions.ts` — reserve and suggest the command from the central built-in policy.
- `tests/actionableMentions.test.ts` — actionable and feature-disabled expectations.
- `tests/commentMentionSuggestions.test.ts` — slash ordering and reserved-script expectations.
- `tests/vaultScriptRegistry.test.ts` — prove a physical script cannot claim the built-in name.
- `tests/commentEditorFormatting.test.ts` — draft highlighting through the shared actionable policy.
- `tests/commentEditorPersistedMentions.test.ts` — persisted highlighting through the shared actionable policy.
- `src/main.ts` — instantiate the built-in controller and insert it before vault-script routing.
- `tests/commentScriptController.test.ts` — prove routing claims the built-in before a physical script or explicit agent fallback.
- `src/core/agents/agentRuns.ts` — add the durable `pdf-to-markdown` request kind.
- `src/agents/agentRunStorePlanner.ts` — normalize the new persisted request kind.
- `tests/agentRunStorePlanner.test.ts` — persistence regression.
- `src/agents/commentAgentController.ts` — queue and retry the built-in through default-agent selection.
- `tests/commentAgentController.test.ts` — preferred/fallback/no-agent, vault-root, and retry revalidation regressions.
- `shared/sideNotePromptPolicy.js` — single provider-independent conversion and preservation contract.
- `shared/sideNotePromptPolicy.d.ts` — expose the new request kind to TypeScript.
- `tests/agentRuntimeAdapter.test.ts` — shared prompt contract regression.
- `docs/superpowers/specs/2026-08-23-pdf-to-markdown-agent-command-design.md` — evidence-backed tracking closure.
- `main.js` — generated production bundle only; never hand-edit.

### Removed vault files

- `/Users/example/Obsidian/lean-startup/🛠️ scripts/pdf-to-clean-markdown.mjs`
- `/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs`

## Task 1: Own the command grammar and actionable identity

**Files:**

- Create: `src/core/text/pdfToMarkdownDirective.ts`
- Create: `tests/pdfToMarkdownDirective.test.ts`
- Modify: `src/core/text/actionableMentions.ts`
- Modify: `tests/actionableMentions.test.ts`
- Modify: `tests/commentMentionSuggestions.test.ts`
- Modify: `tests/vaultScriptRegistry.test.ts`
- Modify: `tests/commentEditorFormatting.test.ts`
- Modify: `tests/commentEditorPersistedMentions.test.ts`

- [ ] **Step 1: Write the failing parser and command-surface tests**

Create `tests/pdfToMarkdownDirective.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
    PDF_TO_MARKDOWN_USAGE,
    parsePdfToMarkdownDirective,
} from "../src/core/text/pdfToMarkdownDirective";

test("pdf-to-markdown parser accepts only one standalone command", () => {
    assert.deepEqual(parsePdfToMarkdownDirective(" /pdf-to-markdown \n"), { kind: "request" });
    assert.deepEqual(parsePdfToMarkdownDirective("ordinary note"), { kind: "none" });
    assert.deepEqual(parsePdfToMarkdownDirective("docs/pdf-to-markdown"), { kind: "none" });
    assert.deepEqual(parsePdfToMarkdownDirective("/pdf-to-markdown-extra"), { kind: "none" });
});

test("pdf-to-markdown parser rejects arguments and repeated commands", () => {
    assert.deepEqual(parsePdfToMarkdownDirective("/pdf-to-markdown please"), {
        kind: "rejected",
        message: PDF_TO_MARKDOWN_USAGE,
    });
    assert.deepEqual(parsePdfToMarkdownDirective("/pdf-to-markdown /pdf-to-markdown"), {
        kind: "rejected",
        message: "Use /pdf-to-markdown only once per side note.",
    });
});
```

Extend the existing actionable, suggestion, and registry tests so enabled built-ins end in `/pdf-to-markdown`, disabled Agents omit it, and `🛠️ scripts/pdf-to-markdown.mjs` is filtered as reserved.

Extend the draft-formatting assertion to render `/create-script`, `/update-script`, and `/pdf-to-markdown` as recognized mentions. Extend the persisted-decoration fixture and expected decorated tokens with `/pdf-to-markdown`. These tests must use `isActionableMention()` rather than adding view-local recognition.

- [ ] **Step 2: Compile and run the focused tests to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: TypeScript compilation fails because `pdfToMarkdownDirective.ts` and the new built-in identity do not exist.

- [ ] **Step 3: Implement the pure parser**

Create `src/core/text/pdfToMarkdownDirective.ts`:

```ts
export const PDF_TO_MARKDOWN_DIRECTIVE = "/pdf-to-markdown";
export const PDF_TO_MARKDOWN_USAGE = "Use /pdf-to-markdown by itself on a PDF.";
export const PDF_TO_MARKDOWN_SOURCE_REQUIRED = "Open a PDF and use /pdf-to-markdown.";
export const PDF_TO_MARKDOWN_NO_AGENT = "No agent is available to convert this PDF.";

export type PdfToMarkdownDirectiveResolution =
    | { kind: "none" }
    | { kind: "request" }
    | { kind: "rejected"; message: string };

const PDF_TO_MARKDOWN_PATTERN = /(^|[^\w/])(\/pdf-to-markdown)(?=$|\s)/giu;

export function parsePdfToMarkdownDirective(value: string): PdfToMarkdownDirectiveResolution {
    const matches = Array.from(value.matchAll(PDF_TO_MARKDOWN_PATTERN));
    if (matches.length === 0) return { kind: "none" };
    if (matches.length > 1) {
        return {
            kind: "rejected",
            message: "Use /pdf-to-markdown only once per side note.",
        };
    }

    const match = matches[0];
    const commandStart = (match?.index ?? 0) + (match?.[1]?.length ?? 0);
    const commandEnd = commandStart + PDF_TO_MARKDOWN_DIRECTIVE.length;
    const remainder = `${value.slice(0, commandStart)} ${value.slice(commandEnd)}`.trim();
    return remainder
        ? { kind: "rejected", message: PDF_TO_MARKDOWN_USAGE }
        : { kind: "request" };
}
```

- [ ] **Step 4: Add the command to the shared actionable policy**

Import `PDF_TO_MARKDOWN_DIRECTIVE` in `src/core/text/actionableMentions.ts` and append:

```ts
{ mention: PDF_TO_MARKDOWN_DIRECTIVE, label: "PDF to Markdown", requiresAgents: true },
```

after the existing update-script item. Do not add a separate reservation list; `RESERVED_BUILT_IN_MENTION_NAMES`, autocomplete, highlighting, and registry filtering must continue deriving from `getAllBuiltInMentions()`.

- [ ] **Step 5: Recompile and run the focused tests to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/pdfToMarkdownDirective.test.js .test-dist/tests/actionableMentions.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/vaultScriptRegistry.test.js .test-dist/tests/commentEditorFormatting.test.js .test-dist/tests/commentEditorPersistedMentions.test.js
```

Expected: all focused tests pass and `/pdf-to-markdown` is actionable only while Agents are enabled.

- [ ] **Step 6: Commit the command identity slice**

```bash
git add src/core/text/pdfToMarkdownDirective.ts src/core/text/actionableMentions.ts tests/pdfToMarkdownDirective.test.ts tests/actionableMentions.test.ts tests/commentMentionSuggestions.test.ts tests/vaultScriptRegistry.test.ts tests/commentEditorFormatting.test.ts tests/commentEditorPersistedMentions.test.ts
git commit -m "feat(agents): reserve PDF conversion command"
```

## Task 2: Route the built-in before physical vault scripts

**Files:**

- Create: `src/agents/pdfToMarkdownCommandController.ts`
- Create: `tests/pdfToMarkdownCommandController.test.ts`

- [ ] **Step 1: Write the failing controller tests**

Create a harness in `tests/pdfToMarkdownCommandController.test.ts` with captured replies, notices, and dispatched events. Add these assertions:

```ts
test("pdf-to-markdown dispatches one PDF request and claims duplicate saves", async () => {
    const harness = createHarness();
    const saved = event("/pdf-to-markdown", "Books/Guide.PDF");

    assert.equal(await harness.controller.handleSavedUserEntry(saved), true);
    assert.equal(await harness.controller.handleSavedUserEntry(saved), true);
    assert.deepEqual(harness.dispatchedFilePaths, ["Books/Guide.PDF"]);
    assert.deepEqual(harness.replies, []);
});

test("pdf-to-markdown rejects non-PDF and malformed requests before dispatch", async () => {
    const harness = createHarness();

    await harness.controller.handleSavedUserEntry(event("/pdf-to-markdown", "Books/Guide.md"));
    await harness.controller.handleSavedUserEntry(event("/pdf-to-markdown please", "Books/Guide.pdf", "entry-2"));

    assert.deepEqual(harness.dispatchedFilePaths, []);
    assert.deepEqual(harness.replies, [
        "Open a PDF and use /pdf-to-markdown.",
        "Use /pdf-to-markdown by itself on a PDF.",
    ]);
});
```

- [ ] **Step 2: Compile to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: compilation fails because `PdfToMarkdownCommandController` is missing.

- [ ] **Step 3: Implement the thin built-in controller**

Create `src/agents/pdfToMarkdownCommandController.ts` with the same lifecycle pattern as `CreateScriptCommandController`:

```ts
export interface PdfToMarkdownCommandHost {
    isAgentsFeatureAvailable(): boolean;
    showNotice(message: string): void;
    appendReply(event: SavedUserEntryEvent, body: string): Promise<void>;
    dispatchRequest(event: SavedUserEntryEvent): Promise<void>;
}

export class PdfToMarkdownCommandController {
    private readonly handledEntryIds = new Set<string>();

    constructor(private readonly host: PdfToMarkdownCommandHost) {}

    public initialize(): void { this.handledEntryIds.clear(); }
    public dispose(): void { this.handledEntryIds.clear(); }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        const resolution = parsePdfToMarkdownDirective(event.body);
        if (resolution.kind === "none") return false;
        if (this.handledEntryIds.has(event.entryId)) return true;
        this.handledEntryIds.add(event.entryId);

        if (!this.host.isAgentsFeatureAvailable()) {
            this.host.showNotice(AGENTS_EXPERIMENT_DISABLED_NOTICE);
            return true;
        }
        if (resolution.kind === "rejected") {
            await this.host.appendReply(event, resolution.message);
            return true;
        }
        if (!/\.pdf$/iu.test(event.filePath)) {
            await this.host.appendReply(event, PDF_TO_MARKDOWN_SOURCE_REQUIRED);
            return true;
        }

        await this.host.dispatchRequest(event);
        return true;
    }
}
```

- [ ] **Step 4: Run the focused controller tests to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/pdfToMarkdownCommandController.test.js
```

Expected: all focused tests pass; valid PDF requests are validated and claimed idempotently.

- [ ] **Step 5: Commit the built-in controller slice**

```bash
git add src/agents/pdfToMarkdownCommandController.ts tests/pdfToMarkdownCommandController.test.ts
git commit -m "feat(agents): validate PDF conversion shortcut"
```

## Task 3: Persist and execute the default-agent request

**Files:**

- Modify: `src/core/agents/agentRuns.ts`
- Modify: `src/agents/agentRunStorePlanner.ts`
- Modify: `tests/agentRunStorePlanner.test.ts`
- Modify: `src/agents/commentAgentController.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/main.ts`
- Modify: `tests/commentScriptController.test.ts`

- [ ] **Step 1: Write failing persistence and execution tests**

Add `pdf-to-markdown` to the persisted-run fixture in `tests/agentRunStorePlanner.test.ts` and assert it survives normalization.

Add controller tests modeled on create-script:

```ts
test("pdf-to-markdown queues the preferred default agent from the vault root", async () => {
    const harness = createHarness({
        runtimeWorkingDirectory: "/vault-root/Books",
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "claude",
            preferredAgent: "claude",
            usedFallback: false,
            runtime: "direct-cli",
            modePreference: "auto",
        },
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.requestKind, "pdf-to-markdown");
    assert.equal(run?.requestedAgent, "claude");
    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault-root");
    assert.equal(harness.runtimeCalls[0]?.requestKind, "pdf-to-markdown");
});
```

Also cover fallback metadata, no-agent reply, and a failed run whose retry stops before agent selection after its source path changes to `.md`.

Add a routing regression to `tests/commentScriptController.test.ts` where the PDF built-in controller returns `true` and assert the physical script controller and generic agent fallback are not called.

- [ ] **Step 2: Compile and run focused tests to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: compilation fails because `AgentRunRequestKind` and `handlePdfToMarkdownRequest` do not support the new kind.

- [ ] **Step 3: Extend durable request metadata**

Change `AgentRunRequestKind` to:

```ts
export type AgentRunRequestKind = "create-script" | "update-script" | "pdf-to-markdown";
```

In `agentRunStorePlanner.ts`, accept the new literal alongside the two existing kinds while retaining the target-path requirement only for `update-script`.

- [ ] **Step 4: Add default-agent dispatch**

Add `handlePdfToMarkdownRequest(event)` to `CommentAgentController`. It must mirror create-script selection but store:

```ts
requestKind: "pdf-to-markdown",
promptText: PDF_TO_MARKDOWN_DIRECTIVE,
```

If selection returns `none`, append `PDF_TO_MARKDOWN_NO_AGENT` and create no run.

Include `pdf-to-markdown` in the vault-root working-directory branch in `executeLocalRun()`.

- [ ] **Step 5: Add retry revalidation**

Before the ordinary explicit-agent retry branch, handle `previousRun?.requestKind === "pdf-to-markdown"`:

```ts
const commandEvent = {
    threadId: thread.id,
    entryId: latestComment.id,
    filePath: latestComment.filePath,
    body: latestComment.comment,
};
const pdfResolution = parsePdfToMarkdownDirective(latestComment.comment);
if (pdfResolution.kind !== "request") {
    await this.appendCommandReply(commandEvent, pdfResolution.kind === "rejected"
        ? pdfResolution.message
        : PDF_TO_MARKDOWN_USAGE);
    return false;
}
if (!/\.pdf$/iu.test(latestComment.filePath)) {
    await this.appendCommandReply(commandEvent, PDF_TO_MARKDOWN_SOURCE_REQUIRED);
    return false;
}
```

Then resolve the default agent fresh and rebuild the run with `requestKind: "pdf-to-markdown"` and `promptText: PDF_TO_MARKDOWN_DIRECTIVE`.

- [ ] **Step 6: Run the focused tests to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRunStorePlanner.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js .test-dist/tests/pdfToMarkdownCommandController.test.js
```

Expected: all focused tests pass, including preferred/fallback metadata, vault-root execution, no-agent fast return, and retry revalidation.

- [ ] **Step 7: Wire the controller into `main.ts`**

Instantiate `PdfToMarkdownCommandController` beside the create/update controllers with the shared append-reply adapter and:

```ts
dispatchRequest: (event) => this.commentAgentController.handlePdfToMarkdownRequest(event),
```

Add it to the built-in route array after update/create and before `commentScriptController`. Initialize and dispose it wherever the two existing built-in controllers are initialized and disposed. Re-run the focused command-controller and routing tests after wiring.

- [ ] **Step 8: Commit the durable agent-run and routing slice**

```bash
git add src/core/agents/agentRuns.ts src/agents/agentRunStorePlanner.ts src/agents/commentAgentController.ts src/main.ts tests/agentRunStorePlanner.test.ts tests/commentAgentController.test.ts tests/commentScriptController.test.ts
git commit -m "feat(agents): run PDF conversion with default agent"
```

## Task 4: Add one shared clean-Markdown conversion contract

**Files:**

- Modify: `shared/sideNotePromptPolicy.js`
- Modify: `shared/sideNotePromptPolicy.d.ts`
- Modify: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write the failing shared-prompt test**

Add:

```ts
test("buildSideNotePrompt forwards the PDF conversion contract", () => {
    const prompt = buildSideNotePrompt({
        promptText: "/pdf-to-markdown",
        vaultRootPath: "/vault",
        requestKind: "pdf-to-markdown",
    });

    assert.match(prompt, /current Note path as the exact source PDF/i);
    assert.match(prompt, /sibling.*\.md/i);
    assert.match(prompt, /already exists.*do not modify/i);
    assert.match(prompt, /inspect representative output/i);
    assert.match(prompt, /do not claim success/i);
});
```

Keep ordinary, create-script, and update-script assertions that these PDF-only instructions are absent.

- [ ] **Step 2: Compile and run the test to verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: TypeScript rejects the new request kind and the prompt assertions cannot pass.

- [ ] **Step 3: Extend the shared prompt type and policy**

Add `"pdf-to-markdown"` to the declaration's request-kind union. In `buildSideNotePrompt()`, append one PDF-only block:

```js
if (options?.requestKind === "pdf-to-markdown") {
    promptLines.push(
        "This is a /pdf-to-markdown request. Treat the current Note path as the exact source PDF.",
        "Derive the sibling destination by replacing the final .pdf extension with .md.",
        "If that sibling Markdown file already exists, do not modify it; report the conflict and stop.",
        "Inspect the PDF layout and text quality before choosing direct extraction, OCR, or another available document workflow.",
        "Produce readable Markdown with faithful headings, paragraphs, lists, and tables where the source supports them; clean extraction artifacts without inventing content.",
        "Inspect representative output at the beginning and at least one later section before reporting success.",
        "Preserve the source PDF, remove temporary conversion artifacts, and do not claim success unless the sibling file exists and the representative checks passed.",
        "If reliable conversion is not possible, state that plainly in the Aside reply.",
        "Return the vault-relative output path and a concise verification result.",
    );
}
```

Condition the general Markdown-page-only sentence so it is not emitted for PDF conversion runs; do not leave contradictory scope instructions in the same prompt.

- [ ] **Step 4: Run the shared-prompt tests to verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: all adapter tests pass and only the PDF request contains the conversion contract.

- [ ] **Step 5: Re-run the policy search**

Run:

```bash
rg -n "current Note path as the exact source PDF|already exists, do not modify" src shared tests
```

Expected: policy prose appears in `shared/sideNotePromptPolicy.js` and intentional test assertions only; provider adapters contain no copy.

- [ ] **Step 6: Commit the prompt slice**

```bash
git add shared/sideNotePromptPolicy.js shared/sideNotePromptPolicy.d.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat(agents): define PDF conversion contract"
```

## Task 5: Remove the obsolete vault script and test

**Files:**

- Remove: `/Users/example/Obsidian/lean-startup/🛠️ scripts/pdf-to-clean-markdown.mjs`
- Remove: `/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs`

- [ ] **Step 1: Resolve and inspect the exact deletion targets**

Run:

```bash
ls -lh '/Users/example/Obsidian/lean-startup/🛠️ scripts/pdf-to-clean-markdown.mjs' '/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs'
shasum -a 256 '/Users/example/Obsidian/lean-startup/🛠️ scripts/pdf-to-clean-markdown.mjs' '/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs'
```

Expected: exactly the approved runnable script and its dedicated test exist.

- [ ] **Step 2: Move both targets to recoverable Trash names**

Run with user-approved filesystem escalation:

```bash
mv '/Users/example/Obsidian/lean-startup/🛠️ scripts/pdf-to-clean-markdown.mjs' '/Users/example/.Trash/pdf-to-clean-markdown.mjs.aside-removed-20260823'
mv '/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs' '/Users/example/.Trash/pdf-to-clean-markdown.test.mjs.aside-removed-20260823'
```

Expected: both vault paths are absent and the recoverable Trash targets exist.

- [ ] **Step 3: Verify no obsolete runnable surface remains**

Run:

```bash
test ! -e '/Users/example/Obsidian/lean-startup/🛠️ scripts/pdf-to-clean-markdown.mjs'
test ! -e '/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs'
rg -n -i 'pdf-to-clean-markdown' '/Users/example/Obsidian/lean-startup/🛠️ scripts' || true
```

Expected: no match in the live vault scripts folder. Existing PDF and Markdown content elsewhere in the vault is untouched.

## Task 6: Verify, install, smoke-test, and close tracking

**Files:**

- Modify: `docs/superpowers/specs/2026-08-23-pdf-to-markdown-agent-command-design.md`
- Generated: `main.js`
- Install: `/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/{main.js,manifest.json,styles.css}`

- [ ] **Step 1: Run the complete build**

Run:

```bash
npm run build
```

Expected: all tests, lint, type checking, Obsidian compliance, production bundling, and release-artifact security checks pass. The artifact guard reports no source maps, embedded `sourcesContent`, raw TypeScript/JSX-family source, or secret-bearing files in shipped assets.

- [ ] **Step 2: Inspect the generated command surface**

Run:

```bash
rg -n "pdf-to-markdown|PDF to Markdown" src shared tests main.js
rg -n "pdf-to-clean-markdown" src shared tests main.js
```

Expected: the new built-in has intentional owners/adapters/tests; the obsolete physical-command name is absent from product code and the bundle.

- [ ] **Step 3: Install the verified bundle into `lean-startup`**

Run:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
```

Expected: the install script copies only `main.js`, `manifest.json`, and `styles.css` to the Aside plugin directory.

- [ ] **Step 4: Verify installed byte identity and source exposure**

Run:

```bash
for artifact in main.js manifest.json styles.css; do cmp -s "$artifact" "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/$artifact" || exit 1; done
rg -n 'sourceMappingURL|sourcesContent' main.js '/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js'
```

Expected: every `cmp` succeeds and the source-exposure search returns no matches.

- [ ] **Step 5: Reload Aside and run the real PDF smoke test**

Reload the plugin in `lean-startup`, open `z_📚 reading/essential-guide-shenzhen-web.pdf`, and submit `/pdf-to-markdown` in its Aside thread. Verify the stored run has `requestKind: "pdf-to-markdown"`, runtime `direct-cli`, and the selected default agent rather than a script run. Verify the thread receives either a checked sibling output path or the approved existing-output conflict.

- [ ] **Step 6: Update the tracked spec with fresh evidence**

Mark only the implementation and verification boxes supported by the build, installed-byte comparison, and live smoke evidence. Change status to `Implemented` only if every required item is complete.

- [ ] **Step 7: Run final verification after the tracking edit**

Run:

```bash
git diff --check
npm run build
git status --short
```

Expected: diff check and full build pass; status lists only intentional source, tests, generated bundle, and tracking changes.

- [ ] **Step 8: Commit the verified integration**

```bash
git add main.js docs/superpowers/specs/2026-08-23-pdf-to-markdown-agent-command-design.md
git commit -m "chore: verify PDF agent command"
```

The earlier task commits already contain source and test changes. The final commit records the verified production bundle and evidence-backed spec closure.
