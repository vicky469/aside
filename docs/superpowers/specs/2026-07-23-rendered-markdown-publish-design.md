# Rendered Markdown Publish Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside already exposes publish actions for `.md` files under `public/`.
- [x] Aside already stores Markdown publish intent in `asidePublish.markdownEnabled`.
- [x] Aside already deploys complete enabled snapshots through the publish controller.
- [x] Aside already supports explicit paired `.html` artifacts and direct PDF artifacts.

### To Implement

- [x] Add a deterministic basic Markdown-to-HTML renderer for publish snapshots.
- [x] Strip YAML frontmatter from generated public HTML bodies.
- [x] Escape raw Markdown HTML so generated pages do not execute embedded scripts or arbitrary tags.
- [x] Publish Markdown source files as derived `.html` snapshot files instead of raw `.md` files.
- [x] Return and open the derived `.html` public URL for Markdown publish actions.
- [x] Purge the derived `.html` public URL when Markdown pages are unpublished or republished.
- [x] Keep `asidePublish.markdownEnabled` as the persisted state for Markdown source publishing.
- [x] Keep explicit paired `.html` publishing and direct PDF publishing unchanged.

### Verification

- [x] Unit tests cover Markdown rendering for headings, paragraphs, lists, blockquotes, code, links, and frontmatter stripping.
- [x] Unit tests cover escaping raw HTML and rejecting unsafe link targets.
- [x] Controller tests cover Markdown publish staging `public/name.html` instead of `public/name.md`.
- [x] Controller tests cover Markdown publish, open-published, republish, and unpublish returning or purging the derived `.html` URL.
- [x] Controller tests confirm explicit paired `.html` and PDF snapshot behavior still works.
- [x] `npm run build` passes.

## Context

The current publish controller treats `.md` files as deployable artifacts. When a user publishes `public/page.md`, Aside stages the raw Markdown file and returns a public URL ending in `/public/page.md`. That URL is not readable in a normal browser experience because it is Markdown source, not rendered HTML.

The user wants Markdown publish to produce a basic readable web page automatically. The source file should remain `.md` in Obsidian, but the public artifact should be HTML.

## Goals

- Make published Markdown readable in a browser without requiring users to author a paired `.html` file.
- Preserve the current simple user action: publish from the `.md` file.
- Avoid publishing raw Markdown source as the default Markdown artifact.
- Avoid exposing Aside publish frontmatter in the public page body.
- Keep the implementation small and deterministic.
- Keep explicit custom HTML pages available for users who want full control.

## Non-Goals

- Do not build a full static site generator.
- Do not execute Obsidian plugins, Dataview, embeds, transclusions, or callouts during rendering.
- Do not add remote rendering infrastructure.
- Do not change the explicit Markdown/HTML pair workflow.
- Do not publish Markdown source files as public artifacts by default.

## Public URL Behavior

Markdown publish uses the `.md` file as source and derives a `.html` artifact path:

```text
public/page.md -> public/page.html
public/nested/page.md -> public/nested/page.html
```

Publishing `public/page.md` returns:

```text
https://publish.example.com/public/page.html
```

The open-published action for an enabled Markdown source opens the same derived `.html` URL. Republish and unpublish purge that `.html` URL because that is the public browser-facing artifact.

## Snapshot Behavior

The snapshot builder continues to scan enabled Markdown files under the allowed publish root. For each source whose `asidePublish.markdownEnabled` is true, it generates one HTML snapshot file at the derived `.html` path.

The generated Markdown HTML file is separate from explicit paired HTML publishing:

- `markdownEnabled: true` stages generated HTML derived from the Markdown source.
- `htmlEnabled: true` stages the user-authored HTML file named in `asidePublish.html` or inferred by the existing pair resolver.
- If generated Markdown and enabled user-authored HTML resolve to the same `.html` path, the user-authored HTML wins and Aside does not stage a duplicate generated artifact for that path.
- PDF artifacts keep using the persisted artifact path list.

This means a source file can publish both a generated Markdown page and a custom HTML pair only when the explicit custom HTML path differs from the generated Markdown `.html` path.

## Renderer

Add a core publish renderer with no browser or Obsidian dependencies.

The renderer should:

- Normalize line endings.
- Remove a leading YAML frontmatter block from the rendered body.
- Choose the document title from the first Markdown heading, falling back to the source basename.
- Escape raw HTML before rendering inline formatting.
- Support basic readable Markdown: headings, paragraphs, unordered lists, ordered lists, blockquotes, fenced code blocks, inline code, emphasis, strong text, and links.
- Reject unsafe link targets such as `javascript:` by rendering only the link text.
- Wrap the content in a complete HTML document with viewport metadata and small inline CSS.

The generated CSS should be plain and readable: constrained content width, comfortable line height, visible code blocks, and mobile-friendly spacing. It should not depend on external assets, scripts, or network access.

## Error Handling

Markdown publishing should still fail when the source path is outside the allowed root or the source file is missing.

Renderer output should be deterministic and should not fail on unsupported Markdown syntax. Unsupported syntax is rendered as escaped plain text inside the nearest paragraph or block.

Artifact guard checks should inspect the generated `.html` artifact. Raw `.md` should not be staged by the Markdown publish path.

## Testing

Tests should cover the renderer directly and the controller behavior through the existing publish harness.

Controller tests should assert deployed snapshot paths, returned URLs, open-published URLs, and cache purge URLs. Existing paired HTML and PDF tests should be adjusted only where their expected snapshot list currently includes raw `.md` artifacts due to Markdown publish state.
