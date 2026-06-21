# Thought Trail Source Markdown Wikilinks Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Existing Thought Trail `Wikilinks` source scans side-note/thread `[[wikilinks]]` from every thread entry.
- [x] Existing Thought Trail `Tags` source already treats source markdown metadata and side-note metadata as one combined related-file source.
- [x] Existing index Files filter is modeled around a selected root and comment-index membership; this design preserves that boundary.

### To Implement

- [x] Add a Thought Trail note-link graph builder that can consume both side-note links and source markdown note links.
- [x] Read source markdown normal links and embeds from Obsidian metadata cache without reading source files directly.
- [x] Count source markdown embeds only when they resolve to markdown notes.
- [x] Use the richer Thought Trail graph for normal note Thought Trail scope, index Thought Trail rendering, and Thought Trail availability.
- [x] Keep the index Files filter and index comment list comment-index scoped; do not let source-markdown-only links expand comment-list membership.
- [x] Render side-note edges with existing labels and source-markdown edges without labels, suppressing unlabeled duplicates when a labeled side-note edge exists for the same source-target pair.
- [x] Update Thought Trail empty-state copy so `Wikilinks` mentions source markdown links as well as side-note links.

### Verification

- [x] Unit tests cover source markdown links creating Thought Trail nodes and edges.
- [x] Unit tests cover source markdown embeds counting only when they resolve to markdown notes.
- [x] Unit tests cover commentless related markdown notes appearing in Thought Trail but not affecting index Files filter membership.
- [x] Unit tests cover side-note duplicate edges winning over source-markdown duplicate edges.
- [x] Unit tests cover exclusion of `Aside index.md`, self-links, unresolved links, and non-markdown targets.
- [x] Existing side-note-only Thought Trail tests still pass.
- [x] Existing index Files filter tests still pass without source-markdown-only expansion.

## Context

Thought Trail currently has two related-file sources:

- `Wikilinks`, which scans `[[wikilinks]]` inside side-note/thread bodies.
- `Tags`, which combines source markdown tags from Obsidian metadata with side-note tags.

That means `Tags` already treats source markdown and side notes as one related-file signal, while `Wikilinks` only sees side-note text. The desired behavior is to bring `Wikilinks` up to the same product model: Thought Trail should reflect note relationships present in the source markdown itself, not only relationships repeated inside side comments.

The relevant prior docs are:

- `docs/superpowers/specs/2026-06-05-thought-trail-related-files-source-design.md`
- `docs/superpowers/plans/2026-06-05-thought-trail-related-files-source-plan.md`, marked superseded
- `docs/prd/index-sidebar-file-filter-spec.md`
- `docs/prd/file-sidebar-thought-trail-spec.md`

The index Files filter docs remain authoritative for comment-list membership. This spec adds a richer Thought Trail note graph without changing the meaning of the index comment list.

## Goals

- Include source markdown `[[wikilinks]]` in Thought Trail `Wikilinks`.
- Include source markdown embeds `![[...]]` only when the target resolves to a markdown note.
- Keep side-note/thread `[[wikilinks]]` in Thought Trail with existing behavior.
- Include incoming, outgoing, and transitive relationships in the rooted Thought Trail graph.
- Allow commentless markdown notes to appear as Thought Trail graph nodes.
- Keep the index Files filter and index comment list scoped to comment-index membership.
- Avoid multiple divergent definitions of Thought Trail-related files.

## Non-Goals

- Do not expand the index comment list because of source-markdown-only links.
- Do not add commentless markdown notes as index Files filter options unless existing comment-index behavior already includes them.
- Do not count image, PDF, audio, video, canvas, or other non-markdown embeds as Thought Trail nodes.
- Do not change the `Tags` source behavior.
- Do not count side-note embeds in this slice; side-note link behavior remains normal `[[wikilinks]]`.
- Do not redesign the Mermaid visual style.

## Product Semantics

Thought Trail `Wikilinks` is a markdown-note graph rooted on the current Thought Trail source file.

For a normal note sidebar, the root is the current markdown file.

For `Aside index.md`, the root is the file selected by the existing Files filter. If no file is selected, the existing prompt to choose a file remains.

The rooted graph includes:

- source markdown normal wiki links, such as `[[Target]]`
- source markdown note embeds, such as `![[Target]]`, when `Target` resolves to a markdown file
- side-note/thread wiki links from all thread entries, such as `[[Target]]`

The graph excludes:

- unresolved links
- self-links
- links to `Aside index.md`
- non-markdown embed targets
- duplicate unlabeled source-markdown edges when a labeled side-note edge exists for the same source and target

Thought Trail scope is the full connected component around the root over this graph. Connectivity is undirected for membership so incoming, outgoing, and transitive relationships are all included. Rendering remains directed: a source markdown link from `A.md` to `B.md` renders as `A -> B`.

## Surface Boundaries

The index Files filter and index comment list stay comment-index scoped.

Selecting `A.md` in the index Files filter must not pull `B.md` comments into the list merely because `A.md` links to `B.md` in source markdown. Source-markdown-only links belong to the Thought Trail graph, not to list membership.

This intentionally separates two related but different concepts:

