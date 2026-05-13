# Aside Naming Ontology And Cleanup Plan

## Why This Exists

Aside has accumulated names from several eras:

- `sidebar` for UI rendered in an Obsidian sidebar leaf
- `sidecar` for local JSON files beside the main synced plugin data
- `side note`, `comment`, `thread`, and `entry` for the same user-facing comment system
- `index sidebar`, `file sidebar`, and `note sidebar` for modes of the same Aside view

The result is readable only if you already know the history. The goal is a small ontology: a shared naming model that makes terms composable, easy to read, and aligned with Obsidian when the concept comes from Obsidian.

## Short Answer: Sidebar vs Sidecar

`sidebar` and `sidecar` are different concepts.

- `sidebar` means UI location or view behavior in Obsidian's sidebar area. Current examples include `AsideView.ts`, `sidebarPersistedComment.ts`, and `tests/sidebarLeafActivation.test.ts`.
- `sidecar` means a storage pattern: local JSON files stored under plugin data, keyed by note path or source id. Current examples include `sidecarCommentStorage.ts` and `tests/sidecarCommentStorage.test.ts`.

They are technically distinct, but the names are too similar. The cleanup should narrow `sidebar` to Obsidian UI placement and replace most `sidecar` usage with a clearer storage name such as `sideNoteCache`.

## Naming Commitments

1. Use Obsidian terms for Obsidian concepts.
2. Use Aside terms only for plugin-owned concepts.
3. Name roles as adjectives on top of Obsidian terms, not as replacement nouns.
4. Separate domain objects from representations.
5. Keep legacy names only at compatibility boundaries.

If Obsidian has a documented API noun for something, use that noun verbatim. Aside should not rename a `WorkspaceLeaf` into a panel, a `TFile` into a document, or a right sidebar into a dock.

## Obsidian Vocabulary We Should Reuse

| Concept | Use | Avoid |
| --- | --- | --- |
| Vault | `vault` | workspace, repo, project |
| Markdown file | `file`, `TFile`, `markdown file` | document, page, source document |
| Note | `note` when talking to users about a markdown note | page |
| Workspace leaf | `leaf`, `WorkspaceLeaf` | panel, slot, tab holder |
| View | `view`, `ItemView`, `AsideView` | panel, surface |
| Right/left sidebar | `right sidebar`, `left sidebar`, `sidebar` only for placement | rail, dock, sidecar |
| Editor state | `editor`, `source mode`, `reading mode`, `frontmatter` | custom synonyms |
| Plugin data | `plugin data`, `data.json` when exact | internal database |
| Data adapter | `DataAdapter` | filesystem adapter, vault IO layer |

Rule: when a name points at an Obsidian API object, the code name should reveal that API object. For example, prefer `workspaceLeaf`, `targetFile`, `activeMarkdownFile`, and `viewState` over plugin-local synonyms.

## Aside Vocabulary

| Term | Meaning | Code Direction |
| --- | --- | --- |
| Aside | The plugin brand and top-level namespace | Keep for product, root view, and CSS prefix |
| Aside view | The custom Obsidian view registered by the plugin | Prefer over generic `sidebar` for implementation helpers |
| Side note | User-facing object attached to a note or selection | Use in UI copy and docs |
| Side note thread | The persisted discussion object | Prefer `SideNoteThread` over `CommentThread` when touching domain code |
| Side note entry | One saved message in a thread | Prefer `SideNoteEntry` over `CommentThreadEntry` |
| Draft | Unsaved side note or unsaved entry edit | Keep `draft` |
| Anchor | The attachment between a side note thread and a note location | Keep `anchor`; use `note anchor` and `selection anchor` |
| Source note | The Obsidian note a side note belongs to | Use only when the role matters; otherwise use `note` or `file` |
| Source file path | The vault-relative path of the source note | Prefer over vague `source` when the value is a path |
| Aside index note | The derived markdown note that lists side notes | Prefer over bare `index` in docs |
| Index mode | Aside view mode shown while targeting the Aside index note | Prefer over `index sidebar` for code names |
| Synced side-note data | Durable side-note data stored in plugin data | Prefer over `canonical sidecar` |
| Side-note cache | Repairable local JSON cache files under plugin data | Prefer over `sidecar` in code names |
| Legacy inline block | Old hidden `<!-- Aside comments -->` or `<!-- SideNote2 comments -->` block | Never call this current storage |
| Sync event | One side-note mutation event used for cross-device replay | Keep `SideNoteSyncEvent` |

