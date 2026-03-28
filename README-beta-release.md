# Beta Release

`SideNote2` should go through a short beta release cycle before we submit it to Obsidian's community plugin directory.

## Policy

- Publish a GitHub release first.
- Use BRAT to distribute the plugin to testers.
- Collect feedback and ship fixes through new beta releases.
- Submit to the community plugin directory only after the beta is stable.

This reduces review risk and catches cross-platform issues before the plugin is listed in Obsidian.

Use [README-qa.md](./README-qa.md) for tester setup and the platform-by-platform verification checklist.

## Current Beta Track

- Current beta repo: `vicky469/SideNote2`
- Current beta tag: `1.0.14`
- Beta install source: published GitHub releases

BRAT does not install from a draft release. The GitHub release must be published.
During the current beta phase, our GitHub Actions workflow creates a published GitHub pre-release when a semver tag is pushed.

## Maintainer Steps

Use [README-release.md](./README-release.md) for the shared release mechanics. This document covers the beta-specific rollout decisions.

1. Prepare the next beta release.
2. Run `npm run release:check`.
3. Publish the GitHub release with these assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Mark the GitHub release as a pre-release during beta.
5. Do not submit to `obsidian-releases` yet.
6. Share the repo path `vicky469/SideNote2` with testers.
7. Ask testers to install through BRAT.
8. Collect bug reports and platform feedback.
9. Ship fixes as new patch releases, for example `1.0.14`, `1.0.15`, and so on.
10. After the beta is stable, publish the final release and submit the plugin to the community directory.

## What Testers Should Verify

Use [README-qa.md](./README-qa.md) for the full tester install steps, platform notes, smoke test, and bug report format.

During this beta phase, make sure the tester checklist covers:

- the core side comment workflow,
- `[[wikilinks]]` inside side comments,
- `SideNote2 index.md` updates,
- the optional Codex GitHub skill install and prompt-driven side comment update flow,
- reload and persistence behavior.

## Updating During Beta

1. Publish a new GitHub release.
2. Ask testers to run BRAT's update command for beta plugins.
3. Confirm the new version installs cleanly.
4. Re-test any behavior touched by the fix.

## Exit Criteria

We submit to the community plugin directory after:

- the beta release installs cleanly through BRAT,
- there are no known critical bugs,
- the core note comment workflow is stable,
- the release assets are correct,
- the README and license are ready for review.
