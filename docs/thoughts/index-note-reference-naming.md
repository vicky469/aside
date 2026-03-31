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

Each source file is rendered once as a bold heading:

```md
**Folder/Note.md**
```

Rule:

- Use the stored `filePath`
- Escape Markdown punctuation
- Sort files lexicographically by path

## Common Label Normalization Rule

Before a text fragment is shown inside a label, it is normalized like this:

- convert CRLF to LF
- collapse repeated whitespace to single spaces
- trim outer whitespace
- if longer than 80 characters, truncate with `...`

After that, Markdown-sensitive characters are escaped.

The blank fallback depends on the source text:

- non-page comments fall back to `(blank selection)`
- page comments fall back to the file basename without extension

## Kind Marker Rule

Each rendered reference gets a dot marker before the link:

- page note: `<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"></span>`
- anchored or orphaned note: `<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"></span>`

This is visual only. The label text carries the actual naming.

## Page Note Naming

Page notes use one of two label forms.

### Page Note Without Mentioned Page Label

Format:

```md
[page note · N](...)
```

Example:

```md
[page note · 1](...)
```

Rule:

- `page note` comes from the page-note status label
- `N` is the page-note ordinal within that file
- ordinals are assigned from file-local comment position order
- in the current renderer, page notes are always emitted before anchored notes for the same file

### Page Note With Mentioned Page Label

Format:

```md
[Mentioned Page](...)
```

Examples:

```md
[Another page](...)
[Third page](...)
```

Rule:

- if `getMentionedPageLabels(comment)` returns labels, each deduped label becomes its own rendered reference
- when a mentioned page label exists, it fully replaces `page note · N`
- duplicate mentioned labels for the same comment are collapsed
- deduping keeps first-seen order

This means page notes currently switch between a generic ordinal label and a pure mentioned-page label.

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
[~~page note · 2~~](...)
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

## Current Examples

Examples of the current naming behavior:

- file heading: `**Folder/Note.md**`
- page note by ordinal: `[page note · 1](...)`
- page note by mentioned page: `[Another page](...)`
- anchored note: `[hello](...)`
- anchored note with related page: `[hello · Roadmap](...)`
- orphaned note: `[orphaned · missing text](...)`
- resolved anchored note: `[~~alpha~~](...)`

## Review Questions

If the goal is more clarity and simplicity, these are the main decision points:

1. Should page notes always say `page note`, even when a mentioned page label exists?
2. Should orphaned notes keep the `orphaned ·` prefix, or should orphaned state be visual only?
3. Should anchored notes always include a stable prefix like `anchored ·`, or is plain selected text better?
4. Should page-note ordinals remain visible, or should they be replaced by a simpler file-local naming rule?
5. Is the extra `kind` query param useful enough to keep if it does not affect routing today?

## Recommended Simplification Target

If we want the naming system to be easier to scan, the main inconsistency today is:

- page notes sometimes look like `page note · 1`
- page notes sometimes look like `Another page`
- anchored notes sometimes look like `hello`
- orphaned notes look like `orphaned · missing text`
- the list is ordered by kind, but that kind is not named with an explicit subheading

That means the same list mixes:

- status-first labels
- selection-first labels
- destination-first labels

Any cleanup should probably choose one primary naming axis and use it consistently.
