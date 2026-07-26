# Private Publish Unpublish Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `public/index.md` when a published file is unpublished.

**Architecture:** Keep the existing deploy-first/write-state-after-success invariant. The publish controller will upsert an `unpublished` managed index row only after the deploy state and local publish state have been updated, preserving unrelated rows and owner content.

**Tech Stack:** TypeScript, Node test runner, existing publish controller tests.

---

## Scope Boundary

Implemented here:

- Mark Markdown source rows as `unpublished` after successful Markdown unpublish.
- Mark paired HTML rows as `unpublished` after successful paired HTML unpublish.
- Mark standalone HTML/PDF rows as `unpublished` after successful artifact unpublish.
- Preserve unrelated managed rows and owner-authored `index.md` content.
- Keep failed deploys from changing `index.md`.

Deferred:

- Folder unpublish.
- Server-side manifest, shell, OAuth, and D1 comments.

## Tasks

- [x] Add failing controller tests for `index.md` rows after Markdown, paired HTML, standalone HTML, and PDF unpublish.
- [x] Add controller helper(s) for `unpublished` index entries.
- [x] Wire successful unpublish paths to update `index.md` after publish state changes and before returning purge results.
- [x] Run targeted controller tests, full test suite, full build/artifact inspection, and update the tracked spec.
