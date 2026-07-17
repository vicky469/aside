# Clipboard Regression Test Design

**Status:** Approved design

**Date:** 2026-07-17

**Objective:** Turn Aside's clipboard capability contract into durable automated regression coverage while retaining a focused manual matrix for platform behavior that Node tests cannot reproduce.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Pure paste planning tests cover rich HTML-to-Markdown conversion, native plain-text fallback, and compact Excalidraw payload insertion.
- [x] Clipboard writer tests cover the async API, successful `execCommand` fallback, and total failure when neither path is available.
- [x] Sidebar selection tests reject absent, collapsed, and cross-boundary selections and accept rendered-comment selections contained by the sidebar.
- [x] Comment-location tests verify exact URI encoding for vault, file, and comment identifiers.
- [x] The compliance checker rejects direct background calls to `navigator.clipboard.readText()`.

### To Implement

- [ ] Expand paste-planner tests for selection replacement, cursor placement, CRLF and non-breaking-space normalization, equivalent HTML/plain fallback, and converter failure.
- [ ] Expand clipboard-writer tests for async failure followed by fallback, `execCommand` false and exception paths, temporary textarea configuration, and guaranteed cleanup.
- [ ] Expand sidebar-selection tests for empty selections and both cross-boundary directions.
- [ ] Extract one narrow `copyCommentLocationToClipboard` adapter and use it from the sidebar share action.
- [ ] Test that the share adapter sends the exact encoded Aside URI to the injected clipboard writer and propagates success or failure without reading the clipboard.
- [ ] Add a maintained manual clipboard matrix for pop-out windows, Obsidian 1.12.7 and 1.13+, mobile, denied clipboard writes, and a background-access canary.

### Verification

- [ ] Every newly introduced production seam is preceded by a failing test that demonstrates the missing behavior or wiring.
- [ ] Clipboard-focused TypeScript tests pass with no runtime dependency on the Obsidian module.
- [ ] The complete repository build passes, including plugin tests, script tests, Worker tests, zero-warning lint, type checking, compliance checks, bundling, and release-artifact inspection.
- [ ] Manual-only scenarios are documented without being represented as automated guarantees.

## Scope

The automated suite covers deterministic behavior owned by Aside:

- interpreting clipboard data supplied by a user-initiated paste event;
- choosing between native paste and Aside's Markdown or Excalidraw transformation;
- deciding whether a browser selection is fully contained by rendered Aside comment content;
- writing explicit copy payloads through the async clipboard API or the temporary-textarea fallback;
- generating and copying an exact `obsidian://aside-comment` URI; and
- rejecting ambient clipboard-read APIs in the repository compliance gate.

The suite does not claim to emulate operating-system clipboard permissions, Chromium permission prompts, mobile clipboard integration, or Obsidian pop-out-window focus. Those behaviors remain in the manual matrix.

## Test Architecture

### Paste planning

Continue testing `createDraftPasteEdit` as a pure function. Add table-driven cases that prove:

- transformed content replaces the selected range and leaves the caret immediately after the inserted Markdown;
- CRLF becomes LF and non-breaking spaces become normal spaces;
- converted Markdown that is equivalent to the plain-text representation returns `null`, allowing native paste;
- missing HTML or a converter exception returns `null`; and
- compact Excalidraw content replaces, rather than duplicates, the selected range.

The event adapter remains thin. Its responsibility is already represented by the pure edit result, while propagation and `InputEvent` behavior depend on browser DOM facilities and are lower-value to emulate in Node.

### Clipboard writing

Continue injecting `ClipboardWriter` and `CopyTextDocument` into `copyTextToClipboard`. Extend the fake document and textarea assertions to cover:

- async success without constructing a fallback textarea;
- async rejection followed by a successful fallback;
- false and thrown `execCommand` results;
- readonly, hidden, non-interactive textarea configuration;
- focus, selection, and the full text selection range; and
- removal in every fallback completion path.

No production API expansion is required for these cases.

### Sidebar selection

Keep `getSelectedSidebarClipboardText` pure. Add missing cases for empty selected text and selections that begin outside but end inside Aside. Existing cases already cover the reverse boundary and successful contained selection.

### Share action

Introduce a small module that composes `buildCommentLocationUrl` with an injected text writer:

```ts
copyCommentLocationToClipboard(vaultName, comment, writeText)
```

The production sidebar passes `copyTextToClipboard` as the writer. Tests use a recording writer to prove the exact URI and returned success value. The adapter must not import the Obsidian runtime, inspect the system clipboard, or own UI feedback.

## Manual Matrix

Document these checks as release-candidate verification:

1. Plain, rich, and Excalidraw paste in Aside drafts on Obsidian 1.12.7 and 1.13 or later.
2. Rendered-comment selection copy, draft-native copy, and Share side note in the main window.
3. The same copy and paste flows in an Obsidian pop-out window.
4. Plain paste, rendered-comment copy, and Share side note on at least one mobile platform.
5. Async clipboard-write denial still permits fallback copying where the platform supports `execCommand`.
6. A harmless clipboard canary remains unchanged and absent from Aside data and logs during navigation, comment saves, and plugin reload without a copy or paste gesture.

## Error Handling

Clipboard write failures remain non-throwing at the shared helper boundary and return `false`. The share adapter returns the writer's result unchanged. Paste conversion failures return `null` so the browser performs native paste. Temporary fallback elements are always removed, including when `execCommand` throws.

## Acceptance Criteria

1. All deterministic clipboard behaviors listed above have direct automated coverage.
2. The share button is wired through the tested adapter with no user-visible behavior change.
3. No production code introduces clipboard reads outside a user-provided paste event.
4. The manual matrix clearly separates platform verification from automated guarantees.
5. The full compliance build remains green.
