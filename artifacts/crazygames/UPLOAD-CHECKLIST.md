# FlickChain — CrazyGames Basic Launch preparation — 2026-10-13

Status: local game build, English copy and SDK integration verified. The game has not been uploaded to the Developer Portal, tested in CrazyGames Preview, approved, or published. This is a Basic Launch preparation package; it does not claim Full Launch readiness.

## Game upload

- Use `FlickChain-dev-en-2026-10-13.zip`, replacing the older 2026-10-12 ZIP.
- `index.html` is at the archive root; bundled resources use relative paths. Worker, WASM-containing bundles, hand model, branding, levels and audio are included.
- `package-manifest-2026-10-13.json` records byte counts and SHA-256 hashes. It identifies the release-candidate working tree and its baseline; the delivery source is versioned on `dev_en`.
- Game code loads the official SDK v3 from `https://sdk.crazygames.com/crazygames-sdk-v3.js`. The SDK is hosted externally by CrazyGames and is not copied into the archive.
- No advertisements, account integration, leaderboard or SDK data APIs are called by game code. Basic Launch forbids advertisements. Progress currently uses local browser storage.
- Use `submission-copy-en.md` for a reviewable English description and controls.

## Submission media

The three final covers are complete in `covers-2026-10-13/`, also bundled in `FlickChain-covers-2026-10-13.zip`. Each reserves the top-left35% width ×25% height for platform overlays. Preview videos remain to prepare. QA screenshots are separate validation evidence.

| Asset | Official requirement | Status |
| --- | --- | --- |
| Landscape cover | 1920 × 1080, 16:9 | Complete; actual PNG dimensions verified |
| Portrait cover | 800 × 1200, 2:3 | Complete; actual PNG dimensions verified |
| Square cover | 800 × 800, 1:1 | Complete; actual PNG dimensions verified |
| Landscape preview video | 1080p, 16:9 | Pending |
| Portrait preview video | 1080p, 2:3 | Pending |

Videos should be 15–20 seconds, at most 50 MB, silent, and show gameplay at normal speed. Avoid black bars, logo transitions, default mouse cursor and promotional overlays. Use the matching static cover as the opening frame. Covers should share a visual identity; include only the game title as text, with no borders or store icons.

## Developer Portal Preview before submission

1. Upload the new ZIP to a draft game in the Developer Portal and open Preview.
2. Confirm SDK environment is `crazygames`, not local/offline/disabled. Verify loading, actual gameplay start, pause/result/menu stop, and resume events.
3. Confirm platform mute works before and during play, and unmute restores previously unlocked audio without overriding the player's sound preference or paused/hidden state.
4. Exercise Solo Play, Continue, local 2 Players, and Vs. Computer. Check that the actual production Worker runs under portal hosting.
5. Check portal embed loading and input, especially relative Worker/GLB/audio paths. Local tests do not prove portal CSP or iframe behavior.
6. Test the full required size matrix at DPR 1: 907×510, 1216×684, 1077×606, 821×462, 1366×768, 1920×1080, 1536×864, 1280×720, 800×450 and 1080×607. This run directly checked a selected subset, plus phone portrait.
7. Test actual mobile touch, performance and target browsers. Desktop mouse at phone dimensions is not a real-device test.
8. Upload the completed three covers, add the two preview videos, complete portal fields, then submit for review when ready.

Full Launch is a separate phase. Recheck current monetization, user, data/progress and other applicable requirements before enabling those integrations.

## Official sources checked on 2026-10-13

- [SDK introduction](https://docs.crazygames.com/sdk/intro/)
- [Game lifecycle and settings](https://docs.crazygames.com/sdk/game/)
- [Technical requirements](https://docs.crazygames.com/requirements/technical/)
- [Gameplay requirements](https://docs.crazygames.com/requirements/gameplay/)
- [Covers and preview video requirements](https://docs.crazygames.com/requirements/game-covers/)
