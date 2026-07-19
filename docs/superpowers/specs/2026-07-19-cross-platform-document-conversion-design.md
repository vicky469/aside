# Cross-Platform Document Conversion Design

**Date:** 2026-07-19
**Status:** Approved for implementation planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside supports page-note threads on PDF files.
- [x] Aside can route normal `@codex` and `@claude` requests through the local agent runtime.
- [x] Persisted in-flight agent runs are recoverable after plugin restart.

### To Implement

- [ ] Add one cross-platform document conversion service shared by desktop and mobile.
- [ ] Convert PDF, EPUB, DOCX, and PPTX inputs to readable sibling Markdown files without invoking an agent, shell, Python, or a network service.
- [ ] Add an explicit `Convert document to Markdown` Obsidian command for the active supported document.
- [ ] Conservatively route matching Aside natural-language requests to the same conversion service before launching Codex or Claude.
- [ ] Preserve recoverable headings, paragraphs, lists, links, and tables while avoiding claims of pixel-perfect layout reconstruction.
- [ ] Reject unsafe, encrypted, unsupported, empty, or suspicious inputs without replacing an existing output.
- [ ] Add progress, cancellation, collision confirmation, timeouts, and terminal run-state handling that cannot leave the sidebar stuck.
- [ ] Keep archive and document parsing bounded enough to avoid freezing Obsidian mobile.

### Verification

- [ ] Unit tests cover intent matching, output naming, collision policy, validation, and terminal run states.
- [ ] Fixture tests cover representative PDF, EPUB, DOCX, and PPTX conversions.
- [ ] Adversarial tests cover encrypted PDFs, scanned PDFs without extractable text, malformed XML, traversal paths, excessive archive expansion, excessive output, and cancellation.
- [ ] Integration tests prove the command and Aside request adapters call the same conversion service.
- [ ] Regression tests prove a completed or failed conversion cannot remain `running` and opening its output does not freeze the sidebar.
- [ ] Desktop and mobile manual checks verify progress, cancellation, collision confirmation, output rendering, and responsive navigation.
- [ ] The production bundle and release artifact guard pass without adding shipped assets beyond `main.js`, `manifest.json`, and `styles.css`.

## Problem

An Aside request to convert a PDF launched a general Codex session. The Markdown file was written, but the persisted agent run remained `running`, leaving the thread and related UI stuck. The produced file contained valid readable text, which shows that conversion and agent-run finalization failed independently.

Document conversion is bounded, deterministic work. It should not pay the latency and reliability cost of an open-ended agent session. Aside should own one direct conversion path and expose it through both an explicit Obsidian command and conservative natural-language routing.

## Goals

- Convert PDF, EPUB, DOCX, and PPTX files to readable Markdown on desktop and mobile.
- Use one conversion service for every caller so behavior cannot drift.
- Keep normal agent requests unchanged.
- Avoid subprocesses, Python, global tools, network services, and runtime dependency installation.
- Prevent empty or malformed output from replacing useful files.
- Keep the Obsidian interface responsive during conversion.
- Guarantee every conversion reaches a succeeded, failed, or cancelled terminal state.

## Non-Goals

- Pixel-perfect reconstruction of source layout.
- OCR for image-only or scanned PDFs in the first version.
- Execution of Office macros, EPUB scripts, embedded JavaScript, or external resources.
- Support for legacy binary `.doc` or `.ppt` files.
- Editing or round-tripping the original document format.
- Automatic conversion of a document merely because it was opened.

## Architecture

### Shared owner

A pure TypeScript `DocumentConversionService` is the single owner of:

- supported-extension detection;
- input preflight and safety limits;
- format-specific extraction;
- Markdown normalization;
- output naming and collision policy;
- progress and cancellation;
- temporary output validation and finalization;
- typed success and failure results.

Format converters implement a narrow interface and return a stream or ordered sequence of Markdown blocks. They do not write vault files directly. The shared service owns all writes and validation.

### Thin adapters

Two adapters consume the service:

