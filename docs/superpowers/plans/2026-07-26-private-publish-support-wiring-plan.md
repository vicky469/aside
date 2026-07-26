# Private Publish Support Wiring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire generated private publish support files into actual publish snapshots so `auth.md` permissions reach server-side Pages code without exposing `auth.md` or generated permission data as public static files.

**Architecture:** Keep deployed content files separate from generated support. The publish controller builds a content manifest from enabled snapshot files, parses root `auth.md`, hashes deployed contents for version metadata, and passes generated static support plus Pages project files to the host. The Obsidian plugin host forwards that support into the Wrangler Pages snapshot adapter.

**Tech Stack:** TypeScript, Node test runner, existing private publish support generator and Wrangler Pages adapter.

---

## Scope Boundary

Implemented here:

- Add a deploy-support payload to the publish host contract.
- Parse root `auth.md` during non-empty snapshot deployment.
- Hash deployed snapshot contents for manifest version metadata.
- Generate `_routes.json`, Pages Functions, and private manifest module support files.
- Forward support files through `main.ts` into the Wrangler Pages adapter.

Deferred:

- Permission-filtered manifest API responses.
- Real Google OAuth session validation.
- D1-backed published comments.
- Rendered three-pane published shell assets.

## Tasks

- [x] Add failing controller integration coverage for generated private Pages support from `auth.md`.
- [x] Extend the publish deploy host contract with static/project support files.
- [x] Build snapshot content metadata, parse auth rules, and generate support files in the controller.
- [x] Forward generated support files through `main.ts` to the Wrangler Pages adapter.
- [x] Run focused tests, full test suite, full build/artifact inspection, update the tracked spec, and commit.
