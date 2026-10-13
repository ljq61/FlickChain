# Final English build and CrazyGames integration QA — 2026-10-13

## Summary

Local acceptance passed for the exposed glowing menu bulb, English copy polish and real CrazyGames SDK v3 integration. This record supersedes the earlier language-only record's SDK status. It does not confirm Developer Portal Preview, platform approval, Full Launch or public publication.

## Changes verified

- Menu lamp: removed the opaque mouth disk, corrected outward shade winding, added a hollow warm lining and exposed luminous globe. A small 32×32 local halo uses one tracked texture; no extra shadow light or bloom pass. Decoration still ignores coin picking and stays outside gameplay.
- English: reviewed runtime UI, instructions, score/turn/result labels, errors, accessibility labels, page metadata and shipped level descriptions. Battle choices now read `2 Players` / `Vs. Computer`; opening is `Who Goes First?`; pause is `Paused`; recovery is `Continue`. Multi-hit explains direct contact by the flicked coin; secondary collisions remain legal. Opening forfeits cover falls and timeouts. Three continues remain three extra recoveries, not initial lives. No physical level or recorded solution data changed.
- SDK: async official v3 script loader, awaited initialization, local/crazygames environment guard, 4-second bounded offline fallback, loading and real gameplay lifecycle events, coalescing, portal mute priority, settings listener cleanup and late initialization disposal protection.
- Audio: platform mute cannot be bypassed by the local toggle. Unmute resumes an existing unlocked AudioContext when visible and unpaused; it does not create an AudioContext during bootstrap or override local sound preferences. Independent review caught and verified the repair of an initially missed unmute-resume path.
- No gameplay physics, public coin ownership, scoring, save schema/key, AI search or hand assets changed. No advertisements, account or cloud-data feature was added.

## Automated validation

- Final full Vitest: 30 files passed, 1 skipped; 383 tests passed, 1 skipped. The skip is the existing opt-in solution generation test.
- TypeScript noEmit passed. Final Vite production build passed.
- Adapter: 19 focused tests cover queued/coalesced lifecycle events, loading gates, settings, disabled/offline failures, timeout, throwing APIs and disposal/late init. App tests cover menu/arrival/play/pause/resume/failure/continue/home, focus handling, mute priority and disposal during initialization. Real SoundManager tests assert resumed context state and fresh sample playback.
- Lamp regression uses production SceneManager camera placement with GPU work mocked. At 320×568, 390×844, 844×390, 1280×720 and 1440×900, center and four nearby bulb rays reach the bulb before opaque lamp geometry. Original lamp failed these rays. Shade/globe/halo stay in the title-safe band; resources dispose exactly once.
- English source/data guard and final ZIP HTML/JS/CSS/JSON scan found no Han text. `git diff --check` passed. Preexisting `.codely-cli/settings.json` modification remains excluded from this work.

## Environment and browser checks

Final built game at `http://127.0.0.1:5174/`, Codex in-app browser, DPR 1. The browser control API was available through `cua_repl`; no external Playwright/browser fallback was used. After restarting the stopped preview service, a fresh tab was used because the old tab retained a connection-error page. The viewport override was reset after testing.

| Check | Result | Evidence |
| --- | --- | --- |
| Page identity | Pass | Title FlickChain, lang=en, final index-HpfZuaae.js and official SDK script |
| Meaningful first screen | Pass | Home menu, table and logo render after loading |
| Framework overlay | Pass | No overlay in final snapshots/screenshots |
| Console | Pass with existing warning | Official SDK local lifecycle logs; existing Rapier initialization deprecation warning remains |
| Screenshot | Pass | Correct image dimensions independently verified for all final captures |
| Real interaction | Pass | Solo → select → 250ms charge/release → miss → Continue; pause/resume/main menu; Local Battle → Vs. Computer opening |

Production mouse interaction (not touch emulation or real touch):

- `home-390.jpg` / `home-907.jpg` / `home-1280.jpg`: warm luminous globe visible below the lamp shade at 390×844, 907×510 and 1280×720. The initial partial 907 capture was replaced and the final image verified as 907×510.
- `solo-390.jpg` / `result-390.jpg`: real random game and actual missed shot. `Continue` restored play and reduced continues 3→2. Pause/resume and main-menu navigation succeeded.
- `battle-menu-821.jpg` / `opening-821.jpg`: 821×462 battle menu and actual computer-match opening. Updated labels and instructions fit; no page-width overflow. This run did not repeat the full Worker scoring flow; it was exercised in the preceding English validation and Worker behavior remains covered by regressions.
- `portal-muted-821.jpg`: official `?muteAudio=true` local SDK parameter yields Sound off. Two local sound toggles cannot turn effective sound on. Returning to the normal URL restores the retained local sound preference.
- `sdk-local-events.json`: official CDN SDK initialized; loading start/stop and actual gameplay start/stop messages observed through browser interaction. Local SDK mode is distinct from actual portal integration.

Isolated layout evidence:

- `fixture-multi-hit-821.jpg`: actual Shell rendered with synthetic failure state, simultaneous MULTI_HIT/FALL/TIMEOUT, score12345, best54321, round1234. Modal top20/bottom442; primary/secondary end377.98 and Main Menu end429.98 within height462. No page-width overflow. A small internal scrollbar does not hide any action. This is layout QA, not evidence of an actual three-reason shot. Temporary HTML fixture and its dev server were removed/stopped.

Key verification tools: final Vitest run, TypeScript noEmit, Vite build; browser reload, DOM/AX snapshots, scoped locators, timed canvas mouse click, viewport capability, screenshots and console logs. Independent reviewer stayed read-only and reviewed final source, audio state reproduction and screenshots.

## Upload package

- `../FlickChain-dev-en-2026-10-13.zip`: 3,703,322 bytes; expanded7,236,519 bytes;16 files.
- SHA-256: `7b4a43901086fb72dd8338c70f9a5d6c5d76378d0f77456cbf110c6f9493734d`.
- Root index.html and all game bundles/Worker/model/branding/levels/audio verified. The official SDK is fetched from CrazyGames CDN and is not copied into the ZIP. Bundle entry paths are relative; per-file hashes are in `../package-manifest-2026-10-13.json`.
- The archive is far below the documented Basic Launch file/size limits. This is archive/expanded size, not a network cold-load measurement or mobile-homepage approval.
- English submission copy and the exact remaining portal/media steps are in `../submission-copy-en.md` and `../UPLOAD-CHECKLIST.md`.

## Remaining boundaries

No CrazyGames Developer Portal upload, Preview, publication, Full Launch validation, real mobile touch/performance or complete required viewport/browser matrix was performed. The three final covers are complete and separately documented in `../covers-2026-10-13/`; two preview videos remain to prepare. The Vite large-chunk and Rapier initialization warnings are preexisting and remain. The implementation, package, covers and evidence are versioned together on `dev_en` for the 2026-10-13 GitHub delivery.

Official interfaces and requirements were checked on2026-10-13: [SDK introduction](https://docs.crazygames.com/sdk/intro/), [game/settings](https://docs.crazygames.com/sdk/game/), [technical](https://docs.crazygames.com/requirements/technical/), [gameplay](https://docs.crazygames.com/requirements/gameplay/), [submission media](https://docs.crazygames.com/requirements/game-covers/).
