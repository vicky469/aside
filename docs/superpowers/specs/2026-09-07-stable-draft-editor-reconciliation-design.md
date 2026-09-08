# Stable Draft Editor Reconciliation Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Draft input updates the canonical in-memory draft on every input event.
- [x] The draft editor keeps a formatted preview synchronized with its textarea.
- [x] Sidebar cards use keyed reconciliation to reuse nodes whose render signatures have not changed.
- [x] Saving state remains part of draft render identity so a submitted card can enter its pending presentation immediately.

### To Implement

- [x] Separate editable draft body changes from structural draft render identity.
- [x] Keep top-level draft card DOM stable across unrelated sidebar refreshes while typing.
- [x] Preserve the mounted editor subtree when a nested append or edit draft's surrounding thread must refresh.
- [x] Resynchronize the formatted preview before a blurred editor depends on it, with visible textarea text as the safe fallback.
- [x] Preserve normal rerenders for draft creation, mode changes, anchor changes, saving, cancellation, and persisted replacement.

### Verification

- [x] A top-level draft retains node identity, value, focus, selection, textarea scroll, and sidebar viewport across an unrelated refresh.
- [x] Nested append and edit drafts retain their mounted editor state when their surrounding thread refreshes.
- [x] A nonempty blurred editor cannot present an empty visual surface when its textarea still contains text.
- [x] Agent and script status updates remain visible outside the preserved draft subtree.
- [x] Focused tests, the complete test suite, production build, and installed `lean-startup` artifact comparison pass.

## Problem

The sidebar render signature currently hashes the mutable draft body. Typing updates the in-memory draft and the existing textarea, but it does not update the mounted card's saved render signature. The next unrelated sidebar refresh therefore treats the draft as structurally changed and replaces its DOM node.

Replacing a mounted editor drops browser-owned state such as focus, selection, textarea scroll, and scroll anchoring. The draft editor also renders two overlapping text layers: a transparent textarea and a formatted preview. A replacement during their focus-to-preview handoff can leave the card visually empty even though its textarea value still exists, which is visible through the unchanged nonzero word count.

## Chosen Approach

Treat editable draft text as locally owned editor state and draft metadata as reconciliation state.

The shared draft identity will continue to include the draft ID, file, anchor, timestamp, mode, thread relationship, active state, and saving state, but it will no longer include the mutable body. Routine refreshes can then reuse a top-level draft card while the input handler keeps both the textarea and in-memory draft current.

For nested append and inline-edit drafts, a surrounding persisted thread may still need to refresh because a reply or run status changed. That refresh may replace the thread chrome and persisted entries, but it must retain the existing draft editor subtree. The reconciler will use the draft ID as the handoff key and keep browser-owned editor state attached to the mounted editor rather than reconstructing it.

The editor visibility contract becomes defensive. Focus shows the real textarea. Before blur switches to formatted presentation, the preview is synchronized from the textarea. If a nonempty textarea does not have a usable preview, the textarea remains visibly rendered instead of becoming transparent.

## Alternatives Considered

### Replace and restore browser state

Snapshot the textarea value, selection, focus, scroll offsets, and sidebar viewport before every replacement, then restore them afterward. This keeps the existing signature model but still performs unnecessary DOM work and can flicker between replacement and restoration. Rejected.

### Pause sidebar refreshes while a draft is open

Defer all sidebar updates until save or cancellation. This prevents replacement but hides concurrent agent and script progress and makes unrelated comments stale. Rejected.

### Remove the formatted preview

Always show the plain textarea. This eliminates the two-layer handoff but unnecessarily removes existing mention and bold styling. Rejected because stable reconciliation and a fallback can preserve both reliability and current presentation.

## Data And Render Flow

1. Input updates the mounted textarea, synchronized preview, counter, save state, and canonical in-memory draft.
2. Routine sidebar refresh builds the same structural draft signature and reuses the mounted draft node.
3. A nested thread refresh renders new surrounding content and hands the existing draft subtree into the corresponding draft slot by draft ID.
4. A true structural draft change produces a new signature and a normal rerender.
5. Saving changes the signature through saving state; cancellation removes the draft; successful persistence replaces it with the persisted card.

## Error Handling

No persistence or storage behavior changes. The mounted textarea remains the immediate source of truth while editing, and every input continues updating the canonical in-memory draft used by save and recovery paths.

If preview rendering cannot produce visible content for a nonempty textarea, the editor falls back to ordinary visible textarea text. A presentation failure must never imply data loss or disable saving.

## Testing

Use red-green tests at the shared reconciliation boundaries:

- Draft-signature tests prove body changes do not alter structural identity, while anchor, mode, active, and saving changes still do.
- Sidebar reconciliation tests use real synthetic elements to prove top-level draft node reuse and nested draft subtree preservation.
- Draft-editor tests prove blur resynchronizes the preview and that nonempty textarea text remains visible when preview readiness is absent.
- Representative agent or script status tests prove surrounding cards can still refresh without replacing the active editor.

All fixtures use synthetic paths, IDs, and bodies. No private vault data, note content, logs, or local filesystem locations enter source, tests, or documentation.

## Relationship To Existing Designs

This design extends `2026-09-07-instant-anchored-card-convergence-design.md`, which made anchored cards and card moves immediate but did not define editor node stability during background refresh. It also preserves the concurrent-agent and viewport-isolation behavior from `2026-09-03-agent-regenerate-and-viewport-isolation-design.md`.

No existing implementation plan covers this exact typing-time reconciliation failure. A focused plan will follow this specification.

## Self-Review

- Placeholder scan: no placeholders or unresolved decisions remain.
- Tracking scan: implementation and verification items are complete after local integration into `main`.
- Focused regressions: 43 checks cover structural signatures, top-level reuse, nested handoff, focus and scroll retention, blur synchronization, and fail-open visibility.
- Production verification: `npm run build` passed 1,548 compiled tests and 164 source-contract tests, lint, typecheck, Obsidian compliance, bundling, and the 750,000-byte size guard.
- Artifact security: the release guard passed for `main.js`, `manifest.json`, and `styles.css`; separate scans found no source-map markers, embedded sources, root-level raw TypeScript/JSX, environment files, package credentials, private keys, or certificates.
- Live installation: all three installed `lean-startup` assets matched the inspected build byte-for-byte after reload, and Obsidian reported no captured errors.
- Plan alignment: the completed anchored-card plan remains neighboring infrastructure and was not reopened.
- Consistency: draft text remains canonical in memory while structural reconciliation avoids replacing its mounted editor.
- Scope: limited to draft identity, editor handoff, preview fallback, and regression coverage.
- Privacy: only synthetic examples and repository-relative paths appear.