- The command adapter registers `Convert document to Markdown`, resolves the active file, asks before overwriting, displays progress, and optionally opens the completed Markdown file.
- The Aside adapter recognizes an explicit conversion request against a supported active document, runs the same service, and writes a compact result or actionable failure into the existing thread.

Neither adapter contains format-specific conversion logic.

### No duplicated desktop path

Desktop and mobile use the same in-process implementation bundled into `main.js`. Desktop does not retain a Python, shell, MarkItDown, or Codex-specific fast path. This avoids behavioral drift and makes test results representative of both platforms.

## Request Routing

Natural-language routing must be conservative. Aside bypasses the selected agent only when all conditions are true:

1. The active file has a supported extension: `.pdf`, `.epub`, `.docx`, or `.pptx`.
2. The request contains an explicit conversion verb such as `convert`, `export`, or `turn`.
3. The request explicitly targets Markdown or a `.md` file.
4. The request does not ask for unrelated analysis, research, rewriting, annotation, or multi-file work.

Requests such as `@codex convert this PDF to Markdown and clean up the format` use the deterministic converter. Requests such as `@codex summarize this PDF` continue through the normal agent runtime.

Intent detection is a pure shared planner with table-driven tests. It returns a typed plan rather than launching work itself.

## Format Pipelines

### PDF

- Use Obsidian's PDF.js runtime.
- Process pages in order and extract positioned text items.
- Reconstruct lines and paragraphs conservatively from coordinates and spacing.
- Detect likely headings without inventing structure that is not supported by the source.
- Yield between pages and report page-level progress.
- Reject encrypted files and files with no meaningful extractable text.
- Return an explicit OCR-required error for image-only PDFs.

### EPUB

- Treat EPUB as a bounded ZIP container without extracting entries to the filesystem.
- Resolve `META-INF/container.xml`, the package document, and the declared spine.
- Parse spine XHTML in reading order.
- Convert safe structural elements to Markdown while dropping scripts, styles, event handlers, remote fetches, and unsupported active content.
- Preserve recoverable headings, paragraphs, lists, links, block quotes, code, and simple tables.

### DOCX

- Treat DOCX as a bounded Open Packaging Convention container.
- Parse document, styles, numbering, relationships, footnotes, and endnotes only as data.
- Ignore macros, embedded objects, external relationships, and active content.
- Preserve recoverable headings, paragraphs, lists, links, simple tables, footnotes, and basic emphasis.

### PPTX

- Treat PPTX as a bounded Open Packaging Convention container.
- Read slides in presentation order and text shapes in stable visual order where recoverable.
- Use each slide title as a heading and preserve body text, lists, speaker notes, links, and simple tables.
- Ignore macros, embedded objects, media execution, and external relationships.

## Markdown Fidelity

The output target is readable, editable Markdown rather than visual equivalence.

- Preserve explicit source structure before applying heuristics.
- Normalize whitespace and page-break artifacts.
- Reflow obvious PDF hard wraps without merging headings, lists, tables, or short labels into prose.
- Avoid aggressive cleanup for EPUB and Office inputs that already provide semantic structure.
- Do not fabricate image descriptions or silently claim OCR success.
- Include a short generated-source comment or frontmatter field only if the repository's existing note conventions support it; conversion must not require metadata.

## Output Safety

The default output is a sibling file with the same basename and a `.md` extension.

- If the target does not exist, conversion may proceed.
- The explicit command requires confirmation before replacing an existing target.
- A natural-language Aside request must include an explicit overwrite instruction before replacing an existing target; otherwise it returns a collision message.
- Conversion writes to a uniquely named temporary vault file first.
- The service validates non-whitespace content, UTF-8-safe text, control characters, output size, and required structure before finalization.
- The service renames the temporary file only after validation succeeds.
- Failure or cancellation removes the temporary file and preserves the previous target.

## Resource and Security Limits

Limits are centralized policy values and are applied before and during parsing.

