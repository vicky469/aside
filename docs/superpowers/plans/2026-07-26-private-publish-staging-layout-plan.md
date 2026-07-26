# Private Publish Staging Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a testable staging-layout planner for future Wrangler Pages deployments with static assets, Pages Functions, and private server modules separated correctly.

**Architecture:** Keep the current deploy code unchanged in this slice, and add a pure planner that future deployment wiring can call. The planner models a temp Pages project root containing an asset directory plus project-root files such as `functions/` and private source modules.

**Tech Stack:** TypeScript, Node test runner, Cloudflare Pages Direct Upload layout.

---

## Scope Boundary

Implemented here:

- A pure planner maps static assets into an asset directory relative to the temp Pages project root.
- The same planner maps `functions/` and private module files into project-root paths outside the asset directory.
- The planner rejects unsafe paths that escape the asset or project roots.

Deferred:

- Wiring the planner into `publishSnapshotArtifacts`.
- Passing generated private snapshot support files through the deploy controller.
- Google OAuth and D1 comment routes.

## Tasks

- [x] Add failing tests for static asset, function, and private module staging layout.
- [x] Add failing tests for path traversal rejection.
- [x] Implement the pure staging-layout planner.
- [x] Run focused tests, full test suite, full build/artifact inspection, update the tracked spec, and commit.
