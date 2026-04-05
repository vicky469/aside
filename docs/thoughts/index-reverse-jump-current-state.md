# Index Reverse Jump Current State

## What We Already Know Exactly

For a sidebar card in index mode, we already know:

- `commentId`
- source `filePath`
- source file basename
- folder path chunk in `SideNote2 index.md`
- exact generated index row identity via `^sidenote2-index-comment-<commentId>`

So this is **not** a graph-search problem and it does **not** need multi-hopping across unrelated targets.

## Current Index Structure

The generated index is now grouped like:

```md
### SideNote2/docs/thoughts

  **refactored.md**

- [comment ref](obsidian://side-note2-comment?...commentId=...)
- [comment ref](obsidian://side-note2-comment?...commentId=...)
```

That means we have a natural chunk boundary:

1. path
2. file
3. comment row

## What The Current Code Does

Current sidebar-card click in index mode:

1. set active sidebar card
2. try to find the rendered index row directly
3. if already rendered, center that exact row
4. if not rendered, pre-scroll to the exact file chunk using the generated file heading line
5. refine toward the exact comment line inside that chunk
6. retry rendered-row lookup until that row exists in preview DOM
7. center the exact rendered row

Files involved:

- [SideNote2View.ts](/Users/wenqingli/Obsidian/dev/SideNote2/src/ui/views/SideNote2View.ts)
- [commentHighlightController.ts](/Users/wenqingli/Obsidian/dev/SideNote2/src/control/commentHighlightController.ts)
- [allCommentsNote.ts](/Users/wenqingli/Obsidian/dev/SideNote2/src/core/derived/allCommentsNote.ts)

There is no native `#^block` jump in the visible path anymore.

## Why There Is Still "Multi-Hop"

The remaining complexity is not identity lookup. Identity lookup is already exact.

The remaining complexity is **Obsidian reading-mode preview rendering**:

- the target row may not be in DOM yet
- only the visible preview chunk is rendered
- scrolling by source line is approximate until the target row actually exists in preview DOM

So the current multi-step path is really:

- exact target identity
- exact file-chunk pre-target
- approximate preview positioning inside that chunk
- exact row lookup again

## Difficulties Found

The hard parts were:

1. Reading mode does not guarantee that the target row already exists in DOM.
2. Obsidian preview only renders the visible chunk, so exact row lookup can fail even when the target identity is known.
3. Native `#^block` jump was reliable for distant rows, but it introduced the yellow-first highlight path.
4. Smoothness requires one highlight owner and one scroll owner. Mixing native jump and custom row highlight caused yellow then purple.

Useful fact we now rely on:

- the generated file heading already contains the exact full `filePath` in
  `<strong class="sidenote2-index-heading-label" title="...">`

That gives us a precise pre-target for:

- file chunk lookup
- file heading line mapping
- rendered file-heading DOM sampling

## Simpler Mental Model

The right model is:

1. get to the right **path chunk**
2. get to the right **file block**
3. find the exact **comment row**
4. highlight it
5. optionally center it

Not:

- search the whole note blindly
- hop across unrelated rows

## Best Next Design

If we keep reverse jump:

1. Use the generated path/file grouping as the primary pre-target.
2. Scroll only enough to bring that path/file chunk into rendered preview DOM.
3. Once that chunk is rendered, resolve the exact row by `commentId`.
4. Use one highlight owner and one scroll owner.
5. Avoid native `#^block` fallback on the visible path so the highlight stays purple-only.

## Key Conclusion

Yes: because we already know `path`, `file`, and `commentId`, the reverse jump should be modeled as:

**chunk first, target row second**

The hard part is not locating the logical target. The hard part is making Obsidian reading mode render that chunk so the exact row becomes available.
