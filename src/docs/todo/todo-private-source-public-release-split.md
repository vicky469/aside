# TODO: Split Private Source Repo From Public Release Repo

Related spec:

- [../prd/private-source-public-release-split-spec.md](../prd/private-source-public-release-split-spec.md)
- [todo-private-vs-public-repo-workflow.md](private-vs-public-repo-workflow.md)

Context:
- GitHub visibility is repository-wide. A public repo cannot hide `src/`, `tests/`, or any other tracked path inside that same repo.
- A private submodule inside a public repo is not a good fit here. The public repo still exposes that the submodule exists, and public clones cannot fetch it without access.

Sources:
- https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

Recommended structure:
- `SideNote2-source` as a private repo
  Keep `src/`, `tests/`, build scripts, CI, and full development history here.
- `SideNote2` as a public release repo
  Keep only `main.js`, `manifest.json`, `styles.css`, `versions.json`, `README.md`, and release assets here.
- Publish one-way from private to public
  Build in the private repo, then push or copy only release artifacts into the public repo.

Practical migration:
1. Create a new private source repo from the current full repo.
2. Create a public release repo that contains only shipped plugin artifacts and public docs.
3. Add a publish script or GitHub Action in the private repo to update the public release repo.
4. Decide whether the current public repo history also needs to be rewritten to remove old source paths.

History rewrite notes:
- If old public history should no longer expose `src/`, `tests/`, or other private paths, use `git-filter-repo` to rewrite history.
- GitHub documents side effects for history rewrites, including changed commit hashes, broken signatures, and cleanup work across forks and local clones.
- GitHub Support will not remove non-sensitive data just because history was rewritten, so old data may still exist in forks, cached refs, or prior clones.

Open tasks:
- define the exact file allowlist for the public release repo
- choose whether the current `SideNote2` repo becomes the private source repo or the public release repo
- implement the publish path from private source to public release
- decide whether to rewrite old public history now or leave it as-is
