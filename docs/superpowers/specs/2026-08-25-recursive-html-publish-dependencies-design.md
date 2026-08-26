# Recursive HTML Publish Dependencies Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside publishes enabled HTML and PDF entry artifacts as a complete Cloudflare Pages Direct Upload snapshot.
- [x] Aside preserves vault-relative paths when staging publish artifacts.
- [x] Aside limits publishing to the configured `public/` root and blocks Obsidian configuration paths, obvious secrets, keys, certificates, logs, and source maps.
- [x] Standalone HTML publish state is persisted independently from Markdown/HTML pair frontmatter.
- [x] The production failure has been reproduced: `public/pigeon-plan/index.html` is served, while its referenced CSS and SVG return HTTP 404 because they are absent from the snapshot.

### To Implement

- [x] Add deterministic extraction of statically discoverable local references from HTML, CSS, SVG, and JavaScript module content.
- [x] Add vault-relative URL resolution that follows browser-style relative paths, strips query/fragment components for file lookup, ignores non-local URLs, and rejects paths outside `public/`.
- [x] Build a recursive, cycle-safe, de-duplicated dependency graph from every enabled HTML entry artifact in the publish snapshot.
- [x] Read dependency files as text when they can contain further references and as binary otherwise, preserving their original vault-relative paths and bytes.
- [x] Extend publish artifact inspection to admit reachable web dependencies while continuing to reject source maps, secret-bearing files, keys, certificates, logs, raw Markdown, TypeScript/JSX-family source, and Obsidian configuration files.
- [x] Abort the deploy before Wrangler runs when a local dependency is missing, unsafe, unreadable, or outside the publish root.
- [x] Keep publish state and the generated public publish index scoped to entry artifacts; derive dependency assets fresh for each snapshot rather than persisting them as independently published files.

### Verification

- [x] Unit tests cover HTML references to sibling CSS and nested SVG assets.
- [x] Unit tests cover recursive CSS imports and `url(...)` assets.
- [x] Unit tests cover static JavaScript module imports and `new URL(..., import.meta.url)` assets.
- [x] Unit tests cover `srcset`, inline CSS, query strings, fragments, percent-encoded paths, cycles, duplicate references, and assets shared by multiple entry pages.
- [x] Unit tests confirm remote, protocol-relative, `data:`, `blob:`, fragment-only, mail, and telephone URLs are ignored.
- [x] Unit tests confirm missing, traversal, outside-root, secret-bearing, source-map, raw Markdown, TypeScript, and JSX dependencies fail closed before deployment.
- [x] Unit tests confirm binary dependency bytes are preserved and unpublishing an entry removes dependencies that are no longer reachable while retaining shared dependencies.
- [x] Existing publish controller and artifact guard tests pass.
- [x] `npm run build` passes.
- [x] The built plugin is installed into the `lean-startup` vault and the original page is republished.
- [x] Fresh HTTP checks return 200 for `/public/pigeon-plan/`, `/public/pigeon-plan/pigeon-mocks-v7.css`, and `/public/pigeon-plan/assets/pigeon-logo.svg`.

### Verification Evidence — 2026-08-26

- Focused publish verification, including the Wrangler publisher suite, passed 132 of 132 tests.
- The full build passed 1,327 compiled tests and 98 `.mjs` tests, for 1,425 total tests with no failures.
- The release artifact guard inspected exactly `main.js`, `manifest.json`, and `styles.css`. Follow-up scans found no `sourceMappingURL`, `sourcesContent`, source maps, `.env*`, `.npmrc`, keys, or certificates.
- The verified build was installed byte-for-byte into the `lean-startup` vault. Aside's normal update-publish action then emitted the sanitized `publish.html.updated` success event for `public/pigeon-plan/index.html`; no Obsidian developer errors were captured, and the reported CSS and SVG dependencies changed from HTTP 404 to live assets.
- The production graph closure contained `index.html`, `assets/pigeon-logo.svg`, `pigeon-mocks-v7.css`, and the recursively imported `pigeon-mocks-v6.css`.
- The page route and all three dependency assets returned HTTP 200. The explicit `/public/pigeon-plan/index.html` URL returned the expected canonical HTTP 308 redirect.
- **Manual browser validation remains open:** no in-app browser backend was available, so computed styles, the rendered logo, and browser console/network state were not visually inspected.

## Context

The existing public publish workflow intentionally snapshots only enabled HTML and PDF artifacts. That model works for self-contained HTML but produces incomplete static sites when an HTML entry point depends on separate stylesheets, scripts, images, fonts, or other files.

The reported entry point is:

```text
public/pigeon-plan/index.html
```

It contains local references to:

```text
public/pigeon-plan/pigeon-mocks-v7.css
public/pigeon-plan/assets/pigeon-logo.svg
```

The entry file is present in Aside's `publishedPublicArtifactPaths` and returns HTTP 200 from Cloudflare Pages. The two dependency URLs return HTTP 404. The local files are symlinks, but that is not the failure: Aside successfully reads and publishes the symlinked entry file through the Obsidian vault API. The snapshot builder simply never asks for the referenced assets.

