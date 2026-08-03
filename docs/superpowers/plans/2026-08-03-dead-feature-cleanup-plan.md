# Dead Feature Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Aside's abandoned resolved-thread and support-report submission surfaces while retaining the legacy sync-event tombstone required for contiguous event replay.

**Architecture:** Treat the current comment domain and `SupportLogInspectorModal` as the authoritative implementations. Delete stale entrypoints and unreachable modules, keep only a narrow `setThreadResolved` storage compatibility branch, and add repository-contract tests that prevent broken package scripts or removed feature surfaces from returning.

**Tech Stack:** TypeScript 5.9, JavaScript ES modules, Node's built-in test runner, Obsidian plugin APIs, ESLint, esbuild.

---

### Task 1: Add fail-first cleanup contracts

**Files:**
- Create: `tests/packageScriptTargets.test.mjs`
- Create: `tests/deadFeatureResidue.test.mjs`
- Modify: `tests/sideNotePromptPolicy.test.mjs:27-39`
- Modify: `tests/sideNoteSyncEvents.test.ts:68-116`

- [x] **Step 1: Add a generic package-script integrity test**

Create `tests/packageScriptTargets.test.mjs`:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));

test("direct Node package scripts point to existing files", () => {
    for (const [name, command] of Object.entries(packageJson.scripts)) {
        const match = /^node\s+([^\s]+\.mjs)(?:\s|$)/u.exec(command);
        if (!match) {
            continue;
        }

        assert.equal(
            existsSync(path.join(rootDir, match[1])),
            true,
            `${name} points to missing ${match[1]}`,
        );
    }
});
```

- [x] **Step 2: Add a structural regression test for both removed surfaces**

Create `tests/deadFeatureResidue.test.mjs`:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");
const readRepoFile = (filePath) => readFileSync(path.join(rootDir, filePath), "utf8");

test("removed resolve workflow stays out of active surfaces", () => {
    const activeText = [
        readRepoFile("AGENTS.md"),
        readRepoFile("README.md"),
        readRepoFile("shared/sideNotePromptPolicy.js"),
        readRepoFile("scripts/lib/asideRepoScripts.mjs"),
        readRepoFile("scripts/generate-large-graph-fixture.mjs"),
        readRepoFile("src/main.ts"),
    ].join("\n");

    assert.doesNotMatch(activeText, /resolve-note-comment|comment:resolve|resolved:\s*false|ensureCommentSelectionVisible|loadKnownCommentSelectionTarget/u);
});

test("support-report submission implementation stays removed", () => {
    const removedPaths = [
        "src/support/supportConfig.ts",
        "src/support/supportReportSender.ts",
        "src/support/supportTypes.ts",
        "src/ui/modals/SupportImagePreviewModal.ts",
        "src/ui/modals/SupportLogPreviewModal.ts",
        "src/ui/modals/SupportReportModal.ts",
    ];

    for (const filePath of removedPaths) {
        assert.equal(existsSync(path.join(rootDir, filePath)), false, `${filePath} should stay removed`);
    }

    assert.doesNotMatch(readRepoFile("README.md"), /sending a support report|Support reports are sent/iu);
    assert.doesNotMatch(readRepoFile("styles.css"), /aside-support-report-modal|aside-support-image-preview/iu);
});
```

- [x] **Step 3: Change the prompt-policy contract to the current action set**

Replace the final assertion in `buildSideNotePrompt carries built-in Aside write-mode terminology` with:

```js
    assert.match(prompt, /create, append, or update Aside side notes/i);
    assert.match(prompt, /side notes were added or updated/i);
    assert.doesNotMatch(prompt, /\b(?:resolve|resolved|archive|archived)\b/i);
```

- [x] **Step 4: Characterize the required legacy sync tombstone**

Add this test after the reducer idempotency test in `tests/sideNoteSyncEvents.test.ts`:

