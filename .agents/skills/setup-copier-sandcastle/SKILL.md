---
name: setup-copier-sandcastle
description: Fill in the credentials a freshly copier-generated .sandcastle/.env needs — Claude token, issue tracker token, and optional explainer hosting. Run once per repo, before the first loop.
disable-model-invocation: true
---

# Set up `.sandcastle/.env`

Copier generates `.sandcastle/.env.example` with every knob commented out. This walks the user from that template to a `.env` a loop can actually run on.

Work one step at a time and **wait for the user** at each credential — they must fetch these from a browser and paste them back. Never invent a placeholder value and move on.

## 1. Create the file

`cp .sandcastle/.env.example .sandcastle/.env` if `.env` doesn't exist yet.

Then read `.env.example` rather than trusting this skill's knob names — the template drifts between copier versions, and it is the **single source of truth** for what this repo's loop reads.

_Done when:_ `.sandcastle/.env` exists and you have listed, from the example, which knobs are required versus commented-out-optional.

## 2. Claude credentials

Tell the user to run `claude setup-token` themselves (suggest typing `! claude setup-token`, which runs it in-session). It opens a browser and prints an `sk-ant-oat01-…` token for `CLAUDE_CODE_OAUTH_TOKEN`. Requires a Pro or Max subscription.

If they have no subscription, they can use a console.anthropic.com API key instead — but confirm the Dockerfile forwards `ANTHROPIC_API_KEY` before promising it works, since `.env.example` only documents the OAuth knob.

_Done when:_ `CLAUDE_CODE_OAUTH_TOKEN` holds a real token.

## 3. Issue tracker credentials

The loop detects GitLab vs GitHub from the `origin` remote. Check it: `git remote -v`.

For GitHub, either `gh auth token` (fast; rotates on re-auth, scopes are whatever they granted at login) or a dedicated fine-grained PAT at github.com/settings/personal-access-tokens/new — repository access limited to this repo, with **Contents**, **Issues**, and **Pull requests** all set to Read and write. Those three map to what the loop does: push branches, file issues and triage labels, open merge tickets.

For GitLab, a project access token with `api` scope goes in `GITLAB_TOKEN`.

Self-hosted instances also need `GH_HOST` / `GITLAB_HOST`. Set `SANDCASTLE_ISSUE_TRACKER` only if detection guesses wrong.

_Done when:_ the token for the detected tracker is set, and any self-hosted host knob with it.

## 4. Explainer hosting

Optional. `finalize` wraps the upload in `degrade()`, so with `EXPLAINER_HOST` unset the run still succeeds and the merge ticket just reads `EXPLAINER: omitted`.

Ask the user which they want:

- **Skip it** — leave `EXPLAINER_HOST` unset. Explainer HTML is still written under `.sandcastle/tmp/explainers/`, which is throwaway. Go to step 6.
- **Host it** — `s3` is the only implementation (`helpers/explainerHost.mts`), and it works against any S3-compatible store. For Cloudflare R2, read [`explainer-r2.md`](explainer-r2.md) and follow it. Neither Vercel Blob nor GitHub Pages can be pointed at this host without new code.

_Done when:_ the user has chosen, and if hosting, every `EXPLAINER_S3_*` knob their store needs is filled in.

## 5. Smoke test the upload

Prove the seam works before spending a real run on it. Copy `scripts/smoke.mts` into `.sandcastle/` — it must run from inside that package to resolve `@aws-sdk/client-s3` — then `npx tsx`, then delete the copy.

Uploading, fetching, and deleting a throwaway object is the whole test. Confirm three things, and report any that fail rather than reporting success:

- the script prints a URL on your **public** base, not the storage API endpoint
- `curl -sSI <url>` returns `200` with `Content-Type: text/html`, so explainers render instead of downloading
- after deleting the test object, the same URL returns `404`

Leave the bucket as you found it — delete the smoke object even when the test passes.

_Done when:_ all three checks pass and no test object remains.

## 6. Keep the secrets out of git

`.sandcastle/` is often wholly untracked in a fresh repo, so a blanket `git add .sandcastle` would commit the live tokens.

Run `git check-ignore -v .sandcastle/.env`. Silence means it is **not** ignored — fix that before anything is staged, then re-run until it reports a matching rule.

_Done when:_ `.env` is provably ignored, and `git status --short` shows no path containing it.
