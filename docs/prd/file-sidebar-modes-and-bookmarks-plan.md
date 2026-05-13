# File Sidebar Modes And Bookmarks Plan

Implementation spec for the first shipped slice:

- [bookmark-and-sidebar-filters-spec.md](bookmark-and-sidebar-filters-spec.md)
- [file-sidebar-thought-trail-spec.md](file-sidebar-thought-trail-spec.md)

## Goal

Extend the normal per-file sidebar so it can support richer modes, not only the current thread list, while also introducing a lightweight "bookmark" or "idea" capture flow for selected text.

This plan covers two related product questions:

1. Should individual file sidebars get top tabs like the index sidebar:
   `List`, `Thought Trail`, and `Agent`?
2. Should Aside support a bookmark-style capture for selected text, rendered more like a saved highlight or idea marker than a full written side note?

The goal is to improve discovery and review without making ordinary file sidebars feel heavy, slow, or over-designed.

## Current System

Current rendering already separates index sidebars from normal file sidebars:

- normal file sidebars load the current file and render the file-local thread list in [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts:340)
- file-local rendering goes through `renderPageSidebar(...)` in [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts:672)
- index-only tabs are rendered in `renderIndexModeControl(...)` in [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts:1310)
- the current Thought Trail view is index-scoped and built from cross-file comment links in [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts:1814) and [src/core/derived/thoughtTrail.ts](../../src/core/derived/thoughtTrail.ts:303)
- the current Agent sidebar planner filters threads that have agent runs in [src/ui/views/agentSidebarPlanner.ts](../../src/ui/views/agentSidebarPlanner.ts:15)

Current draft saving also assumes a saved side note has non-empty text:

- empty draft bodies are rejected in [src/comments/commentMutationController.ts](../../src/comments/commentMutationController.ts:81)

That matters for bookmark capture, because an icon-only or empty-body bookmark does not fit the current persistence rules.

## Product Assessment

### File-Level Modes

Adding modes to the normal file sidebar is reasonable, but the three candidate modes are not equally strong.

#### `List`

This is already the default and should remain the default.

Reason:

- it is the most common mode
- it matches current user expectations
- it preserves the current lightweight feel for normal files

#### `Agent`

This is worth adding to normal file sidebars.

Reason:

- the data is already file-local once comments for that file are loaded
- the planner is already simple: keep only threads with a latest agent run
- this is likely useful for users who want to review agent interactions in the current note without leaving the file

Expected UX:

- `List | Agent` at the top of the normal file sidebar
- `Agent` shows only threads in the current file with agent history
- empty state should be explicit and calm:
  "No agent threads for this file yet."

Revised near-term note:

- for normal file sidebars, a top-toolbar `bot` filter inside the existing list may be a better first move than a dedicated `Agent` tab
- that keeps the sidebar lighter and aligns better with the bookmark filter direction below

#### `Thought Trail`

This gets much stronger once it is framed as contextual graph navigation from the current file, not just "another mode."

The core user need is:

- start from the current note
- see the connected note neighborhood around it
- move up to broader context, down to more specific notes, and sideways to related neighbors
- keep the whole picture in view while traversing

That is meaningfully different from Obsidian's default related-file patterns, which are usually one level deep and flat.

The current Thought Trail is fundamentally cross-file. It builds a graph from wiki links mentioned inside comments and renders connected note nodes. That already points toward a graph-navigation product, not just a filtered list.

For a normal file sidebar, there are still two possible implementations:

1. local outgoing trail
   Show only links mentioned by side notes in the current file.
2. rooted connected graph
   Start from the current file and show the connected note neighborhood so users can traverse outward in multiple directions.

The second meaning is the stronger one and better matches the reason for the feature. The first may be too weak to justify a dedicated mode.

Recommendation:

- do not ship file-level `Thought Trail` in the first pass
- add file-level `Agent` first
- if file-level `Thought Trail` is revisited, treat it as a rooted connected graph around the current file, not just a compact local-outgoing preview

If shipped too early, the risk is less "bad idea" and more "good idea with fuzzy framing." It can sound like a clever alternate view instead of an immediately useful way to see and traverse the connected note neighborhood around the current file.

## Performance Assessment

### File-Level `Agent`

Performance risk is low.

Reason:

- normal file sidebars already load the file's comments before rendering
- filtering those loaded threads to agent-backed threads is cheap
- no cross-file graph build is required

