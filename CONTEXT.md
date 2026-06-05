# Aside Context

## Source Of Truth

The source code is the authority for current behavior. Docs describe the code; they do not define behavior by themselves.

For comment-card architecture work, start from these files:

- `src/domain/comments/`: comment model, projections, normalization, and ordering helpers.
- `src/commentManager.ts`: in-memory loaded thread collection.
- `src/comments/commentMutationController.ts`: user-facing write path for comment changes.
- `src/comments/commentPersistenceController.ts`: storage, sync replay, legacy inline migration, and aggregate refresh orchestration.
- `src/storage/comments/sideNoteSyncEvents.ts`: comment sync event encoding, diffing, and reduction semantics.
- `src/ui/views/AsideView.ts`: sidebar rendering and user interaction surface.
- `src/index/AggregateCommentIndex.ts`: derived read model for index surfaces.

## Vocabulary

Use these terms consistently in code, docs, and reviews.

| Term | Meaning |
| --- | --- |
| Source note | A markdown file that can have side notes. |
| Thread | Durable side-note aggregate stored as `CommentThread`. |
| Entry | One item inside a thread, stored as `CommentThreadEntry`. |
| Comment | Flattened projection of a thread or entry. Keep this name for new code. |
| Draft | Unsaved session state for new, edit, or append flows. |
| Anchor | Text or page location a thread points at. |
| Orphaned thread | Selection-anchored thread whose text cannot currently be resolved. |
| Resolved thread | Durable thread intentionally hidden from normal sidebar view. |
| Deleted thread or entry | Soft-deleted data retained until cleanup/expiry. |
| Sidecar | Local JSON cache under plugin data. |
| Sync event | Synced plugin-data event representing a comment change. |
| Snapshot | Compacted synced thread state for a source note. |
| Legacy inline block | Old hidden `<!-- Aside comments -->` or `<!-- SideNote2 comments -->` migration input. |
| Index note | Generated markdown surface for all comments. |
| Index sidebar | Sidebar view scoped to the index note. |
| Thought trail | Derived graph/read model over related files. |
| Cross-cutting concern | App-wide infrastructure such as logging, diagnostics, profiling, time, or config. |

## Architecture Rules

- `CommentThread` is the durable aggregate. `Comment` is a projection.
- UI writes go through comment mutation interfaces. UI should not mutate `CommentManager` directly.
- `CommentManager` is an in-memory collection adapter, not the owner of the comment vocabulary.
- Domain comment modules must not import `obsidian`.
- Comment-specific storage belongs under `src/storage/comments/`. Generic storage can live under `src/storage/`, with subfolders only when there is enough code to justify them.
- Cross-cutting concerns belong in one `src/crosscutting/` folder when introduced or moved.
- Legacy SideNote2 and inline-block compatibility stays at migration and compatibility edges.

## Comment Flow

1. User intent enters through Obsidian commands, editor actions, protocol links, or sidebar interactions.
2. Controllers translate that intent into comment operations.
3. Mutations load latest state, update `CommentManager`, persist, refresh derived surfaces, and notify agent flows when needed.
4. Persistence chooses canonical state from sidecar, sync events/snapshots, or legacy inline migration input.
5. Derived surfaces render from loaded threads, aggregate index state, and current draft/session state.

## Refactor Direction

Active refactor spec:

- `docs/refactor/domain-first-architecture-cleanup-spec.md`

Current priority:

1. Keep the comment model visible under `src/domain/comments/`.
2. Remove UI write bypasses around `CommentManager`.
3. Split persistence internals only after storage placement is agreed.
4. Defer profiling until the architecture cleanup exposes expensive paths cleanly.
