# Configurable Root-Level Index Note Name

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside persists the generated index note path in `indexNotePath`.
- [x] Aside can rename the generated index note without losing the active sidebar or draft host context.
- [x] Existing index-note rename planning detects missing parents and target-file conflicts.

### To Implement

- [ ] Give brand-new installations the default root-level index note name `🐰 Aside index`.
- [ ] Preserve every existing installation's current index note path after a plugin update.
- [ ] Add `Index note name` as the first setting beneath the `Index note` heading.
- [ ] Restrict newly entered index note values to safe root-level filenames and append `.md` automatically.
- [ ] Apply a valid name change only when the user presses Enter or leaves the field.
- [ ] Keep the previous name and path when validation or rename planning rejects a change.
- [ ] Centralize old and new default-name rules so derived runtime modules cannot drift.
- [ ] Preserve legacy custom folder paths until the user deliberately enters a new root-level name.

### Verification

- [ ] Test that a new installation resolves to `🐰 Aside index.md`.
- [ ] Test that existing settings with `Aside index.md` remain unchanged after loading the update.
- [ ] Test that existing custom root and folder paths remain unchanged after loading the update.
- [ ] Test emoji and other valid Unicode filenames.
- [ ] Test optional `.md` input, blank input, path separators, unsafe filename characters, and target conflicts.
- [ ] Test successful rename, sidebar retargeting, draft-host retargeting, persistence, and aggregate refresh behavior.
- [ ] Run the focused settings and derived-index tests.
- [ ] Run the full test, lint, type-check, and production build pipeline.

## Goal

Make Aside's generated index note easier to recognize on new installations while letting each user choose its filename. The setting controls only the filename; the generated note remains at the vault root for all newly selected names.

## User-Visible Behavior

The first control under the `Index note` settings heading is a text field named `Index note name`.

- A brand-new installation starts with `🐰 Aside index.md` at the vault root.
- An installation that updates to this version keeps its current index note path exactly as stored or previously resolved. In particular, `Aside index.md` is not automatically renamed.
- The field displays the filename without the `.md` extension.
- Users may enter a valid Unicode name such as `🐰 Aside index`, `Comments`, or `研究索引`.
- Aside accepts an optional trailing `.md` but stores and uses a normalized Markdown path.
- Clearing the field resets a new selection to the new default name, `🐰 Aside index`.
- A user-entered `/` or `\` is rejected because the setting does not control location.
- Aside commits the edit on Enter or blur rather than renaming the file after every keystroke.

## Compatibility Contract

Updating the plugin must have no observable index-note impact until the user edits the new setting:

- no automatic file rename;
- no automatic file move;
- no new index note created under the rabbit name;
- no link, sidebar, draft, or sync churn caused by the new default;
- no change to an existing custom root-level or folder-based path.

The loader must distinguish a brand-new installation from an existing installation. A null or otherwise positively identified first-install data state receives the new default. Existing persisted data that lacks `indexNotePath` is treated as legacy existing data and retains the legacy `Aside index.md` fallback.

The persisted property remains `indexNotePath`. Keeping the storage key avoids a settings-schema break and continues to support existing data. A legacy folder-based value remains functional and unchanged on load. If that user deliberately submits a new name, the controller renames or moves the generated note to the selected root-level filename.

## Design

### Default ownership

The shared index-note module owns two explicit defaults:

- the new-install default path, `🐰 Aside index.md`;
- the legacy existing-install fallback, `Aside index.md`.

Callers consume these exported rules instead of declaring local `Aside index.md` constants. Runtime functions that receive the configured index path continue to prefer that injected path.

### Name normalization and validation

A focused helper converts setting input into a root-level Markdown path. It trims surrounding whitespace, removes one optional case-insensitive `.md` suffix, and appends `.md` to the normalized name.

Validation rejects path separators, control characters, and filename characters that are unsafe on common desktop filesystems. It also rejects names that normalize to an empty or reserved filename. Valid Unicode, including emoji, remains unchanged.

The helper returns an explicit success or validation-error result so the settings UI can retain the prior value and show a useful notice without partially changing state.

### Settings interaction

The setting initializes from the basename of the active configured path and removes its `.md` extension for display. This keeps a legacy folder path working while presenting the setting as a filename.

On Enter or blur, the UI validates the text and sends the normalized root path through the existing index-note settings controller. The controller remains responsible for conflict checks, vault rename operations, persistence, sidebar and draft retargeting, and aggregate refresh. After success or failure, the field is reset to the actual active filename so UI and persisted state cannot diverge.

### Failure behavior

- Invalid input: show a notice, keep the current file and stored path, and restore the field.
- Existing target file: show a conflict notice, keep the current file and stored path, and restore the field.
- Rename failure: propagate the existing controller failure behavior without saving the requested name; restore the field to the active name.
- No-op input: do not rename, save, or refresh.

## Testing Strategy

Planner and normalization tests cover first-install versus existing-install resolution, Unicode names, extension normalization, root-only enforcement, unsafe names, no-op changes, and conflicts.

Controller tests cover a successful root-level rename and verify the vault operation, saved `indexNotePath`, active sidebar retargeting, draft-host retargeting, and aggregate refresh. Existing tests remain the regression baseline for current rename behavior.

Settings-surface tests verify that `Index note name` is the first control in its section and that edits commit only on Enter or blur. A final repository search confirms that runtime default constants are owned centrally and remaining literal mentions are intentional tests or documentation.

## Out of Scope

- Choosing an index-note folder.
- Automatically migrating or renaming any existing index note.
- Changing the generated note's contents, header image, caption, or index ordering.
- Renaming the plugin, commands, sidebar views, or persisted storage keys.
