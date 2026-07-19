# Cross-Platform Document Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert active PDF, EPUB, DOCX, and PPTX documents to safe readable Markdown on desktop and mobile through one deterministic service used by both an Obsidian command and Aside requests.

**Architecture:** Pure core modules own intent planning, bounded archive/XML parsing, format extraction, Markdown normalization, and atomic output planning. A single app controller supplies vault and PDF.js adapters; command registration and the agent controller remain thin callers. Deterministic conversion is selected before desktop CLI availability checks, so matching mobile requests never launch Codex or Claude.

**Tech Stack:** TypeScript 5.9, Obsidian `loadPdfJs`, `fflate@0.8.3`, `fast-xml-parser@5.10.1`, Node test runner, esbuild.

---

## File Structure

Create focused core modules under `src/core/conversion/`:

- `documentConversionContracts.ts`: formats, plans, progress, results, errors, and host-neutral interfaces.
- `documentConversionPolicy.ts`: centralized limits and validation helpers.
- `documentConversionIntent.ts`: conservative command/Aside routing and output path planning.
- `safeArchiveReader.ts`: bounded in-memory ZIP extraction with traversal and expansion guards.
- `orderedXml.ts`: inert ordered XML parsing and traversal helpers.
- `markdownWriter.ts`: escaping, block assembly, normalization, and final output validation.
- `pdfToMarkdown.ts`: PDF.js page extraction and conservative line/paragraph reconstruction.
- `epubToMarkdown.ts`: EPUB container/spine resolution and safe XHTML conversion.
- `docxToMarkdown.ts`: DOCX document/styles/numbering/relationship extraction.
- `pptxToMarkdown.ts`: PPTX slide-order, text, list, notes, link, and table extraction.
- `documentConversionService.ts`: format dispatch, cancellation, progress, temporary-write lifecycle, and typed results.

Create one app adapter:

- `src/app/documentConversionController.ts`: active-file command flow and Aside-result adapter over the shared service.

Modify only thin existing surfaces:

- `src/app/pluginRegistrationController.ts`: register `Convert document to Markdown`.
- `src/agents/commentAgentController.ts`: plan deterministic work before runtime selection and execute it before filesystem/CLI checks.
- `src/core/agents/agentRuns.ts`: add `document-converter` runtime metadata.
- `src/agents/agentRunStorePlanner.ts`: preserve the new runtime during persistence normalization.
- `src/main.ts`: construct the controller with Vault/PDF.js adapters and wire both callers.
- `package.json` and `package-lock.json`: pin the two parser dependencies.

Add focused tests without shipping fixture files:

- `tests/documentConversionIntent.test.ts`
- `tests/safeArchiveReader.test.ts`
- `tests/documentFormatConversion.test.ts`
- `tests/documentConversionService.test.ts`
- `tests/documentConversionController.test.ts`
- Modify `tests/pluginRegistrationController.test.ts` and `tests/commentAgentController.test.ts` only where wiring assertions belong.

### Task 1: Contracts, Policy, and Intent Planner

**Files:**
- Create: `src/core/conversion/documentConversionContracts.ts`
- Create: `src/core/conversion/documentConversionPolicy.ts`
- Create: `src/core/conversion/documentConversionIntent.ts`
- Test: `tests/documentConversionIntent.test.ts`

- [ ] **Step 1: Write failing intent and path tests**

Cover supported extensions, case normalization, explicit conversion verb plus Markdown target, rejection of summaries and unrelated work, sibling output paths, collision behavior, and explicit overwrite language.

```ts
assert.deepEqual(planDocumentConversionIntent({
    filePath: "Raw/Amazon.pdf",
    prompt: "@codex convert this PDF to Markdown and clean it up",
}), {
    format: "pdf",
    sourcePath: "Raw/Amazon.pdf",
    outputPath: "Raw/Amazon.md",
    allowOverwrite: false,
});
assert.equal(planDocumentConversionIntent({
    filePath: "Raw/Amazon.pdf",
    prompt: "@codex summarize this PDF",
}), null);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionIntent.test.js`