This should feel effectively instant for normal note sizes.

### File-Level `Thought Trail`

Performance risk is still manageable, but it depends on scope.

If the mode is local-outgoing-only:

- risk is low to medium
- the work is mostly parsing already loaded thread bodies and rendering a small Mermaid graph
- this is cheaper, but it likely undershoots the main user value

If the mode is rooted connected graph:

- risk is medium
- it starts pushing the normal file sidebar toward index-style aggregate behavior
- the expensive-feeling part is more likely the Mermaid render and graph expansion than raw thread filtering
- this is also the more compelling product direction, because it supports actual neighborhood traversal around the current file

The main concern is not absolute runtime alone. It is whether opening a normal note sidebar starts to feel like it is doing index-grade work.

### UX Performance Concern

The larger risk is perceived performance and mode overhead:

- more tabs in a normal file sidebar increase cognitive load
- empty modes can make the sidebar feel sparse or unfinished
- remembering the wrong last-used mode can make ordinary note browsing feel off

## Recommendation

Ship this in two stages.

### Stage 1

Keep the normal file sidebar in `List` mode and add top-toolbar quick filters:

- `lightbulb` for bookmarks
- `bot` for agent threads

Keep:

- default mode = `List`
- current file scope only
- no file-level Thought Trail yet
- no dedicated file-level `Agent` tab in the first pass

This gives a meaningful gain with low implementation and UX risk.

### Stage 2

Explore file-level `Thought Trail` only after the rooted-graph interaction is clear:

- how far the graph expands by default
- how users traverse or refocus it
- how to keep it legible in a narrow sidebar

Do not add it just for tab symmetry with the index, and do not reduce it to a weak one-hop preview if the real goal is neighborhood traversal.

## Bookmark / Idea Capture

## Problem

There is a valid use case for saving selected text without wanting a full written side note.

Examples:

- "this passage matters"
- "come back to this later"
- "this is an idea seed"
- "this should surface in review filters"

That is close to a bookmark, highlight, or idea marker.

## Current Constraint

Today Aside treats saved content as a normal side note thread with text content. Empty bodies are rejected at save time in [src/comments/commentMutationController.ts](../../src/comments/commentMutationController.ts:81).

That means a pure icon-only bookmark does not fit cleanly right now.

## Model Options

### Option A: Tag-Based Prototype

Use a reserved semantic tag, for example:

- `#idea`
- `#bookmark`

and render it specially in the UI.

Pros:

- lowest schema risk
- can piggyback on existing comment text, tag extraction, and index filtering
- fastest way to test whether users actually use the feature

Cons:

- type is implicit, not explicit
- body text remains overloaded with system meaning
- future UI branching becomes harder
- emoji-only or magic-text conventions are brittle

### Option B: Explicit Thread Kind

Add a first-class field on the stored thread model, for example:

- `kind: "note" | "bookmark"`

Bookmarks would still be side notes structurally, but the UI and filtering could treat them differently.

Pros:

- clean semantics
- better filtering
- better future extensibility
- avoids encoding product meaning in comment body text

Cons:

- requires schema and migration thought
- touches storage, rendering, creation flows, and derived index output

## Recommendation

Prefer Option B if this feature is expected to last.

Reason:

- bookmark capture feels like a real product concept, not just a cosmetic variation
- users will likely want filtering, distinct rendering, and possibly different default actions later
- the current model already has enough complexity that adding another hidden text convention would age poorly

Do not model bookmarks as:

- literal `💡` body text
- empty comment bodies
- magic text that the renderer silently interprets

That is acceptable only for a throwaway prototype, not for a product feature that should be reliable and queryable.

## Closed Product Decisions

The bookmark product decision should now be treated as closed enough to drive a follow-up implementation spec.

### Bookmark Model

Bookmarks should be a first-class thread kind:

- `kind: "note" | "bookmark"`

They should not be inferred from:

- literal emoji body text
- reserved filler text
- empty comment bodies

### Toolbar Filters

The top sidebar toolbar should gain two new Obsidian-style icon filters:

- `lightbulb` for bookmarks
- `bot` for agent threads

Placement:

- both should sit to the left of the current resolved `check` icon

Recommended left-to-right order:

- `lightbulb`
- `bot`
- `check`

This keeps bookmark and agent filtering close to the existing resolved filter instead of introducing a separate control pattern.