This design extends the snapshot model from an entry-artifact allowlist to an entry-artifact allowlist plus the local dependency closure of those entries.

## Goals

- Publish a working static HTML site when its entry file references local assets.
- Follow local dependencies recursively across the common HTML, CSS, SVG, and JavaScript module surfaces.
- Preserve the existing whole-snapshot deploy and unpublish behavior.
- Upload only files reachable from enabled HTML entries rather than every file in an entry's folder.
- Keep every shipped file inside the configured publish root and subject to artifact inspection.
- Fail before upload instead of deploying a predictably incomplete or unsafe site.
- Preserve referenced binary files byte-for-byte.

## Non-Goals

- Do not execute HTML or JavaScript to discover runtime-computed URLs.
- Do not crawl remote URLs or download third-party assets.
- Do not publish an entire sibling directory merely because it contains an entry file.
- Do not introduce a user-maintained asset manifest in this change.
- Do not persist dependency assets as independently published entries.
- Do not make CSS, JavaScript, images, fonts, or other dependencies directly publishable from the Aside file action UI.
- Do not upload raw Markdown, TypeScript, TSX, or JSX source as dependencies.
- Do not change Cloudflare Pages project selection, URL generation, cache purging, or authentication behavior.

## Approaches Considered

### Recursive dependency graph — selected

Start from each enabled HTML entry, extract local references, resolve them to vault-relative paths, and recursively scan referenced text assets that can contain more dependencies. This publishes the smallest complete reachable site, keeps unrelated files private, and recomputes the truth on every deploy.

The trade-off is that runtime-computed URLs cannot be discovered without executing application code. The implementation must define the supported static syntax precisely and give a clear failure for local references that it can discover but cannot safely include.

### Publish the entire entry directory

Stage every file under the directory containing `index.html`. This handles dynamic paths but can expose unrelated drafts, fixtures, or local-only files and makes a single HTML action behave like an implicit folder publish. It conflicts with the requested reference-driven mental model and the existing least-public snapshot policy.

### Require an explicit asset manifest

Let users enumerate dependencies in frontmatter or a sidecar file. This is predictable but creates manual upkeep, is easy to forget during edits, and does not satisfy automatic bundling.

## Architecture

Add a pure publish dependency module under `src/core/publish/`. It owns four responsibilities:

1. Extract candidate URL strings from supported text formats without executing content.
2. Classify candidates as local or ignored non-local URLs.
3. Resolve local candidates relative to the referring file using browser-style path semantics.
4. Traverse referenced files through a cycle-safe, de-duplicated graph builder.

The publish controller remains the owner of snapshot composition. After collecting the currently enabled generated Markdown HTML, paired HTML, standalone HTML, and PDF entries, it invokes the dependency graph builder for each real HTML entry. Generated Markdown HTML is self-contained and does not need vault dependency traversal unless the generated output later gains local asset syntax.

The host interface supplies the existing file existence, text read, and binary read operations. The resolver does not need filesystem paths or direct Node filesystem access. A symlink that Obsidian exposes as a vault file is read through the same vault API as its entry point; only the vault-relative reference path is staged.

The final snapshot is keyed by normalized vault-relative path. Shared dependencies are included once. If multiple entries reach the same file, unpublishing one entry keeps the file as long as another enabled entry still reaches it.

## Supported Static References

### HTML and SVG

The extractor recognizes local resource URLs in standard URL-bearing attributes, including:

- `src`, `href`, `poster`, and `data`
- `srcset` candidates
- inline `style` attributes
- CSS inside `<style>` elements

This covers scripts, stylesheets, icons, manifests as direct files, images, image candidates, audio/video sources, tracks, frames, embeds, objects, SVG image/use links, and local document links. A local `<base href>` changes relative URL resolution using browser semantics. Fragment-only navigation remains inside the current document and does not create another dependency.

### CSS

The extractor recognizes:

- `url(...)`
- `@import` with quoted or `url(...)` syntax

Imported CSS is scanned recursively. Referenced fonts, images, and other binary assets are added without text scanning unless their type is itself supported.

### JavaScript

The extractor recognizes statically quoted paths in:

- static `import` declarations
- `export ... from` declarations
- literal dynamic `import(...)`
- `new URL(..., import.meta.url)`

The publisher does not evaluate variables, template expressions, `fetch()` calls, application routing, service-worker code, or arbitrary string construction. Such runtime dependencies must also appear through a supported static reference to be included by this version.

## URL Resolution

Dependency resolution follows these rules:

- Relative paths resolve from the directory of the referring file.
- A local `<base href>` changes the base for HTML references.
- Root-relative paths resolve from the vault snapshot root, then must still fall under the configured `public/` root.
- Query strings and fragments are removed for vault file lookup and staging.
- Percent-encoded path components are decoded before vault lookup, with malformed encodings rejected.
- `.` and `..` segments are normalized before the publish-root check.
- Empty references and fragment-only references are ignored.
- `http:`, `https:`, protocol-relative, `data:`, `blob:`, `mailto:`, and `tel:` references are ignored and never fetched.
- Other explicit schemes are ignored unless a future design adds a safe local mapping.
- Control characters, invalid paths, and any normalized path outside the allowed root fail closed.

