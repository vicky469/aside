# Local Publish Feature Flag Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has a typed `publish` feature flag that defaults to disabled.
- [x] The complete **Publishing (experimental)** settings group is hidden while the publish feature flag is disabled.
- [x] Publish actions reject requests while the publish feature flag is disabled.
- [x] Aside can reload through Obsidian's plugin manager after a DevTools change.

### To Implement

- [ ] Read the publish feature flag from the browser local-storage key `aside.feature.publish`.
- [ ] Enable publishing features only when the stored value is the exact string `true`.
- [ ] Keep the feature flag out of Aside's persisted `data.json`.
- [ ] Remove any legacy `featureFlags` property from `data.json` during normalized settings persistence.
- [ ] Replace the repository-only feature-flag CLI instructions with DevTools local-storage instructions.
- [ ] Document explicit enable and disable snippets that also reload Aside.

### Verification

- [ ] Unit tests cover an absent key, the exact enabled value, and other disabled values.
- [ ] Settings tests confirm the publishing group follows the local-storage-backed runtime flag.
- [ ] Persistence tests confirm `featureFlags` is not written to `data.json` and a legacy property is removed.
- [ ] The documented enable snippet reveals publishing settings after Aside reloads.
- [ ] The documented disable snippet hides publishing settings after Aside reloads.
- [ ] `npm run build` passes.

## Context

Aside's experimental publishing controls should remain invisible after a normal community-plugin installation or update. Testers should be able to reveal them without cloning the repository, installing a separate CLI, or editing the plugin's source.

The existing feature flag is stored in Aside's `data.json` and the documented setter is a repository script invoked through `npm run feature:flag`. Community-plugin releases do not ship that script, so the documented opt-in is unavailable to users who only have the installed plugin.

Obsidian Developer Tools already gives testers a familiar way to reload a plugin. Browser local storage provides a small, durable, device-local opt-in that can be changed either from the console or the Application panel.

## Goals

- Keep experimental publishing hidden by default.
- Let a tester enable it with a short DevTools snippet.
- Let a tester inspect or change the flag directly in Developer Tools local storage.
- Preserve the opt-in across Aside plugin updates and Obsidian restarts.
- Keep the actual **Enable publishing** setting and publishing configuration vault-local.
- Provide an equally simple way to disable and hide the feature again.

## Non-Goals

- Do not expose a feature-flag toggle in Aside settings or the command palette.
- Do not add or publish a standalone Aside CLI.
- Do not treat the visibility flag as authorization to publish content.
- Do not move normal publishing configuration out of `data.json`.
- Do not synchronize the feature flag through Obsidian Sync or vault files.
- Do not react to local-storage changes while Aside is running; a plugin reload is required.

## Storage Contract

Use one local-storage entry:

```text
Key: aside.feature.publish
Enabled value: true
```

`localStorage.getItem("aside.feature.publish") === "true"` is the complete enablement rule. A missing key, an empty value, different capitalization, JSON booleans serialized in another form, and all other strings are disabled.

The key is global to the current Obsidian browser profile rather than scoped to a vault. Enabling it therefore reveals the publishing settings group in every vault opened by that profile. This is acceptable because the flag only reveals an experimental UI surface. Each vault retains its own default-off `publishEnabled` value, Pages project, publishing URL, allowed root, and published-artifact state in Aside's normal plugin data.

Clearing Obsidian's browser storage may remove the opt-in. A plugin update or normal restart must not remove it.

## Runtime Design

Keep the existing typed `FeatureFlags` runtime shape so settings visibility and publish validation continue to consume a single flag source.

Add a small dependency-free reader in the feature-flag module. It accepts a minimal storage interface so it can be unit tested without a browser. The reader returns the default-off feature flags when storage is unavailable or throws, and returns `publish: true` only for the exact stored value.

During plugin startup, load normal persisted settings first, then derive `settings.featureFlags` from safe browser local storage before registering publish actions or settings UI. The flag remains runtime-only after that point.

Aside does not listen for the browser `storage` event. A tester changes the value and reloads Aside, matching the existing Developer Tools plugin-refresh workflow.

## Persistence and Legacy Data

`featureFlags` must no longer be a canonical `data.json` setting:

- Loaded legacy values do not enable the feature.
- Normalized settings use the runtime local-storage value.
- Every plugin-data write strips the `featureFlags` property.
- Existing publish configuration remains untouched.

This deliberately requires testers who used the previous repository CLI to opt in once through local storage. It prevents a stale `data.json` flag from competing with the new source of truth.

## DevTools Workflow

The documented enable snippet sets the flag and reloads Aside:

```js
localStorage.setItem("aside.feature.publish", "true");
await app.plugins.disablePlugin("aside");
await app.plugins.enablePlugin("aside");
```

The documented disable snippet removes the flag and reloads Aside:

```js
localStorage.removeItem("aside.feature.publish");
await app.plugins.disablePlugin("aside");
await app.plugins.enablePlugin("aside");
```

A tester may instead edit `aside.feature.publish` directly under Developer Tools → Application → Local Storage. Aside must still be reloaded afterward.

The README should replace the repository-only `npm run feature:flag` instruction with this workflow. Repository scripts that no longer have a supported consumer should be removed together with their tests and package script.

## Error Handling

If local storage is unavailable, access is denied, or a storage call throws, Aside treats publishing as disabled and continues loading normally. Feature-flag lookup must never prevent the plugin from starting.

The DevTools snippets rely on Obsidian's loaded `app` object and plugin manager. A console error is sufficient if Aside is not installed or cannot be re-enabled; no additional plugin UI is required for this advanced workflow.

## Testing

Core feature-flag tests should use an injected storage stub to prove exact string matching and failure-safe defaults.

Settings-planner and controller tests should prove that legacy `data.json` flags cannot enable publishing and that later saves remove `featureFlags` without disturbing other settings.

Existing setting-catalog and publish-controller tests should continue verifying behavior against the runtime `FeatureFlags` object. Integration wiring should verify startup overlays that runtime object from local storage before publishing UI or actions are registered.

Documentation review should confirm that a marketplace user needs only Obsidian Developer Tools and does not need this repository.
