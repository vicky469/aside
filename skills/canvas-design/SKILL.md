---
name: canvas-design
description: Use when creating or refining Obsidian .canvas boards, especially when the user wants cleaner spacing, clearer hierarchy, better grouping, fewer crossings, or a more readable visual flow.
---

# Obsidian Canvas Design

Use this skill for Obsidian `.canvas` files and canvas-style diagrams.

The goal is not decorative art. The goal is a board that reads clearly at a glance, survives zooming, and feels intentionally arranged.

## Scope

- Create new `.canvas` boards.
- Refine existing boards without rewriting their meaning.
- Improve spacing, alignment, grouping, labels, and flow.
- Reduce overlap, crowding, and unnecessary edge crossings.

## Working Style

1. Read the board before moving anything.
   - Identify the main reading direction: left-to-right or top-to-bottom.
   - Find the backbone, supporting detail, and side notes.
2. Preserve semantics first.
   - Keep node ids, links, and user-authored content unless the task requires otherwise.
   - Prefer repositioning and resizing over rewriting text.
3. Make structural changes, not random aesthetic ones.
   - Every move should improve scan order, grouping, or edge clarity.

## Layout Rules

- Pick one primary flow and make it obvious.
  - Main sequence items should sit on a consistent axis.
  - Secondary material should branch outward, not interrupt the spine.
- Use compact but readable spacing.
  - Tight spacing is acceptable when the structure still reads clearly.
  - Leave small but visible gutters between sibling nodes.
  - Use larger gaps between sections than within a section.
  - Give groups enough inner padding that content does not touch borders.
- Align aggressively.
  - Rows should share a top or center line.
  - Columns should share a left edge or center line.
  - Similar nodes should usually share width and height unless asymmetry communicates importance.
- Avoid collisions completely.
  - Never overlap nodes or groups.
  - No labels pressed against group edges.
  - No nodes so close that edge handles or arrows become ambiguous.
- Minimize line noise.
  - Prefer short, direct connections.
  - Reduce crossings when possible.
  - Put hub nodes near the center of the relationships they explain.

## Grouping Rules

- Use groups to show shared responsibility or topic, not as decoration.
- Group bounds should include all child nodes with consistent padding.
- Section titles should be short and readable at normal zoom.
- If two groups are peers, make their size relationship feel intentional rather than accidental.

## Text Rules

- Keep labels short.
- Let position and grouping do most of the communication.
- If explanatory text is needed, park it off to the side as guide text rather than mixing it into the main flow.
- Size nodes so the text is visible without internal scrolling whenever practical.
  - Prefer making a node wider before making it much taller.
  - If a text node would require scrolling, enlarge it or split the content into smaller nodes.
  - Avoid layouts that force the reader to scroll inside a node just to read all words.

## Editing Checklist

Before finishing, verify:

- the board has an obvious reading order
- major sections are visually separated
- sibling nodes are aligned consistently
- no nodes overlap
- no node requires scrolling to read its text, unless the user explicitly asked for dense content
- groups fully contain their contents
- edges still point to valid nodes
- the JSON stays valid

## Repo-Specific Guidance

When working in this Aside repo, prefer the existing docs canvases as style references:

- `docs/architecture.canvas`
- `docs/feature-map.canvas`
- `docs/comment-lifecycle.canvas`

Match their tone: practical, diagram-first, and readable without visual gimmicks.