- **Comment list membership:** which comment-bearing source files are shown in the index sidebar.
- **Thought Trail note graph:** which markdown notes are related around the selected root, including commentless notes.

When the user opens Thought Trail from `Aside index.md`, the selected Files filter root still chooses the Thought Trail root. After that, Thought Trail may show related commentless markdown nodes that the List tab does not show as comments.

## Edge Sources

### Side-Note Edges

Side-note edges preserve current behavior:

- scan every entry in a thread
- parse normal `[[wikilinks]]`
- resolve links through Obsidian link resolution
- exclude unresolved, self, and index-note links
- preserve existing edge labels from comment or selection context

Multiple side-note comments that link the same source-target pair may continue to render as multiple labeled edges if that is the existing output for those comments.

### Source Markdown Edges

Source markdown edges come from Obsidian cached metadata for markdown files:

- `CachedMetadata.links` for normal source links
- `CachedMetadata.embeds` for embeds

Each cached link is resolved with the source file path. The target is included only when it resolves to a markdown `TFile`.

Source markdown edges are unlabeled. They are navigational note relationships, not side-comment annotations.

The implementation should use cached metadata and vault file lists rather than reading every markdown file from disk during sidebar render.

## Graph Ownership

Create a Thought Trail-specific graph or edge builder under `src/core/derived/`.

It should be separate from `indexFileFilterGraph.ts` because the index graph is intentionally comment-index scoped, while the Thought Trail graph can include commentless markdown nodes.

The builder should expose enough structure for:

- rooted connected-component discovery
- Mermaid line generation
- availability checks
- duplicate edge handling

Recommended conceptual model:

```ts
interface ThoughtTrailGraphEdge {
    sourceFilePath: string;
    targetFilePath: string;
    source: "side-note" | "source-markdown";
    comment?: Comment | CommentThread;
}
```

The concrete implementation can use different names if they fit the existing code better.

## Duplicate Edges

When source markdown and side notes both produce the same `sourceFilePath -> targetFilePath` pair:

1. Keep the side-note edge because it carries user-authored comment context and an edge label.
2. Suppress the duplicate source-markdown edge because the unlabeled edge adds visual noise.

This duplicate rule applies only across source types. It should not remove meaningful multiple side-note edges if existing Thought Trail behavior renders them separately.

## Availability And Empty States

Thought Trail `Wikilinks` should be available when a root markdown file exists and the richer Thought Trail graph has at least one renderable edge for that root component.

This means a normal note can have an available Thought Trail from source markdown links even when the note has no side-note links.

Empty-state copy should stop implying that only side-note links matter. Suggested copy:

- Normal note: `No related files for this file yet.`
- Normal note hint: `Add wiki links in the source note or in side notes.`
- Index root: `No related files for the selected file.`
- Index root hint: `Add wiki links in that source note, related source notes, or side notes.`

The `Tags` source availability and empty states remain unchanged.

## Data Flow

1. `AsideView` determines the Thought Trail root:
   - normal note: current markdown file
   - index note: selected Files filter root
2. `AsideView` passes the root, indexed side-note threads, markdown candidate files, and link-resolution helpers to the Thought Trail graph builder.
3. The graph builder collects:
   - side-note edges from indexed/current threads
   - source markdown edges from cached metadata for markdown files
4. The graph builder derives the root connected component for Thought Trail only.
5. The renderer builds Mermaid lines from the component:
   - side-note edges labeled as today
   - source markdown edges unlabeled
6. Node click behavior continues to open the target markdown note.

The index Files filter continues to use its current comment-index graph and derived closure for list membership.

## Performance

The implementation should not synchronously read every markdown source file during sidebar render.

Use:

- `app.vault.getMarkdownFiles()` for candidate markdown files
- `app.metadataCache.getFileCache(file)` for cached links and embeds
- existing Obsidian link resolution APIs for target resolution

Because the graph can include commentless source markdown notes, the candidate file set for Thought Trail source-markdown edges is the markdown files in the vault, excluding `Aside index.md`. This is broader than the comment-index file set, so it should remain isolated from the list filter.

If metadata for a file is not available yet, that file contributes no source-markdown edges until Obsidian metadata refreshes. The plugin can rely on existing render refresh paths rather than forcing file reads.

## Acceptance Criteria

- Thought Trail `Wikilinks` includes source markdown normal `[[wikilinks]]`.
- Thought Trail `Wikilinks` includes source markdown `![[embeds]]` only when the target resolves to a markdown note.
- Thought Trail `Wikilinks` continues to include side-note/thread `[[wikilinks]]` from all thread entries.
- Source-markdown-only related notes can appear as graph nodes even when they have no side comments.
- Selecting a file in the index Files filter does not show comments from source-markdown-only related files in the List tab.
- The index Files filter options and comment membership remain comment-index scoped.
- Side-note edges keep labels.
- Source markdown edges are unlabeled.
- Duplicate source-markdown edges are suppressed when a side-note edge for the same source-target pair exists.
- `Aside index.md`, self-links, unresolved links, and non-markdown targets are excluded.
- Existing `Tags` source behavior is unchanged.
- Existing side-note-only Thought Trail behavior remains intact.
