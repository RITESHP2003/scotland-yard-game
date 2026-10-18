#!/bin/bash
# push.sh -- deploy latest changes to GitHub Pages
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "=== Scotland Yard -- Push to GitHub Pages ==="
echo "Branch: $(git branch --show-current)"
echo "Remote: $(git remote get-url origin)"
echo ""

if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to commit -- working tree clean."
else
  echo "Uncommitted changes detected -- commit them first:"
  git status --short
  exit 1
fi

echo "Pushing to origin/main..."
git push origin main

echo ""
echo "✅ Pushed. GitHub Actions will deploy in ~60s."
echo "Live at: https://riteshp2003.github.io/scotland-yard-game/"
