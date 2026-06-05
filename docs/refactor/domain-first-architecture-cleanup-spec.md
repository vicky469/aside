# Domain-First Architecture Cleanup Spec

## Purpose

Make Aside easier to understand from the filesystem and safer to change from the code. The source code remains the source of truth. Existing docs can explain the code, but they must not become parallel architecture that drifts from runtime behavior.

This refactor should make the app flow visible through module ownership:

- what the comment data model is
- where user intent enters the system
- where mutations happen
- where persistence and sync happen
- where derived views are built
- where cross-cutting concerns live
- which paths are expensive enough to profile

## Current Code Context

Aside is an Obsidian plugin for side notes attached to markdown notes.

The runtime is currently centered around these source-owned concepts:

- `CommentThread`: the durable parent side-note aggregate.
- `CommentThreadEntry`: one entry inside a thread.
- `Comment`: the flattened comment projection used by legacy callers and some UI paths.
- `DraftComment`: ephemeral UI/session state for new, edit, and append flows.
- `CommentManager`: the in-memory loaded thread collection.
- `CommentPersistenceController`: canonical storage, sidecar writes, sync-event replay, legacy inline migration, source identity, and aggregate refresh orchestration.
- `CommentMutationController`: user-facing comment mutations that should load the latest state, update the manager, persist, refresh views, and emit agent hooks.
- `AggregateCommentIndex`: derived read model for index surfaces.
- `AsideView`: sidebar UI surface and current largest caller of plugin facade methods.
- `SourceIdentityStore`: synced identity for a source note across renames.
- `SideNoteSyncEventStore`: synced plugin-data event log and snapshots.

## Vocabulary

Use these names consistently in code and docs.

| Term | Meaning | Notes |
| --- | --- | --- |
| Source note | A markdown file that can have side notes. | Avoid "host note" unless referring to UI placement. |
| Thread | A durable side-note aggregate stored as `CommentThread`. | Preferred over "comment" when discussing persisted data. |
| Entry | One item inside a thread, stored as `CommentThreadEntry`. | Parent entry is `thread.entries[0]`. |
| Comment projection | Flattened `Comment` view of a thread or entry. | Useful for compatibility and UI, not the domain source. |
| Draft | Unsaved session state for new, edit, or append. | UI-only until saved by mutation flow. |
| Anchor | The text or page location a thread points at. | `selection` anchors can become orphaned; `page` anchors cannot. |
| Orphaned thread | A selection-anchored thread whose text cannot currently be resolved. | Still durable data. |
| Resolved thread | A thread intentionally hidden from normal sidebar view. | Still durable data. |
| Deleted thread or entry | Soft-deleted data retained until cleanup/expiry. | Do not confuse with vault file deletion. |
| Sidecar | Local JSON cache under plugin data. | Hot local materialization, not the only durable sync surface. |
| Sync event | Synced plugin-data event that represents a comment change. | Reduced into sidecar and aggregate state. |
| Snapshot | Compacted synced thread state for a source note. | Used to reduce event replay cost. |
| Legacy inline block | Old hidden `<!-- Aside comments -->` or `<!-- SideNote2 comments -->` block. | Migration input only, not current canonical storage. |
| Index note | Generated markdown surface for all comments. | Derived output, not canonical data. |
| Index sidebar | Sidebar view scoped to the index note. | Derived UI over aggregate comments. |
| Thought trail | Derived graph/read model over related files. | Expensive enough to profile. |
| Cross-cutting concern | App-wide non-domain infrastructure used by many feature areas. | Must live under one folder with thin adapters. |

## Target Module Shape

The target shape is domain-first, not framework-first. It should remain pragmatic and TypeScript-native.

```text
src/
  main.ts                    # Obsidian plugin composition root and facade only
  app/                       # Obsidian lifecycle, registration, workspace adapters
  domain/
    comments/                # thread model, entry model, projections, invariants
    session/                 # draft and reveal session state
  comments/                  # comment use cases: entry, mutation, navigation, highlight
  storage/
    comments/                # sidecar, legacy inline, canonical planning, sync materialization
  sync/                      # plugin-data stores and source identity
  index/                     # aggregate comment read model
  agents/                    # agent run orchestration
  ui/                        # views, modals, editor helpers, settings UI
  crosscutting/
    logging/
    diagnostics/
    profiling/
    time/
    config/
```

Rules:

- `main.ts` composes adapters and exposes the smallest plugin facade the UI needs.
- `domain/comments/` must not import `obsidian`.
- `CommentManager` becomes an in-memory adapter over domain comments, not the owner of domain vocabulary.
- UI must call use-case interfaces for writes. It should not mutate `CommentManager` directly.
- Storage modules can depend on domain comments and Obsidian adapter interfaces, but domain modules cannot depend on storage.
- Cross-cutting concerns live under `src/crosscutting/`. Do not scatter logging, profiling, time, diagnostics, config parsing, or environment checks across feature folders.

