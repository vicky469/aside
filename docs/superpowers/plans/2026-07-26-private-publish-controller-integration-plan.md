# Private Publish Controller Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the private publish core helpers into the existing public HTML publish controller so a user can publish one file, a folder, or the whole configured publish root while maintaining `index.md`.

**Architecture:** Keep the current deploy-first/write-state-after-success behavior. The controller remains the boundary for publish state mutation; Obsidian-specific file creation and listing stay behind `PublicHtmlPublishHost`.

**Scope Boundary**

Implemented here:

- Create `index.md` under the configured publish root when publishing is enabled or a publish operation runs.
- Preserve existing owner content and previous managed index rows.
- Publish a file, folder, or the whole configured root through controller APIs.
- For folder/root publish, enable selected Markdown files and remember selected HTML/PDF artifacts.
- Exclude root control files `index.md` and `auth.md` from folder/root deploy selection.
- Add Obsidian commands for publishing the current file's folder and the whole configured root.

Deferred:

- Generated simplified Obsidian site shell.
- OAuth middleware and identity sessions.
- D1-backed published comments.
- WeChat runtime auth.
- Folder unpublish and permission-aware remote browsing.

## Tasks

- [x] Extend private publish index helpers with read/merge support for the managed table.
- [x] Add folder/root publish tests at the `PublicHtmlPublishController` boundary.
- [x] Implement controller APIs for `ensurePrivatePublishIndex`, `publishFolder`, and `publishRoot`.
- [x] Wire Obsidian host methods for all-file listing and create-or-update writes.
- [x] Add commands for publishing the active folder and configured root.
- [x] Run targeted tests, full tests, build/artifact inspection, and update tracking docs.
