# Pending GitHub Actions workflows

These are the CI (`ci.yml`) and release (`release.yml`) workflow definitions
for Sophira. They belong in `.github/workflows/`.

The push credential currently configured for this repository is a Personal
Access Token WITHOUT the `workflow` scope, so GitHub refuses any push that
creates files under `.github/workflows/`. Until the token is updated, add
these files by either:

1. Regenerating a PAT with `repo` AND `workflow` scopes, updating the stored
   credential, then moving these two files to `.github/workflows/` and
   pushing; or
2. Creating the two files manually in the GitHub web UI
   (Add file → Create new file → paste contents → commit).

No other step is required — both files are complete and valid YAML.
