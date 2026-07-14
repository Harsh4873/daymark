# Daymark

Daymark is the private, local-first habit app published at `harsh.bet/daymark/`. This repository is the standalone source for the app and its GitHub Pages deployment.

## Product model

- Daily, weekly, monthly, and rolling-year reviews
- Check, count, duration, quantity, and distance measurements
- Reach-at-least and stay-at-or-below goals
- Daily, selected-day, interval, weekly, and monthly rhythms
- Period-aware streaks, consistency scores, skips, notes, pause history, and normalized heatmaps
- Mirrored IndexedDB/localStorage persistence with lossless JSON backup and CSV export
- Automatic phone/laptop sync through the existing `pickledgerpro` Firebase project
- Offline check-ins that queue locally and reconcile after reconnecting

## Sync and privacy

Google sign-in is restricted to the verified `hdav4873@gmail.com` account. Authentication persists on each device until explicit sign-out, so the normal experience remains automatic after signing in once.

Firestore data is isolated under `daymark_users/{uid}` with separate habit and entry documents. This keeps unrelated check-ins from overwriting one another, while a generation ID makes reset and JSON-import replacements propagate cleanly. The combined Firestore rules preserve Slate's `slate_users/{uid}`, Fare's `fare_users/{uid}`, and Sift's `research_users/{uid}` namespaces while denying signed-out users, other accounts, mismatched UIDs, and every unrelated collection. The rules file must stay identical across the Daymark, Slate, Fare, and Research repositories. Firebase Analytics is not enabled.

The browser mirror remains the first read and write path for instant startup and offline use. Cloud sync aligns devices; JSON export remains the portable backup the user controls. Signing out waits for pending writes, then removes Daymark's local copy from that device.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Vite's public base is `/daymark/`. Navigation is hash-based so every view remains safe on GitHub Pages without a server rewrite.

The Pages workflow deploys only the built website. When intentionally updating the shared backend, deploy the combined Daymark + Slate + Fare + Sift Firestore rules separately with:

```sh
firebase deploy --only firestore:rules --project pickledgerpro
```
