# Wrangler Pages Snapshot Deploy Adapter Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the direct-upload staging/deploy path so generated Pages Functions and private modules can be staged at the Pages project root while static assets stay under the deploy asset directory.

**Architecture:** Keep static-only snapshots on the existing layout. When project files are supplied, use the existing Pages staging planner to write static assets under `assets/` and project files beside that directory, then invoke Wrangler from the temporary project root with the asset directory as the deploy target.

**Tech Stack:** TypeScript, Node test runner, existing Wrangler Pages publisher.

---

## Scope Boundary

Implemented here:

- Export a focused Wrangler Pages snapshot deploy adapter.
- Preserve existing static-only staging behavior.
- Add Pages project-root staging for generated Functions and private modules.
- Delegate `main.ts` snapshot deploys through the adapter.

Deferred:

- Passing generated private publish support files from the controller into the adapter.
- Permission-filtered manifest APIs and rendered published shell.

## Tasks

- [x] Add failing adapter tests for Pages project-root staging and static-only compatibility.
- [x] Implement the extracted deployment adapter.
- [x] Delegate `main.ts` snapshot deploys through the adapter.
- [x] Run focused tests, full test suite, full build/artifact inspection, update the tracked spec, and commit.
