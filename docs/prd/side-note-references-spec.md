# Side Note References Spec

## Status

Draft implementation spec for linking one side note to another.

Related docs:

- [threaded-side-notes-spec.md](threaded-side-notes-spec.md)
- [file-sidebar-thought-trail-spec.md](file-sidebar-thought-trail-spec.md)
- [index-sidebar-file-filter-spec.md](index-sidebar-file-filter-spec.md)

Relevant current code:

- [src/commentManager.ts](../../src/commentManager.ts)
- [src/core/storage/noteCommentStorage.ts](../../src/core/storage/noteCommentStorage.ts)
- [src/index/AggregateCommentIndex.ts](../../src/index/AggregateCommentIndex.ts)
- [src/core/derived/allCommentsNote.ts](../../src/core/derived/allCommentsNote.ts)
- [src/core/derived/thoughtTrail.ts](../../src/core/derived/thoughtTrail.ts)
- [src/core/derived/indexFileFilterGraph.ts](../../src/core/derived/indexFileFilterGraph.ts)
- [src/ui/views/sidebarDraftEditor.ts](../../src/ui/views/sidebarDraftEditor.ts)
- [src/ui/views/sidebarPersistedComment.ts](../../src/ui/views/sidebarPersistedComment.ts)
- [src/comments/commentNavigationController.ts](../../src/comments/commentNavigationController.ts)

## Objective

Allow a side note to reference another side note in a way that:

- works within the same markdown file and across different markdown files
- supports true many-to-many relationships across side notes
- fits the current per-note storage model
- does not require dual-writing relationship state into two notes
- does not require treating `SideNote2 index.md` as canonical data storage
- feels like a natural inline mention in the sidebar UI
- can drive richer navigation and graph behavior later

## Current Constraints

The current architecture already gives us three strong primitives:

1. Canonical side-note storage is per source markdown file in the trailing managed block.
2. Every side note already has a stable deep link via `obsidian://side-note2-comment?...&file=...&commentId=...`.
3. The plugin already maintains an aggregate in-memory comment index that can resolve a comment by `commentId` across loaded vault state.

The current architecture also imposes two important constraints:

1. `CommentThread` and `CommentThreadEntry` do not currently have first-class relationship fields.
2. File-level graph features today derive edges from markdown content, not from separately stored edge tables.

This spec should align with those constraints instead of creating a second relationship system.

Important implication:

- `SideNote2 index.md` is a derived note view, not the write model and not the search database

## Decision Summary

### Decision 1: A Side-Note Reference Is Stored In Comment Markdown, Not In Thread Metadata

The canonical persisted form should be an ordinary markdown link inside the source entry body:

```md
[label](obsidian://side-note2-comment?vault=<vault>&file=<file>&commentId=<commentId>)
```

This keeps the source of truth inside the existing `body` / `comment` text, consistent with how wiki links and tags already work.

### Decision 2: `commentId` Is The Real Identity; `file` Is A Hint

The link payload may include both `file` and `commentId`, but runtime resolution must treat `commentId` as authoritative.

Reason:

- the current deep-link format already includes both values
- `commentId` is the stable object identity
- file paths can change on rename or move

### Decision 3: References Are One-Way In Storage And Two-Way In UI

Only the source side note stores the outgoing reference.
Incoming backlinks on the target side note must be derived in memory.

This avoids:

- cross-note dual writes
- synchronization bugs
- rename churn across unrelated notes

### Decision 4: V1 Authoring Uses Explicit Side-Note Link UI, Not A New Inline Trigger Syntax

Do not overload:

- `@`, because that already collides with agent mentions
- `[[`, because that already means note links

V1 should add:

- a draft-editor toolbar action such as `Link side note`
- a side-note picker modal
- paste normalization for raw copied side-note URLs

### Decision 5: The Rendered UI Should Feel Like A Mention Chip, Not A Raw External URL

The stored markdown stays standard, but the sidebar rendering should visually decorate side-note links as SideNote2-native references.

### Decision 6: Cross-File Side-Note References Should Count As File Graph Edges

If a side note in `A.md` references a side note in `B.md`, file-level derived graph features should treat that as an `A -> B` edge.

