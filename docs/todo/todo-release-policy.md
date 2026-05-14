# Release Policy After Marketplace Launch

Current state:
- Aside is in the Obsidian community plugin marketplace.
- Stable releases use GitHub releases and normal semver tags.
- GitHub `Latest` should point to the newest marketplace-ready release.

Semver guidance:
- Use `MAJOR.MINOR.PATCH` for marketplace releases.

Release checklist:
- Update `manifest.json`, `versions.json`, `package.json`, `package-lock.json`, README badge, and `docs/releases/<version>.md`.
- Run `npm run release:check`.
- Inspect the shipped assets: `main.js`, `manifest.json`, and `styles.css`.
- Publish the GitHub release and tag only after the release notes file exists and artifact inspection passes.

Open follow-up:
- Keep release automation focused on marketplace releases.