### Filter Semantics

The sidebar should use one primary content filter dimension plus the existing resolved dimension.

Recommended model:

- `contentFilter: "all" | "bookmarks" | "agents"`
- `showResolvedOnly: boolean`

Rules:

- `lightbulb` and `bot` are mutually exclusive
- clicking an inactive icon activates that content filter
- clicking the active icon clears it back to `all`
- `check` remains independent and can combine with any content filter

Examples:

- no icon active: all active threads
- `lightbulb` active: bookmark threads only
- `bot` active: agent threads only
- `lightbulb` + `check`: resolved bookmark threads only
- `bot` + `check`: resolved agent threads only

### Agent Filter Meaning

The `bot` filter should be derived from existing agent-run state, not modeled as a new stored thread kind.

That means:

- bookmarks are explicit persisted type
- agent threads are derived behavior

This is the cleaner split.

### Obsidian Style Requirement

These controls should use the same visual language as the rest of the toolbar:

- Obsidian/Lucide icons, not literal emoji glyphs in the toolbar chrome
- existing icon-button treatment
- existing hover, active, and disabled states
- no custom chip-heavy treatment in the first version

So even if the product idea is "💡 bookmarks," the toolbar control should render as an Obsidian-style `lightbulb` icon button, not a raw emoji.

## Recommended Bookmark UX

Bookmarks should still behave like Aside threads:

- anchored to a text selection or page
- stored in the same note-backed comment block
- visible in the sidebar and index

But they should differ in presentation:

- lighter card chrome
- compact icon-forward representation
- optional text instead of required longer note text
- visible bookmark affordance using the same lightbulb icon family

Suggested user-facing language:

- `Bookmark`
- or `Idea`

`Idea` fits the lightbulb concept better than `Bookmark`, but `Bookmark` is clearer as a generic action.

## Filtering

If bookmarks ship, the index and sidebar should support a simple icon-based filter model.

Recommended first filter shape:

- `contentFilter: all | bookmarks | agents`
- resolved as an independent existing filter
- toolbar icons instead of text chips

This is more durable than filtering by emoji or reserved tag, and more consistent with the current toolbar direction.

## Proposed Rollout

### Phase 1: File Sidebar Modes

Ship:

- normal file `List` mode with top-toolbar `lightbulb` and `bot` filters

Do not ship:

- dedicated file-level `Agent` tab
- file-level `Thought Trail`
- bookmark capture

Success criteria:

- the new toolbar filters feel instant
- the default `List` flow remains unchanged and lightweight
- the added toolbar controls do not create noisy empty-state clutter

### Phase 2: Bookmark Product Decision

Closed decisions from this phase:

- bookmarks should be a first-class thread kind
- the sidebar should add `lightbulb` and `bot` icon filters
- those filters should use Obsidian-style icon buttons
- `lightbulb` and `bot` should be mutually exclusive and sit to the left of resolved
- bookmark text may be optional, but bookmark kind must be explicit

Expected output of this phase:

- a dedicated bookmark spec, likely with storage implications

### Phase 3: Bookmark Implementation

If Phase 2 confirms demand:

- add explicit thread kind support
- add creation entrypoint from selected text
- add sidebar and index kind filters
- add lighter bookmark rendering

### Phase 4: Revisit File-Level Thought Trail

Only after the above settles:

- define the rooted-graph interaction clearly
- test whether users actually want graph context in single-note mode

## Open Questions

1. Should file-level mode selection be remembered globally, per note, or not remembered at all?
2. If the `bot` filter is empty for the current file, should the icon still be shown disabled or should it hide entirely?
3. Should bookmark capture require any text at creation time, or allow pure capture with optional later annotation?
4. Should bookmarks be visible in the same list by default, or only when filtered in?
5. If file-level Thought Trail is added later, what default depth or expansion limit keeps the rooted connected graph useful without overwhelming the sidebar?

## Final Recommendation

Worth adding now:

- bookmark and agent quick filters in the existing top toolbar
- explicit bookmark thread kind planning

Worth planning but not shipping yet:

- file-level `Thought Trail` as a rooted connected graph around the current note
- actual bookmark capture flow and card treatment
- any dedicated file-level `Agent` tab

Not recommended:

- shipping all three file-level tabs immediately just for symmetry
- modeling bookmarks as a literal `💡` comment body
- relying on hidden text conventions instead of explicit bookmark semantics
