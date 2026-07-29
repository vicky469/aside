# Published HTML Line Breaks and Hashtags Implementation Plan

**Goal:** Preserve authored paragraph line breaks in published HTML and render
Unicode hashtags as blue, non-clickable labels.

**Architecture:** Keep source lines in the existing `MarkdownBlock.lines` array
instead of flattening them during block parsing. Render adjacent lines through
the existing inline renderer and join them with `<br>`. Add hashtag recognition
inside the inline renderer after HTML escaping, while existing inline-code
placeholders protect code content.

**Tech stack:** TypeScript, Node test runner, generated inline CSS.

## Implementation tracking

- [ ] Task 1: Add failing renderer regression coverage.
- [ ] Task 2: Preserve source lines and render line breaks.
- [ ] Task 3: Render and style Unicode hashtags.
- [ ] Task 4: Run focused and full verification.
- [ ] Task 5: Update implementation tracking and review the diff.

## Task 1: Add failing renderer regression coverage

**Files:**

- Modify: `tests/markdownHtmlRender.test.ts`

Add a test using consecutive Chinese timestamp lines, a blank-line paragraph
boundary, Chinese and mixed-language hashtags, an inline-code hashtag, and a URL
fragment. Assert `<br>` separators, blue tag spans, protected code, and separate
paragraphs.

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/markdownHtmlRender.test.js
```

Expected: failure because paragraphs are currently joined with spaces and
hashtags are plain text.

## Task 2: Preserve source lines and render line breaks

**Files:**

- Modify: `src/core/publish/markdownHtmlRender.ts`

Store paragraph and blockquote lines without joining them. Add a small helper
that renders each line through `renderInline` and joins adjacent lines with
`<br>\n`. Use it for paragraph and blockquote bodies.

Run the focused test. The line-break assertions should pass while hashtag
assertions remain red.

## Task 3: Render and style Unicode hashtags

**Files:**

- Modify: `src/core/publish/markdownHtmlRender.ts`

Recognize hashtags only at the start of inline text or after whitespace. Support
Unicode letters and numbers plus `_`, `-`, and `/`. Insert a semantic classed
span after escaping source text and before restoring stashed inline HTML.

Add readable blue colors to the generated stylesheet for light and dark color
schemes. Do not add margins, padding, or click behavior; authored whitespace and
the existing line-height provide spacing.

Run the focused test and expect it to pass.

## Task 4: Run focused and full verification

Run:

```bash
npm test
npm run build
```

The build includes lint, type checking, Obsidian compliance, bundling, and the
release artifact guard. Inspect the exact shipped assets (`main.js`,
`manifest.json`, and `styles.css`) and confirm there is no source map reference,
embedded `sourcesContent`, raw TypeScript/JSX-family source, or obvious
secret-bearing file.

## Task 5: Update implementation tracking and review the diff

Mark completed items in this plan and the design specification. Review the
focused diff and repository status, then commit the implementation.
