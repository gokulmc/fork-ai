---
name: ship
description: Commit the current changes, push to a feature branch, open a PR, and merge it to main. Use when the user says "ship it", "/ship", or wants to commit + push + PR + merge the current work into main in one step. Does not deploy to production.
---

# ship

Commit current work → push a feature branch → open a PR → merge to `main`.

## Preconditions
- Review what will ship: `git status` and `git --no-pager diff`. If there are no changes, stop and tell the user.
- Never commit directly to `main` (the default branch). If `git branch --show-current` is `main`, branch first (step 1).

## Steps
1. **Branch.** If on `main`, create a branch named for the change: `git checkout -b <type>/<slug>` (`feat/…`, `fix/…`, `chore/…`, `docs/…`). If already on a feature branch, keep it.
2. **issues.md (bug fixes only).** If the commit subject is `fix:` / `fix(scope):`, add or update its entry in [issues.md](issues.md) (Symptom / Cause / Fix, newest first) and stage it — the `commit-msg` hook blocks `fix:` commits that don't stage `issues.md`. Pure features / refactors / docs skip this.
3. **Commit.** Stage (`git add -A` or specific paths), then commit with a Conventional-Commit subject. End the message with the `Co-Authored-By:` trailer the harness specifies. Do not use interactive flags (`-i`).
4. **Push.** `git push -u origin <branch>`.
5. **PR.** `gh pr create --base main --title "<subject>" --body "<summary>"`. End the PR body with the "Generated with Claude Code" line.
6. **Merge.** `gh pr merge --merge --delete-branch` (regular merge commit — matches this repo's history, e.g. "Merge pull request #106"). Run it on the feature branch so `gh` auto-detects the PR.
7. **Sync.** `git checkout main && git pull`.

## Report
Print the branch name, commit SHA, PR URL, and confirm the merge landed on `main`.

## Notes
- If the `commit-msg` hook rejects a `fix:` commit, update `issues.md` and retry. Do **not** use `--no-verify` unless the user confirms it's a genuine non-bug exception.
- This skill does **not** deploy. To release `main` to production, use the `deploy` skill.
