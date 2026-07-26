# Private Publish Filtered Manifest Route Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the private publish manifest through a generated Pages Function that returns only permission-filtered client metadata.

**Architecture:** Keep the full manifest in the private project-root module. Add a generated private runtime module for identity normalization, permission resolution, and filtered client-manifest projection. Add a generated `_aside/api/site-manifest` Pages Function that reads the private manifest and returns the filtered projection. Session identity stays `null` until the Google OAuth slice adds signed cookies.

**Tech Stack:** TypeScript, Node test runner, generated Cloudflare Pages Functions/modules.

---

## Scope Boundary

Implemented here:

- Generate `functions/_aside/api/site-manifest.js`.
- Generate `src/_aside/private-publish-runtime.js`.
- Filter client-visible files, tree, and per-file permissions by identity.
- Keep raw permission rules server-side only.
- Report WeChat as unsupported while preserving it in generated provider metadata.

Deferred:

- Google OAuth and signed session cookie identity resolution.
- Static asset middleware permission enforcement.
- D1-backed comments and comment API permission enforcement.
- Three-pane browser shell assets.

## Tasks

- [x] Add failing generated-runtime tests for identity-filtered manifest projection.
- [x] Add the generated private runtime module.
- [x] Add the generated `_aside/api/site-manifest` route.
- [x] Update support-file expectations for the new generated route/module.
- [x] Run focused tests, full test suite, full build/artifact inspection, update the tracked spec, and commit.
