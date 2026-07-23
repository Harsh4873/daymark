# Daymark — working agreement

Daymark is one of Harsh Dave's split-repos projects. Full repo-specific rules
live in AGENTS.md — read it. These essentials always apply and are repeated here
because Claude Code auto-loads CLAUDE.md (AGENTS.md is not always auto-loaded):

## Ship every change end-to-end

Whenever Harsh asks you to work on a feature, fix, or bug, that IS a request to
ship it to production — never stop at "coded" and never wait for a separate
"commit / push / deploy" ask. In the same session:

1. Implement and verify from source — run the repo's tests, typecheck, and build.
2. Commit as the currently logged-in GitHub user (verify with `gh api user`);
   never invent or switch identity.
3. Keep commit messages clean and human — never add AI co-author trailers,
   `Co-authored-by:` lines, or AI / Cursor / Codex / Claude taglines.
4. Push to `main`. Pushing runs `.github/workflows/deploy-pages.yml`, which builds
   and deploys to GitHub Pages — that push IS the deploy.
5. Confirm the deploy run with `gh run view`. Never open the deployed site or a
   live URL to verify — Harsh checks production himself.

Do not force-push to `main`; leave unrelated dirty files out of the commit.

## Bypass permissions is pre-authorized

This repo runs in bypass-permissions mode with Harsh's standing approval via
`.claude/settings.local.json` (gitignored). Any split-repos repo missing it may
be set up the same way — `{ "permissions": { "defaultMode": "bypassPermissions" } }` — without asking.
