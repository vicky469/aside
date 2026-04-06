#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF_DIR="$ROOT/references"
SRC_ROOT="${OBS_PLUGIN_DEV_SRC_ROOT:-/tmp/obsidian-plugin-dev-sources}"
SYNC_REMOTE="${SYNC_REMOTE:-1}"

clone_or_update() {
  local name="$1"
  local repo="$2"
  local dest="$SRC_ROOT/$name"

  if [[ ! -d "$dest/.git" ]]; then
    git clone --depth 1 "$repo" "$dest"
    return
  fi

  if [[ "$SYNC_REMOTE" == "1" ]]; then
    git -C "$dest" fetch --depth 1 origin HEAD
    git -C "$dest" reset --hard FETCH_HEAD
    git -C "$dest" clean -fd
  fi
}

mkdir -p "$SRC_ROOT" "$REF_DIR"

clone_or_update "obsidian-developer-docs" "https://github.com/obsidianmd/obsidian-developer-docs.git"
clone_or_update "obsidian-help" "https://github.com/obsidianmd/obsidian-help.git"
clone_or_update "obsidian-api" "https://github.com/obsidianmd/obsidian-api.git"
clone_or_update "obsidian-sample-plugin" "https://github.com/obsidianmd/obsidian-sample-plugin.git"

rm -rf \
  "$REF_DIR/developer-docs" \
  "$REF_DIR/help" \
  "$REF_DIR/api" \
  "$REF_DIR/sample-plugin"

mkdir -p \
  "$REF_DIR/developer-docs/Plugins" \
  "$REF_DIR/developer-docs/Reference" \
  "$REF_DIR/help/Extending Obsidian" \
  "$REF_DIR/help/Contributing to Obsidian" \
  "$REF_DIR/api/obsidian-api" \
  "$REF_DIR/sample-plugin/src"

rsync -a --delete \
  "$SRC_ROOT/obsidian-developer-docs/en/Plugins/" \
  "$REF_DIR/developer-docs/Plugins/"

rsync -a --delete \
  "$SRC_ROOT/obsidian-developer-docs/en/Reference/TypeScript API/" \
  "$REF_DIR/developer-docs/Reference/TypeScript API/"

rsync -a --delete \
  "$SRC_ROOT/obsidian-developer-docs/en/Reference/CSS variables/" \
  "$REF_DIR/developer-docs/Reference/CSS variables/"

cp \
  "$SRC_ROOT/obsidian-help/en/Extending Obsidian/Community plugins.md" \
  "$SRC_ROOT/obsidian-help/en/Extending Obsidian/Plugin security.md" \
  "$SRC_ROOT/obsidian-help/en/Extending Obsidian/Obsidian URI.md" \
  "$SRC_ROOT/obsidian-help/en/Extending Obsidian/Obsidian CLI.md" \
  "$SRC_ROOT/obsidian-help/en/Extending Obsidian/Obsidian Headless.md" \
  "$REF_DIR/help/Extending Obsidian/"

cp \
  "$SRC_ROOT/obsidian-help/en/Contributing to Obsidian/Developers.md" \
  "$REF_DIR/help/Contributing to Obsidian/"

cp \
  "$SRC_ROOT/obsidian-api/obsidian.d.ts" \
  "$SRC_ROOT/obsidian-api/canvas.d.ts" \
  "$SRC_ROOT/obsidian-api/publish.d.ts" \
  "$SRC_ROOT/obsidian-api/README.md" \
  "$SRC_ROOT/obsidian-api/CHANGELOG.md" \
  "$SRC_ROOT/obsidian-api/LICENSE.md" \
  "$SRC_ROOT/obsidian-api/package.json" \
  "$REF_DIR/api/obsidian-api/"

cp \
  "$SRC_ROOT/obsidian-sample-plugin/README.md" \
  "$SRC_ROOT/obsidian-sample-plugin/manifest.json" \
  "$SRC_ROOT/obsidian-sample-plugin/package.json" \
  "$SRC_ROOT/obsidian-sample-plugin/package-lock.json" \
  "$SRC_ROOT/obsidian-sample-plugin/tsconfig.json" \
  "$SRC_ROOT/obsidian-sample-plugin/esbuild.config.mjs" \
  "$SRC_ROOT/obsidian-sample-plugin/version-bump.mjs" \
  "$SRC_ROOT/obsidian-sample-plugin/versions.json" \
  "$SRC_ROOT/obsidian-sample-plugin/styles.css" \
  "$SRC_ROOT/obsidian-sample-plugin/LICENSE" \
  "$SRC_ROOT/obsidian-sample-plugin/AGENTS.md" \
  "$REF_DIR/sample-plugin/"

cp \
  "$SRC_ROOT/obsidian-sample-plugin/src/main.ts" \
  "$SRC_ROOT/obsidian-sample-plugin/src/settings.ts" \
  "$REF_DIR/sample-plugin/src/"

{
  echo "# Upstream Versions"
  echo
  echo "- Synced at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- obsidian-developer-docs: $(git -C "$SRC_ROOT/obsidian-developer-docs" rev-parse HEAD)"
  echo "- obsidian-help: $(git -C "$SRC_ROOT/obsidian-help" rev-parse HEAD)"
  echo "- obsidian-api: $(git -C "$SRC_ROOT/obsidian-api" rev-parse HEAD)"
  echo "- obsidian-sample-plugin: $(git -C "$SRC_ROOT/obsidian-sample-plugin" rev-parse HEAD)"
} > "$REF_DIR/upstream-versions.md"

echo "Synced references into: $REF_DIR"
