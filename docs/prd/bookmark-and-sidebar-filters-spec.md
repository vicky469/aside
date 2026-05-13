# Bookmark And Sidebar Filters Spec

## Status

Draft implementation spec based on:

- [file-sidebar-modes-and-bookmarks-plan.md](file-sidebar-modes-and-bookmarks-plan.md)

## Objective

Implement the first shipped slice of bookmark support and normal-file sidebar filtering:

- add a first-class bookmark thread kind
- add Obsidian-style `lightbulb` and `bot` toolbar filters to the normal file sidebar
- keep resolved filtering independent
- keep the normal file sidebar in list mode for this phase

This spec intentionally does not include the full bookmark creation flow yet.

## Scope

In scope:

- canonical thread kind model for stored threads
- read/write storage support for bookmark threads
- in-memory thread and comment shape updates
- normal file sidebar toolbar filter state
- normal file sidebar filter behavior for:
  - all threads
  - bookmark threads
  - agent threads
- Obsidian-style toolbar icon placement and behavior
- render-signature updates required for rerender correctness
- tests for storage, filtering, and toolbar-state logic

Out of scope:

- bookmark creation entrypoint from selected text
- bookmark-specific card visual redesign beyond minimal class plumbing
- index sidebar bookmark filtering
- file-level `Agent` tab
- file-level `Thought Trail`
- migrations of existing threads into bookmarks

## Product Rules

### Rule 1: Bookmark Is A First-Class Thread Kind

Bookmarks must be modeled explicitly on the thread.

Required thread kind set:

- `note`
- `bookmark`

Existing stored threads that do not declare a kind must normalize to:

- `note`

### Rule 2: Agent Is A Derived Filter, Not A Thread Kind

Agent filtering must continue to derive from existing agent-run state.

It must not introduce:

- `kind: "agent"`

### Rule 3: Normal File Sidebar Stays In List Mode

The first implementation slice must keep the current file sidebar in the existing list layout.

The new behavior is:

- add icon filters to the top toolbar
- do not add a dedicated `Agent` tab yet

### Rule 4: Content Filter And Resolved Filter Are Separate Axes

The sidebar must support:

- one content filter
- one resolved-only filter

Content filter options:

- `all`
- `bookmarks`
- `agents`

Resolved filter options:

- active only
- resolved only

### Rule 5: Bookmark And Agent Filters Are Mutually Exclusive

The `lightbulb` and `bot` toolbar icons represent the content filter axis.

Therefore:

- activating `lightbulb` sets `contentFilter = "bookmarks"`
- activating `bot` sets `contentFilter = "agents"`
- clicking the active icon clears back to `contentFilter = "all"`
- only one of those icons may be active at a time

### Rule 6: Resolved Filter Remains Independent

The `check` toolbar icon keeps existing meaning:

- off = active threads
- on = resolved-only threads

It must combine with the content filter.

Examples:

- `all` + active only
- `bookmarks` + active only
- `agents` + active only
- `bookmarks` + resolved only
- `agents` + resolved only

## Canonical Data Model

### Thread Model

Extend the canonical `CommentThread` shape:

```ts
type CommentThreadKind = "note" | "bookmark";

interface CommentThread {
  id: string;
  filePath: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  selectedText: string;
  selectedTextHash: string;
  anchorKind?: "selection" | "page";
  kind?: CommentThreadKind;
  orphaned?: boolean;
  resolved?: boolean;
  deletedAt?: number;
  entries: CommentThreadEntry[];
  createdAt: number;
  updatedAt: number;
}
```

Normalization rule:

- missing or invalid `kind` becomes `note`

### Comment Projection Model

Projected `Comment` values derived from a thread must also carry the thread kind:

```ts
interface Comment {
  ...
  kind?: CommentThreadKind;
}
```

This keeps sidebar rendering and future bookmark creation/edit flows aligned.

## Storage Model

### Stored Thread Shape

Extend the managed JSON thread payload with:

```ts
kind?: "bookmark";
```

Storage rule:

- omit `kind` when it is `note`
- persist `kind: "bookmark"` when the thread is a bookmark

This keeps note threads compact and backward-compatible.

### Compatibility

Existing stored threads without `kind` must read as:

- `note`

No migration rewrite is required just to add the new field.

## Sidebar State Model

### Normal File Sidebar Filter State

Add a view-local filter state for the current sidebar instance:

```ts
type SidebarContentFilter = "all" | "bookmarks" | "agents";
```

Recommended first implementation:

