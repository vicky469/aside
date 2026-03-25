# Deployment

`SideNote2` ships as an Obsidian plugin. Deployment means building the plugin, publishing a GitHub release with the required assets, and for the first public launch, submitting the plugin to Obsidian's community catalog.

## Release Baseline

- Initial public release version: `1.0.0`
- Versioning scheme: semantic versioning in `x.y.z` format
- Current minimum supported Obsidian version: `0.15.0`
- Release assets: `main.js`, `manifest.json`, `styles.css`
- Compatibility map: `versions.json`

`minAppVersion` stays at `0.15.0` unless the plugin starts using newer Obsidian APIs or launch testing shows a higher floor is required.

## Automation

- `.github/workflows/release.yml` creates a draft GitHub release whenever a semantic-version tag is pushed.
- `npm version patch|minor|major` updates `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` together.
- The workflow assumes GitHub Actions has `Read and write permissions` enabled for the repository.
- The workflow can only run after this local repo is connected to a GitHub remote.

## Preflight Checklist

- Confirm the release version is the same in `manifest.json`, `package.json`, and `package-lock.json`.
- Confirm `versions.json` contains the release version mapped to the intended `minAppVersion`.
- Run `npm run release:check`.
- Smoke test in a local Obsidian vault:
  - Enable the plugin.
  - Add a comment from a text selection.
  - Edit, resolve, reopen, and delete comments.
  - Confirm highlights render in the note.
  - Confirm `SideNote2 index.md` is generated and updated.
  - Reload the plugin and verify comments persist.
- Review the README files for any user-facing changes that need documentation.

## Release Steps

1. Choose the next release version.
2. Run `npm version patch|minor|major` or update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` together.
3. Run `npm run release:check`.
4. Build the release artifact with `npm run build`.
5. Verify that `main.js` exists at the repo root. Do not commit it.
6. Commit the release metadata and documentation changes.
7. Push the commit and the semantic-version tag that exactly matches the plugin version, for example `1.0.0`.
8. Let GitHub Actions create the draft GitHub release from that tag.
9. Review the draft release and confirm these files are attached:
   - `main.js`
   - `manifest.json`
   - `styles.css`

## Initial Community Launch

For the first public launch only:

1. Publish the GitHub release first.
2. Submit the plugin to the `obsidian-releases` community plugin list.
3. Use the GitHub repository URL that hosts the release assets.
4. Do not change the plugin `id` after submission.

## Hotfix Process

- For a bug fix after launch, increment the patch version only.
- Update `versions.json` for the new release.
- Run `npm run release:check` again before publishing.
- Publish a new GitHub release instead of modifying an existing one.
