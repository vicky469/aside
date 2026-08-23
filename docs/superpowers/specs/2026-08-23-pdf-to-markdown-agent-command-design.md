# PDF-to-Markdown Agent Command Design

**Date:** 2026-08-23
**Status:** Approved; implementation pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside supports page-note threads on PDF files and passes the PDF vault path into agent prompt context.
- [x] `/create-script` and `/update-script` already prove that built-in slash commands can select the available default agent and reuse normal agent streaming, persistence, fallback, cancellation, and retry behavior.
- [x] The real failure was reproduced: the physical `pdf-to-clean-markdown.mjs` vault script is rejected before launch because the vault-script runtime accepts only Markdown targets.
- [x] The command name `/pdf-to-markdown`, agent-backed execution, internal clean-Markdown requirement, and preserve-existing-output behavior were approved in the originating conversation.

### To Implement

- [ ] Add `/pdf-to-markdown` as a reserved actionable built-in command and slash-menu suggestion.
- [ ] Parse the command as a standalone PDF conversion request and route it before registered vault scripts.
- [ ] Validate that the current Aside source is a PDF before resolving or launching an agent.
- [ ] Queue the request through the existing availability-aware default-agent path with durable `pdf-to-markdown` request-kind metadata.
- [ ] Add one shared provider-independent prompt contract for inspected, readable, verified sibling Markdown conversion.
- [ ] Preserve an existing sibling Markdown file and report the conflict without modifying it.
- [ ] Revalidate the current command and PDF target when retrying or regenerating the request.
- [ ] Remove the obsolete `🛠️ scripts/pdf-to-clean-markdown.mjs` vault script and its dedicated `🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs` test.
- [ ] Build and install the generated plugin assets into the `lean-startup` vault without hand-patching generated or installed bundles.

### Verification

- [ ] Fail-first parser and controller tests cover exact recognition, repeated use, non-PDF rejection, idempotency, default-agent dispatch, fallback, and no-agent handling.
- [ ] Agent-run and prompt tests cover durable metadata, shared conversion instructions, existing-output preservation, and retry revalidation.
- [ ] Actionable-mention, registry, suggestion, draft-rendering, and persisted-rendering tests cover the reserved command without changing unrelated slash behavior.
- [ ] Existing explicit-agent, script-authoring, and registered vault-script tests remain green.
- [ ] The full automated build and release-artifact guard pass.
- [ ] Installed `main.js`, `manifest.json`, and `styles.css` match the verified repository artifacts byte-for-byte.
- [ ] A live `lean-startup` smoke test on `z_📚 reading/essential-guide-shenzhen-web.pdf` reaches the default agent instead of the vault-script runtime and reports either a verified sibling note or the approved existing-output conflict.

## Summary

Aside will expose `/pdf-to-markdown` as a built-in default-agent command. It is not a runnable vault script. The user types only the command on a PDF page-note thread; Aside selects the configured available default agent and asks it to inspect the PDF, choose an appropriate extraction or OCR path, create readable sibling Markdown, and verify the result.

The existing physical `pdf-to-clean-markdown.mjs` script and its test will be deleted. Generic PDF conversion cannot promise clean output across text PDFs, scans, multi-column brochures, tables, and image-heavy documents. Agent execution can adapt the method and report uncertainty, while the built-in command preserves the low-friction slash interface.

No existing implementation plan covers this command. A focused plan will be written after this specification is reviewed.

## Goals

- Make one short `/pdf-to-markdown` command sufficient on a PDF Aside thread.
- Reuse the user's default agent and existing fallback behavior without requiring an explicit `@agent` mention.
- Treat clean, readable Markdown as an internal quality contract rather than part of the public command name.
- Let the agent choose extraction, OCR, and cleanup methods based on the actual PDF.
- Preserve existing sibling Markdown and report the conflict instead of overwriting it.
- Keep one durable run lifecycle for progress, cancellation, failure, metadata, and retry.
- Remove the obsolete conversion script and its dedicated test from the vault.

## Non-Goals

- Making the direct vault-script runtime accept PDF or arbitrary binary targets.
- Guaranteeing perfect semantic reconstruction for every PDF.
- Bundling a PDF converter, OCR engine, or model into Aside.
- Letting the command silently overwrite or rename an existing sibling Markdown file.
- Adding converter settings, extraction-mode choices, or provider-specific command variants.
- Changing explicit `@codex`, `@claude`, `@gemini`, `/create-script`, `/update-script`, or registered `/script-name` behavior.

## User Experience

On a PDF page-note thread, the user submits:

```text
/pdf-to-markdown
```

The command appears in the slash menu with the label **PDF to Markdown**. Aside immediately queues a normal agent run using the configured default agent or the existing deterministic fallback. The normal pending output, streamed progress, cancellation, failure presentation, tool metadata, and retry action remain visible.

On success, the agent creates a sibling note with the same basename and a `.md` extension, then replies with the vault-relative output path and a concise verification summary. The reply must not claim success unless the file exists and representative output was inspected.

If the sibling `.md` already exists, the agent leaves it unchanged and replies that conversion was not run because the destination exists. The command never invents an alternate filename and never silently replaces existing work.

If used on a non-PDF source, Aside appends `Open a PDF and use /pdf-to-markdown.` without probing agents or creating a run. If no agent is available, it appends `No agent is available to convert this PDF.`

## Command Policy

`/pdf-to-markdown` is a reserved actionable built-in mention owned by the same central policy as `/create-script` and `/update-script`. A physical `🛠️ scripts/pdf-to-markdown.mjs` may exist as a vault file, but the registry must neither suggest nor launch it under the reserved name.

The parser recognizes one standalone `/pdf-to-markdown` token with surrounding whitespace. It rejects repeated command tokens and non-whitespace request text with a concise usage response. The command intentionally has no arguments: method selection, cleanup, and verification are internal agent responsibilities.

