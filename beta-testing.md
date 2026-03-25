# Beta Testing

`SideNote2` should go through a short beta period before we submit it to Obsidian's community plugin directory.

## Policy

- Publish a GitHub release first.
- Use BRAT to distribute the plugin to testers.
- Collect feedback and ship fixes through new beta releases.
- Submit to the community plugin directory only after the beta is stable.

This reduces review risk and catches cross-platform issues before the plugin is listed in Obsidian.

Use [qa.md](./qa.md) for tester setup and the platform-by-platform verification checklist.

## Current Beta Path

- Current beta repo: `vicky469/SideNote2`
- Current release line: `1.0.2` or newer
- Beta install source: published GitHub releases

BRAT does not install from a draft release. The GitHub release must be published.
During the current beta phase, our GitHub Actions workflow creates a published GitHub pre-release when a semver tag is pushed.

## Maintainer Steps

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
9. Ship fixes as new patch releases, for example `1.0.3`, `1.0.4`, and so on.
10. After the beta is stable, publish the final release and submit the plugin to the community directory.

## Tester Install Steps

1. Open Obsidian.
2. Install the community plugin `Obsidian42 - BRAT`.
3. Open the command palette.
4. Run `BRAT: Add a beta plugin for testing`.
5. Paste `vicky469/SideNote2`.
6. Let BRAT install the plugin.
7. Go to `Settings -> Community plugins`.
8. Enable `SideNote2`.

Testers can also use this BRAT protocol link:

```text
obsidian://brat?plugin=vicky469/SideNote2
```

## What Testers Should Verify

- Add a comment to a text selection.
- Edit a comment.
- Resolve and reopen a comment.
- Delete a comment.
- Confirm highlights appear in the note.
- Confirm `SideNote2 index.md` updates.
- Reload Obsidian and confirm comments persist.

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
