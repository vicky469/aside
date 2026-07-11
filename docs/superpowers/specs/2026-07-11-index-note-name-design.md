# Rabbit Index Note Filename

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside generates a vault-root index note.
- [x] Aside already has controller support for renaming the generated index note and retargeting active sidebar and draft state.

### To Implement

- [x] Change the generated index filename from `Aside index.md` to `🐰 Aside Index.md`.
- [x] Rename an existing `Aside index.md` automatically after the plugin update.
- [x] Use `🐰 Aside Index.md` for new installations.
- [x] Centralize the current filename and legacy filename in the shared index-note module.
- [x] Keep `Aside index.md` and show a notice if an unrelated `🐰 Aside Index.md` already exists.
- [x] Do not add an index-name setting.

### Verification

- [x] Test a new installation using `🐰 Aside Index.md`.
- [x] Test an existing installation renaming `Aside index.md` to `🐰 Aside Index.md`.
- [x] Test that sidebar and draft references follow the renamed index note.
- [x] Test the target-file collision safeguard.
- [x] Re-run a repository search to confirm runtime filename ownership is centralized.
- [x] Run focused index settings and derived-note tests.
- [x] Run the full test, lint, type-check, and production build pipeline.

## Goal

Rename Aside's generated vault-root index file to `🐰 Aside Index.md` for every user. Keep the implementation flexible by defining the filename once, without adding user-facing configuration.

## Behavior

- New installations generate `🐰 Aside Index.md` at the vault root.
- On update, an existing generated `Aside index.md` is renamed to `🐰 Aside Index.md`.
- Aside continues to recognize the generated index throughout the rename so open sidebar and draft references remain valid.
- No settings control is added.
- The index contents, image, caption, ordering, and other behavior do not change.

## Collision Safety

Aside must not overwrite an existing `🐰 Aside Index.md`. If both filenames exist, the plugin keeps `Aside index.md` as the active generated index for that vault and shows a notice explaining that the rename could not be completed. A later startup may retry once the collision is removed.

## Design

The shared index-note module owns both names:

- current filename: `🐰 Aside Index.md`;
- legacy filename: `Aside index.md`.

Other runtime modules import or receive the configured current filename instead of declaring their own fallback literals.

During settings/plugin initialization, Aside detects the legacy generated file. When the new filename is available, it uses the existing rename flow so persisted index state, active sidebar state, draft host state, and aggregate output all point to the new filename. When the new filename is occupied, it retains the legacy filename for that vault rather than overwriting data or creating a second generated index.

The persisted `indexNotePath` key remains an internal compatibility mechanism. There is no user-facing filename or path setting in this change.

## Testing Strategy

Unit tests cover default-name ownership, existing-user resolution, migration planning, and collision behavior. Controller tests verify the vault rename, persisted path, sidebar retarget, draft retarget, and aggregate refresh. A repository-wide filename search checks that production fallbacks derive from the shared owner and that remaining legacy literals are intentional migration logic, tests, or historical documentation.

## Out of Scope

- A configurable index filename.
- A configurable index folder.
- Renaming any note other than Aside's generated `Aside index.md`.
- Changing the generated index contents or presentation.