Expected: FAIL because the conversion modules do not exist.

- [ ] **Step 3: Implement contracts and centralized policy**

Define these stable public shapes:

```ts
export type DocumentFormat = "pdf" | "epub" | "docx" | "pptx";
export type DocumentConversionStage = "preflight" | "extract" | "normalize" | "write";
export interface DocumentConversionPlan {
    format: DocumentFormat;
    sourcePath: string;
    outputPath: string;
    allowOverwrite: boolean;
}
export interface DocumentConversionProgress {
    stage: DocumentConversionStage;
    completed: number;
    total?: number;
    message: string;
}
export class DocumentConversionError extends Error {
    constructor(public readonly code: DocumentConversionErrorCode, message: string) {
        super(message);
        this.name = "DocumentConversionError";
    }
}
```

Use one immutable default policy for input bytes, archive entries, expanded bytes, compression ratio, XML bytes, document units, output bytes, and elapsed time. All format adapters receive the policy rather than declaring local limits.

- [ ] **Step 4: Implement conservative intent and output planning**

Require a supported active extension, a conversion verb, and a Markdown target. Reject prompts containing analysis-only intents unless conversion is separately explicit. Normalize vault paths without accepting absolute paths or `..`. Recognize overwrite only from explicit phrases such as `overwrite`, `replace the existing file`, or `replace Amazon.md`.

- [ ] **Step 5: Run the focused test and confirm it passes**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionIntent.test.js`

Expected: all intent tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/conversion/documentConversionContracts.ts src/core/conversion/documentConversionPolicy.ts src/core/conversion/documentConversionIntent.ts tests/documentConversionIntent.test.ts
git commit -m "feat(conversion): plan document requests"
```

### Task 2: Safe Archive and Ordered XML Foundation

**Files:**
- Create: `src/core/conversion/safeArchiveReader.ts`
- Create: `src/core/conversion/orderedXml.ts`
- Test: `tests/safeArchiveReader.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install pinned pure-JavaScript dependencies**

Run: `npm install --save-exact fflate@0.8.3 fast-xml-parser@5.10.1`

Expected: both packages appear in `dependencies` with exact versions and the lockfile updates.

- [ ] **Step 2: Write failing archive and XML tests**

Build ZIPs in memory with `zipSync`; do not add binary fixtures. Cover valid reads, `../escape.xml`, absolute paths, excessive entries, declared/actual expansion overflow, abort, missing entries, `DOCTYPE`/`ENTITY`, and ordered namespace-prefixed nodes.

```ts
const bytes = zipSync({ "word/document.xml": strToU8("<w:document />") });
const archive = await readSafeArchive(bytes, DEFAULT_DOCUMENT_CONVERSION_POLICY);
assert.equal(decodeArchiveText(archive, "word/document.xml"), "<w:document />");
```

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/safeArchiveReader.test.js`

Expected: FAIL because the archive and XML helpers do not exist.

- [ ] **Step 4: Implement bounded asynchronous ZIP reading**

Use fflate's streaming `Unzip` API. Normalize every name before accepting it, inspect declared sizes before `start()`, count actual emitted bytes, reject excess immediately, and call `terminate()` on failure or abort. Return a read-only map of normalized entry names to bytes. Never extract entries to filesystem paths.

- [ ] **Step 5: Implement inert ordered XML parsing**

Reject `DOCTYPE` and `ENTITY` before parsing. Configure `XMLParser` with `preserveOrder: true`, attributes retained, entity processing disabled, and whitespace retained. Export helpers for tag name, attributes, children, recursive text, and child lookup without format-specific assumptions.

- [ ] **Step 6: Run the focused tests and confirm they pass**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/safeArchiveReader.test.js`

Expected: all archive/XML tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/core/conversion/safeArchiveReader.ts src/core/conversion/orderedXml.ts tests/safeArchiveReader.test.ts
git commit -m "feat(conversion): bound package parsing"
```

### Task 3: Markdown Writer and PDF Conversion

