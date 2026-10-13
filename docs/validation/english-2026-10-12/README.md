# English adaptation — dev_en — 2026-10-12

Status: English distribution and selected viewport checks passed. This record covers localization and layout; it is not a CrazyGames platform approval or full release certification.

> Historical scope note: this 2026-10-12 record predates the SDK integration and final submission covers. Current CrazyGames preparation status and evidence are in [`artifacts/crazygames/qa-2026-10-13/README.md`](../../../artifacts/crazygames/qa-2026-10-13/README.md) and [`artifacts/crazygames/UPLOAD-CHECKLIST.md`](../../../artifacts/crazygames/UPLOAD-CHECKLIST.md).

## Implemented

All shipped interface copy, tutorial text, dynamic player/round labels, results, continue/restart/settings controls, storage notices, startup/recovery errors, AI/physics diagnostics, accessible labels, page title/description and level names/lessons are English. The document declares lang=en. The branch has one English locale and no language selector. The accepted Tavern Letterpress logo is retained.

Terminology: Solo Play, Local Battle, Opening Flick, First to 10, Score, Best, Continues. Continues are the existing three post-failure recoveries; initial play is not counted as one of them. Hold the finger to charge, release to flick; blank-area dragging rotates the view. Physics, coin ownership, scoring, settlement, AI decisions, stored-save key/schema and gameplay level parameters remain unchanged.

UI fonts use system UI and Georgia rather than Chinese-oriented stacks. English labels wrap/stack where needed; small portrait score panels accommodate long scores. Ready/simulating hide the decorative game logo so the focused tabletop stays clear. Short landscape result/error cards use a wider layout and side-by-side main actions.

## Requirements checked

Official sources were read on 2026-10-12:

- [Gameplay requirements](https://docs.crazygames.com/requirements/gameplay/): English localization and DPR=1 readability; selected 907×510, 821×462 and 800×450 frames checked.
- [Technical requirements](https://docs.crazygames.com/requirements/technical/): relative bundle paths, file/download limits, optional SDK for Basic implementation versus mandatory integration for Full implementation.
- [Quality guidance](https://docs.crazygames.com/requirements/quality/): clear controls, concise onboarding and immediately understandable actions.

English-only distribution uses English irrespective of browser language. Locale-based selection/fallback is relevant if additional translations are introduced. This language-focused validation did not include the SDK, which was added and separately verified on 2026-10-13. Solo Play reaches the game with one menu click. Existing secondary PVP/PVE menu remains; this record does not claim Full implementation acceptance. Runtime checks found no external promotional links or custom fullscreen control.

## Automated validation

- Full Vitest run: 29 files passed, 1 skipped; 351 tests passed, 1 skipped. The skipped test is the existing explicit opt-in solution generation job.
- TypeScript noEmit and final Vite production build passed.
- English-content guard scans production source, CSS, shipped level JSON and document metadata. ZIP scan confirms no Han characters in shipped HTML/JS/CSS/JSON.
- The five solution fingerprints include level name/lesson. They were refreshed after the English metadata change only after verifying old HEAD fingerprints, unchanged physical configuration and name/lesson-only level differences. All recorded shot IDs, directions, powers, schema/config versions and fingerprint algorithm are unchanged. The original five complete N−1 shot solutions replay successfully through production Rapier/GameSession.
- Independent read-only reviewer checked source structure, copy semantics, no-Han scans, preserved data/contracts and final screenshots/build.

## Browser evidence

Actual game in the Codex in-app browser, mouse interaction, DPR 1:

- home-390.jpg / solo-390.jpg: 390×844 home and playable Solo UI.
- shot-result-390.jpg: real coin selection, 250ms finger hold/release and resulting miss; English Chain broken result. Continue Run restored the board and decremented continues from 3 to 2.
- solo-907.jpg / settings-907.jpg / home-907.jpg: 907×510 normal gameplay, pause/settings, return-to-menu.
- battle-menu-821.jpg: 821×462 Local Battle menu; PVE entered with You/Computer and English Opening Flick instructions.
- pve-opening-800.jpg: 800×450 Opening Flick and pause flow.
- production-home-390.jpg / production-solo-390.jpg: final built distribution at http://127.0.0.1:5174/ opened, logo/scene loaded, lang=en/title=FlickChain, one-click Solo Play reached the selecting phase.
- production-pve-390.jpg: actual production Worker completed the opening contest and played a valid scoring relay. Computer reached 1 point, 8 coins remained, and input returned to Your turn. No production console errors.
- No runtime errors or framework error overlays observed. Existing Rapier initialization deprecation warning and Vite large-chunk warning remain.

Isolated layout checks render the actual production Shell with synthetic views, not a simulated or completed game:

- fixture-high-score-320.jpg: 320×568, score12345, round1234, best54321 and singular Continue. No viewport overflow or right-control overlap.
- fixture-battle-320.jpg: 320×568 live Battle HUD with nine coins and English Player1/Player2 labels. Score panel x16–244, controls begin x258; no horizontal overflow.
- fixture-continue-821-before.jpg: initial long result modal required scrolling to reach Restart/Main Menu.
- fixture-continue-821.jpg: corrected 821×462 modal width680, height403.6, no internal overflow; primary/secondary buttons end y364.8, Main Menu ends y416.8 within viewport.
- fixture-error-821.jpg: long English recovery description and both actions remain visible.

The temporary layout HTML page was removed and is not part of the distribution.

## Delivery

- Production root: dist/
- Reviewable archive: artifacts/crazygames/FlickChain-dev-en-2026-10-12.zip
- ZIP: 3,701,168 bytes; unpacked: 7,228,509 bytes, 16 files.
- index.html is at the archive root. Entry JS/CSS paths and bundled resource entries are relative. Worker, audio, branding, levels and hand model are included.
- This is below the currently documented20MB no-SDK total-size threshold for mobile-homepage eligibility and50MB Basic limit; meeting size alone is not platform eligibility approval. Total bundle size is measured here, not network cold-load timing.

## Boundaries

No CrazyGames Developer Portal upload, platform Preview, SDK/ad/data integration, public deployment, or real mobile device touch/performance/browser compatibility certification was performed. The checked viewports are a selected subset of the official size matrix. High refresh-rate and complete keyboard-play acceptance were not rerun for this copy/layout change. Previous Chinese development docs and archived Chinese logo artwork are unshipped historical assets, not runtime language options.
