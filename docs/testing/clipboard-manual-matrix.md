# Clipboard Manual Test Matrix

Run this matrix against a release-candidate build. Automated tests do not satisfy these rows because Node cannot reproduce operating-system clipboard permissions, Obsidian window focus, or mobile clipboard integration.

Use harmless test content. For the background-access check, use a unique canary such as `ASIDE-CLIPBOARD-CANARY-7391`, never a real secret.

## Environments

- [ ] Obsidian 1.12.7 desktop, main window
- [ ] Obsidian 1.13 or later desktop, main window
- [ ] Obsidian desktop pop-out window
- [ ] At least one supported mobile platform

## Paste

| Status | Scenario | Expected result |
| --- | --- | --- |
| [ ] | Paste multiline plain text into the start, middle, and selected range of an Aside draft. | Text appears once, preserves line breaks, replaces the selection, and supports Undo. |
| [ ] | Paste headings, bold text, lists, and links copied from a rich-text source. | Aside inserts readable Markdown without duplicate content. |
| [ ] | Paste copied Excalidraw elements into an Aside draft. | Aside inserts a compact `[Excalidraw clipboard: …]` description instead of raw JSON. |
| [ ] | Paste into the main editor or another plugin surface. | Aside does not intercept or transform the paste. |

## Copy and share

| Status | Scenario | Expected result |
| --- | --- | --- |
| [ ] | Select rendered Aside comment text and press Cmd/Ctrl+C. | Only the contained selected text is placed on the clipboard. |
| [ ] | Select text that crosses from outside the Aside comment content into it. | Aside does not intercept the platform's native copy behavior. |
| [ ] | Copy selected text inside an Aside draft textarea. | Native textarea copy works without interference. |
| [ ] | Click **Share side note** and paste the result externally. | The clipboard contains the correct `obsidian://aside-comment` URI and opening it targets the intended comment. |
| [ ] | Repeat rendered-text copy, draft copy, share, and paste inside a desktop pop-out. | Operations use the active pop-out document and produce the same results as the main window. |
| [ ] | Repeat plain paste, rendered-text copy, and Share side note on mobile. | Supported mobile clipboard operations complete without duplicated or missing content. |

## Permission and background behavior

| Status | Scenario | Expected result |
| --- | --- | --- |
| [ ] | Deny or make the async clipboard writer unavailable, then invoke Share side note or explicit sidebar copy on a platform that supports `execCommand`. | The temporary-textarea fallback copies successfully and leaves no visible textarea or focus artifact. |
| [ ] | Put the harmless canary on the clipboard, then navigate, save comments, and reload Aside without copying or pasting. | Clipboard content remains unchanged and no clipboard permission prompt appears. |
| [ ] | Search Aside plugin data and logs for the harmless canary after the background test. | The canary is absent from persisted data and logs. |

## Release record

Record the release version, Obsidian versions, operating systems, mobile device, failures, and any skipped permission scenario in the release notes or review evidence. Leave skipped rows unchecked and explain why they could not be exercised.