Saved-entry routing remains ordered:

```text
built-in commands → registered vault scripts → explicit agents → ordinary side notes
```

The new controller must claim each saved entry at most once. Validation failures append at most one reply and create no agent run.

## Agent Run Contract

The agent-run request-kind union gains `pdf-to-markdown`. A valid command resolves the default agent through the existing fresh runtime diagnostics. The run stores the effective requested agent and the preferred agent when fallback was used.

`CommentAgentController` remains the single owner of run creation, persistence, streaming, cancellation, execution, result storage, and retry. A small built-in command controller owns only parsing, PDF validation, idempotent fast returns, and typed dispatch.

Retry and Regenerate load the latest saved trigger and source path, reparse the command, and revalidate the `.pdf` target before resolving an agent. They do not fall back to explicit-agent parsing if the command or source is no longer valid. Agent availability is resolved fresh for every retry.

The run uses the active vault root as its writable workspace. The Note path already present in agent prompt context identifies the source PDF.

## Shared Prompt Contract

`shared/sideNotePromptPolicy.js` remains the single provider-independent prompt owner. For `pdf-to-markdown` runs it tells Codex, Claude Code, or Gemini to:

- treat the current Note path as the exact source PDF;
- confirm the source exists inside the active vault;
- derive the sibling destination by replacing the final `.pdf` extension with `.md`;
- stop without modifying anything if the sibling destination already exists;
- inspect PDF layout and text quality before choosing direct extraction, OCR, or another available document workflow;
- create readable Markdown with useful headings, paragraphs, lists, and tables where the source supports them;
- clean extraction artifacts without inventing missing content;
- inspect representative output, including the beginning and at least one later section, before reporting success;
- remove temporary conversion artifacts while preserving the source PDF;
- state uncertainty or failure plainly when the source cannot be converted reliably;
- return a concise Aside reply containing the output path and verification result.

Provider adapters remain transport-only. They must not duplicate or weaken this contract.

## Error Handling

- Wrong source type: compact thread reply, no diagnostics probe, no run.
- Repeated token or extra text: compact usage reply, no run.
- No available agent: compact thread reply, no run.
- Existing sibling Markdown: agent preserves it and reports the conflict.
- Missing or unreadable PDF: agent reports failure without creating a success reply.
- Extraction or OCR failure: normal agent-run failure handling; no automatic second provider is launched because a partial process may have created files.
- Unreliable output: agent states the limitation and does not describe the result as clean or complete.
- Retry after source rename, deletion, or command edit: fast-return after revalidation rather than using stale run metadata.

## Removal Scope

Implementation deletes exactly these vault files:

- `🛠️ scripts/pdf-to-clean-markdown.mjs`
- `🛠️ scripts/tests/pdf-to-clean-markdown.test.mjs`

Existing PDFs and existing generated Markdown files remain untouched. No plugin source file is deleted. The registry's live vault-file event path removes the obsolete `/pdf-to-clean-markdown` script mention after deletion or plugin reload.

## Testing Strategy

### Parser and built-in controller

- Recognize the exact command with surrounding whitespace.
- Ignore longer names, paths, and ordinary prose.
- Reject repeated tokens and extra text.
- Dispatch a valid PDF event exactly once.
- Reject Markdown and other non-PDF events before agent selection.
- Handle disabled Agents and no-agent availability without creating a run.

### Agent execution and retry

- Persist `requestKind: "pdf-to-markdown"` with preferred/effective provider metadata.
- Use the existing default-agent fallback order.
- Build the run from the PDF source path and active vault root.
- Reparse and revalidate on retry.
- Preserve normal output replacement, progress, cancellation, and failure behavior.

### Shared prompt

- Inject the conversion contract only for `pdf-to-markdown` runs.
- Require sibling-output preservation and representative verification.
- Prove representative Codex, Claude Code, and Gemini invocations receive the same shared contract.
- Keep create-script, update-script, and ordinary Aside prompt behavior unchanged.

### Actionable command surfaces

- Reserve `pdf-to-markdown` in the live script registry.
- Suggest `/pdf-to-markdown` only when Agents are available.
- Highlight it in draft and persisted comments through the shared actionable-mention policy.
- Preserve ordering and behavior for existing built-ins and live scripts.

### Installed acceptance

1. Delete the obsolete vault script and test.
2. Build the plugin and run the release-artifact security guard.
3. Install `main.js`, `manifest.json`, and `styles.css` into `lean-startup` and verify byte identity.
4. Reload Aside and confirm `/pdf-to-clean-markdown` is no longer suggested.
5. Open `z_📚 reading/essential-guide-shenzhen-web.pdf` and submit `/pdf-to-markdown`.
6. Confirm the saved run is attributed to the configured default agent or identified fallback, not the vault-script runtime.
7. Confirm success creates and verifies the sibling `.md`, or an existing sibling is preserved and reported as a conflict.
8. Retry the run and confirm the same command contract is revalidated.

## Change-Surface Ownership

The command must have one owner per concern:

- identity, reservation, and suggestion: shared actionable built-in mention policy;
- grammar: one pure PDF-to-Markdown directive parser;
- validation and dispatch: one built-in command controller;
- run lifecycle: existing `CommentAgentController`;
- conversion instructions: existing shared side-note prompt policy;
- provider preference and fallback: existing default-agent selection policy;
- physical conversion implementation: the selected external agent and its available document tools.

Generated `main.js` and installed plugin files are artifacts, not policy owners. They are regenerated and installed from verified source. A final repository and vault search must leave no physical `pdf-to-clean-markdown` script or test and only intentional built-in command owners, adapters, tests, and documentation for `pdf-to-markdown`.