```ts
test("side-note sync reducer ignores legacy resolve events without blocking later clocks", () => {
    const thread = createThread("docs/note.md");
    const legacyResolve = createEvent({
        eventId: "event-2",
        logicalClock: 2,
        op: "setThreadResolved",
        payload: { threadId: thread.id, resolved: true },
    });
    const laterUpdate = createEvent({
        eventId: "event-3",
        logicalClock: 3,
        op: "updateEntry",
        payload: {
            threadId: thread.id,
            entryId: thread.entries[0].id,
            entry: {
                ...thread.entries[0],
                body: "updated after legacy resolve",
                timestamp: 1710000000300,
            },
        },
    });

    const reduced = reduceSideNoteSyncEvents([thread], [legacyResolve, laterUpdate]);

    assert.equal(reduced.threads[0].entries[0].body, "updated after legacy resolve");
    assert.equal(reduced.appliedLogicalClocks.has("device-a:2"), true);
    assert.equal(reduced.appliedLogicalClocks.has("device-a:3"), true);
});
```

- [x] **Step 5: Run the new JavaScript contracts and verify RED**

Run:

```bash
node --test tests/packageScriptTargets.test.mjs tests/deadFeatureResidue.test.mjs tests/sideNotePromptPolicy.test.mjs
```

Expected: FAIL because `comment:resolve`, resolve prompt wording, dead support modules, dead CSS, and dead README claims still exist. The failures must name those existing surfaces rather than syntax or fixture errors.

- [x] **Step 6: Compile and run the sync-event characterization**

Run:

```bash
npm test
```

Expected: the new sync tombstone test passes, while the new JavaScript cleanup contracts still fail for the expected stale surfaces.

### Task 2: Finish removing resolved-thread product behavior

**Files:**
- Modify: `package.json:29`
- Modify: `src/main.ts:1724-1788,1964-1975,2075-2100,2145-2163`
- Modify: `shared/sideNotePromptPolicy.js:34,43`
- Modify: `AGENTS.md:28,54,72-73`
- Modify: `README.md:47-53,137-138`
- Modify: `scripts/lib/asideRepoScripts.mjs:890,995`
- Modify: `scripts/generate-large-graph-fixture.mjs:225`
- Test: `tests/packageScriptTargets.test.mjs`
- Test: `tests/deadFeatureResidue.test.mjs`
- Test: `tests/sideNotePromptPolicy.test.mjs`
- Test: `tests/sideNoteSyncEvents.test.ts`

- [x] **Step 1: Remove broken and misleading entrypoints**

Delete the `comment:resolve` property from `package.json`. In `AGENTS.md`, delete the resolve/archive trigger bullet, the deleted helper-script line, and the resolve-thread intent mapping. In `README.md`, change the feature line to:

```md
- Uses a dedicated sidebar for drafting, editing, and deleting comments.
```

Delete the separate resolved-comments feature line and the `resolved note` glossary entry.

- [x] **Step 2: Update the shared prompt policy**

Replace the two stale prompt lines with:

```js
        "When the user asks to create, append, or update Aside side notes, make that change before replying.",
```

and:

```js
        "Do not claim that side notes were added or updated unless you actually made the change.",
```

- [x] **Step 3: Remove new serialized resolved fields**

Delete each `resolved: false,` property from the thread objects in `scripts/lib/asideRepoScripts.mjs` and `scripts/generate-large-graph-fixture.mjs`. Do not change legacy input parsing or the sync tombstone.

- [x] **Step 4: Delete the no-op composition-root funnel**

Remove all eight statements of this form from `src/main.ts`:

```ts
await this.ensureCommentSelectionVisible(...);
```

Then delete both private methods:

```ts
private async loadKnownCommentSelectionTarget(...): Promise<Comment | null>
private async ensureCommentSelectionVisible(...): Promise<void>
```

Keep the surrounding navigation and draft-controller calls unchanged.

- [x] **Step 5: Run resolved-surface tests and verify GREEN**

Run:

```bash
node --test tests/packageScriptTargets.test.mjs tests/sideNotePromptPolicy.test.mjs
node --test --test-name-pattern="removed resolve workflow" tests/deadFeatureResidue.test.mjs
npm test
```

Expected: package-script, resolve-residue, prompt-policy, and legacy sync-event tests pass. The support-report residue contract is intentionally deferred until Task 3.

- [x] **Step 6: Commit the resolved-thread cleanup**