- keep it in `AsideView`
- do not persist it in `CustomViewState` yet

Reason:

- this slice is normal-file-sidebar only
- view-local state is enough to validate the product direction
- it avoids unnecessary persistence churn while the model is still settling

## Rendering Rules

### Toolbar Placement

The normal file sidebar toolbar must render the filters in this left-to-right order:

1. `lightbulb`
2. `bot`
3. `check`

These icons must sit in the existing toolbar group, using the same Obsidian-style icon button treatment as other sidebar toolbar actions.

### Toolbar Icon Behavior

#### `lightbulb`

- active when `contentFilter === "bookmarks"`
- click toggles between:
  - `bookmarks`
  - `all`

#### `bot`

- active when `contentFilter === "agents"`
- click toggles between:
  - `agents`
  - `all`

#### `check`

- keeps current resolved-only toggle behavior

### Disabled State

Recommended first behavior:

- if there are zero bookmark threads in the current normal-file sidebar and `lightbulb` is inactive, show it disabled
- if there are zero agent threads in the current normal-file sidebar and `bot` is inactive, show it disabled

Do not hide the icons entirely in this phase.

Reason:

- stable toolbar layout
- clearer discoverability
- consistent with the user’s requested icon placement

## Filtering Rules

### Bookmark Filter

Bookmark filter membership for a thread:

- include only threads where `thread.kind === "bookmark"`

### Agent Filter

Agent filter membership for a thread:

- include only threads that have at least one agent run in their thread scope

Recommended source:

- existing `getLatestAgentRunForCommentThread(...)`
- or equivalent derived boolean helper

### Combined Visibility

Normal file sidebar thread visibility should be computed in this order:

1. start from file-local threads already loaded for the current file
2. apply deleted visibility rules as today
3. apply resolved visibility rules as today
4. apply the content filter:
   - `all`
   - `bookmarks`
   - `agents`

Draft behavior in this phase:

- no special bookmark draft creation is required
- existing drafts should continue to behave as normal note drafts unless later work explicitly adds bookmark-draft support

## Render Signature Rules

Any thread rerender signature used by the normal file sidebar must include:

- thread `kind`
- current sidebar content filter, if it affects the rendered list

This prevents stale DOM reuse when:

- bookmark status changes
- content filter changes

## CSS / Style Rules

Toolbar controls must use existing Obsidian-style icon buttons:

- existing `clickable-icon` treatment
- existing hover and active color behavior
- no raw emoji glyphs in toolbar chrome
- no new heavy chip treatment for this phase

If bookmark cards later receive a distinct visual treatment, that should be additive and scoped to cards, not to the toolbar control language.

## Module Ownership

### `src/commentManager.ts`

Owns:

- canonical `CommentThreadKind`
- thread normalization to default `note`
- projection of thread kind into projected `Comment`

### `src/core/storage/noteCommentStorage.ts`

Owns:

- reading optional stored bookmark kind
- writing bookmark kind only when non-default
- compatibility behavior for old threads without `kind`

### `src/ui/views/AsideView.ts`

Owns:

- normal file sidebar content-filter state
- toolbar button rendering for `lightbulb` and `bot`
- thread list filtering integration

### New Pure Helper

Recommended file:

- `src/ui/views/sidebarContentFilter.ts`

Owns:

- filter type definition
- thread-matching rules for:
  - bookmarks
  - agents
  - all
- count helpers for toolbar disabled-state decisions

This should be pure and easy to test.

## Test Requirements

Add or update tests for:

1. storage round-trip preserves bookmark kind
2. missing kind normalizes to `note`
3. projected comment from a bookmark thread keeps bookmark kind
4. content filter helper matches bookmark threads correctly
5. content filter helper matches agent threads correctly
6. normal file sidebar render signature changes when thread kind changes
7. toolbar-state logic exposes disabled bookmark and bot icons when no matching threads exist

## Acceptance Criteria

This slice is successful when:

1. the repo has a concrete bookmark/filter spec
2. stored threads can represent bookmark kind without breaking existing notes
3. the normal file sidebar shows Obsidian-style `lightbulb` and `bot` icon filters to the left of resolved
4. those icons filter the visible thread list correctly
5. resolved filtering still works independently
6. existing notes without bookmark metadata continue to behave as normal note threads

## Non-Goals

Not part of this implementation slice:

- a user-facing bookmark creation button
- bookmark editing UX differences
- bookmark index-note rendering differences
- index sidebar bookmark filtering
- a file-level `Agent` tab
- a file-level `Thought Trail` mode
