# Index Sidebar Bounded Global Search Performance Design

## Goal

Make unscoped index-sidebar search feel as responsive as individual-file sidebar search without weakening match accuracy. Global search keeps the existing exact matcher, returns the true highest-ranked 100 matches, and updates cards through the same incremental reconciliation boundary used by the individual-file sidebar.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Note and index search use the same exact, case-insensitive thread scorer.
- [x] Both search inputs use the same 120 ms debounce and shared toolbar input renderer.
- [x] Individual-file sidebar cards already use keyed render signatures and incremental reconciliation.
- [x] Unscoped index List rendering already has a 100-card window when no search is active.
- [x] A synthetic benchmark on 2026-08-09 measured the existing exact scorer at a 9.4 ms median and 16.8 ms p95 for 10,000 three-entry threads; card rendering, not scoring, is the observed bottleneck.

### To Implement

- [x] Add an exact bounded-ranking result that returns the stable top 100 matching threads and the total match count without retaining or sorting every match.
- [x] Apply the bounded result only to nonempty, unscoped index List searches; retain full exact results when a file filter is selected and retain current individual-file search behavior.
- [x] Extract the keyed sidebar-item reconciler into one shared owner and consume it from both individual-file and index card-list rendering.
- [x] Keep an index card-list shell mounted across search updates so unchanged cards are reused instead of clearing and rebuilding the entire index container.
- [x] Stop superseded index searches before they commit stale card or highlight results.
- [x] Show a search-specific notice when more than 100 global matches exist: `100 of N matches shown. Refine your search or select a file.`
- [x] Preserve the current exact matching, score priorities, stable tie behavior, file scope, pinned/group filters, nested-entry reveal behavior, highlighting, empty states, and card actions.
- [x] Do not add fuzzy, typo-tolerant, semantic, or approximate matching.
- [x] Evaluate the fallback after installed performance acceptance. It was not invoked because the installed broad and narrow searches settled without a visible typing stall.

### Verification

- [x] Fail-first tests prove bounded global results equal the first 100 items from the existing complete exact ranking and report the complete match count.
- [x] Tests cover fewer than 100 matches, more than 100 matches, stable score ties, empty queries, file-scoped queries, and exact nested-entry matches.
- [x] Reconciler tests prove unchanged keyed cards retain object identity, removed cards are detached, moved cards are reordered, and only new or signature-changed cards invoke Markdown-card rendering.
- [x] Index wiring tests prove nonempty unscoped search renders at most 100 cards while file-scoped and individual-file search remain unbounded by the global window.
- [x] Cancellation tests prove an obsolete search cannot overwrite the latest result order or highlights.
- [x] The focused exact-ranking benchmark remains within a 25 ms median for 10,000 representative threads on the development machine.
- [x] The complete test, lint, typecheck, Obsidian-compliance, production-bundle, and release-artifact guard pipeline passes.
- [x] The verified build is installed and smoke-tested with blank, broad, narrow, nested-entry, Escape-clear, and file-scoped queries without a visible typing stall.

### Verification Evidence

- Bounded exact ranking over 10,000 three-entry threads retained 100 of 10,000 matches with a 9.65 ms median and 16.90 ms p95 across 20 warmed iterations.
- The complete build passed 1,101 TypeScript tests and 82 JavaScript/policy tests, followed by lint, typecheck, Obsidian compliance, production bundling, and the release-artifact guard.
- The installed `lean-startup` vault contained 446 indexed threads. Global query `a` rendered 100 of 353 matches in 92.9 ms after debounce and reused 58 mounted result nodes; follow-up query `an` rendered 100 of 237 matches in 89.2 ms and restored input focus and caret.
- A file-scoped query rendered all 34 of 34 exact matches without a result-window notice. A child-entry-only query rendered its parent plus the matching child, and Escape restored the blank 100-card index window.
- The installed `main.js`, `manifest.json`, and `styles.css` exactly matched the verified build. No source map, source-map marker, embedded source content, local path, private-key marker, or obvious secret pattern was present in the shipped assets.

## Current Problem

The matcher is already fast enough for a large aggregate. The expensive difference appears after matching:

1. Individual-file rendering keeps a stable shell and reconciles keyed cards. A search commonly removes or moves existing DOM nodes and renders only newly visible or structurally changed cards.
2. Index rendering calls `containerEl.empty()` and rebuilds the toolbar, result list, and every visible Markdown card.
3. A nonempty index search currently disables the ordinary 100-card list limit. A broad query can therefore start hundreds or thousands of asynchronous Markdown renders.
4. Request-version checks protect focus restoration, but a superseded render may already have performed expensive detached-DOM work before the check runs.

The fix therefore keeps exact scoring and removes unbounded, repeated presentation work.

## Product Behavior

### Unscoped index List

The search field remains visible when no file filter is selected. After the existing debounce, Aside evaluates every eligible indexed thread with the existing exact scorer and retains the true top 100 by score. Equal scores retain their original input order.

If at most 100 threads match, all matches are shown. If more than 100 match, the result list shows the top 100 and adds:

> 100 of N matches shown. Refine your search or select a file.

The count reflects the current visibility, pinned, and List-mode filters. It does not include threads excluded before search.

