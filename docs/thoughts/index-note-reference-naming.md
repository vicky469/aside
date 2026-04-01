# Index Note Reference Naming

This document describes the current naming rules for references rendered inside `SideNote2 index.md`.

It is a behavior note, not a design recommendation.

## Scope

The index note currently renders these reference shapes:

- file headings
- page-note references
- anchored-note references
- orphaned-note references
- resolved references
- anchored target suffixes
- tag suffixes

The current source of truth is:

- `src/core/derived/allCommentsNote.ts`
- `src/core/anchors/commentAnchors.ts`
- `src/core/anchors/commentSectionOrder.ts`

## Per-File Ordering Rule

Within each file block, references are rendered in this order:

1. page notes
2. anchored notes, including orphaned notes

Important:

- this ordering exists in the output
- the current index note does not print visible section headings like `Page notes` or `Anchored notes`
- references are effectively a flat per-file list with page entries first
- within each kind, comments are ordered by stored position:
  - `startLine`
  - `startChar`
  - `timestamp`

## File Heading Rule

Each source file is rendered once as a bold text heading:

```html
<strong class="sidenote2-index-heading-label">Folder/Note.md</strong>
```

Rule:

- Use the stored `filePath`
- HTML-escape the path text
- Sort files lexicographically by path
- Do not make the file heading itself clickable

## Common Label Normalization Rule

Before a text fragment is shown inside a label, it is normalized like this:

- convert CRLF to LF
- collapse repeated whitespace to single spaces
- trim outer whitespace
- if longer than 80 characters, truncate with `...`

After that, Markdown-sensitive characters are escaped.

The blank fallback currently matters only for non-page comments:

- non-page comments fall back to `(blank selection)`
- page comments do not use selected-text fallback in the index; they always use `pn` ordinals

## Kind Marker Rule

Each rendered reference gets a dot marker before the link:

- page note: `<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"></span>`
- anchored or orphaned note: `<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"></span>`

This is visual only. The label text carries the actual naming.

## Page Note Naming

Page notes currently use one label form.

### Page Note Label

Format:

```md
[pnN](...)
```

Example:

```md
[pn1](...)
```

Rule:

- `pn` is a fixed page-note prefix
- `N` is the page-note ordinal within that file
- ordinals are assigned from file-local comment position order
- in the current renderer, page notes are always emitted before anchored notes for the same file
- page-note rows stay a single entry even when the side note contains wiki links
- page-note rows do not currently append resolved target links in the index note

## Anchored Note Naming

Anchored notes use one of two label forms.

### Anchored Note Without Mentioned Page Label

Format:

```md
[Selected Preview](...)
```

Example:

```md
[hello](...)
```

Rule:

- use the normalized selection preview only

### Anchored Note With Mentioned Page Label

Format:

```md
[Selected Preview · Mentioned Page](...)
```

Example:

```md
[hello · Roadmap](...)
```

Rule:

- keep the selection preview first
- append the mentioned page label after ` · `

## Anchored Target Suffix Rule

When an anchored side note contains a resolved wiki link target, the rendered row appends a separate target suffix.

Format:

```html
[Selected Preview · Mentioned Page](...) -> <a class="external-link sidenote2-index-target-link" ...>Mentioned Page</a>
```

Example:

```html
[hello · Roadmap](...) -> <a class="external-link sidenote2-index-target-link" ...>Roadmap</a>
```

Rule:

- only anchored and orphaned-style rows currently use this suffix behavior
- the suffix uses ` -> `
- the target link opens the resolved note with `obsidian://open`
- duplicate resolved targets for the same comment are collapsed before rendering

## Orphaned Note Naming

Orphaned notes are rendered as anchored-kind entries, but their text uses the orphaned status label.

Format:

```md
[orphaned · Selected Preview](...)
```

Example:

```md
[orphaned · missing text](...)
```

Rule:

- use `orphaned` as the status prefix
- append the normalized stored selection preview
- orphaned notes still use the anchored-kind marker and the anchored section/order bucket

## Resolved Naming

Resolved references keep the same label text, but wrap the full label in strikethrough Markdown.

Format:

```md
[~~Label~~](...)
```

Example:

```md
[~~alpha~~](...)
[~~pn2~~](...)
```

## Tag Suffix Rule

If the side note body contains tags, they are appended after the link.

Format:

```md
[Label](...)  #tag1 #tag2
```

Rule:

- extract tags from the comment body
- dedupe tags
- preserve first-seen order
- preserve tag text
- append them after two spaces

## URL Rule

All index-note references point to the SideNote2 protocol URL:

```txt
obsidian://side-note2-comment?vault=<vault>&file=<filePath>&commentId=<id>&kind=<page|anchored>
```

Current note:

- `parseCommentLocationUrl()` only reads `file` and `commentId`
- `kind` is currently extra metadata, not part of resolution

Anchored target suffix links use a separate open-note URL:

```txt
obsidian://open?vault=<vault>&file=<resolvedFilePath>
```

## Current Examples

Examples of the current naming behavior:

- file heading: `<strong class="sidenote2-index-heading-label">Folder/Note.md</strong>`
- page note by ordinal: `[pn1](...)`
- anchored note: `[hello](...)`
- anchored note with related page label: `[hello · Roadmap](...)`
- anchored note with resolved target suffix: `[hello · Roadmap](...) -> <a ...>Roadmap</a>`
- orphaned note: `[orphaned · missing text](...)`
- resolved anchored note: `[~~alpha~~](...)`

## Review Questions

If the goal is more clarity and simplicity, these are the main decision points:

1. Should `pn` remain the visible page-note prefix, or should page-note labels become more descriptive?
2. Should orphaned notes keep the `orphaned ·` prefix, or should orphaned state be visual only?
3. Should anchored notes always include a stable prefix like `anchored ·`, or is plain selected text better?
4. Should anchored rows keep both the inline mentioned-page label and the separate `-> target` suffix, or is that redundant?
5. Is the extra `kind` query param useful enough to keep if it does not affect routing today?

## Recommended Simplification Target

If we want the naming system to be easier to scan, the main inconsistency today is:

- page notes look like `pn1`
- anchored notes sometimes look like `hello`
- anchored notes sometimes look like `hello · Roadmap`
- anchored notes with resolved links also add `-> Roadmap`
- orphaned notes look like `orphaned · missing text`
- the list is ordered by kind, but that kind is not named with an explicit subheading

That means the same list mixes:

- compact ordinal labels
- selection-first labels
- selection-plus-destination labels

Any cleanup should probably choose one primary naming axis and use it consistently.
