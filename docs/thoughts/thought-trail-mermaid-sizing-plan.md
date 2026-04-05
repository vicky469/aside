# Thought Trail Mermaid Sizing Plan

## Problem

The Thought Trail graph in the sidebar still renders node boxes much larger than expected, even after:

- compacting file labels
- removing the old depth limit
- reducing Mermaid spacing options in the generated diagram text

The user-visible problem is not the overall SVG width alone. The node boxes themselves are too tall and too wide for the compact labels.

## Live DOM Findings

Verified in the running Obsidian app with `obsidian dev:dom`:

- current live label text is compact, for example:
  - `g30-bridge-c01-n01`
- current live label text still renders at:
  - `font-size: 16px`
- current live node box for that compact label is still about:
  - `width: 208.7578125`
  - `height: 54`
- current live Mermaid output still uses:
  - `foreignObject`
  - HTML labels

The generated live SVG still inlines styles like:

- `font-size:16px`
- `line-height: 1.5`
- `max-width: 200px`

That explains why the boxes still feel large even after label compaction.

## Research Summary

Generic Obsidian forum advice about:

- `.mermaid svg { width: 100% }`
- outer container sizing
- wrapper boxes around the SVG

does not address the main issue here.

Those approaches can change overall diagram width, but they do not fix the internal node box sizing that Mermaid computes from its own label measurement.

## Runtime Experiments

I tested Mermaid directly inside the running Obsidian app via `obsidian eval`, instead of only inspecting the markdown-rendered graph.

### Experiment 1: current-style render path

Observed result:

- `foreignObject` labels remain
- `font-size` remains `16px`

Conclusion:

- our current Thought Trail render path is not getting the effective label sizing we expect from the inline Mermaid init string

### Experiment 2: direct Mermaid render with explicit config

Using live Mermaid runtime calls in Obsidian:

- `mermaid.initialize(...)`
- `mermaid.render(...)`

with:

- `themeVariables.fontSize = "12px"`

produced:

- `font-size: 12px`
- compact label box around:
  - `width: 107.5234375`
  - `height: 20`

This is a major improvement over the current live `208.7578125 x 54`.

### Experiment 3: lower wrapping width

Testing smaller `flowchart.wrappingWidth` values showed:

- `wrappingWidth: 120` did not materially improve the already-compact single-line case
- `wrappingWidth: 90` made boxes taller again by forcing wrap

Conclusion:

- wrapping width is not the primary fix for our current compact-label case
- the main win is correct font sizing during Mermaid render

### Experiment 4: `htmlLabels: false`

Even direct Mermaid runtime render in Obsidian still produced `foreignObject` labels.

Conclusion:

- `htmlLabels: false` is not a reliable lever in the Obsidian Mermaid runtime we are using
- we should not build the fix around forcing non-HTML labels

## Root Cause

The current Thought Trail uses:

- `MarkdownRenderer.renderMarkdown(...)`
- a generated ```mermaid code block

That means Obsidian's built-in Mermaid code-block processor owns the render.

In that path, the label sizing we want is not being applied reliably. The live DOM shows that Mermaid is still measuring nodes at `16px`, which is why the boxes remain large.

## Recommended Fix

### Phase 1

Replace the Thought Trail Mermaid render path in the sidebar:

- stop rendering Thought Trail as markdown code block content
- render Mermaid directly with the live Mermaid runtime instead

Use:

- `mermaid.initialize(...)`
- `mermaid.render(...)`

with explicit config for each render.

Recommended config baseline:

- `themeVariables.fontSize: "12px"`
- `flowchart.nodeSpacing: 3`
- `flowchart.rankSpacing: 5`
- `flowchart.padding: 1`
- `flowchart.diagramPadding: 0`
- `flowchart.useMaxWidth: false`

Keep:

- compact unique node labels
- sidebar scroll container behavior
- click handling on graph nodes

Do not add:

- wrapper-box sizing hacks
- post-render rect geometry rewriting
- CSS overrides that try to shrink already-measured node boxes

### Phase 2

After direct Mermaid render is working:

- re-check live DOM for actual rendered node sizes
- keep CSS focused only on container overflow and layout
- remove any no-longer-needed Mermaid text overrides

### Phase 3

Only if needed after Phase 1:

- further shorten node labels
- adjust rank/node spacing slightly

Do not treat `wrappingWidth` as the primary fix unless live DOM proves it helps for real labels without reintroducing extra height.

## Acceptance Criteria

The fix is successful if live DOM in Obsidian shows:

- Thought Trail node label text rendered at `12px`
- compact single-line labels no longer produce `~208 x 54` boxes
- boxes are materially closer to the direct-render experiment, around `~108 x 20` for compact labels
- no CSS hack is required to shrink node geometry after Mermaid has already rendered it

## Implementation Order

1. Extract Thought Trail Mermaid rendering out of `MarkdownRenderer.renderMarkdown(...)`.
2. Use direct Mermaid runtime render with explicit config.
3. Rebind existing node click behavior on the rendered SVG.
4. Re-inspect live DOM with `obsidian dev:dom`.
5. Only then do any minor spacing follow-up.

## Non-Goals

Not part of this fix:

- changing graph semantics
- reintroducing depth limits
- custom SVG graph rendering
- center/fit/scale hacks on the whole SVG
