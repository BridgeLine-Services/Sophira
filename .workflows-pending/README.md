# Pending GitHub Actions workflows

These are the CI (`ci.yml`) and release (`release.yml`) workflow definitions
for Sophira. They belong in `.github/workflows/`.

The push credential configured for this repository is a Personal Access Token
WITHOUT the `workflow` scope (verified: the GitHub API returns no
X-OAuth-Scopes header and pushes are rejected), so GitHub refuses any push
that creates files under `.github/workflows/`. To activate CI + releases:

1. Regenerate the PAT with `repo` AND `workflow` scopes (or add the
   "Workflows" permission on a fine-grained token), update the stored
   credential, then run:
     mkdir -p .github/workflows
     cp .workflows-pending/ci.yml .workflows-pending/release.yml .github/workflows/
     git add .github/workflows && git commit -m "Activate CI and release workflows" && git push
   or
2. Create the two files manually in the GitHub web UI
   (Add file → Create new file → paste contents → commit).

Then set the repository VARIABLE `SOPHIRA_APP_URL` to the deployed Sophira
URL, and (optionally) the ANDROID_* and IOS_* SECRETS for signed artifacts.
No other step is required — both files are complete and valid YAML, and the
release workflow refuses to run against the placeholder URL.
