# Single-Write Agent Replies Design

## Goal

Make agent replies appear immediately, persist exactly once when complete, and show a save failure only when the canonical reply commit itself fails.

## Confirmed Failure

The current lifecycle persists a blank output entry before the runtime finishes, then edits that child entry with the final response. In the reported run, the blank save waited 28.6 seconds for aggregate-index cleanup. Concurrent note loading replaced the volatile lookup state, so the later child-id lookup failed even though the blank placeholder had reached both sidecars. The visible response survived only in the retained live stream.

## Design

- The turning reply card is live UI state keyed by the reserved output entry id. It is not a persisted blank comment.
- A completed response uses one canonical, idempotent per-note commit against the stable parent thread id.
- The commit reads canonical stored threads inside the existing per-note persistence queue, updates an existing output id or appends it once, and persists that explicit snapshot.
- A regenerated reply with an existing durable output id is updated once; a missing or deleted output is appended once.
- Aggregate-index and view refresh work is deferred until after the canonical reply data is durable.
- Only the canonical commit result may produce `❌ Agent · Couldn’t save reply`. Run-history, duplicate cleanup, and view handoff failures are logged and retried or retained without reversing a successful reply.
- The behavior is provider-neutral and applies to every supported agent.

## Non-Goals

- Changing agent runtime concurrency.
- Changing sidecar formats or sync-event schemas.
- Reworking unrelated comment mutation flows.
- Adding persistence retries that conceal an uncommitted reply.

## Implementation Tracking

### To Implement

- [x] Add an idempotent canonical thread-entry commit inside the per-note persistence queue.
- [x] Persist an explicit thread snapshot so concurrent in-memory reloads cannot erase the committed reply.
- [x] Stop persisting blank agent placeholders while retaining the immediate live turning card.
- [x] Commit a new completed reply once; update an existing regenerate target once.
- [x] Defer aggregate refresh from the canonical reply commit.
- [x] Separate reply-save failure from run-history, cleanup, and refresh failures.
- [x] Keep all supported agents and different-note runs concurrent.

### Verification

- [x] A failing regression test reproduces the blank-placeholder/final-edit lifecycle before the fix.
- [x] A completed new reply performs one full-body commit and no blank append or final edit.
- [x] A regenerated durable reply performs one full-body upsert and no blank write.
- [x] Canonical commit failure retains the response and shows `Couldn’t save reply`.
- [x] Post-commit bookkeeping failure does not relabel the saved reply as failed.
- [x] Same-note concurrent completions retain both replies; different notes remain independent.
- [ ] Full tests, lint, typecheck, Obsidian compliance, build, and artifact inspection pass.
- [ ] The verified build is installed in `lean-startup`, reloaded, and its shipped assets match byte-for-byte.
