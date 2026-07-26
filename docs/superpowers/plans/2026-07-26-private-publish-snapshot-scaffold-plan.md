# Private Publish Snapshot Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first private deployment snapshot primitives without exposing `auth.md` or generated permission data as static content.

**Architecture:** Keep current public publish behavior working while adding a pure core generator for private Pages support files. Wire only the hard security exclusion into the controller now; defer full Pages Functions deployment wiring until the generated auth gate can enforce access.

**Tech Stack:** TypeScript, Node test runner, Cloudflare Pages direct upload conventions, existing publish controller tests.

---

## Scope Boundary

Implemented here:

- `public/auth.md` and root `public/index.md` are ignored by the enabled snapshot scanner even if stale publish frontmatter exists.
- A pure snapshot-support generator can emit `_routes.json`, Pages Functions stub files, and a private manifest module for later controller wiring.
- Generated permission rules are kept in a non-route private module imported by Pages Functions, not a readable static JSON asset or route file.

Deferred:

- Wiring generated Functions into real Cloudflare deployments.
- Google OAuth/session enforcement.
- D1 comment read/write APIs.
- Three-pane browser shell.

## Tasks

- [x] Add failing controller coverage proving root control Markdown files are never deployed from stale frontmatter.
- [x] Add failing core coverage for generated private snapshot support files and server-only permission data.
- [x] Implement the controller control-file skip in the enabled snapshot scan.
- [x] Implement the private snapshot support generator.
- [x] Run focused tests, full test suite, full build/artifact inspection, update the tracked spec, and commit.
