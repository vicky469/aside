# Private Package Repository Design

**Date:** 2026-07-19
**Status:** Approved for implementation planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The public Aside repository uses a single `origin` remote for normal pushes.
- [x] The public Aside package is currently marked `"private": true` and is not configured for npm publishing.
- [x] The public Aside package manifest currently lists only public npm dependencies.

### To Implement

- [ ] Create a private GitHub repository named `aside-private` under the same GitHub owner used for the public Aside repository.
- [ ] Initialize `aside-private` as a source repository for private modular packages, not as a second remote for the public `aside` repository.
- [ ] Add a minimal private npm workspace structure under `packages/` so new internal modules can be added incrementally.
- [ ] Document the boundary rule: the public `aside` repository must remain buildable without private dependencies unless an explicit private edition or private build path is designed later.
- [ ] Document the future package publication path for stabilized private modules, with GitHub Packages as the default private package registry.
- [ ] Avoid adding private package dependencies, private registry configuration, or a private remote to the public `aside` repository in this setup step.

### Verification

- [ ] `gh repo view vicky469/aside-private --json name,visibility` or equivalent confirms the repo exists and is private.
- [ ] The initialized `aside-private` repository contains `README.md`, root `package.json`, `packages/README.md`, and `docs/modularization.md`.
- [ ] The public `aside` repository still has only its normal `origin` remote.
- [ ] The public `aside` package manifest remains free of private package dependencies and private registry configuration.
- [ ] No release artifact or public marketplace output changes are introduced by this setup.

## Problem

Aside is moving toward a more modular design. Some modules will be useful as packages but should not necessarily be public while the boundaries are still evolving. The project needs a private home for those packages without weakening the public plugin repository's release safety or making public builds depend on private credentials.

The current public repository also has an explicit routing rule: it uses one `origin` remote, and normal pushes go there. A private repository should therefore be a separate repository, not an extra remote attached to the public checkout.

## Goals

- Create a private GitHub repository for future Aside package extraction.
- Keep the public `aside` repository buildable without private dependencies.
- Allow private modules to start as source packages and evolve gradually.
- Preserve the public repository's single-remote push model.
- Make the eventual package distribution path clear before private modules are consumed.

## Non-Goals

- Moving existing Aside code into packages in this first step.
- Publishing private npm packages immediately.
- Adding private dependencies to the public plugin build.
- Creating a private edition of Aside in this first step.
- Mirroring the public repository source into a private fork.
- Changing the public release artifact contents.

## Repository Boundary

`aside-private` is the owner of experimental or private package source. It is not a deployment repository and not a second remote for `aside`.

The public `aside` repository remains the Obsidian marketplace plugin repository. It should continue to install, typecheck, test, build, and release using only public dependencies unless a later approved design intentionally introduces a separate private edition or private build path.

This boundary keeps three concerns separate:

- public plugin releases;
- private package development;
- future private/package distribution.

## Initial Private Repository Layout

The initial repository should be intentionally small:

```text
aside-private/
  README.md
  package.json
  packages/
    README.md
  docs/
    modularization.md
```

The root `package.json` should be private and workspace-enabled. It should not publish anything from the root package.

The `packages/` directory is the place for future packages such as extracted domain utilities, private integration adapters, or package candidates that are not ready to be public.

`docs/modularization.md` should capture the standing rule that a private package can influence the public plugin only through an explicit integration decision. Until then, private code can be developed and tested independently.

## Package Flow

Start with source-only private packages inside `aside-private`. Once a package boundary stabilizes, publish it to GitHub Packages under the repository owner's npm scope.

The default future package naming pattern should be:

```text
@vicky469/aside-<module-name>
```

Consuming private packages from the public `aside` repository is out of scope for this setup. If that becomes necessary, it should be designed as one of:

- a private edition/build path that is allowed to require credentials;
- a build-time vendoring or sync step that preserves public standalone builds;
- a public extraction path for packages that are safe to publish.

## Public Repository Constraints

This setup must not modify public release behavior.

Specifically, it must not:

- add `aside-private` as a Git remote in the public checkout;
- add `.npmrc` or private registry credentials to the public repository;
- add private package dependencies to the public `package.json`;
- change the public bundle or release artifact allowlist;
- require private GitHub access for normal public builds.

Any later change that makes public Aside consume private code must include explicit release artifact review, because bundled JavaScript exposes the shipped implementation even when the source package is private.

## Error Handling

If GitHub repository creation fails because the repo already exists, the setup should inspect the existing repo before writing to it. If it is private and empty or compatible with this design, initialize the missing skeleton files. If it is public or contains unrelated content, stop and ask for direction.

If GitHub CLI authentication lacks permission to create private repositories, stop and report the exact missing permission instead of falling back to a local-only repository.

If the intended owner cannot be inferred from the existing `origin` remote, stop and ask which GitHub owner should host the private repository.

## Testing and Verification

Verification is mostly structural:

- confirm the created GitHub repository exists and is private;
- confirm the private repo has the initial workspace skeleton;
- confirm the public repo's remote configuration is unchanged;
- confirm the public package manifest still has no private dependencies or private registry configuration.

No public `npm run build` is required for the setup unless the implementation changes public repository files beyond this spec document. If any public build or packaging file changes are made later, the normal build and release artifact checks apply.
