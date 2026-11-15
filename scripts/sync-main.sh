#!/usr/bin/env bash
# Publish both branches: push `dev`, then rebuild `main` (the product branch) from dev's committed tree
# minus every path listed in .mainignore, and push `main`.
#
#   npm run sync:main          # run from the dev branch with a clean working tree
#
# `main` is generated — never commit to it by hand. Each sync adds one commit on main that mirrors dev@<sha>.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "dev" ]; then
  echo "✖ Run this from the dev branch (current: ${BRANCH:-detached})." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✖ Uncommitted changes — commit (or stash) them on dev first." >&2
  exit 1
fi
if [ ! -f .mainignore ]; then
  echo "✖ .mainignore not found." >&2
  exit 1
fi

DEV_SHA="$(git rev-parse --short HEAD)"
DEV_SUBJECT="$(git log -1 --pretty=%s)"
DEV_TRAILERS="$(git log -1 --pretty='%(trailers:only,unfold)')"

echo "▶ Pushing dev (${DEV_SHA})"
git push -u origin dev

git fetch -q origin main 2>/dev/null || true

WT="$(mktemp -d)"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; git worktree prune >/dev/null 2>&1 || true; }
trap cleanup EXIT

if git show-ref -q --verify refs/remotes/origin/main; then
  git worktree add -q -B main "$WT" origin/main
else
  git worktree add -q --orphan -b main "$WT"
fi

# Replace main's tree with dev's committed tree…
git -C "$WT" rm -r -q --ignore-unmatch . >/dev/null
git archive dev | tar -x -C "$WT"

# …then drop the dev-only paths.
(
  cd "$WT"
  shopt -s nullglob dotglob  # (no globstar: macOS ships bash 3.2)
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    for path in $line; do
      rm -rf -- "$path"
    done
  done < "$ROOT/.mainignore"
)

git -C "$WT" add -A
if git -C "$WT" diff --cached --quiet; then
  echo "✔ main is already in sync with dev@${DEV_SHA}"
  exit 0
fi

MSG="Sync from dev@${DEV_SHA}: ${DEV_SUBJECT}"
if [ -n "$DEV_TRAILERS" ]; then
  git -C "$WT" commit -q -m "$MSG" -m "Product build of dev (guides, demos, tests and tooling removed — see .mainignore on dev)." -m "$DEV_TRAILERS"
else
  git -C "$WT" commit -q -m "$MSG" -m "Product build of dev (guides, demos, tests and tooling removed — see .mainignore on dev)."
fi

echo "▶ Pushing main"
git -C "$WT" push origin main
echo "✔ dev@${DEV_SHA} → main@$(git -C "$WT" rev-parse --short HEAD)"