```bash
git add package.json src/main.ts shared/sideNotePromptPolicy.js AGENTS.md README.md scripts/lib/asideRepoScripts.mjs scripts/generate-large-graph-fixture.mjs tests/packageScriptTargets.test.mjs tests/deadFeatureResidue.test.mjs tests/sideNotePromptPolicy.test.mjs tests/sideNoteSyncEvents.test.ts
git commit -m "refactor: finish removing resolved threads"
```

### Task 3: Delete the unreachable support-report submission cluster

**Files:**
- Delete: `src/support/supportConfig.ts`
- Delete: `src/support/supportReportSender.ts`
- Delete: `src/support/supportTypes.ts`
- Delete: `src/ui/modals/SupportImagePreviewModal.ts`
- Delete: `src/ui/modals/SupportLogPreviewModal.ts`
- Delete: `src/ui/modals/SupportReportModal.ts`
- Modify: `src/ui/views/supportReportPlanner.ts:1-188,310-331`
- Modify: `tests/supportReportPlanner.test.ts:3-65`
- Modify: `tests/noticePolicy.test.ts:5-13`
- Modify: `tests/logService.test.ts:126`
- Modify: `styles.css:116-120,2479-2593,2921-2928,2960-2968`
- Modify: `README.md:59-75`
- Test: `tests/deadFeatureResidue.test.mjs`

- [x] **Step 1: Delete the unreachable modules**

Delete the six files listed above. `SupportLogInspectorModal.ts`, `SupportLogPreviewSource`, `truncateLogPreview`, log location actions, and the live sidebar support button must remain.

- [x] **Step 2: Remove form-only planner code and stale event classifications**

From `supportReportPlanner.ts`, delete:

```ts
SUPPORTED_SCREENSHOT_MIME_TYPES
MAX_SUPPORT_SCREENSHOT_COUNT
MAX_SUPPORT_SCREENSHOT_BYTES
ScreenshotFileLike
SupportValidationInput
SupportValidationResult
ScreenshotSelectionResult
validateSupportReportInput
inferMimeType
validateScreenshotSelection
formatSupportAttachmentSize
```

From `classifySupportLogKind`, delete only these obsolete prefixes:

```ts
"thread.resolve"
"thread.reopen"
"support.form.opened"
"support.log.preview.opened"
"support.submit.begin"
```

Keep `support.debugger.opened` and all active draft, navigation, index, parsing, filtering, and formatting behavior.

- [x] **Step 3: Remove tests that only describe deleted submission behavior**

In `tests/supportReportPlanner.test.ts`, remove imports and tests for `validateSupportReportInput`, `validateScreenshotSelection`, and `formatSupportAttachmentSize`. Keep the `truncateLogPreview` assertions and all log model tests.

Remove the `Support report sent.` case from `tests/noticePolicy.test.ts`. Change the write-failure fixture event in `tests/logService.test.ts` to the current diagnostic event:

```ts
await service.log("error", "support", "support.log.read.error", {
    message: "failure",
});
```

- [x] **Step 4: Remove submission-only CSS**

Delete `.aside-support-report-modal`, `.aside-modal-footer`, form field/textarea rules, attachment rules, and `.aside-support-image-preview`. Change the shared selector:

```css
.aside-support-intro,
.aside-support-preview-note {
```

to:

```css
.aside-support-preview-note {
```

In the mobile media query, remove `.aside-modal-footer` and `.aside-modal-submit-btn` while keeping `.aside-modal-cancel-btn` responsive:

```css
@media (max-width: 768px) {
    .aside-modal-cancel-btn {
        width: 100%;
        min-height: 44px;
        padding: 12px 16px;
    }
}
```

- [x] **Step 5: Correct current README network claims**

Replace the network-access paragraph with wording that lists only current actions:

```md
Aside does not send vault contents, note paths, tags, clipboard contents, or local diagnostic logs to an Aside-operated analytics or support service. Network-capable actions are user initiated: opening an external link, invoking a local agent CLI, or publishing through the user's local Wrangler installation. The generated Aside index uses the default remote image at `ichef.bbci.co.uk` unless the user replaces or clears that image URL; Obsidian may request that image when it renders the note.
```