Same-file references should remain comment-level only.

### Decision 7: N:N Relationships Are Supported, But Only Outgoing Edges Are Stored

The product should support true many-to-many linking:

- one side note may reference many target side notes
- one target side note may be referenced by many source side notes

Only outgoing references are stored canonically in source entry markdown.
Incoming relationships are always derived from the indexed outgoing set.

### Decision 8: Global Search Runs On Indexed Side Notes, Not On `index.md`

Cross-note search should be powered by:

- `AggregateCommentIndex` as the structured source
- a derived search index layered on top of it

It must not depend on reparsing `SideNote2 index.md`.

### Decision 9: Thought Trail Should Consume The Shared Reference Index

Thought trail and file-filter graph derivation should use the same indexed side-note relationship layer that powers search and backlinks.

The goal is one shared derived relationship model, not separate parsing paths per feature.

## Scope

In scope:

- canonical side-note reference format
- parser and derived reference index
- global side-note reference search across notes
- link insertion flow in draft UI
- rendered link styling and click behavior
- backlink derivation
- rename-safe target resolution
- thought-trail and file-filter graph integration for cross-file references
- tests for parsing, insertion, navigation, and derived graph behavior

Out of scope:

- arbitrary relation types beyond plain reference
- comment-to-comment drag-and-drop linking
- a new standalone comment graph view
- syncing link labels across existing references after target edits
- public markdown syntax outside SideNote2-rendered surfaces

## Product Rules

### Rule 1: Canonical Storage Stays Per Note

Do not add a global relationship file.
Do not add target-owned backlink storage.
Do not treat `SideNote2 index.md` as canonical storage.

The source markdown note remains canonical for its own threads and their entry bodies.

### Rule 2: References Are Authored On Entries, Not On Threads As A Separate Layer

A reference is part of what a specific entry says.
It belongs in entry markdown, not in a second thread-level edge list.

### Rule 3: Reference Resolution Must Survive Renames

If the `file=` parameter in a stored link is stale but the `commentId` still exists, navigation must still succeed.

### Rule 4: Cross-Vault Links Are Not Local Side-Note References

If a pasted `side-note2-comment` URL explicitly names a different vault, treat it as an external link for local graph and backlink purposes.

It may still render as a clickable markdown link, but it must not enter the local derived reference graph.

### Rule 5: Self-Links Must Be Prevented In V1

The picker should not allow a side note to reference itself.

For V1, the picker should also avoid presenting child-entry targets from the same thread.

### Rule 6: Existing Share Links Become A First-Class Authoring Path

The current share action already copies a `side-note2-comment` URL.

V1 must support this workflow naturally:

1. copy side-note link from one card
2. paste into another draft
3. SideNote2 converts the raw URL into a readable inline reference

### Rule 7: Display Labels Are Presentation, Not Identity

The rendered label can be generated from target metadata, but identity always comes from the URL target.

If the user edits the markdown label text manually, preserve that label.
Do not silently rewrite old links just because the target preview changed.

### Rule 8: Cross-File References Influence File Graphs; Same-File References Do Not

Same-file side-note references improve local navigation and backlinks only.
They must not create self-loop file graph edges.

### Rule 9: Side-Note Linking Is Many-To-Many

The relationship model must allow:

- one source side note to reference many targets
- one target side note to have many incoming references

No uniqueness rule should limit a side note to a single outbound or inbound connection.

### Rule 10: Search Must Reuse The Aggregate Index

Global side-note search should be built from the already indexed side-note corpus in memory.

It must not:

- parse `SideNote2 index.md` as its source
- require a second canonical side-note store
- trigger a vault-wide full rescan on every picker open

### Rule 11: `index.md` Remains A Derived Surface Only

`SideNote2 index.md` may show:

- summaries
- links
- navigable projections of stored side notes

It must not become:

- the canonical side-note database
- the relationship database
- the search index source of truth

## Canonical Model

### Persisted Form

The canonical stored form is inline markdown in the entry body:

```md
[Pricing concern](obsidian://side-note2-comment?vault=MyVault&file=notes%2Froadmap.md&commentId=thread-42)
```

### Canonical Requirements

