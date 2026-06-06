# Thought Trail Related Files Source Implementation Plan

> **Superseded:** Do not execute this plan as-is.

The active spec is `docs/superpowers/specs/2026-06-05-thought-trail-related-files-source-design.md`.

Regenerate a fresh implementation plan from that spec before implementation. The active design requires:

- Tags live only inside Thought Trail, not as an index primary tab.
- Wikilinks remain the default selected source.
- Source choice is session-only.
- Tag relationships use the union of markdown-file tags and side-note tags.
- Related files match by shared-tag overlap, not by requiring every source tag.
