# Local Publish Feature Flag Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has a typed `publish` feature flag that defaults to disabled.
- [x] The complete **Publishing (experimental)** settings group is hidden while the publish feature flag is disabled.
- [x] Publish actions reject requests while the publish feature flag is disabled.
- [x] Aside can reload through Obsidian's plugin manager after a DevTools change.

### To Implement

- [ ] Keep `data.json.featureFlags.publish` as the canonical persistent feature flag.
- [ ] Accept the exact local-storage strings `true` and `false` as requested flag changes during plugin startup.
- [ ] Persist an accepted local-storage change to `data.json`.
- [ ] Mirror the canonical persisted value to the local-storage key `aside.feature.publish`.
- [ ] Replace the repository-only feature-flag CLI instructions with DevTools local-storage instructions.
- [ ] Document explicit enable and disable snippets that also reload Aside.

### Verification

- [ ] Unit tests cover exact `true` and `false` overrides, an absent key, invalid values, and unavailable storage.
- [ ] Persistence tests confirm accepted local-storage changes update `data.json` without disturbing other settings.
- [ ] Persistence tests confirm an absent or invalid local-storage value preserves the existing `data.json` flag.
- [ ] Settings tests confirm the publishing group continues to follow the canonical runtime flag.
- [ ] The documented enable snippet reveals publishing settings after Aside reloads.
- [ ] The documented disable snippet hides publishing settings after Aside reloads.
- [ ] `npm run build` passes.

## Context

Aside's experimental publishing controls should remain invisible after a normal community-plugin installation or update. Testers should be able to reveal them without cloning the repository, installing a separate CLI, or editing the plugin's source.

The existing feature flag is stored in Aside's `data.json` and the documented setter is a repository script invoked through `npm run feature:flag`. Community-plugin releases do not ship that script, so the documented opt-in is unavailable to users who only have the installed plugin.

Obsidian Developer Tools already gives testers a familiar way to reload a plugin. Browser local storage provides an easy control surface that can be changed either from the console or the Application panel, while `data.json` remains Aside's persistent settings layer.

## Goals

- Keep experimental publishing hidden by default.
- Let a tester enable it with a short DevTools snippet.
- Let a tester inspect or change the flag directly in Developer Tools local storage.
- Persist accepted flag changes in `data.json` across Aside plugin updates and Obsidian restarts.
- Keep the actual **Enable publishing** setting and publishing configuration vault-local.
- Provide an equally simple way to disable and hide the feature again.

## Non-Goals

- Do not expose a feature-flag toggle in Aside settings or the command palette.
- Do not add or publish a standalone Aside CLI.
- Do not treat the visibility flag as authorization to publish content.
- Do not move normal publishing configuration out of `data.json`.
- Do not inspect `public/`, scan publishing metadata, or infer the flag from existing publish data.
- Do not add any new visibility behavior beyond the existing settings-group feature gate.
- Do not react to local-storage changes while Aside is running; a plugin reload is required.

## Storage Contract

The canonical persisted value remains:

```text
data.json.featureFlags.publish: boolean
```

Use one local-storage control entry:

```text
Key: aside.feature.publish
Accepted values: true or false
```

Only the exact strings `"true"` and `"false"` request a change. A missing key, empty value, different capitalization, and every other string leave the persisted flag unchanged.

The local-storage key is global to the current Obsidian browser profile, but it is an input to the currently loading vault's plugin data. After Aside loads, it mirrors that vault's canonical boolean back as `"true"` or `"false"`. Testers working with multiple vaults should change the value and reload Aside in the vault they intend to update.

Clearing Obsidian's browser storage does not disable a persisted opt-in. The next Aside load restores the local-storage mirror from `data.json`.

## Runtime Design

Keep the existing typed `FeatureFlags` runtime shape so existing settings visibility and publish validation continue to consume the canonical flag without new visibility behavior.

Add a small dependency-free synchronization planner in the feature-flag module. It accepts the persisted feature flags and the raw local-storage value, then returns the canonical flags, whether persistence is required, and the string that should be mirrored to local storage. This keeps precedence and exact-value handling testable without a browser.

During plugin startup:

1. Load and normalize settings from `data.json`.
2. Read `aside.feature.publish` through safe browser local storage.
3. Apply an exact `"true"` or `"false"` as a requested change.
4. Persist the settings only when the requested value differs from `data.json`.
5. Mirror the canonical value to local storage.
6. Register publish actions and settings UI using the canonical runtime flag.

Aside does not listen for the browser `storage` event. A tester changes the value and reloads Aside, matching the existing Developer Tools plugin-refresh workflow.

## Persistence

`featureFlags` remains part of Aside's canonical `data.json` settings. Local storage does not replace that layer. Accepted local-storage values update the same normal settings write path used elsewhere, preserving all unrelated plugin data and publishing configuration.

An absent or invalid local-storage value must never reset the persisted flag. New installations still default to `publish: false` through the existing feature-flag normalization.

## DevTools Workflow

The documented enable snippet sets the flag and reloads Aside:

```js
localStorage.setItem("aside.feature.publish", "true");
await app.plugins.disablePlugin("aside");
await app.plugins.enablePlugin("aside");
```

The documented disable snippet sets the flag to false and reloads Aside:

```js
localStorage.setItem("aside.feature.publish", "false");
await app.plugins.disablePlugin("aside");
await app.plugins.enablePlugin("aside");
```

A tester may instead edit `aside.feature.publish` directly under Developer Tools → Application → Local Storage. Aside must still be reloaded afterward.

The README should replace the repository-only `npm run feature:flag` instruction with this workflow. Repository scripts that no longer have a supported consumer should be removed together with their tests and package script.

## Error Handling

If local storage is unavailable, access is denied, or a storage call throws, Aside keeps the normalized `data.json` flag and continues loading normally. Feature-flag synchronization must never prevent the plugin from starting.

The DevTools snippets rely on Obsidian's loaded `app` object and plugin manager. A console error is sufficient if Aside is not installed or cannot be re-enabled; no additional plugin UI is required for this advanced workflow.

## Testing

Core feature-flag tests should cover the pure synchronization planner's precedence, exact string matching, persistence decision, and mirrored value.

Settings-planner and controller tests should prove that accepted local-storage changes persist through the normal `data.json` write path without disturbing other settings. They should also prove that absent, invalid, or unavailable storage preserves the persisted flag.

Existing setting-catalog and publish-controller tests should continue verifying behavior against the runtime `FeatureFlags` object. Integration wiring should verify startup overlays that runtime object from local storage before publishing UI or actions are registered.

Documentation review should confirm that a marketplace user needs only Obsidian Developer Tools and does not need this repository.