## Composition Rules

Names should read as:

```text
<Aside domain object> + <Obsidian object or representation> + <role>
```

Examples:

- `SideNoteThread`
- `SideNoteEntry`
- `SideNoteAnchor`
- `SourceFile`
- `SourceFilePath`
- `AsideViewToolbar`
- `AsideViewState`
- `AsideIndexNote`
- `SideNoteCacheStorage`
- `SideNoteSyncEvent`

Avoid stacked names where two words compete for the same role:

- Avoid `sidebarSideNoteCard`; prefer `SideNoteThreadCard` or `AsideViewThreadCard`.
- Avoid `sidecarCommentStorage`; prefer `SideNoteCacheStorage`.
- Avoid `indexSidebarState`; prefer `AsideIndexViewState` or `IndexModeState`.
- Avoid `pageComment`; prefer `noteAnchor` or `note-level side note`.

## Representation Boundaries

Use different words for different layers:

| Layer | Word |
| --- | --- |
| Domain object | `SideNoteThread`, `SideNoteEntry`, `Anchor` |
| Stored payload | `Record`, `Snapshot`, `SyncEvent`, `CacheFile` |
| In-memory collection | `Store`, `Manager`, `Index` |
| Pure decision logic | `Planner`, `Policy`, `Resolver` |
| Obsidian integration | `Controller`, `Adapter`, `WorkspaceLeaf`, `View` |
| DOM output | `Renderer`, `Card`, `Toolbar`, `Button` |

This keeps composition clear. A thread is not a card, a card is not storage, storage is not the view, and the view is not the Obsidian sidebar itself.

## Current Drift Map

| Current Name Family | Problem | Target Direction |
| --- | --- | --- |
| `sidecarCommentStorage` | Mixes storage-pattern jargon with the old `comment` noun | Rename to `sideNoteCacheStorage` and `SideNoteCacheStorage` |
| `CanonicalCommentStorageSource = "sidecar"` | Treats cache representation as a canonical source name | Rename internal plan source to `cache`; document synced plugin data as durable source |
| `sidebar*` helper files | Some are about the Aside view, not the Obsidian sidebar as a placement | Rename opportunistically to `asideView*` or domain-specific names |
| `indexSidebar*` | The user is still in `AsideView`; the mode changes because the target file is the Aside index note | Rename to `indexMode*` or `asideIndexView*` |
| `CommentThread`, `CommentThreadEntry` | Old implementation noun obscures the user concept | Introduce `SideNoteThread` and `SideNoteEntry`; migrate by aliases first |
| `Comment` projection | Ambiguous: sometimes means latest entry, sometimes thread display row | Rename by representation, such as `SideNoteListItem` or `SideNoteEntryProjection` |
| `page` anchor wording | Obsidian users think in notes, not pages | Prefer `note anchor`; keep serialized `"page"` only behind compatibility helpers |
| `SideNote2` names | Historical compatibility only | Keep at migration and legacy URI boundaries, not new code |

## Cleanup Plan

### 1. Adopt This Ontology For New Code

Use this note as the naming rule for new files, tests, docs, UI copy, and log event names. Do not add new `sidecar*`, `sidebar*`, or `comment*` names unless the term is explicitly allowed by the tables above.

### 2. Rename Storage First

Storage is the clearest immediate win because `tests/sidecarCommentStorage.test.ts` exposes the confusion.

