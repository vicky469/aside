# QA Guide

This guide explains how to install and test the `SideNote2` beta in a normal user vault on different machines.

Use this guide for:

- Windows
- macOS
- Ubuntu
- iPhone

## Scope

- Beta installs should use the published GitHub beta release, not the dev symlink setup.
- Plugins are installed per vault, not globally.
- Each tester should repeat these steps in their own vault on their own device.
- Current beta repo: `vicky469/SideNote2`
- Current beta release line: `1.0.5` or newer

## Prerequisites

- Obsidian is installed on the test device.
- The tester has a vault open.
- Community plugins are allowed in that vault.
- The vault is not using the dev checkout directly.

## Standard Setup For Any Tester

1. Open the target vault in Obsidian.
2. Open `Settings -> Community plugins`.
3. Turn on community plugins if Restricted mode is still enabled.
4. Select `Browse` and install `Obsidian42 - BRAT`.
5. Enable `BRAT`.
6. Open the command palette.
7. Run `BRAT: Add a beta plugin for testing`.
8. Paste `vicky469/SideNote2`.
9. Wait for BRAT to finish the install.
10. Go back to `Settings -> Community plugins`.
11. Refresh the installed plugin list if needed.
12. Enable `SideNote2`.
13. Confirm the installed `SideNote2` version matches the current beta release.

Optional BRAT protocol link:

```text
obsidian://brat?plugin=vicky469/SideNote2
```

## Platform Notes

### Windows

- Follow the standard setup exactly.
- Use the right-click editor menu to test `Add comment to selection`.

### macOS

- Follow the standard setup exactly.
- Use the right-click editor menu to test `Add comment to selection`.

### Ubuntu

- Follow the standard setup exactly.
- Use the right-click editor menu to test `Add comment to selection`.

### iPhone

- Open `Settings` from the mobile sidebar.
- Install and enable `BRAT` from `Community plugins`.
- Open the command palette from the mobile UI.
- Install `SideNote2` through BRAT the same way as desktop.
- Enable `SideNote2` in `Community plugins`.
- If the editor context menu does not expose `Add comment to selection`, use the command palette command `SideNote2: Add comment to selection`.

## Smoke Test

1. Open any markdown note.
2. Select a short piece of text.
3. Start a comment:
   Desktop: right-click and choose `Add comment to selection`.
   iPhone: use the command palette if the context menu is not available.
4. Confirm the `SideNote2` sidebar opens.
5. Write and save a comment.
6. Confirm the selected text is highlighted.
7. Edit the comment.
8. Inside the side comment editor, type `[[` and:
   Create a link to an existing note, or create a new markdown note through the suggester flow.
9. Save the comment and confirm the rendered side comment link opens the expected note.
10. Use the comment actions menu and confirm `Copy` works.
11. Resolve the comment.
12. Reopen the comment.
13. Delete a test comment.
14. Confirm `SideNote2 index.md` updates.
15. Optional Codex check: install the `sidenote2` CLI and run `sidenote2 install-skill`.
16. Restart Codex and confirm it can pick up the SideNote2 skill.
17. Ask Codex to update the side comment for the selected text by note path, then confirm the note file updates correctly.
18. Close and reopen Obsidian, or reopen the vault.
19. Confirm the comment data persists after reload.

## Update Test During Beta

1. Publish a newer beta release.
2. In Obsidian, open the command palette.
3. Run BRAT's update command for beta plugins.
4. Confirm `SideNote2` updates to the new version.
5. Re-run the smoke test for the changed behavior.

## Test Report Template

- Device: `Windows`, `macOS`, `Ubuntu`, or `iPhone`
- OS version:
- Obsidian version:
- Vault name:
- BRAT version:
- SideNote2 version:
- Step number that failed:
- Expected result:
- Actual result:
- Screenshot or screen recording:

## Exit Criteria Before Community Submission

- `SideNote2` installs cleanly through BRAT on the target platforms.
- The plugin enables successfully after install.
- The core comment workflow works in normal user vaults.
- `SideNote2 index.md` updates correctly.
- No critical bug is open for the beta release.
