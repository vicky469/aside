# Private Publish Manifest Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server-side private publish manifest explicit and include minimal file version metadata for the future published shell.

**Architecture:** Reuse the existing private snapshot support generator, but expose its manifest shape as a core API. Each file record gets a current version and a single-entry version history based on content hash and publish timestamp.

**Tech Stack:** TypeScript, Node test runner, existing private publish snapshot core.

---

## Scope Boundary

Implemented here:

- Export manifest types and `buildPrivatePublishManifest`.
- Include folder tree, file route metadata, permission rules, supported/unsupported providers, and version metadata.
- Keep generated manifest data server-side only through the existing private module output.

Deferred:

- Historical multi-version storage.
- Filtered manifest API route.
- Three-pane shell rendering.

## Tasks

- [x] Add failing tests for exported manifest file version metadata.
- [x] Export the manifest builder and manifest types.
- [x] Add current-version and version-history fields to each manifest file.
- [x] Run focused tests, full test suite, full build/artifact inspection, update the tracked spec, and commit.
