# File Sidebar Local Tags Spec (Implementation Checklist)

- Plan: [file-sidebar-local-tags-plan.md](file-sidebar-local-tags-plan.md)

## What to implement

- Add new note-sidebar mode: `tags`.
- Normal file sidebar mode order becomes: `List | Tags | Thought Trail`.
- `Tags` applies only to the active markdown file.
- Batch flow on search results: select multiple, choose existing tag or create-on-miss, apply to all selected.
- No schema changes to comments; use existing text tag parsing.

## Data model (minimal)

```ts
// src/ui/views/viewState.ts
export type SidebarPrimaryMode = "list" | "thought-trail" | "tags";

interface CommentTagProjection {
  filePath: string;
  threadId: string;
  tagRaw: string;          // e.g. "#alpha/topic"
  tagKey: string;          // lower-case normalized key
}

interface FileTagIndex {
  filePath: string;
  threadIdsByTag: Map<string, Set<string>>;
  tagsByThreadId: Map<string, Set<string>>;
  tagsByDisplay: Map<string, string>;
}

interface BatchTagFlowState {
  isOpen: boolean;
  isApplying: boolean;
  query: string;
  selectedTagKey: string | null;
  selectedTagText: string | null;
  candidateTagTexts: readonly string[];
  failures: readonly { threadId: string; reason: string; message: string }[];
}

interface NoteSidebarTagsUiState {
  mode: "list" | "tags" | "thought-trail";
  searchQuery: string;
  searchInputValue: string;
  selectedThreadIds: readonly string[];
  visibleTagFilterKey: string | null;
  batchTagFlow: BatchTagFlowState;
}
```

Rules:

- Keep `extractTagsFromText` and `normalizeTagText` from existing utilities.
- For each active-file thread: `filePath` is authoritative for scope.
- Tag matching uses normalized key (`toLowerCase`, strip leading `#`).

## Transition checklist (must-do behavior)

1. File open
   - active file changes -> rebuild local tag index for that file.
   - clear selected IDs, batch panel, failures, and tag filter.

2. Mode changes
   - `list`, `tags`, `thought-trail`.
   - switching mode should respect existing draft-save guard.
   - search should not auto-switch mode when already in `tags`.

3. Search
   - existing debounce behavior.
   - results are filtered within active-file scope.
   - supports normal and tags mode.

4. Tag filter in `Tags` mode
   - selecting a tag filter narrows visible results.
   - `null` filter means all tags in file.

5. Batch selection
   - result checkboxes/toggles only affect active file results.
   - if selection becomes empty, close batch panel + clear query.

6. Batch apply flow
   - open panel only when selection non-empty.
   - typing shows local matches first.
   - if no exact local match, allow create option.
   - on confirm: append normalized tag to each selected thread (no replace).
   - duplicates suppressed by normalized key.
   - if a thread fails, keep others applied.

7. Cancel
   - closes panel.
   - keeps selection for quick retry.

8. Invariants
   - mutate only active-file thread IDs.
   - if thread disappears during mutation, report it as failure and continue.
   - duplicate tag text is normalized before append.

## Rendering checklist

- Show mode tabs for file sidebars: `List`, `Tags`, `Thought Trail`.
- `Tags` tab not shown in index-sidebar surface.
- `Tags` mode shows:
  - tag chips/filter
  - local search
  - selectable results
  - batch apply controls
- `Thought Trail` mode keeps existing behavior; no local tag batch actions.
- Empty states cover: no matches, no results for tag filter, no selection for batch.

## Acceptance

- `List | Tags | Thought Trail` appears on normal markdown file sidebars.
- Tag creation/search in batch flow works in one input.
- Batch apply is append-only and local-file only.
- No cross-file tag mutation.
- Existing users without tags see unchanged behavior.

## Tests required

1. Normalization + local extraction for tags.
2. `SidebarPrimaryMode` accepts and persists `tags`.
3. Filter + search + batch across 1+ selected items.
4. Create-on-miss option in batch input.
5. Partial mutation: some succeed, some fail, no rollback.
6. No side effects outside active file.
