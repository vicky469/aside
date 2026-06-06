# Global Unresolved Todo Index Design

## Context

Sidebar Todo mode is currently derived by scanning thread bodies for `@todo` during sidebar rendering. The current helper lives in `src/ui/views/sidebarThreadGroups.ts`:

- `threadMatchesSidebarGroup(thread, "todo")` joins all thread entry bodies and tests `/@todo\b/iu`.
- `getSidebarThreadGroupCounts(...)` scans the current thread list and counts Todo and Agent groups.
- In the generated index sidebar, group counts currently come from the current scoped index thread list.

That works for local note sidebars, where the thread set is small. It is less appropriate for global unresolved Todo in `Aside index.md`, because the index view should know whether global Todo exists without repeatedly scanning all indexed comments during render.

## Goals

- Track global unresolved Todo threads efficiently.
- Keep comment threads as the source of truth. Todo state remains derived, not stored.
- Make generated index Todo global, independent of the selected Files root/filter.
- Count global unresolved Todo in near O(1) after the aggregate index is built.
- Rebuild the Todo index only when aggregate comment data changes.
- Keep local note Todo behavior compatible with the current sidebar model.

## Non-Goals

- Do not add a new Todo syntax in this slice.
- Do not parse Markdown task checkboxes.
- Do not persist Todo state in plugin data, notes, sidecars, or generated index content.
- Do not include unsaved drafts in the global Todo index.
- Do not redesign Todo cards or introduce a separate Todo storage model.

## Vocabulary

- **Todo thread**: A visible comment thread where any visible entry body contains `@todo` using the existing case-insensitive word-boundary match.
- **Unresolved Todo thread**: A Todo thread whose thread-level `resolved` flag is not `true`.
- **Global Todo scope**: All indexed visible comment threads across the vault, excluding soft-deleted threads and soft-deleted entries.
- **Local Todo scope**: The current source note sidebar's current visible thread set.
- **Aggregate version**: `AggregateCommentIndex.getVersion()`, incremented when indexed comment data changes.

## Data Model

Add a derived index shape:

```ts
export interface GlobalTodoIndex {
    version: number;
    unresolvedTodoThreadIds: Set<string>;
    unresolvedTodoThreadIdsByFilePath: Map<string, Set<string>>;
}
```

The index does not need to store full thread clones. Consumers can use thread ids to filter the current aggregate thread list, preserving existing rendering and sorting behavior.

## Source Of Truth

The source of truth remains `AggregateCommentIndex` plus stored comment threads.

`AggregateCommentIndex.getAllThreads()` already returns visible clones and filters soft-deleted threads and entries. The global Todo index should build from that visible aggregate output so it does not duplicate deletion visibility rules.

Resolved threads are excluded from the global Todo index even if they contain `@todo`. The global Todo tab represents pending work.

## Placement

Create a small derived module, for example:

```text
src/core/derived/globalTodoIndex.ts
```

This keeps Todo derivation outside the UI renderer while avoiding persistence or storage coupling.

The module should expose pure helpers:

```ts
export function threadHasTodoMention(thread: Pick<CommentThread, "entries">): boolean;
export function buildGlobalTodoIndex(
    threads: readonly CommentThread[],
    version: number,
): GlobalTodoIndex;
```

`sidebarThreadGroups.ts` should reuse `threadHasTodoMention(...)` so local and global Todo use one vocabulary.

## Cache Strategy

Cache the global Todo index by aggregate version.

Recommended view/plugin-side shape:

```ts
private globalTodoIndexCache: GlobalTodoIndex | null = null;

private getGlobalTodoIndex(): GlobalTodoIndex {
    const version = this.plugin.getAggregateCommentIndexVersion();
    if (!this.globalTodoIndexCache || this.globalTodoIndexCache.version !== version) {
        this.globalTodoIndexCache = buildGlobalTodoIndex(
            this.plugin.getAllIndexedThreads(),
            version,
        );
    }
    return this.globalTodoIndexCache;
}
```

If multiple sidebar views need the same cache, move ownership to the plugin facade instead of duplicating the cache per view. The public API can stay small:

```ts
public getAggregateCommentIndexVersion(): number;
public getGlobalTodoIndex(): GlobalTodoIndex;
```

## Index Sidebar Behavior

In `Aside index.md`, Todo is global:

- Todo tab availability uses `globalTodoIndex.unresolvedTodoThreadIds.size > 0`.
- Todo tab list ignores the selected Files root/filter.
- Todo tab list ignores resolved threads.
- Todo tab list still respects sidebar search text.
- Todo tab list uses existing card rendering and sorting.
- Agent remains local to the current index scope.

This aligns with the tab grouping:

```text
List Agent | Todo Thought Trail
```

`List` and `Agent` remain local. `Todo` and `Thought Trail` are global.

## Normal Note Sidebar Behavior

In an individual source note sidebar, Todo remains local:

```text
List Tags Todo Agent | Thought Trail
```

The local Todo tab can continue using the current thread-group filtering over the current note's visible thread set. It may optionally reuse `GlobalTodoIndex.unresolvedTodoThreadIdsByFilePath.get(file.path)` for counts, but that is not required for this slice.

## Data Flow

1. Comment storage, migration, rename, delete, and mutation flows update `AggregateCommentIndex`.
2. `AggregateCommentIndex` increments its version when indexed data changes.
3. The sidebar asks for the global Todo index.
4. The cache returns the existing index when the aggregate version matches.
5. If the version changed, the cache rebuilds from `getAllIndexedThreads()`.
6. `Aside index.md` uses the global Todo index for Todo tab availability and Todo filtering.

## Performance

Current render-time global scanning is O(n * body text length) per render.

The target model is:

- O(n * body text length) only when aggregate comment data changes.
- O(1) for global unresolved Todo count.
- O(k) to render k unresolved Todo threads.
- O(1) to answer whether a file has unresolved Todo threads through `unresolvedTodoThreadIdsByFilePath`.

## Sorting

The global Todo index should not impose a new sort order. It should filter the existing aggregate thread list by id, then pass those threads through the existing sidebar render ordering. This preserves the current index/list presentation rules.

## Empty States

When global Todo mode is active and no unresolved Todo exists, show a focused empty state:

```text
No unresolved todo side notes.
Add @todo to a side note to track it here.
```

Search-specific empty states should continue to mention the active search query when search hides all Todo results.

## Testing

Do not modify tests unless the implementation session explicitly allows it. If tests are allowed later, add focused coverage for:

- `threadHasTodoMention(...)` matches `@todo` case-insensitively.
- `threadHasTodoMention(...)` does not match embedded words such as `@todone`.
- `buildGlobalTodoIndex(...)` excludes resolved threads.
- `buildGlobalTodoIndex(...)` indexes thread ids by file path.
- Global Todo tab availability is based on global unresolved Todo count, not selected index file scope.
- Index Todo list ignores the selected Files root/filter.
- Local note Todo behavior remains compatible with the current local scope.

## Acceptance Criteria

- Global unresolved Todo is derived from indexed visible comment threads.
- The derived Todo index is rebuilt only when aggregate index version changes.
- `Aside index.md` Todo availability uses global unresolved Todo count.
- `Aside index.md` Todo results are not limited by the selected Files root/filter.
- Resolved Todo threads are excluded from global Todo.
- Soft-deleted threads and soft-deleted entries are excluded through aggregate visibility.
- Local note Todo remains local.
- Todo state is not persisted separately.