1. `commentId` is required.
2. `file` should be written for compatibility and direct opening.
3. `vault` should be written by SideNote2 when it inserts the link.
4. Runtime resolution must not depend on optional params such as `kind`.

### Link Target Model

Recommended internal parsed shape:

```ts
interface SideNoteReferenceTarget {
  commentId: string;
  filePathHint: string | null;
  vaultName: string | null;
}

interface ExtractedSideNoteReference {
  original: string;
  label: string | null;
  target: SideNoteReferenceTarget;
}
```

## Why Inline Markdown Is Preferred Here

This repo already derives important features from comment text:

- wiki-link graph edges
- metadata-cache synthetic links
- tag extraction

Side-note references should follow the same pattern.

Advantages:

- no storage migration for `CommentThread` / `CommentThreadEntry`
- no second source of truth
- no backlink dual writes
- human-readable persisted markdown
- easy clipboard and sharing behavior

## Indexed Data Model

The feature should use a layered indexed model:

1. canonical per-note storage in source markdown managed blocks
2. `AggregateCommentIndex` as the structured in-memory corpus of all known side notes
3. derived reference and search indexes built from that corpus
4. `SideNote2 index.md` as a readable projection over the same data

This avoids both extremes:

- reparsing `index.md` as if it were the database
- rescanning every source note on every search interaction

### Aggregate Index Responsibilities

`AggregateCommentIndex` should remain the shared structured source for:

- comment identity lookup
- global side-note search candidates
- reference resolution
- backlink derivation
- graph edge derivation

The expectation is:

- load once
- keep updated incrementally as files change
- let higher-level features reuse that indexed state

## Derived Reference Index

Add a derived in-memory reference layer built from all current thread entry bodies.

Recommended outputs:

```ts
interface SideNoteOutgoingReference {
  sourceCommentId: string;
  sourceThreadId: string;
  sourceFilePath: string;
  targetCommentId: string;
  targetFilePath: string | null;
  crossFile: boolean;
}

interface SideNoteIncomingReference {
  sourceCommentId: string;
  sourceThreadId: string;
  sourceFilePath: string;
  targetCommentId: string;
}

interface SideNoteReferenceIndex {
  outgoingByCommentId: Map<string, SideNoteOutgoingReference[]>;
  incomingByCommentId: Map<string, SideNoteIncomingReference[]>;
}
```

### Build Rules

1. Parse every visible stored entry body for local `side-note2-comment` links.
2. Resolve target comments by `commentId` through the aggregate index first.
3. Use `filePathHint` only when the target is not already known.
4. Ignore malformed links.
5. Ignore foreign-vault links.
6. Deduplicate repeated references within one source entry to the same `targetCommentId`.

### Why Derived Backlinks Are The Right Tradeoff

The target side note can show `Referenced by` UI without owning any backlink payload in its own hidden block.

That means:

- no backlink repair work on rename
- no two-note transaction semantics
- no risk of dangling target metadata after source deletion

## Search Model

Add a derived global search index for side-note linking.

Recommended shape:

```ts
interface SideNoteReferenceSearchDocument {
  commentId: string;
  threadId: string;
  filePath: string;
  selectedTextPreview: string;
  pageNotePreview: string | null;
  latestEntryPreview: string;
  resolved: boolean;
  updatedAt: number;
}

interface SideNoteReferenceSearchIndex {
  search(query: string, options?: { sourceFilePath?: string; limit?: number }): SideNoteReferenceSearchDocument[];
}
```

### Search Source

V1 search should read from `AggregateCommentIndex`, not from `SideNote2 index.md`.

Recommended candidate set in V1:

- thread roots only
- no deleted threads
- resolved threads included but ranked lower

### Search Semantics

The search model must support N:N linking naturally.

That means:

- any result can be selected as a target
- selection creates one outgoing reference from the current source side note
- many different source side notes may select the same target independently

### Search Performance Rule

Opening the reference picker should query an already-built in-memory index.

It should not:

- rebuild by reparsing `SideNote2 index.md`
- scan every source markdown note synchronously on modal open

### Search Ranking

Search ranking should prioritize:

1. same file as the source draft
2. exact selected-text match
3. exact file-name match
4. prefix matches on selected text or file path
5. recency
6. unresolved items over resolved items