## Snapshot Data Flow

For each publish, republish, or unpublish action:

1. Resolve all enabled entry artifacts using the existing frontmatter and standalone artifact state.
2. Render generated Markdown HTML and read real HTML/PDF entries as today.
3. Seed dependency traversal with each real HTML entry path and contents.
4. Extract and resolve its local references.
5. For every unseen dependency, verify that it exists, read it as text or binary, inspect it, add it to the snapshot, and recursively scan it when its format is supported.
6. De-duplicate the completed snapshot by normalized vault-relative path.
7. Inspect the exact completed snapshot again at the deploy boundary.
8. Stage the snapshot into the temporary Pages upload directory and invoke Wrangler.
9. Persist entry publish state only after a successful deploy, preserving the current transaction ordering.

Dependency assets are derived data. They do not appear as independent rows in `public/index.md` and are not added to `publishedPublicArtifactPaths`.

## Artifact Security

The current artifact guard conflates two policies: which file types can be selected as entry artifacts and which files are safe inside a referenced site bundle. The implementation should separate these decisions while keeping one shared path-and-content safety core.

Entry selection remains limited to HTML, HTM, and PDF. Reachable dependencies may use ordinary web asset types, including CSS, JavaScript, JSON/web manifests, SVG and raster images, fonts, media, and WebAssembly. Regardless of type, every dependency must:

- remain within the configured publish root;
- avoid the vault configuration directory;
- avoid obvious secret-bearing names such as `.env*` and `.npmrc`;
- avoid private keys and certificates;
- avoid logs and source maps;
- contain no source-map reference marker when read as text; and
- not be raw Markdown, TypeScript, TSX, or JSX source.

JavaScript that is explicitly referenced by a public HTML/CSS/JavaScript graph is intentional public web code and may ship. Source maps and higher-level source files remain blocked.

Before Wrangler runs, the deploy layer inspects the exact list of staged paths and contents. A blocked dependency aborts the entire upload; the guard is never bypassed to make a partial site deploy.

## Failure Handling

The graph builder returns a structured failure that identifies:

- the referring entry or dependency path;
- the original reference string; and
- the reason it could not be included.

User-facing notices remain concise, for example:

```text
Publish failed: public/pigeon-plan/index.html references missing local asset public/pigeon-plan/site.css.
```

Detailed graph context can be written through the existing sanitized publish logs. No dependency failure mutates frontmatter or `publishedPublicArtifactPaths`, and Wrangler is not invoked.

Cycles such as mutually importing CSS files are valid and terminate through the visited-path set. Duplicate references are valid and add only one snapshot file.

## Testing

Pure unit tests should lock down extraction and path resolution independently from controller integration. Controller tests should then prove that the real snapshot includes the graph closure and that deploy failures preserve existing publish state.

The regression fixture must model the production case:

```text
public/pigeon-plan/index.html
  -> public/pigeon-plan/pigeon-mocks-v7.css
  -> public/pigeon-plan/assets/pigeon-logo.svg
```

Additional tests cover nested CSS imports and fonts/images, static JavaScript imports, inline CSS, `srcset`, URL encoding, query/fragment removal, cycles, shared dependencies, binary byte preservation, missing files, traversal, outside-root references, blocked source exposure, and ignored remote URLs.

After automated verification, build and install the plugin into the `lean-startup` vault, republish the original entry, and verify all three production URLs with fresh HTTP requests.

## Acceptance Criteria

- Publishing `public/pigeon-plan/index.html` stages the entry, `pigeon-mocks-v7.css`, and `assets/pigeon-logo.svg` with their existing paths and contents.
- The deployed page loads with its stylesheet and logo at `/public/pigeon-plan/#/workspaces`.
- Recursive supported references are included without publishing unrelated sibling files.
- Missing, unsafe, or outside-root local dependencies stop the deploy before Wrangler runs.
- Remote dependencies are left as remote URLs and are never downloaded by Aside.
- Cycles and shared dependencies produce one staged copy per normalized vault-relative path.
- Unpublishing an entry removes dependencies that are no longer reachable from any enabled entry.
- Existing standalone HTML, Markdown-generated HTML, paired HTML, and PDF behavior remains intact.
- Publish state continues to track entry artifacts only.
- The exact final snapshot passes artifact inspection before upload.

## Relationship To Existing Publish Design

This spec extends, but does not replace, `docs/superpowers/specs/2026-07-08-public-html-publish-workflow-design.md`. That design remains authoritative for entry selection, UI actions, Markdown/HTML pairing, PDF handling, Cloudflare Pages Direct Upload, and unpublish semantics. This spec changes only how local dependencies of enabled real HTML entries are discovered, inspected, and added to the same snapshot.
