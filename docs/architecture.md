# SideNote2 Architecture

This note is meant to make the codebase easier to read visually.

Use five lenses:

- Blueprint: static module boundaries and ownership.
- Cross-section: the same parts, but grouped by responsibility layers.
- Feature map: where to edit when you know the behavior, not the file.
- Transit map: how data and events move.
- State machine: how a comment changes over time.

## 1. Module Blueprint

Read this as the structural map of the plugin.

- `src/main.ts` is the composition root. It detects `runtime=local|release`, wires the controllers, manager, cache, aggregate index, metadata augmentation, logging, and the sidebar view registration.
- `src/app/*` owns the Obsidian plugin shell: event intake, lifecycle, registration, refresh coordination, workspace context, and workspace view adapters.
- `src/comments/*` owns comment workflows: entry, mutation, session, navigation, highlight, persistence, index click routing, and related planners.
- `src/agents/*` owns Codex and remote runtime orchestration: prompt context, run store, runtime selection, local adapter, and remote bridge.
- `src/settings/*` owns persisted plugin settings and local secret storage.
- `src/sync/*` owns synced side-note event and source-identity stores.
- `*Planner.ts` files hold the pure routing, normalization, and selection decisions that app/comment/agent modules call.
- `src/commentManager.ts` owns the in-memory comment list.
- `src/domain/*` holds draft shapes and ephemeral draft/reveal session state.
- `src/core/*` handles canonical storage, anchors, sync policy, text helpers, shared datetime formatting, derived metadata augmentation, editor highlight ranges, and index builders such as `allCommentsNote.ts`.
- `src/ui/*` handles the sidebar view, draft and persisted comment cards, interaction helpers, editor helpers, settings, and modals.
- `src/index/*` and `src/cache/*` support the aggregate comment index and parsed-note acceleration behind the derived views.
- `src/logs/*` is the persistent JSONL logging subsystem: daily files, retention, payload sanitization, and attachment snapshots.
- `src/ui/views/supportReportPlanner.ts` plus `src/ui/modals/SupportLogInspectorModal.ts` turns raw JSONL into the local debugger table. Log entries are stored in UTC and rendered in the viewer using local time.
- `src/support/*` defines support payload and sender types, but the active in-app diagnostics entry point is the local-only log inspector opened from the sidebar.

## 2. Cross-Section View

Read this as the same architecture, but sliced by responsibility instead of file ownership.

- Top: the user-facing surfaces.
- Middle: controllers plus pure planners that route intent and workspace state.
- Bottom: persistence, retargeting, cache/index state, and derived views.

This view is now drawn as one overview-first canvas: `High-Level Flow` on top, then a clickable `Grouped Module Map` below.

![[architecture.canvas]]

The canvas answers `what lives where`. The next three diagrams stay relevant because they answer different questions:

- `Feature Map` answers `where should I edit this behavior`.
- `Comment Route Map` answers `what happens over time`.
- `Comment Lifecycle State Machine` answers `what states a comment can be in`.

## 3. Feature Map

Read this when you already know the feature area and want the shortest path to the right files.

This is separate from the blueprint on purpose: the blueprint is structural, while the feature map is optimized for edits and debugging handoff.

![[feature-map.canvas]]

## 4. Comment Route Map

Read this as the movement of one comment through the system. The canvas is spatial; this one is temporal.

This is a separate canvas so you can zoom the flow without crowding the main architecture board. It covers canonical comment capture and persistence, derived index surfaces, and the current index click path that highlights the sidebar before navigation. The local log inspector is intentionally not on this canvas because it is a parallel diagnostics path, not part of the comment write path.

![[comment-route-map.canvas]]

## 5. Comment Lifecycle State Machine

Read this when debugging a specific comment. The route map shows flow; this one shows allowed status changes.

- `draft` is UI-only and not yet persisted.
- `saved` means persisted in markdown note storage.
- `resolved` is still stored, but normally hidden in the sidebar.
- `orphaned` means the stored comment still exists, but its anchor could not currently be matched back to the file text.