**Files:**
- Create: `src/core/conversion/markdownWriter.ts`
- Create: `src/core/conversion/pdfToMarkdown.ts`
- Test: `tests/documentFormatConversion.test.ts`

- [ ] **Step 1: Write failing Markdown and PDF tests**

Inject a fake PDF.js document with positioned text items across pages. Assert heading/paragraph/list output, progress per page, hard-wrap reflow, cancellation, encrypted errors, and OCR-required errors. Validate that blank, control-heavy, and oversized Markdown is rejected.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentFormatConversion.test.js`

Expected: FAIL because the Markdown/PDF modules do not exist.

- [ ] **Step 3: Implement the Markdown writer**

Represent extracted content as typed blocks (`heading`, `paragraph`, `list`, `quote`, `code`, `table`, `thematic-break`). Escape Markdown contextually, collapse repeated blank lines, preserve semantic blocks, and validate the final string for meaningful non-whitespace text, disallowed controls, and maximum bytes.

- [ ] **Step 4: Implement PDF conversion through an injected PDF.js loader**

Load the document from `Uint8Array`, reject password callbacks, iterate pages, sort text items by vertical then horizontal position, reconstruct lines with coordinate tolerances, and conservatively join hard-wrapped prose. Call `await yieldToHost()` and progress after every page. If every page lacks meaningful text, throw `ocr-required` rather than returning empty Markdown.

- [ ] **Step 5: Run the focused test and confirm it passes**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentFormatConversion.test.js`

Expected: Markdown/PDF cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/conversion/markdownWriter.ts src/core/conversion/pdfToMarkdown.ts tests/documentFormatConversion.test.ts
git commit -m "feat(conversion): extract PDF markdown"
```

### Task 4: EPUB, DOCX, and PPTX Conversion

**Files:**
- Create: `src/core/conversion/epubToMarkdown.ts`
- Create: `src/core/conversion/docxToMarkdown.ts`
- Create: `src/core/conversion/pptxToMarkdown.ts`
- Modify: `tests/documentFormatConversion.test.ts`

- [ ] **Step 1: Add failing in-memory package fixtures**

Build minimal packages with `zipSync`:

- EPUB: container, OPF manifest/spine, two XHTML chapters, a script to drop, and an external resource.
- DOCX: document, styles, numbering, relationships, footnote, table, macro part, and external relationship.
- PPTX: presentation order, two slides, slide relationships, notes, list paragraphs, table, and external relationship.

Assert stable Markdown order and absence of script/macro/external active content.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentFormatConversion.test.js`

Expected: FAIL because the three converters do not exist.

- [ ] **Step 3: Implement EPUB conversion**

Resolve container to OPF, manifest IDs to normalized local paths, and spine itemrefs to XHTML. Convert safe XHTML nodes in order to shared Markdown blocks. Drop scripts, styles, event attributes, remote resources, and unsupported active nodes. Yield and report progress per spine item.

- [ ] **Step 4: Implement DOCX conversion**

Resolve paragraph styles and numbering, traverse body order, map heading styles, lists, emphasis, hyperlinks, simple tables, footnotes, and endnotes into shared blocks. Ignore macros, embedded objects, and external relationships. Yield by major body batch.

- [ ] **Step 5: Implement PPTX conversion**

Resolve presentation slide order, sort text shapes by recoverable `y`/`x`, use title placeholders as headings, convert paragraphs/lists/tables, and append speaker notes under a `Notes` subheading. Ignore macros, embedded objects, media execution, and external relationships. Yield and report progress per slide.

- [ ] **Step 6: Run the focused test and confirm it passes**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentFormatConversion.test.js`

Expected: PDF, EPUB, DOCX, and PPTX fixture cases pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/conversion/epubToMarkdown.ts src/core/conversion/docxToMarkdown.ts src/core/conversion/pptxToMarkdown.ts tests/documentFormatConversion.test.ts
git commit -m "feat(conversion): extract office markdown"
```

### Task 5: Shared Service and Atomic Vault Lifecycle

