# SideNote2 Architecture

This note is meant to make the codebase easier to read visually.

Use three lenses:

- Blueprint: static module boundaries and ownership.
- Transit map: how data and events move.
- State machine: how a comment changes over time.

## 1. Module Blueprint

Read this as the structural map of the plugin.

- `src/main.ts` is the orchestrator.
- `src/commentManager.ts` owns the in-memory comment list.
- `src/core/*` handles storage, anchors, sync policy, derived metadata, and file rules.
- `src/ui/*` handles the sidebar view, editor helpers, settings, and modals.
- `src/index/*` and `src/cache/*` support derived or accelerated views of note-backed data.

```mermaid
flowchart TB
    subgraph UI[UI]
        direction TB
        View[SideNote2View.ts]
        EditorUI[ui/editor/*]
        Modals[ui/modals/*]
        Settings[SideNote2SettingTab.ts]
    end

    Main[main.ts]
    Manager[commentManager.ts]

    subgraph Core[Core]
        direction TB
        Storage[noteCommentStorage.ts]
        Attach[attachmentCommentStorage.ts]
        Sync[commentSyncPolicy.ts]
        Files[commentableFiles.ts]
        Mentions[commentMentions.ts]
        AllComments[allCommentsNote.ts]
    end

    subgraph Anchoring[Anchoring]
        direction TB
        Anchor[anchorResolver.ts]
        Anchors[commentAnchors.ts]
    end

    subgraph Derived[Derived / Index]
        direction TB
        Index[AggregateCommentIndex.ts]
        Cache[ParsedNoteCache.ts]
        Highlights[editorHighlightRanges.ts]
    end

    Vault[(Vault files)]
    IndexNote[SideNote2 index.md]

    EditorUI --> View
    Modals --> View
    View --> Main
    Settings --> Main

    Main --> Manager
    Manager --> Anchor
    Manager --> Anchors

    Main --> Storage
    Main --> Attach
    Main --> Sync
    Main --> Files
    Main --> Mentions
    Main --> AllComments
    Main --> Index
    Main --> Cache
    Main --> Highlights

    Storage --> Vault
    Attach --> Vault
    AllComments --> IndexNote
    Index --> IndexNote
```

## 2. Comment Route Map

Read this as the movement of one comment through the system.

```mermaid
flowchart TD
    A[User selects text in editor] --> B[Command or editor menu\nAdd comment to selection]
    B --> C[main.ts starts draft]
    C --> D[SideNote2View sidebar draft]
    D --> E[Save draft]
    E --> F[commentManager.ts updates in-memory comments]
    F --> G{Target file type}
    G -->|Markdown| H[noteCommentStorage.ts]
    G -->|PDF/attachment| I[attachmentCommentStorage.ts]
    H --> J[Trailing hidden comment JSON block]
    I --> K[Plugin data storage]
    J --> L[ParsedNoteCache.ts refresh]
    K --> L
    L --> M[AggregateCommentIndex.ts refresh]
    M --> N[allCommentsNote.ts builds index note]
    N --> O[SideNote2 index.md]
    F --> P[anchorResolver.ts retargets ranges after edits]
    F --> Q[editorHighlightRanges.ts updates highlights]
    Q --> R[Editor and preview decorations]
```

## 3. Comment Lifecycle State Machine

Read this when debugging a specific comment.

- `draft` is UI-only and not yet persisted.
- `saved` means persisted in markdown or attachment storage.
- `resolved` is still stored, but normally hidden in the sidebar.
- `orphaned` means the stored comment still exists, but its anchor could not currently be matched back to the file text.

```mermaid
stateDiagram-v2
    [*] --> Draft: startNewCommentDraft
    Draft --> Saved: saveDraft
    Draft --> [*]: cancelDraft

    Saved --> Saved: editComment
    Saved --> Resolved: resolveComment
    Resolved --> Saved: unresolveComment
    Saved --> Deleted: deleteComment
    Resolved --> Deleted: deleteComment

    Saved --> Orphaned: anchorResolver cannot match selection
    Orphaned --> Saved: anchor matched again
    Resolved --> Orphaned: resolved comment loses anchor
    Orphaned --> Resolved: anchor matched and resolved=true

    Deleted --> [*]
```

## 4. How To Use These Diagrams

### When you are reading code

- Start with `Module Blueprint` to find which layer owns the behavior.
- Use `Comment Route Map` when you want to know where data came from or where it is written.
- Use `Comment Lifecycle State Machine` when a bug is really about status, visibility, or retargeting.

### When you are debugging

Use this shortcut table:

| Symptom | First files to inspect |
| --- | --- |
| Draft does not save or disappears | `src/main.ts`, `src/ui/views/SideNote2View.ts`, `src/domain/drafts.ts` |
| Comment saved but not persisted to note | `src/core/noteCommentStorage.ts`, `src/core/attachmentCommentStorage.ts`, `src/core/commentSyncPolicy.ts` |
| Comment exists but highlight is wrong | `src/core/anchorResolver.ts`, `src/core/editorHighlightRanges.ts`, `src/commentManager.ts` |
| Sidebar shows wrong grouping or visibility | `src/ui/views/sidebarCommentSections.ts`, `src/ui/views/SideNote2View.ts`, `src/commentManager.ts` |
| Index note is stale or wrong | `src/index/AggregateCommentIndex.ts`, `src/core/allCommentsNote.ts`, `src/cache/ParsedNoteCache.ts` |
| Wiki links or tags inside comments behave incorrectly | `src/ui/editor/commentEditorLinks.ts`, `src/ui/editor/commentEditorTags.ts`, `src/core/commentMentions.ts` |

## 5. Mental Model

SideNote2 is easiest to understand if you keep one rule in mind:

- The note-backed comment data is the source of truth.
- The sidebar is a working view over that data plus any current draft.
- The index note and highlights are derived views.

That means most bugs reduce to one of three questions:

1. Was the canonical comment data loaded correctly?
2. Was it transformed correctly into UI or index state?
3. Was the anchor still resolvable after the file changed?
