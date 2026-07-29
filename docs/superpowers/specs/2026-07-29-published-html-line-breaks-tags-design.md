# Published HTML Line Breaks and Hashtags

## Implementation tracking

- [x] Reproduce the flattened timestamp lines in the local renderer.
- [x] Confirm the live published page contains flattened paragraphs and plain hashtags.
- [x] Agree on source-line preservation and automatic spacing behavior.
- [ ] Add regression tests for line breaks and Unicode hashtags.
- [ ] Preserve nonblank source lines within rendered paragraphs.
- [ ] Render hashtags as blue, non-clickable spans.
- [ ] Run focused tests, the full suite, and the release artifact guard.

## Problem

The basic publishing renderer currently joins every adjacent Markdown source line
with a space. A sequence such as:

```markdown
00:00 序言
04:36 第一章：资金源头的差异
09:42 第二章：条款里的生死劫
```

therefore becomes one continuous line in the generated HTML. Hashtags are emitted
as plain text, so the public page gives them no visual distinction.

## Approved behavior

Every explicit, nonblank source line inside a paragraph is preserved in the
published HTML with a `<br>` between adjacent lines. Blank source lines continue
to delimit paragraphs.

Spacing is automatic:

- `<br>` provides the authored line break.
- The existing paragraph line-height controls vertical rhythm within the group.
- Existing paragraph margins apply only at blank-line boundaries.
- Existing source spaces remain between adjacent hashtag spans.

The renderer does not recognize timestamps specially and does not insert
content-specific gaps.

Hashtags that begin at the start of inline text or after whitespace are wrapped
in a non-interactive `<span>` and styled blue. The tag body supports Unicode
letters and numbers plus `_`, `-`, and `/`, so Chinese and mixed-language tags
work without a hard-coded vocabulary. A URL fragment such as `/page#section`
does not become a tag.

## Rendering and safety

Inline Markdown rendering continues to escape source text before emitting HTML.
Hashtag spans are added by the renderer after escaping, and inline code remains
protected by the existing placeholder mechanism. Hashtags are visual labels,
not links, and receive no click behavior.

## Verification

Regression coverage will use the reported Chinese timestamp and hashtag shape
and will verify:

- consecutive source lines produce `<br>` separators;
- blank lines still create separate paragraphs;
- Chinese and mixed-language hashtags receive the tag span;
- inline-code hashtags remain code;
- hashtag styling is present in the generated document;
- the complete test/build pipeline and release artifact checks pass.