**Files:**
- Create: `src/core/conversion/documentConversionService.ts`
- Test: `tests/documentConversionService.test.ts`

- [ ] **Step 1: Write failing service lifecycle tests**

Use an in-memory vault host. Cover dispatch for every format, source preflight, collision refusal, allowed overwrite, unique temporary path, success rename, validation failure cleanup, previous-target preservation, cancellation, timeout, progress, and output-size failure.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionService.test.js`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the shared service**

Inject vault reads/writes/moves/deletes, PDF.js loading, clock, timeout scheduling, ID generation, and cooperative yielding. Dispatch by the typed plan, race conversion against one timeout abort controller, validate Markdown, write only the temporary path, then finalize with a vault move. Use `finally` to clear timers and remove temporary files after every non-success outcome.

```ts
export interface DocumentConversionHost {
    readBinary(path: string): Promise<ArrayBuffer>;
    exists(path: string): Promise<boolean>;
    writeText(path: string, text: string): Promise<void>;
    move(path: string, destination: string): Promise<void>;
    remove(path: string): Promise<void>;
    loadPdfJs(): Promise<PdfJsLike>;
    yieldToHost(): Promise<void>;
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionService.test.js`

Expected: all lifecycle cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/conversion/documentConversionService.ts tests/documentConversionService.test.ts
git commit -m "feat(conversion): finalize vault output"
```

### Task 6: Command and Aside Adapters

**Files:**
- Create: `src/app/documentConversionController.ts`
- Create: `tests/documentConversionController.test.ts`
- Modify: `src/app/pluginRegistrationController.ts`
- Modify: `tests/pluginRegistrationController.test.ts`
- Modify: `src/core/agents/agentRuns.ts`
- Modify: `src/agents/agentRunStorePlanner.ts`
- Modify: `src/agents/commentAgentController.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing controller and command tests**

Assert the command registration ID/name, unsupported active-file notice, overwrite confirmation, conversion progress/cancel wiring, success/open behavior, and compact failure messages. Assert Aside intent planning happens before runtime availability selection and matching requests do not call the CLI host.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionController.test.js .test-dist/tests/pluginRegistrationController.test.js .test-dist/tests/commentAgentController.test.js`

Expected: FAIL because command and deterministic agent adapters are absent.

- [ ] **Step 3: Implement the app controller**

Expose:

```ts
planAsideRequest(filePath: string, prompt: string): DocumentConversionPlan | null;
convertActiveDocument(): Promise<void>;
runAsideConversion(options: {
    plan: DocumentConversionPlan;
    abortSignal?: AbortSignal;
    onProgressText?: (text: string) => void;
}): Promise<AgentRuntimeResponse>;
```

Return `runtime: "document-converter"` and a compact vault-relative success reply. Map typed errors to actionable notices/replies without absolute paths or parser stacks.

- [ ] **Step 4: Register the explicit command**

Add host method `convertActiveDocument()` and command:

```ts
this.host.addCommand({
    id: "convert-document-to-markdown",
    name: "Convert document to Markdown",
    icon: "file-output",
    callback: () => this.host.convertActiveDocument(),
});
```

- [ ] **Step 5: Route deterministic Aside work before agent availability**

Add a host planner that receives `filePath` and the raw triggering prompt. When it returns a plan, create the run with runtime `document-converter`, skip CLI runtime selection, and execute through the deterministic host. Reuse the existing stream/progress/output-entry finalization path. Ensure success/failure/cancel paths end the run in `finally`. Non-matching prompts continue unchanged.

- [ ] **Step 6: Persist and present the new runtime**

Extend `AgentRunRuntime` and persistence normalization with `document-converter`. Keep requested actor attribution but record conversion as the runtime/tool metadata so diagnostics are truthful.

- [ ] **Step 7: Wire Obsidian Vault and PDF.js in `main.ts`**

Use `vault.readBinary`, adapter existence checks, `vault.create`, `vault.rename`, `vault.delete`, `loadPdfJs`, `requestAnimationFrame`/short timer yielding, the existing notice/log facilities, and an Obsidian confirmation modal. Do not use Node APIs or filesystem paths.

- [ ] **Step 8: Run focused tests and confirm they pass**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionController.test.js .test-dist/tests/pluginRegistrationController.test.js .test-dist/tests/commentAgentController.test.js`

Expected: command and Aside integration cases pass.

- [ ] **Step 9: Commit**

```bash
git add src/app/documentConversionController.ts src/app/pluginRegistrationController.ts src/core/agents/agentRuns.ts src/agents/agentRunStorePlanner.ts src/agents/commentAgentController.ts src/main.ts tests/documentConversionController.test.ts tests/pluginRegistrationController.test.ts tests/commentAgentController.test.ts
git commit -m "feat(conversion): route document commands"
```

### Task 7: Recovery, Responsiveness, and Security Regression Coverage

**Files:**
- Modify: `tests/documentConversionService.test.ts`
- Modify: `tests/documentConversionController.test.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`

- [ ] **Step 1: Add failing regressions for the reported incident**

Model a converter that writes valid output and then settles, a converter that throws after progress, timeout, cancellation, reload with a persisted conversion run, and navigation to the output file. Assert no case leaves `queued`/`running`, no streaming node is revived, and existing output survives failures.

- [ ] **Step 2: Run the regression tests and confirm they fail where behavior is incomplete**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionService.test.js .test-dist/tests/documentConversionController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js`

Expected: any missing terminalization or UI isolation case fails.

- [ ] **Step 3: Make the minimal lifecycle corrections**

Centralize terminalization in the existing run completion helpers, clear conversion streams after settlement, classify persisted in-flight conversion runs as interrupted on startup, and ensure sidebar rendering depends only on active in-memory streams for running UI.

- [ ] **Step 4: Run the regression tests and confirm they pass**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionService.test.js .test-dist/tests/documentConversionController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js`

Expected: all recovery and responsiveness regressions pass.

- [ ] **Step 5: Commit**

```bash
git add tests/documentConversionService.test.ts tests/documentConversionController.test.ts tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts src/agents/commentAgentController.ts src/ui/views/sidebarPersistedComment.ts
git commit -m "fix(conversion): terminalize document runs"
```

### Task 8: Full Verification, Tracking, and Release Readiness

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-cross-platform-document-conversion-design.md`

- [ ] **Step 1: Run all conversion-focused tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/documentConversionIntent.test.js .test-dist/tests/safeArchiveReader.test.js .test-dist/tests/documentFormatConversion.test.js .test-dist/tests/documentConversionService.test.js .test-dist/tests/documentConversionController.test.js .test-dist/tests/pluginRegistrationController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js`

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run repository lint and type checks**

Run: `npm run lint && npm run typecheck && npm run typecheck:worker`

Expected: all commands exit 0 with zero lint warnings.

- [ ] **Step 3: Run the complete shared build**

Run: `npm run build`

Expected: all TypeScript, MJS, and worker tests pass; compliance, bundling, and artifact inspection pass.

- [ ] **Step 4: Inspect bundle and release boundaries**

Run: `npm run release:artifacts:check`

Expected: exact shipped assets remain `main.js`, `manifest.json`, and `styles.css`; no source map, embedded source content, raw source files, local paths, or secret material is reported.

- [ ] **Step 5: Perform manual desktop and mobile checks**

For each format, run the command and an Aside request; check progress, cancellation, collision refusal/confirmation, readable output, navigation responsiveness, and terminal thread state. On a scanned PDF, confirm the OCR-required error and absence of an empty output.

- [ ] **Step 6: Update implementation tracking**

Mark spec items complete only for behavior supported by passing automated or manual evidence. Leave mobile manual checks pending if no mobile device/emulator evidence exists.

- [ ] **Step 7: Commit verification tracking**

```bash
git add docs/superpowers/specs/2026-07-19-cross-platform-document-conversion-design.md
git commit -m "docs: track document conversion"
```
