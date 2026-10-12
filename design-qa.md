> Historical logo-stage report. The latest dev_en English-language validation is [English adaptation](docs/validation/english-2026-10-12/README.md).

# FlickChain English logo design QA — 2026-10-12

final result: passed

## Source and scope

Selected visual truth: assets/design/english-logo-2026-10-12/01-tavern-letterpress.png (first displayed ImageGen result, 1536 × 1024).
Implementation: existing FlickChain at http://127.0.0.1:5173/; one transparent English identity integrated into the existing home and gameplay UI.
This is a logo integration, not an English localization or world/camera redesign. Chinese menu/game copy and production 3D scenes intentionally remain. The original Chinese vector logo is preserved as assets/design/english-logo-2026-10-12/legacy-chinese-title.svg.

## Evidence and normalization

- Full-view comparison: assets/design/english-logo-2026-10-12/home-comparison.jpg.
- Focused lettering/material comparison: assets/design/english-logo-2026-10-12/logo-comparison.jpg.
- Source HOME panel cropped at (719,68)-(1099,960), 380 × 892 pixels, without stretching. Live mobile home captured at the matching 380 × 892 CSS viewport, DPR 1, JPEG 380 × 892. Comparison places these in one image; focused comparison uses corresponding 352 × 168 regions.
- Live gameplay: assets/design/english-logo-2026-10-12/game-mobile.jpg, 380 × 892, selecting state.
- Live compact Battle opening: assets/design/english-logo-2026-10-12/battle-320.jpg, 320 × 568.
- Live landscape Battle opening: assets/design/english-logo-2026-10-12/battle-landscape.jpg, 568 × 320.
- Live desktop home: assets/design/english-logo-2026-10-12/home-desktop.jpg, 1440 × 900.
- Device pixel ratio 1 for browser checks; JPEG screenshots are visual evidence, not pixel-perfect lossless rendering comparisons. Source gameplay panel and actual gameplay differ in viewport/world placement; use home full-view and focused logo comparison for design fidelity, and gameplay captures for visibility/spacing/input checks.

## Required fidelity surfaces

- Typography: exact mixed-case FlickChain wordmark, cream-gold vintage serif, curved brass rules, centered coin and restrained diamond flourish. Lettering is embedded in the raster asset rather than relying on runtime fonts; home H1 accessible name is FlickChain · 一弹到底. Existing Chinese UI fonts are intentionally retained.
- Spacing/layout: mobile home image box now 357.19 × 157.23 at x11.39/y124.88 in 380 × 892. Transparent margins are compensated by the 94% wide/14% high placement. Desktop uses existing left title/right tabletop hierarchy. Compact portrait gameplay starts logo at >=145px; short landscape hides the decorative brand.
- Colors/tokens: warm ivory, gold and brass retain the selected direction and existing tavern palette. Existing UI colors are unchanged.
- Image quality: 1890 × 832 RGBA PNG with real transparent corners; faces approximately alpha253 and >983k fully transparent pixels. Low-alpha RGB fringe in raw previews is not visibly present on the actual tavern background. Browser confirms natural image dimensions and successful loading. Both screens share one cacheable public asset using Vite BASE_URL.
- Copy/content: English logo implemented; Chinese controls intentionally retained. No extra slogans or product features added.

## Findings and iteration history

1. [P2, resolved] Small portrait game brand crowded the Battle label row. Initial 320 × 568 opening evidence: battle-320-before.jpg; logo element y96.55–147.25 and label row y84–105. Changed mobile top to max(17%,145px). Final battle-320.jpg shows label row ending105px, logo box y145–195.70, tabletop starting around203px, without overlap.
2. [P2, resolved] On short landscape, center brand reached the tabletop's upper-left silhouette. Initial 568 × 320 evidence: battle-landscape-before.jpg. Hide the decorative game brand at landscape height <=600px. Final battle-landscape.jpg keeps score/table/prompt unobstructed.
3. [P2, resolved] Initial mobile wordmark appeared narrower and lower than selected design due to transparent asset padding. Adjusted mobile title from 88%/16% to 94%/14%, preserving short-portrait and landscape overrides. Re-captured home-mobile.jpg and compared again in home-comparison.jpg / logo-comparison.jpg.
4. [P3, acceptable] Generated production lettering has slightly heavier bevel/flourish strokes than the reference's home-panel logo. It follows the selected primary mark and remains recognizable/readable at both display sizes. No further regeneration required for this implementation.

No actionable P0/P1/P2 findings remain. Main visually reviewed the combined source/implementation evidence and final compact/landscape captures. Independent read-only test-reviewer checked source, asset alpha, and the captured compact/game/home evidence and confirmed no blocker after the responsive fix.

## Behavior checks

Browser interaction: home -> Solo -> game; settings -> pause -> return menu; Local Battle -> PVP -> opening; settings -> return menu. Brand visibility and existing controls behaved correctly. No blank screen or Vite error overlay. Browser error logs: none. Existing Rapier initialization deprecation warning remains, unrelated to logo.

Existing Shell regression suite: 21 passed. TypeScript noEmit and Vite production build passed; existing large JS chunk warning remains. Public logo included in dist/branding/flickchain-logo.png. Final build and diff checks recorded by main.

## Boundaries

Browser mouse and responsive viewport emulation only. Real mobile touch/DPI/performance, production deployment, CrazyGames and full physics/match regression were not tested for this visual change.

## Implementation checklist

- [x] Production transparent logo saved and loaded in both screens.
- [x] Original asset preserved; no game/core/input/AI edits.
- [x] H1 accessible name, decorative secondary image, and pointer pass-through verified.
- [x] Phone, compact Battle, short landscape and desktop screenshots reviewed.
- [x] Targeted regression, compile/build, independent review and visual comparison completed.
