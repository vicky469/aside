# Thought Trail Node Path Tooltip Design

## Summary

Thought Trail will keep its compact Mermaid node labels while exposing each node's full vault-relative Markdown path on hover. The tooltip includes the `.md` extension and appears for every clickable file node, regardless of whether its visible filename is unique.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is implemented and the listed verification passes.

### Already Done

- [x] Thought Trail file nodes open their exact vault-relative file paths.
- [x] When multiple graph nodes share a basename, their visible labels expand to the shortest unique path suffix.
- [x] Unique filenames remain compact instead of displaying their full paths in the graph.

### To Implement

- [x] Attach an Obsidian-native tooltip to every clickable Mermaid file node after rendering.
- [x] Show the complete vault-relative file path, including the `.md` extension, as the tooltip text.
- [x] Apply the same tooltip behavior to both the direct Mermaid renderer and the Markdown-renderer fallback.
- [x] Preserve existing node labels, click navigation, graph layout, and tag-related file-list behavior.

### Verification

- [x] Automated tests prove unique-filename nodes receive their full vault-relative paths.
- [x] Automated tests prove same-basename nodes retain unique visible labels and receive their distinct full paths.
- [x] Automated tests cover node identification and path extraction for the renderer-independent binding path.
- [x] The complete repository build passes.

## Goals

- Let users identify the exact file behind any Thought Trail node without opening it.
- Keep the graph visually compact.
- Make path discovery consistent for unique and duplicate filenames.

## Non-Goals

- Always displaying full paths inside Mermaid cards.
- Changing the shortest-unique-suffix label algorithm.
- Changing which notes appear in Thought Trail.
- Adding a hover preview of note contents.
- Changing the separate tag-related file list, which already exposes paths through native title text.

## Interaction Design

Visible Mermaid cards keep their current labels. A unique note such as `projects/alpha.md` may continue to appear as `alpha`; duplicate basenames continue to expand only as far as needed, such as `archive/alpha` and `projects/alpha`.

Hovering any clickable card shows its complete vault-relative path, including `.md`, such as `projects/alpha.md`. The tooltip uses Obsidian's native tooltip treatment so it matches the host application rather than relying on the browser's delayed `title` presentation.

Click behavior is unchanged: selecting the card opens the exact file identified by the tooltip.

## Architecture

The existing Thought Trail click directives remain the single mapping from Mermaid node IDs to file URLs. After either Mermaid rendering path completes, the shared node-binding step resolves each rendered node ID, reads its existing click target, extracts the vault-relative file path, and attaches the Obsidian tooltip to that node.

This keeps tooltip behavior out of Mermaid source generation and avoids separate direct-render and fallback implementations. Invalid, missing, or non-file click targets do not receive a tooltip and retain their current behavior.

## Error and Lifecycle Handling

Tooltip binding is best-effort and local to the newly rendered graph. A rendered element without a recognized Thought Trail node ID or valid `obsidian://open` file target is skipped. Existing click binding and fallback rendering continue even when no tooltip can be attached.

Rerendering replaces the graph container through the existing view lifecycle, so tooltip ownership follows the rendered node elements and requires no persisted state or new cleanup path.

## Testing Strategy

Pure tests cover the node-ID-to-path mapping derived from existing click directives, including encoded folder paths and duplicate basenames. Renderer binding coverage verifies that recognized Mermaid node elements receive the exact path with `.md`, while unrelated SVG elements are ignored.

Existing Thought Trail generation tests continue to verify compact labels, shortest unique suffixes, and exact click URLs. Final verification runs the full repository build, including tests, lint, type checking, Obsidian compliance, bundling, and release-artifact inspection.