This is a separate canvas so the state changes and transition labels stay readable when embedded.

![[comment-lifecycle.canvas]]

## 6. How To Use These Views

### When you are reading code

- Start with `Module Blueprint` to find which layer owns the behavior.
- Use `Cross-Section View` when you want the one main spatial diagram of the same structure.
- Use `Feature Map` when you know the feature or bug, but not the owning files.
- Use `Comment Route Map` when you want to know where data came from or where it is written.
- Use `Comment Lifecycle State Machine` when a bug is really about status, visibility, or retargeting.

### When you are debugging

Use this shortcut table:

| Symptom | First files to inspect |
| --- | --- |
| Draft does not save or disappears | `src/ui/views/SideNote2View.ts`, `src/ui/views/sidebarDraftEditor.ts`, `src/domain/drafts.ts` |
| Comment saved but not persisted to note | `src/core/storage/noteCommentStorage.ts`, `src/core/rules/commentSyncPolicy.ts` |
| Comment exists but highlight is wrong | `src/core/anchors/anchorResolver.ts`, `src/core/derived/editorHighlightRanges.ts`, `src/commentManager.ts` |
| Sidebar or index sidebar shows wrong grouping or visibility | `src/ui/views/sidebarCommentSections.ts`, `src/ui/views/SideNote2View.ts`, `src/commentManager.ts` |
| Sidebar card click, link, or action buttons behave incorrectly | `src/ui/views/sidebarPersistedComment.ts`, `src/ui/views/SideNote2View.ts`, `src/ui/views/commentPointerAction.ts` |
| Sidebar focus, copy, selection, or draft-dismiss behavior is wrong | `src/ui/views/sidebarInteractionController.ts`, `src/ui/views/sidebarClipboardSelection.ts`, `src/ui/views/editDismissal.ts` |
| Index note is stale or wrong | `src/index/AggregateCommentIndex.ts`, `src/core/derived/allCommentsNote.ts`, `src/comments/commentPersistenceController.ts`, `src/cache/ParsedNoteCache.ts` |
| Index list, thought trail, or file filter behaves incorrectly | `src/ui/views/SideNote2View.ts`, `src/core/derived/thoughtTrail.ts`, `src/core/derived/indexFileFilterGraph.ts`, `src/ui/modals/SideNoteFileFilterModal.ts` |
| Index click highlights the wrong sidebar card or opens the wrong target | `src/app/pluginRegistrationController.ts`, `src/comments/commentHighlightController.ts`, `src/comments/commentNavigationController.ts`, `src/ui/views/SideNote2View.ts` |
| Wiki links or tags inside comments behave incorrectly | `src/ui/editor/commentEditorLinks.ts`, `src/ui/editor/commentEditorTags.ts`, `src/core/text/commentMentions.ts` |
| Local log inspector, JSONL parsing, or timestamp display is wrong | `src/main.ts`, `src/logs/logService.ts`, `src/logs/logSanitizer.ts`, `src/ui/modals/SupportLogInspectorModal.ts`, `src/ui/views/supportReportPlanner.ts`, `src/core/time/dateTime.ts` |

## 7. Mental Model

SideNote2 is easiest to understand if you keep one rule in mind:

- The note-backed comment data is the source of truth.
- The sidebar is a working view over that data plus any current draft.
- The index surfaces are derived views: the note is built by `allCommentsNote.ts`, and the index sidebar can render either the sectioned comment list or the thought-trail graph over the aggregate comments.
- Index clicks highlight the sidebar first. The sidebar card is what then redirects you back into the source note.
- Diagnostics are a separate subsystem: local runtime exposes a sidebar log inspector, daily log files are stored as append-only UTC JSONL, and the inspector renders those timestamps in local time.

That means most bugs reduce to one of three questions:

1. Was the canonical comment data loaded correctly?
2. Was it transformed correctly into UI, index, or debugger state?
3. Was the anchor still resolvable after the file changed?