## Navigation Model

### Target Resolution

Navigation should use this order:

1. resolve by `commentId` from loaded current-file state
2. resolve by `commentId` from the aggregate comment index
3. if still unresolved and `filePathHint` exists, load that file and try `commentId`
4. if unresolved after that, show a missing-target notice

### Important Change From Current Behavior

The current protocol navigation path is file-first.
That is not durable enough once side-note-to-side-note linking becomes a common authored feature.

Required change:

- `highlightCommentById(...)` and related open/reveal flows must accept stale `file` hints and recover by `commentId`

## Authoring UI Spec

### Draft Editor Actions

Add a dedicated draft-editor action:

- toolbar button: `Link side note`
- inline-edit action row button: link icon with `Link side note`

This action opens a side-note picker modal and inserts a reference at the cursor.

### Why A Button Is Better Than New Syntax In V1

The current editor already has:

- `[[` note-link suggestions
- `#` tag suggestions
- `@` mental space occupied by agent mentions

Adding a third inline trigger now would create ambiguity.

The explicit action keeps the feature understandable.

### Picker Modal

Recommended new modal:

- `SideNoteReferenceSuggestModal`

Search source:

- aggregate indexed side-note search index
- deduplicated to thread roots in V1

Search ranking should prioritize:

1. same file as the draft
2. exact selected-text match
3. exact file-name match
4. prefix matches on selected text or file path
5. recent threads

Suggestion row should show:

- primary label: selected-text preview or page-note preview
- secondary label: source markdown path
- badges when relevant:
  - `Same note`
  - `Page note`
  - `Resolved`

### V1 Picker Constraints

1. do not show the current source side note itself
2. do not expose child-entry targets in the picker
3. do not allow linking to deleted targets

### Inserted Markdown

When the user chooses a target:

1. if text is selected in the draft, use the selected text as the markdown label
2. otherwise insert a generated label from target metadata

Recommended default label generation:

- same file anchored note: selected-text preview
- same file page note: page-note preview
- cross-file note: `<FileName> · <preview>`

Example:

```md
[Roadmap · shipping timeline concern](obsidian://side-note2-comment?...&commentId=thread-42)
```

### Paste Normalization

If a user pastes a raw `obsidian://side-note2-comment?...` URL into a draft:

1. detect it at paste or input-normalization time
2. resolve the target if local
3. replace the raw URL with readable markdown link text

If resolution fails:

- leave the pasted URL unchanged

This makes the existing `Share side note` action immediately useful for connecting notes.

## Rendered UI Spec

### Inline Rendering

In rendered sidebar markdown, side-note references should be decorated as SideNote2-native chips or pills.

Recommended presentation:

- link icon or side-note icon
- human-readable label
- muted file label for cross-file targets
- muted state for resolved targets
- broken state for missing targets

The stored markdown remains a normal markdown link.
Only the rendering is upgraded.

### Click Behavior

Clicking a rendered side-note reference should:

1. intercept the link before generic markdown-link behavior
2. resolve the target comment
3. if target is in the same file:
   - activate and highlight the target in the sidebar
   - keep the sidebar interaction model intact
4. if target is in a different file:
   - open the target note in the preferred file leaf
   - reveal the target side note
   - focus the destination view

This should feel like following a comment mention, not like opening an external URL.

### Backlink UI

Targets with incoming references should show a compact backlink affordance.

Recommended V1 behavior:

- footer line: `Referenced by`
- up to three backlink chips
- `+N` overflow indicator when more exist

Each backlink chip should show:

- source file label when cross-file
- source selected-text preview or page-note preview

Clicking a backlink chip uses the same navigation behavior as an inline reference.

## Graph Integration

### File-Level Edge Rule

When a side-note reference resolves to a target in another markdown file:

- source file = source side note `filePath`
- target file = resolved target side note `filePath`

That relation should count as a file-level edge for:

- `buildIndexFileFilterGraph(...)`
- `buildThoughtTrailLines(...)`

### Merge Rule

File graph builders should treat cross-file side-note references as an additional edge source alongside existing wiki-link edges.

They should not replace wiki-link logic.

