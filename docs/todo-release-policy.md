# TODO: Release Policy After Marketplace Launch

Current state:
- SideNote2 is still in beta.
- We distribute through GitHub releases and BRAT.
- We use normal GitHub releases so the newest version can be marked as `Latest`.

Why:
- GitHub does not allow a release to be both `Latest` and `Pre-release`.
- While SideNote2 is not yet in the Obsidian marketplace, treating beta builds as normal releases keeps the install/update path simpler.

Future policy after marketplace launch:
- Stable track:
  - publish normal GitHub releases such as `1.1.0`, `1.1.1`
  - these are the versions intended for marketplace users
  - GitHub `Latest` should point to this track
- Beta track:
  - publish GitHub prereleases such as `1.2.0-beta.1`, `1.2.0-beta.2`
  - these are intended for BRAT testers
  - do not mark these as `Latest`

Semver guidance:
- Stable: `MAJOR.MINOR.PATCH`
- Beta: `MAJOR.MINOR.PATCH-beta.N`

When to switch:
- After SideNote2 is accepted into the Obsidian community plugin marketplace.
- At that point, split release automation so stable releases and beta prereleases are separate.

Open follow-up:
- decide whether beta builds should continue from `main` and stable releases from release branches, or whether both should be cut from `main` with manual version discipline
