# Daymark Maintenance

This repository is for Harsh Dave's Daymark app only.

## Product Boundary

- Daymark lives on `main` and publishes under `/daymark/`.
- Do not add or modify PickLedger, betting, prediction, scraper, grading, model-cache, or player-prop code in this repository.
- Do not add or modify Gym source, workout data, storage, or styling in this repository.
- Do not add or modify Slate, Fare, Sift, or Portfolio source, data, content, or styling in this repository — with one exception: `firestore.rules` intentionally carries the complete Daymark + Slate + Fare + Sift ruleset and must stay identical to the copies in the Slate, Fare, and Research repositories.
- Keep Daymark local-first. Habit entries stay in the user's browser unless the user explicitly exports them.
- The Pages workflow builds and publishes Daymark directly from `main`.

## Verification

- Never open the deployed site, a browser preview, rendered Pages output, or live URLs to verify Daymark. The user confirms production behavior.
- Agents may review source, run typecheck/build/tests, inspect generated file paths as text, and inspect GitHub Actions/API state.
- Before publishing Daymark work, run `npm test`, `npm run typecheck`, and `npm run build`.

## GitHub Publish

- Commit Daymark work on `main`; every push runs the Pages deployment workflow.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
