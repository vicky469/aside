# SideNote2 Architecture

This note is meant to make the codebase easier to read visually.

Use four lenses:

- Blueprint: static module boundaries and ownership.
- Cross-section: the same parts, but grouped by responsibility layers.
- Transit map: how data and events move.
- State machine: how a comment changes over time.

## 1. Module Blueprint

Read this as the structural map of the plugin.

- `src/main.ts` is the composition root. It wires the controllers, manager, cache, aggregate index, metadata augmentation, and the sidebar view registration.
- `src/control/*` owns the side-effecting coordination layer: entry, mutation, session, workspace, workspace view, lifecycle, registration, navigation, highlight, persistence, and index settings controllers.
- `src/control/*Planner.ts` holds the pure routing, normalization, and selection decisions that controllers call.
- `src/commentManager.ts` owns the in-memory comment list.
- `src/domain/*` holds draft shapes and ephemeral draft/reveal session state.
- `src/core/*` handles storage, anchors, sync policy, text helpers, derived metadata augmentation, editor highlight ranges, and index builders such as `allCommentsNote.ts`.
- `src/ui/*` handles the sidebar view, draft and persisted comment cards, interaction helpers, editor helpers, settings, and modals.
- `src/index/*` and `src/cache/*` support the aggregate comment index and parsed-note acceleration behind the derived views.

## 2. Cross-Section View

Read this as the same architecture, but sliced by responsibility instead of file ownership.

- Top: the user-facing surfaces.
- Middle: controllers plus pure planners that route intent and workspace state.
- Bottom: persistence, retargeting, cache/index state, and derived views.

This view is now drawn as one overview-first canvas: `High-Level Flow` on top, then a clickable `Grouped Module Map` below.

![[architecture.canvas]]

The canvas answers `what lives where`. The next two diagrams stay relevant because they answer different questions:

- `Comment Route Map` answers `what happens over time`.
- `Comment Lifecycle State Machine` answers `what states a comment can be in`.

## 3. Comment Route Map

Read this as the movement of one comment through the system. The canvas is spatial; this one is temporal.

This is a separate canvas so you can zoom the flow without crowding the main architecture board. It now covers both index-note generation and the current index click path that highlights the sidebar before navigation.

![[comment-route-map.canvas]]

## 4. Comment Lifecycle State Machine

Read this when debugging a specific comment. The route map shows flow; this one shows allowed status changes.

- `draft` is UI-only and not yet persisted.
- `saved` means persisted in markdown or attachment storage.
- `resolved` is still stored, but normally hidden in the sidebar.
- `orphaned` means the stored comment still exists, but its anchor could not currently be matched back to the file text.

This is a separate canvas so the state changes and transition labels stay readable when embedded.

![[comment-lifecycle.canvas]]

## 5. How To Use These Views

### When you are reading code

- Start with `Module Blueprint` to find which layer owns the behavior.
- Use `Cross-Section View` when you want the one main spatial diagram of the same structure.
- Use `Comment Route Map` when you want to know where data came from or where it is written.
- Use `Comment Lifecycle State Machine` when a bug is really about status, visibility, or retargeting.

### When you are debugging

Use this shortcut table:

| Symptom | First files to inspect |
| --- | --- |
| Draft does not save or disappears | `src/ui/views/SideNote2View.ts`, `src/ui/views/sidebarDraftEditor.ts`, `src/domain/drafts.ts` |
| Comment saved but not persisted to note | `src/core/storage/noteCommentStorage.ts`, `src/core/storage/attachmentCommentStorage.ts`, `src/core/rules/commentSyncPolicy.ts` |
| Comment exists but highlight is wrong | `src/core/anchors/anchorResolver.ts`, `src/core/derived/editorHighlightRanges.ts`, `src/commentManager.ts` |
| Sidebar or index sidebar shows wrong grouping or visibility | `src/ui/views/sidebarCommentSections.ts`, `src/ui/views/SideNote2View.ts`, `src/commentManager.ts` |
| Sidebar card click, link, or action buttons behave incorrectly | `src/ui/views/sidebarPersistedComment.ts`, `src/ui/views/SideNote2View.ts`, `src/ui/views/commentPointerAction.ts` |
| Sidebar focus, copy, selection, or draft-dismiss behavior is wrong | `src/ui/views/sidebarInteractionController.ts`, `src/ui/views/sidebarClipboardSelection.ts`, `src/ui/views/editDismissal.ts` |
| Index note is stale or wrong | `src/index/AggregateCommentIndex.ts`, `src/core/derived/allCommentsNote.ts`, `src/control/commentPersistenceController.ts`, `src/cache/ParsedNoteCache.ts` |
| Index click highlights the wrong sidebar card or opens the wrong target | `src/control/pluginRegistrationController.ts`, `src/control/commentHighlightController.ts`, `src/control/commentNavigationController.ts`, `src/ui/views/SideNote2View.ts` |
| Wiki links or tags inside comments behave incorrectly | `src/ui/editor/commentEditorLinks.ts`, `src/ui/editor/commentEditorTags.ts`, `src/core/text/commentMentions.ts` |

## 6. Mental Model

SideNote2 is easiest to understand if you keep one rule in mind:

- The note-backed comment data is the source of truth.
- The sidebar is a working view over that data plus any current draft.
- The index surfaces are derived views: the note is built by `allCommentsNote.ts`, and the index sidebar can render either the sectioned comment list or the thought-trail graph over the aggregate comments.
- Index clicks highlight the sidebar first. The sidebar card is what then redirects you back into the source note.

That means most bugs reduce to one of three questions:

1. Was the canonical comment data loaded correctly?
2. Was it transformed correctly into UI or index state?
3. Was the anchor still resolvable after the file changed?

<!-- SideNote2 comments
[
  {
    "id": "8cc93bfb-ac20-4069-b430-57896f23393e",
    "startLine": 24,
    "startChar": 6,
    "endLine": 24,
    "endChar": 20,
    "selectedText": "Cross-Section ",
    "selectedTextHash": "964144fee0c5a203693674a98b75f471c7cf4e71ff06faa5999aff516b0aa326",
    "resolved": true,
    "entries": [
      {
        "id": "8cc93bfb-ac20-4069-b430-57896f23393e",
        "body": "Cross-section means: a cut-through view of something, as if you sliced it and looked inside.\n\nFor example, a codebase “cross-section” might show:\n\n  - UI layer\n  - application logic\n  - storage layer\n  - indexing/cache layer\n\n  So if you use cross-section visually for software, it suggests:\n\n  - internal composition\n  - layered architecture\n  - hidden structure made visible",
        "timestamp": 1774912991539
      },
      {
        "id": "2ffd6f57-f0f1-4458-b09b-ed9c871d77b0",
        "body": "update",
        "timestamp": 1775537967014
      },
      {
        "id": "0d27a831-86e5-4fdd-be42-7a67146b64e8",
        "body": "this is nested",
        "timestamp": 1775538575210
      }
    ],
    "createdAt": 1774912991539,
    "updatedAt": 1775538575210
  }
]
-->