- Bound input bytes, archive entry count, cumulative uncompressed bytes, compression ratio, XML node/text volume, page/slide/chapter count, generated output bytes, and elapsed conversion time.
- Reject archive entry names that are absolute, contain traversal segments, or normalize outside the logical package root.
- Never write archive entries directly to filesystem paths.
- Parse XML and XHTML without external entity expansion or network access.
- Never execute macros, scripts, event handlers, embedded objects, or external relationships.
- Yield between document units and long parsing batches so mobile navigation and cancellation remain responsive.
- Use `AbortSignal` throughout the planner, converter, normalization, and write stages.
- Prefer small audited pure-JavaScript dependencies that do not use `eval`; record license and bundle-size impact during implementation planning.

Initial numeric limits must be selected from representative device measurements during implementation and kept in one tested policy module. They must not be scattered across format adapters.

## Lifecycle and UI

### Explicit command

1. Resolve the active supported document.
2. Preflight the source and destination.
3. Confirm replacement if needed.
4. Show progress with a cancel action.
5. Convert, validate, and finalize.
6. Show a concise success notice and offer to open the Markdown output.

### Aside request

1. Parse the directive and build a deterministic conversion plan before agent launch.
2. Create or reuse the output entry and persist a running operation.
3. Stream concise progress without placing document content in the sidebar.
4. Convert, validate, and finalize.
5. Replace progress with a compact success reply containing the vault-relative output path.
6. Persist succeeded, failed, or cancelled state in a `finally`-guarded terminalization path.

The conversion adapter must not leave a running state after its promise settles. A watchdog marks overdue operations failed and aborts remaining work. Plugin startup converts persisted in-flight conversions into interrupted failures because no in-memory conversion can survive a reload.

Opening the generated Markdown file is independent of the originating PDF thread. The sidebar must not borrow or retain a streaming node for a conversion that has already terminalized.

## Error Handling

User-facing failures are specific and actionable:

- unsupported file type;
- encrypted or password-protected document;
- no extractable text and OCR required;
- malformed or suspicious archive;
- resource limit exceeded;
- output already exists;
- conversion cancelled;
- conversion timed out;
- temporary or final vault write failed.

Errors must not expose local absolute paths, archive internals beyond a safe entry label, or raw parser stack traces in the sidebar. Detailed diagnostics may go to Aside's local logs with sensitive paths normalized.

## Testing Strategy

### Unit tests

- Supported extensions and deterministic intent matching.
- Output path planning and explicit overwrite requirements.
- Shared safety limits and normalized archive paths.
- Markdown block normalization and output validation.
- Progress, cancellation, timeout, cleanup, and terminal state transitions.

### Format fixture tests

Use small, license-safe fixtures with known expected semantic output:

- a text PDF with multiple pages, headings, paragraphs, and lists;
- an image-only PDF that must request OCR;
- an EPUB with ordered spine chapters and active content that must be ignored;
- a DOCX with headings, lists, links, a table, and footnotes;
- a PPTX with multiple slides, lists, links, notes, and a table.

### Adversarial tests

- encrypted PDF;
- malformed ZIP and XML;
- path traversal entries;
- excessive entry count, expansion ratio, XML volume, and output size;
- external relationships and active content;
- cancellation during each format pipeline;
- existing output preservation after every failure mode.

### Integration and regression tests

- Command and Aside adapters produce equivalent output through the shared service.
- Matching conversion requests do not invoke Codex or Claude.
- Non-conversion requests still invoke the selected agent.
- Success, failure, cancellation, and timeout all persist terminal states.
- Reload recovery marks interrupted conversions failed.
- Opening generated Markdown remains responsive and does not revive streaming UI.

## Release Constraints

- Conversion code and dependencies bundle into `main.js`.
- The GitHub release asset allowlist remains exactly `main.js`, `manifest.json`, and `styles.css`.
- No raw TypeScript, source maps, test fixtures, conversion fixtures, or local runtime files ship in the release.
- Release artifact inspection remains mandatory before publishing.

## Rollout

The feature ships behind normal capability checks rather than an experimental setting. Unsupported or unsafe inputs fail closed. Initial release notes must call out supported formats, the absence of OCR, collision behavior, and mobile resource limits.

Telemetry is not required. Local structured logs should record format, input-size bucket, duration, terminal status, and normalized failure category without recording document content or absolute paths.