## Non-Goals

- Do not rewrite the plugin into textbook Clean Architecture.
- Do not introduce repository abstractions without at least two real adapters.
- Do not move tests in this session.
- Do not change release behavior.
- Do not delete compatibility support for legacy SideNote2 data unless a separate migration/removal decision is made.
- Do not treat docs or canvases as source of truth.
- Do not spend this refactor on canvases unless they affect current comment-card work.

## Decisions Recorded

- Keep `Comment` as the projection name. New code should use `Comment` when it needs the flattened projection and `CommentThread` when it needs the durable aggregate.
- `src/storage/comments/` is only for comment-specific storage. Generic storage concerns can live directly under `src/storage/`, and large non-comment storage areas can get their own subfolder.
- Canvas cleanup is out of scope for this refactor. The active concern is source-owned comment-card architecture, not visual documentation maintenance.
- Profiling settings are deferred. Profiling remains a future concern and should not block the initial architecture cleanup.

## Refactor Slices

### 1. Extract Comment Domain Model

Move the comment model out of `src/commentManager.ts`.

Target modules:

- `src/domain/comments/commentThread.ts`
- `src/domain/comments/commentProjection.ts`
- `src/domain/comments/commentThreadNormalization.ts`
- `src/domain/comments/commentThreadOrdering.ts`

Keep `src/commentManager.ts` as a compatibility re-export plus the in-memory collection implementation during the first slice.

Acceptance criteria:

- Production imports can start using `src/domain/comments/*`.
- Existing imports from `src/commentManager.ts` still work.
- The thread/entry/comment vocabulary is visible from the filesystem.
- No test file is modified in this session.

### 2. Make Mutation The Only Write Interface

Route UI write paths through `CommentMutationController` or a narrower comment mutation facade.

Known issue from source inspection:

- `src/ui/views/AsideView.ts` batch tag flows currently call `this.plugin.getCommentManager().editComment(...)` and then persist manually.

Target behavior:

- UI asks for a mutation such as `applyTagToThreads` or `editThreadEntry`.
- The mutation interface loads latest state, mutates manager state, persists, refreshes, and logs.
- `CommentManager` remains inaccessible to UI write paths.

Acceptance criteria:

- No direct `getCommentManager().editComment(...)` calls from UI.
- Batch tag behavior still persists through the same mutation path as normal edits.
- Search confirms remaining `getCommentManager()` calls are read-only or composition-only.

### 3. Split Persistence Internals

Keep `CommentPersistenceController` as the public module for callers, but move internal responsibilities into deeper modules.

Candidate internal modules:

- `canonicalCommentLoader`: chooses sidecar, legacy inline migration, or rename recovery.
- `commentWritePipeline`: writes manager state to sidecar/sync/index and strips legacy inline blocks.
- `syncEventReplay`: replays plugin-data events and hydrates snapshots.
- `sourceRecovery`: strict renamed-source and legacy-cache recovery.
- `aggregateRefreshQueue`: index refresh timer/promise coordination.

Acceptance criteria:

- Public caller interface stays stable.
- Each extracted module has a smaller interface than the implementation it hides.
- Storage flow can be read without scanning the whole persistence controller.

### Storage Layout Detail

The storage move should separate comment storage from generic storage without inventing folders before they earn their keep.

Recommended first target:

```text
src/storage/
  comments/
    canonicalCommentStorage.ts
    noteCommentStorage.ts
    sidecarCommentStorage.ts
    legacyInlineCommentMigration.ts
    sideNoteSyncEvents.ts
```

Keep these outside `src/storage/comments/`:

- `src/sync/sourceIdentityStore.ts`: source identity is plugin-data sync state, not a comment storage format.
- `src/sync/sideNoteSyncEventStore.ts`: this owns persisted plugin-data event state and snapshots; it may import comment storage event types, but should stay in `sync/` unless the sync folder itself is redesigned.
- `src/cache/ParsedNoteCache.ts`: this is a performance cache, not durable storage.
- `src/index/AggregateCommentIndex.ts`: this is a derived read model, not storage.

If a storage module is not comment-specific:

- Put it under `src/storage/` only if it is small and generic.
- Give it a subfolder only after there are multiple files with a shared storage concern.

Approved storage decision:

- Keep the event reducer in `src/storage/comments/sideNoteSyncEvents.ts`.
- Keep the stateful event log and snapshot store in `src/sync/sideNoteSyncEventStore.ts`.

The reducer is comment-domain storage logic. The store is synced plugin-data infrastructure.

### 4. Shrink Main Composition Root