They should also avoid building a separate relationship corpus just for graph rendering.

Preferred flow:

1. read the shared derived side-note reference index
2. project cross-file edges from that index
3. merge those edges with existing wiki-link edges

If multiple side-note references connect the same source file to the same target file, graph builders should aggregate them into one file-level relation rather than emitting duplicate parallel file edges.

### Same-File Rule

If source and target resolve to the same markdown file:

- keep the comment-level relation
- do not emit a file-level edge

## State And Data Integrity Rules

### Rename And Move

On file rename or move:

- aggregate index updates already keep known comment objects current
- stored side-note reference URLs do not need immediate rewrite
- runtime resolution must continue working from `commentId`

Optional future improvement:

- opportunistically rewrite stale `file=` hints when a source note is next edited and saved

### Resolved Targets

Resolved targets remain valid navigation targets.
They should render with muted styling or a resolved badge, not disappear.

### Missing Or Deleted Targets

If a target no longer resolves:

- keep the markdown link text visible
- render it as broken or unavailable
- clicking should show a clear notice instead of silently failing

### Foreign Vault Targets

If the link explicitly points to a different vault:

- do not include it in local backlink derivation
- do not include it in local file graphs
- do not try to resolve it against the local aggregate index

## Module Ownership

### `src/core/text/*`

Add a parser module for side-note references.

Recommended file:

- `src/core/text/commentReferences.ts`

Owns:

- parsing markdown links that target `side-note2-comment`
- validating local-vault compatibility
- extracting structured reference targets

### `src/index/AggregateCommentIndex.ts`

Remains the structured source of indexed side notes.

Possible additions:

- helpers for search inputs used by the picker
- thread-root suggestion helpers

### `src/index/*`

Add a dedicated derived search index module.

Recommended file:

- `src/index/SideNoteReferenceSearchIndex.ts`

Owns:

- searchable side-note documents built from `AggregateCommentIndex`
- ranking logic for picker results
- incremental refresh when aggregate comments change

### `src/core/derived/*`

Add a shared derived reference-index module.

Recommended file:

- `src/core/derived/sideNoteReferenceIndex.ts`

Owns:

- outgoing side-note reference derivation
- incoming backlink derivation
- reusable cross-file relationship edges for graph features

### `src/comments/commentNavigationController.ts`

Must own rename-safe target resolution and open/highlight behavior for comment references.

### `src/ui/modals/*`

Add:

- `SideNoteReferenceSuggestModal.ts`

### `src/ui/views/sidebarDraftEditor.ts`

Owns:

- opening the reference picker
- applying the inserted markdown into the active draft
- paste normalization entry point if implemented in the draft surface

### `src/ui/views/sidebarDraftComment.ts`

Owns:

- rendering the draft-editor button that opens side-note linking

### `src/ui/views/sidebarPersistedComment.ts`

Owns:

- intercepting rendered side-note reference clicks
- rendering backlink affordances

### `src/core/derived/indexFileFilterGraph.ts`

Must include cross-file side-note references as graph edges, preferably by consuming the shared derived reference index.

### `src/core/derived/thoughtTrail.ts`

Must include cross-file side-note references as file-to-file edges in the thought trail builder, preferably by consuming the shared derived reference index.

## Testing

Add tests for:

1. parsing local side-note markdown links
2. ignoring malformed or foreign-vault links
3. deduplicating repeated references within one entry
4. generating readable inserted labels
5. preventing self-link suggestions
6. paste normalization from raw copied URLs
7. same-file navigation from rendered reference chip
8. cross-file navigation from rendered reference chip
9. rename-safe resolution when `file=` is stale but `commentId` still exists
10. backlink derivation for local references
11. graph connectivity updates when cross-file side-note references exist without wiki links
12. no file-graph edge created for same-file references
13. search results come from indexed side-note data rather than reparsing `SideNote2 index.md`
14. many-to-many linking works across multiple sources and targets without uniqueness conflicts

## Rollout Notes

Recommended implementation order:

1. parser and rename-safe navigation
2. picker modal and draft insertion
3. rendered chip styling and click interception
4. backlink UI
5. graph integration

This order gives useful authoring and navigation early, while keeping the file-graph changes isolated and testable.
