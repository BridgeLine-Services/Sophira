#!/bin/bash
# One-time: activate the pending GitHub Actions workflows.
# Requires a git credential WITH `workflow` scope (a fine-grained PAT with
# Actions: write, or a classic PAT with the workflow scope). The current
# automation credential lacks it, which is the ONLY reason the workflows
# are not yet active.
set -euo pipefail
cd "$(dirname "$0")/.."
test -d .workflows-pending || { echo "no .workflows-pending present"; exit 1; }
mkdir -p .github/workflows
cp .workflows-pending/ci.yml .github/workflows/ci.yml
cp .workflows-pending/release.yml .github/workflows/release.yml
git add .github
git commit -m "Activate GitHub Actions workflows (ci.yml, release.yml)"
git push origin HEAD:master
echo "Pushed. Check https://github.com/BridgeLine-Services/Sophira/actions"
echo "Next: set repository variable SOPHIRA_APP_URL (see docs/RELEASE_PROCESS.md)"