Reduce `src/main.ts` to plugin shell, dependency construction, and small facade methods.

Target extraction:

- comment app facade
- storage migration startup runner
- runtime/environment adapter
- support/log location adapter

Acceptance criteria:

- `main.ts` stops being the place where app flow is learned.
- Controller construction remains explicit.
- Runtime-specific details are adapter data, not duplicated policy.

### 5. Centralize Cross-Cutting Concerns

Create `src/crosscutting/` and move app-wide infrastructure there.

Initial candidates:

- `src/logs/*` -> `src/crosscutting/logging/*`
- `src/support/*` plus support planning types -> `src/crosscutting/diagnostics/*` where not UI-specific
- `src/core/time/dateTime.ts` -> `src/crosscutting/time/dateTime.ts`
- app config parsing that is not comment-domain policy -> `src/crosscutting/config/*`
- new profiling helpers -> `src/crosscutting/profiling/*`

Keep domain rules out of cross-cutting:

- comment visibility rules
- commentable file rules
- deleted/resolved policy
- anchor rules
- storage canonicalization rules

Those are comment-domain or storage-domain rules, not generic infrastructure.

Acceptance criteria:

- Cross-cutting code has one folder.
- Feature modules import cross-cutting helpers from that folder.
- Cross-cutting modules do not import UI views or comment mutation controllers.

### 6. Clean Documentation

Replace the current noisy docs set with a small maintained set.

Target docs:

- `CONTEXT.md`: source-owned vocabulary and current code map for agents.
- `docs/architecture.md`: concise current architecture map only.
- `docs/adr/`: durable decisions that future refactors should not re-litigate.
- `docs/refactor/`: active refactor specs and plans.
- `docs/releases/`: release notes required by release policy.

Cleanup policy:

- Keep docs that describe current code.
- Archive docs that explain past decisions but are not current operating docs.
- Delete generated `.DS_Store` files.
- Leave canvases alone unless they directly affect current comment-card work.
- Do not delete release notes.
- Do not delete docs that still explain active compatibility obligations without first replacing that knowledge in `CONTEXT.md` or an ADR.

Acceptance criteria:

- A new contributor can read `CONTEXT.md` plus `docs/architecture.md` and understand the app flow.
- Old PRDs are not the first place an agent lands when trying to understand current behavior.
- Every remaining doc has an obvious maintenance purpose.

## Deferred Profiling Spec

Add lightweight, opt-in profiling for expensive paths before optimizing them.

Target folder:

- `src/crosscutting/profiling/`

Interface sketch:

```ts
export interface ProfileSink {
  record(event: ProfileEvent): void | Promise<void>;
}

export function measure<T>(
  label: string,
  metadata: Record<string, unknown>,
  fn: () => T,
): T;

export function measureAsync<T>(
  label: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T>;
```

Rules:

- Profiling is off by default.
- Profiling must not add UI noise.
- In local runtime, profiling can write sanitized entries through the existing log service.
- Metadata must not include note content, selected text, or comment body.
- Prefer count/size/path-shape metadata: thread count, file count, elapsed milliseconds, index mode, cache hit/miss.

Initial paths to profile:

- `CommentPersistenceController.loadCommentsForFile`
- `CommentPersistenceController.handleMarkdownFileModified`
- `CommentPersistenceController.writeCommentsForFile`
- `CommentPersistenceController.replaySyncedSideNoteEvents`
- `CommentPersistenceController.ensureAggregateCommentIndexInitialized`
- `CommentManager.updateCommentCoordinatesForFile`
- `CommentHighlightController` decoration refresh paths
- `AsideView.renderComments`
- note-sidebar render path
- index-sidebar render path
- `buildThoughtTrail`
- `buildIndexFileFilterGraph`

Profiling acceptance criteria:

- Profiles identify slow path labels and elapsed time.
- Profiles are safe for public support logs.
- The first profiling pass produces a ranked list before any performance refactor.

## Verification Strategy

For each refactor slice:

- Run TypeScript compilation.
- Run targeted tests for touched modules.
- Run the full test suite before declaring the slice complete.
- Search for forbidden direct write paths after mutation-interface work.
- Search for remaining scattered cross-cutting imports after cross-cutting folder work.

Session constraint:

- Do not modify any test file in this session.

## Suggested Order

1. Create `CONTEXT.md` from the vocabulary in this spec.
2. Extract comment domain model with compatibility re-exports.
3. Route batch tag writes through mutation flow.
4. Split persistence internals based on source-flow friction.
5. Move cross-cutting concerns into `src/crosscutting/`.
6. Shrink `main.ts`.
7. Clean docs and record durable choices as ADRs.
8. Revisit profiling only after the architecture cleanup exposes the expensive paths cleanly.

## Open Decisions

- None for the approved initial slices.
