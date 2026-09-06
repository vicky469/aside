# Advanced Settings Graduation Design

**Date:** 2026-09-06
**Status:** Approved

## Implementation Tracking

- [ ] Reorder settings groups to Sidebar tabs, Scripts (advanced), Publishing (advanced), Index note in both declarative and legacy settings renderers.
- [ ] Remove the complete feature-flag model, browser-storage synchronization, startup sequencing, and persisted `featureFlags` setting.
- [ ] Keep publishing unavailable until the visible **Enable publishing** toggle is on, without a second hidden gate.
- [ ] Rename the experimental-features guide to an advanced-features guide and remove obsolete DevTools activation instructions.
- [ ] Update settings, publishing, persistence, startup, and documentation tests.
- [ ] Run focused regression tests and the complete build/release-artifact verification.

## Context

Aside currently treats publishing as both a visible setting and a hidden feature flag. This leaves the Publishing settings absent for most users, duplicates availability policy in settings and runtime validation, and requires a DevTools/local-storage activation flow. Scripts have already graduated from their former feature flag but their settings label does not identify the section as advanced.

## Selected Design

The settings page uses this exact section order:

1. **Sidebar tabs**
2. **Scripts (advanced)**
3. **Publishing (advanced)**
4. **Index note**

The `advanced` suffix is informational. It does not hide either section or require an activation step.

Publishing keeps one ordinary capability control: **Enable publishing**. The Publishing section and this toggle are always visible. Publishing configuration fields remain hidden until the toggle is enabled, and publish actions continue to reject execution while it is off.

## Feature-Flag Removal

Remove the remaining `publish` feature flag rather than hard-coding it to `true`. Delete its types, normalization, browser-local-storage synchronization, startup call, host adapters, validation branch, and tests. Loaded plugin data may still contain a legacy `featureFlags` property; settings normalization will omit it on the next normal save instead of retaining or migrating it.

The visible `publishEnabled` setting remains persisted and authoritative. No publishing command, action, or network request runs merely because the advanced section is visible.

## Documentation

Rename `EXPERIMENTAL_FEATURES.md` to `ADVANCED_FEATURES.md`, update the README link, and describe publishing as an advanced desktop workflow. Delete the local-storage enable/disable snippets and direct users to **Settings → Aside → Publishing (advanced)**. Historical release notes and historical design documents remain unchanged because they describe behavior at the time of release.

## Verification

- Settings catalog tests assert the exact group order and labels in the shared source of truth.
- Settings visibility tests assert both advanced groups are always present while dependent publishing fields still follow `publishEnabled`.
- Publishing validation/controller tests assert the visible toggle is the only availability gate.
- Settings-loading tests assert legacy `featureFlags` data is dropped without disturbing current settings.
- Startup and documentation tests assert no production feature-flag synchronization or hidden activation instructions remain.
- Full build runs TypeScript tests, direct tests, lint, typecheck, Obsidian compliance, production bundling, bundle-size checks, and exact release-artifact inspection.