Target rename set:

- `src/core/storage/sidecarCommentStorage.ts` to `src/core/storage/sideNoteCacheStorage.ts`
- `tests/sidecarCommentStorage.test.ts` to `tests/sideNoteCacheStorage.test.ts`
- `SidecarCommentStorage` to `SideNoteCacheStorage`
- `StoredSidecarComments` to `StoredSideNoteCache`
- user/docs wording from `sidecar` to `side-note cache`, except where explaining the old name

Compatibility:

- Keep existing cache folder layout unless a separate migration is planned.
- Keep reading legacy SideNote2 paths.
- If string values like `"sidecar"` are externally visible, keep a compatibility parser and normalize to `cache` internally.

### 3. Introduce Domain Aliases

Create a domain naming bridge before broad renames:

- `SideNoteThread = CommentThread`
- `SideNoteEntry = CommentThreadEntry`
- optional `SideNoteListItem` for the current `Comment` projection if that projection means "renderable list row"

Then migrate touched modules toward the side-note names. This avoids one giant rename across storage, UI, sync, agents, and tests.

### 4. Narrow Sidebar Names

Keep `sidebar` only when the name really means Obsidian sidebar placement or compatibility with existing CSS/log event names.

For implementation helpers, prefer:

- `AsideViewToolbar` over `sidebarToolbar`
- `SideNoteThreadCard` over `sidebarPersistedComment`
- `SideNoteDraftCard` over `sidebarDraftComment`
- `AsideViewSearchHighlight` over `sidebarSearchHighlight`
- `AsideIndexModeState` over `indexSidebarState`

CSS classes can migrate more slowly because they are a wide change area. New classes should follow the clearer concept names.

### 5. Rename Index Concepts

Use two separate names:

- `Aside index note`: the generated markdown file.
- `index mode`: the mode of `AsideView` when it is displaying aggregate side-note data for the index note.

Avoid `index sidebar` in new code. In docs, spell it out once if needed: "Aside view in index mode".

### 6. Replace Page Anchor Language

Use:

- `note anchor` for a side note attached to the whole source note
- `selection anchor` for a side note attached to selected text

Do not expose `page` in new UI copy. Keep existing serialized `anchorKind: "page"` behind conversion helpers until a schema migration is justified.

### 7. Add A Naming Audit

Add a lightweight check after the first rename slice:

- fail on new `sidecar` outside storage compatibility docs/tests
- warn on new `sidebar` outside `AsideView` placement, CSS compatibility, and old tests
- warn on new exported `Comment*` domain names
- allow `SideNote2` only in legacy migration code and tests

The audit should be advisory at first, then become blocking once the main storage and domain aliases land.

## Rollout Order

1. Commit this ontology note.
2. Rename storage from `sidecarCommentStorage` to `sideNoteCacheStorage`.
3. Add domain aliases for `SideNoteThread` and `SideNoteEntry`.
4. Rename tests around storage and new domain types.
5. Rename `indexSidebar*` state/planner code where the blast radius is small.
6. Rename high-traffic `sidebar*` UI helpers only when they are already being touched.
7. Update architecture docs to point to this ontology instead of repeating naming rules.
8. Add the naming audit once the allowed exceptions are explicit.

## Success Criteria

- A new contributor can explain why `sidebar` and `side-note cache` are different without reading storage internals.
- Obsidian API concepts use Obsidian words.
- Aside domain concepts use side-note words.
- UI components are named after what they render, not only where they render.
- Storage names say whether data is durable synced data, a repairable cache, or legacy inline migration input.
- New code does not add fresh `sidecar`, ambiguous `sidebar`, or broad `comment` names.

## Non-Goals

- Do not churn old release notes.
- Do not rename serialized data or cache folder paths just for aesthetics.
- Do not replace Obsidian vocabulary with plugin-local metaphors.
- Do not do one repository-wide rename unless the domain aliases and compatibility boundaries are already in place.
