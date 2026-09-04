# Production Bundle Size Cleanup Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Production builds are minified, tree-shaken, emitted without source maps, and inspected as the exact three-file release artifact set.
- [x] The current production `main.js` baseline is 871,084 bytes.
- [x] An esbuild metafile profile identifies Acorn at about 121 KB and the HTML entity decoder at about 38 KB of the minified bundle.
- [x] Existing publish dependency tests define supported HTML, SVG, CSS, and JavaScript reference extraction, malformed-input recovery, ordering, and performance behavior.

### To Implement

- [ ] Add a deterministic production bundle-size check with a 750,000-byte maximum for `main.js`.
- [ ] Raise the production JavaScript output target from ES2018 to ES2020.
- [ ] Replace Acorn with a focused internal lexer for the supported static JavaScript dependency forms.
- [ ] Replace the bundled HTML named-entity table with native HTML attribute decoding in Obsidian plus a small deterministic non-DOM fallback.
- [ ] Remove `acorn` and `entities` from runtime dependencies and the lockfile.
- [ ] Keep release assets and every existing user-facing feature unchanged.

### Verification

- [ ] Architecture tests fail while heavyweight parser dependencies or imports remain.
- [ ] The bundle budget test fails against the 871,084-byte baseline and passes only after cleanup.
- [ ] All existing publish dependency extraction and traversal tests pass unchanged.
- [ ] Differential fixtures cover static imports, exports, dynamic imports, `new URL(..., import.meta.url)`, strings, templates, comments, regular expressions, malformed tails, and HTML named/numeric entities.
- [ ] Parser performance tests remain within their existing limits.
- [ ] The full test, lint, typecheck, Obsidian compliance, build, and artifact-security checks pass.
- [ ] The built `main.js` is at most 750,000 bytes and contains neither Acorn nor the generated HTML entity table.
- [ ] The verified build is installed into `lean-startup`, reloaded, and matched byte-for-byte.

## Context

Aside 2.0.103 ships a minified 871,084-byte `main.js`. The bundle is already tree-shaken, so splitting TypeScript files or deleting unreferenced exports will not materially reduce the artifact. The profile shows a concentrated removable cost instead:

- `acorn/dist/acorn.mjs`: about 121 KB;
- `entities` HTML decode code and generated tables: about 38 KB; and
- ES2018 lowering compared with ES2020: about 26 KB.

Acorn and `entities` are used only by recursive public-site dependency discovery. Removing that feature would reduce the bundle but violate the existing publishing contract. The cleanup must retain that contract while replacing general-purpose parsers with narrowly scoped code.

## Goals

- Reduce production `main.js` to 750,000 bytes or less.
- Preserve all current agent, comment, Thought Trail, publishing, and support behavior.
- Keep the release artifact set at `main.js`, `manifest.json`, and `styles.css`.
- Prevent later changes from silently restoring the removed bundle weight.
- Keep dependency extraction fail-safe, deterministic, ordered, and fast on malformed input.

## Non-Goals

- Do not remove or hide public publishing, support diagnostics, or another user-facing feature.
- Do not add lazy-loaded plugin files, remote code, runtime package installation, `eval`, compressed source payloads, or a second JavaScript artifact.
- Do not broadly rewrite `AsideView`, persistence, or agent controllers merely because they are large.
- Do not mangle public or Obsidian API property names.
- Do not change which dependency reference forms Aside supports.
- Do not increase `styles.css`.

## Selected Approach

Use three cumulative reductions behind the current public interfaces.

First, change the esbuild target to ES2020. Current supported Obsidian runtimes implement this language level, and the change removes unnecessary lowering helpers without changing source behavior.

Second, replace Acorn in `publishDependencyReferences.ts` with a focused lexer. The lexer recognizes only the already-supported static forms:

- static `import` declarations;
- `export ... from` declarations;
- literal dynamic `import(...)`; and
- `new URL(<literal>, import.meta.url)`.

It must skip comments, quoted strings, template raw segments, and regular-expression bodies while recursively scanning template expressions. It must preserve UTF-16 source offsets so mixed HTML, CSS, and JavaScript references retain first-appearance order. Malformed suffixes must not discard references found in valid prefixes.

Third, decode HTML attribute references with the platform HTML parser in Obsidian rather than shipping the complete named-entity table. The input is placed into an inert, detached attribute context with raw delimiters escaped before parsing. A small pure fallback handles numeric references and the URL-significant named references used when no DOM exists, including Node tests. Both paths retain the current extraction interface.

## Boundaries

The public owner remains `extractPublishDependencyReferences`. HTML, CSS, JavaScript, and URL-resolution callers do not change.

The JavaScript lexer should live in a focused core module and return ordered `{ offset, value }` events. It must not expose parser internals to the graph builder or publish controller.

The HTML attribute decoder should live behind one helper. Browser capability detection belongs inside that helper; callers must not branch on runtime type.

The bundle-size guard should read the generated production `main.js`, report actual and maximum byte counts, and fail the build after bundling but before artifact approval. A source-contract test should also reject runtime imports or dependency declarations for `acorn` and `entities`.

## Error Handling

- Lexical ambiguity must fail closed by ignoring an uncertain candidate, never by executing code or treating arbitrary strings as dependencies.
- Malformed input must terminate in linear time and retain references already proven by a valid prefix.
- Native entity decoding must use an inert detached node and must not attach content, fetch resources, or execute markup.
- The non-DOM fallback must leave unknown named entities unchanged rather than guessing.
- Bundle-budget failures must report the exact byte overage and stop the production build.

## Testing Strategy

Implementation follows test-first slices:

1. Add a source-contract test rejecting the two runtime dependencies and observe it fail.
2. Add a production bundle budget check and observe the current artifact exceed the limit.
3. Lock any uncovered lexer or entity edge cases into focused fixtures before replacing code.
4. Implement the focused lexer until the existing extraction suite passes without Acorn.
5. Implement native and fallback entity decoding until the same HTML fixtures pass without `entities`.
6. Raise the output target, remove dependencies, bundle, and satisfy the size gate.
7. Run the complete release-quality verification and install the exact build for live smoke testing.

Existing expected-output tests remain authoritative. They should not be weakened to accommodate the smaller implementation.

## Acceptance Criteria

- Production `main.js` is no larger than 750,000 bytes.
- `package.json`, the lockfile, source imports, and production metafile contain neither `acorn` nor `entities`.
- Existing publish dependency extraction results and graph behavior remain unchanged.
- All current plugin features remain available through the same UI and commands.
- Production build and release artifact security checks pass.
- Installed `lean-startup` artifacts match the verified build byte-for-byte.