Delete the support-report bullet under `External services`.

- [x] **Step 6: Run targeted tests and verify GREEN**

Run:

```bash
node --test tests/deadFeatureResidue.test.mjs
npm test
```

Expected: all cleanup contracts and the full test suite pass.

- [x] **Step 7: Commit the support-submission cleanup**

```bash
git add src/support src/ui/modals/SupportImagePreviewModal.ts src/ui/modals/SupportLogPreviewModal.ts src/ui/modals/SupportReportModal.ts src/ui/views/supportReportPlanner.ts tests/supportReportPlanner.test.ts tests/noticePolicy.test.ts tests/logService.test.ts tests/deadFeatureResidue.test.mjs styles.css README.md
git commit -m "refactor: remove dead support submission flow"
```

### Task 4: Reconcile historical documentation and verify the complete change

**Files:**
- Modify: `docs/prd/persistent-diagnostics-plan.md:1`
- Modify: `docs/prd/persistent-diagnostics-spec.md:1`
- Modify: `docs/superpowers/specs/2026-08-03-dead-feature-cleanup-design.md:14-38`

- [x] **Step 1: Mark old support-submission designs as superseded**

Add this notice immediately below each persistent-diagnostics title:

```md
> Historical design note: the support-report submission workflow described here was never connected to the public runtime and has been removed. The current supported surface is the local-only log inspector implemented in `src/ui/modals/SupportLogInspectorModal.ts` and opened from the sidebar debug button.
```

Do not rewrite historical sections or remove current local logging guidance.

- [x] **Step 2: Re-run the change-surface audit searches**

Run:

```bash
rg -n "comment:resolve|resolve-note-comment|resolved: false|ensureCommentSelectionVisible|loadKnownCommentSelectionTarget|SupportReportModal|sendSupportReport|aside-support-report-modal|aside-support-image-preview" package.json src scripts shared README.md styles.css
rg -n "comment:resolve|resolve-note-comment|resolved: false|ensureCommentSelectionVisible|loadKnownCommentSelectionTarget|SupportReportModal|sendSupportReport|aside-support-report-modal|aside-support-image-preview" tests/deadFeatureResidue.test.mjs
if test -f AGENTS.md; then
    rg -n "comment:resolve|resolve-note-comment|resolved: false|ensureCommentSelectionVisible|loadKnownCommentSelectionTarget|SupportReportModal|sendSupportReport|aside-support-report-modal|aside-support-image-preview" AGENTS.md
fi
rg -n "setThreadResolved" src tests
```

Expected: the active-surface command returns no matches. The test command returns only intentional structural guard strings. If a local `AGENTS.md` exists, its conditional audit returns no matches. The final command returns only the storage operation union, operation validator, explicit no-op reducer case, and regression test.

- [x] **Step 3: Run compiler, lint, and Obsidian checks**

Run:

```bash
npm run typecheck
npm run lint
npm run check:obsidian
```

Expected: all three commands exit 0 with no warnings or errors.

- [x] **Step 4: Build and inspect the exact release artifacts**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, production bundle, and release artifact guard all pass. The guard confirms the shipped `main.js`, `manifest.json`, and `styles.css` contain no source-map markers, embedded `sourcesContent`, raw source files, or obvious secret material.

- [x] **Step 5: Update implementation tracking only after verification**

In `docs/superpowers/specs/2026-08-03-dead-feature-cleanup-design.md`, mark every completed `To Implement` and `Verification` item `[x]`. Leave an item unchecked if its stated verification did not pass.

- [x] **Step 6: Commit documentation and verified tracking**

```bash
git add -f docs/prd/persistent-diagnostics-plan.md docs/prd/persistent-diagnostics-spec.md docs/superpowers/specs/2026-08-03-dead-feature-cleanup-design.md docs/superpowers/plans/2026-08-03-dead-feature-cleanup-plan.md
git commit -m "docs: reconcile removed feature surfaces"
```

- [x] **Step 7: Confirm final repository state**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: the worktree is clean and the design, resolved cleanup, support cleanup, and documentation commits are present.
