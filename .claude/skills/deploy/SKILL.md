---
name: deploy
description: Deploy fork.ai to production by merging main into the prod branch and pushing, which auto-triggers the API CodeBuild webhook and the Amplify web build. Use when the user says "/deploy", "deploy to prod", "release to production", or wants to ship the current main to production.
---

# deploy

Release `main` to production by merging it into `prod` and pushing. Pushing `prod` automatically triggers **both** deployments:
- **API** → CodeBuild `forkai-api-deploy` → ECR → Elastic Beanstalk `forkai-api-prod`
- **Web** → Amplify `forkai-web` `prod` branch build → https://forkai.in

## ⚠️ Production guard — confirm first
Deploying to prod is irreversible and customer-facing. **Get an explicit go-ahead from the user for this specific deploy before pushing `prod`**, even though this skill was invoked. Show the exact diff that will ship and wait for confirmation. Approval to deploy once never carries to the next deploy.

## Steps
1. **Preview the release.** `git fetch origin`, then show what's new: `git --no-pager log --oneline origin/prod..origin/main`. If empty, tell the user prod is already up to date and stop.
2. **Confirm** with the user (see guard above). Do not proceed without an explicit yes.
3. **Clean & update main.** Ensure `git status` is clean, then `git checkout main && git pull`.
4. **Merge & push.**
   ```
   git checkout prod
   git pull
   git merge main --no-edit
   git push origin prod
   ```
   The `git push origin prod` is what fires the CodeBuild webhook and the Amplify build.
5. **Return.** `git checkout main`.
6. **Report.** Confirm the deploy was triggered and note it takes a few minutes. Optionally watch the API build: `aws codebuild list-builds-for-project --project-name forkai-api-deploy --region ap-south-1` (read-only).

## Do NOT
- Do **not** run `aws codebuild start-build`, `aws elasticbeanstalk update-environment`, `aws amplify start-job`, or any other AWS mutation — the `prod` push is the only trigger needed (manual `start-build` is only a fallback if the webhook fails to fire).
- Do **not** push `prod` without the explicit confirmation in step 2.
- Do **not** touch Secrets Manager, EB env vars, or any prod infra.
