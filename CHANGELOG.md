# Changelog

Game versions follow Semantic Versioning. `package.json` is the source of truth;
`package-lock.json` must match. A version describes game changes, not platform approval.
Physics configuration, save schema and level schema keep their own compatibility versions.

## 0.2.0 — 2026-10-13 — release candidate

### Gameplay and presentation

- Continuous randomized Solo Play, three continues and a local best score.
- Local two-player and computer battles, an opening distance contest and a 10-point goal.
- A more forgiving computer opponent, visible computer hand charging and turn announcements.
- Circular tabletop, animated hand, charge meter, tavern lighting and visible glowing bulb.
- More readable layouts on narrow and landscape screens, plus clearer foul explanations.

### Fixes

- Opening coins resting partly beyond the table rim now record their real distance and participate in the first-turn comparison.
- Pause, restart, menu and hidden-page transitions cancel pending computer shots.
- Mobile gesture protection preserves charging while suppressing selection and context menus.

### English distribution

- English runtime text, title artwork and three submission covers on `dev_en`.
- CrazyGames SDK v3 loading/gameplay lifecycle and platform mute integration on `dev_en`.
- Platform Preview, preview videos, real-device acceptance and publication remain pending.

### Version management

- Build output includes `version.json` with game version, source revision, branch, source-change status and UTC build time.
- Upload archives and their SHA-256 manifests use versioned filenames; earlier dated packages are historical candidates.

## 0.1.0 — 2026-10-09

- Initial playable physics prototype, five authored Challenge layouts and local Battle.
- Full-shot relay evaluation, pointer input, static build and baseline validation.