### File-scoped index List

Selecting a file remains the first scoping operation. Search then evaluates only that file's eligible threads and returns every exact match, just like individual-file search. The global 100-result window and its notice are not applied.

### Empty query and other modes

An empty unscoped List query keeps the current ordinary 100-card list window and existing `Use files to filter the index to see more` guidance. Todo, Agent, Tags, and Thought Trail behavior remains unchanged. Leaving List continues to clear the transient index query.

### Accuracy

No fuzzy matching is introduced. Exact phrase, prefix, substring, ordered-term, unordered-term, selected-text, entry-recency, and stable-tie rules remain owned by the existing sidebar search scorer. The bounded collector changes only how many already-scored matches are retained for rendering.

## Architecture

### Exact bounded ranking

`sidebarContentFilter.ts` remains the single search-policy owner. It gains a bounded result API alongside the existing complete-ranking wrapper. The result contains:

- ranked items;
- total matching count;
- hidden matching count.

For a finite limit, the collector scans every thread exactly once, increments the total for every positive score, and maintains a score-ordered collection no larger than the requested limit. Its comparison is the current comparison: higher score first, then lower original index. This produces the same first 100 items as complete ranking without retaining or sorting the full match set.

The individual-file caller continues using complete ranking. The index adapter requests a limit only when all of these are true:

- the surface is the generated index;
- the effective mode is List;
- the query is nonempty;
- no file-filter root is selected.

### Shared reconciliation

Move the generic descriptor and keyed reconciliation logic out of its note-specific naming into a focused shared module. A descriptor continues to provide a stable key, render signature, optional thread id, and lazy asynchronous render callback.

The shared reconciler:

1. indexes existing card elements by key;
2. reuses a card when key and signature match;
3. renders only new or signature-changed cards;
4. removes obsolete cards and streamed-reply controllers through an adapter callback;
5. moves retained nodes into the requested order;
6. checks that the render request is still current before committing asynchronous output.

The note and index paths provide surface-specific descriptors, card capabilities, ordering, and cleanup callbacks. They do not carry separate copies of reconciliation behavior.

### Mounted index shell

Index List, Todo, and Agent use a stable card-list shell with slots for the toolbar, active file-filter summary, comments body, limit notice, and support action. A search refresh may replace small toolbar or notice contents, but it does not empty the comments body or root container.

Thought Trail remains a distinct renderer and may replace the card-list shell when entering or leaving that mode. File changes and view teardown also discard the shell.

### Search cancellation

The existing request version remains the authority for input requests, and `renderVersion` remains the authority for view renders. The index adapter passes a current-request predicate into reconciliation. If a newer query or view render supersedes the current one, remaining lazy card renders stop and no obsolete node order, highlight pass, or focus restoration is committed.

## Change-Surface Ownership

- **Search policy source of truth:** `src/ui/views/sidebarContentFilter.ts`.
- **Shared DOM reconciliation source of truth:** a focused sidebar-item reconciler module extracted from `AsideView`.
- **Individual-file adapter:** prepares note descriptors and complete search results.
- **Index adapter:** chooses global bounded versus file-scoped complete results and prepares index descriptors.
- **Presentation adapter:** renders the ordinary list-limit notice or the global-search result notice.
- **Tests:** directly verify both shared owners plus representative note and index wiring.

No second exact scorer, duplicated top-100 rule, or index-specific reconciler is added.

## Performance Acceptance

Performance is verified at two levels:

1. A deterministic benchmark measures exact bounded ranking over 10,000 representative threads after warm-up. The target is a median no higher than 25 ms on the development machine.
2. An installed Obsidian smoke check types broad and narrow queries slowly enough to cross the 120 ms debounce between characters. The input must retain focus, the latest query must win, unchanged cards must not visibly flash, and results must settle without a visible typing stall.

The benchmark is diagnostic rather than a cross-platform CI timing assertion. Automated regression tests instead enforce bounded retained results and bounded card-render calls, which are deterministic proxies for the expensive work.

If the installed check fails despite bounded rendering and reconciliation, global unscoped search will not ship. The capability planner will hide the search input without a selected file and show guidance to select a file; file-scoped exact search will remain available.

## Testing Strategy

Development follows red-green-refactor:

1. Add fail-first bounded-ranking equivalence and count tests.
2. Implement the smallest bounded exact result API and keep complete ranking green.
3. Add fail-first shared reconciler identity and lazy-render tests.
4. Extract reconciliation without changing note behavior.
5. Add fail-first index wiring tests for the 100-card boundary, notice, and scoped exception.
6. Introduce the mounted index shell and current-request guard.
7. Run focused tests, the deterministic benchmark, the complete build, and installed smoke checks.

Search highlighting tests continue to use the exact query. Nested-entry tests continue to prove that a match renders its parent thread and reveals the complete matching thread under the existing search policy.

## Out of Scope

- Fuzzy or typo-tolerant matching.
- Semantic or embedding-based search.
- Persisted search history or query state.
- Virtual scrolling beyond the bounded top-100 global window.
- Changes to scoring weights or exact match semantics.
- Search fields in Todo, Agent, Tags, or Thought Trail.
- Changes to canonical thread storage, aggregate sync, or generated index-note content.
