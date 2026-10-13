# FlickChain

A mobile-first 3D coin-flicking game set on a cozy tavern tabletop.

**Current game version: 0.2.0 — release candidate.** This checkout is the English distribution on `dev_en`. English content and CrazyGames integration belong to this branch; `main` and `dev_cn` retain Chinese content and share the gameplay fixes and general art improvements.

[Changelog](CHANGELOG.md) · [Development and validation](docs/PROGRESS.md) · [CrazyGames upload checklist](artifacts/crazygames/UPLOAD-CHECKLIST.md)

The [public GitHub Pages game](https://ljq61.github.io/FlickChain/) is built from `main` and currently serves the Chinese edition. CrazyGames Preview and publication have not been completed.

## Game description

Flick coins, build a chain, and keep your streak alive on a cozy 3D tabletop.

Line up your shot, charge your flick, and hit exactly one other coin directly. Score a point, then take your next shot from the coin you just hit. All coins are shared. Other coins can knock into each other, but a miss, a direct hit on multiple coins, or any coin falling off the table breaks the chain. Rebounds from the table's obstacles are allowed.

Play solo to beat your best score, with three continues to keep your run going. Each completed round brings more coins to the table. Play against a friend on the same device or challenge the computer in a race to 10 points. Before a match, each player takes an opening shot: the longest valid shot that comes to rest on the table goes first.

### Solo Play

- Clear each round by chaining through its coins. Your last coin carries over at its actual resting position.
- A miss or foul ends the current attempt. Use one of three continues to keep your score and remaining coins; fallen coins are replaced when continuing.
- Restart begins a fresh run. Your local best score remains saved when browser storage is available.

### Local Battle

- Choose **2 Players** for one shared device or **Vs. Computer** for a computer opponent. This is local play, not online multiplayer.
- Both opening shots use the same starting position, direction and tabletop material. A fall or timeout forfeits that shot; tied results or two forfeits trigger another opening contest.
- A stationary coin partly overhanging the rim still counts when it has real tabletop support. Distance is measured to its resting position.
- The match uses a random wood or marble table, nine mixed gold/iron coins and one to five glasses. A legal relay scores +1 and keeps your turn; a miss or foul switches players after settlement. First to 10 wins.
- Below the winning score, a board with zero or one surviving coin keeps its score, table and obstacles. **2 Players** refills to nine coins; **Vs. Computer** adds eight new coins.
- The computer uses the same production physics, with a more forgiving aim and power strategy. Its hand and power meter show the charge before each shot. A brief central banner announces the current player's turn.

## Controls

| Action | Mouse / touch |
| --- | --- |
| Choose a starting coin | Click or tap any coin after the coins settle. Before firing, you can choose another starting coin. |
| Aim | Drag empty tabletop space to rotate the view and line up your shot. Opening shots always point straight ahead. |
| Charge and flick | Press and hold the hand or active coin, then release. Hold longer for more power; the meter fills green → yellow → red. |
| Full power | Reached after 1.25 seconds. Release within the following two seconds, or the charge is canceled; release and press again to retry. |
| Continue a successful chain | Play from the coin you just hit, at its final position. You cannot switch to another coin during that chain. |
| Pause / resume / restart / menu | Select the gear button, then the corresponding action. |
| Sound | Select the speaker button. CrazyGames can also mute the game. Audio starts after user interaction. |

Wait for each shot to settle before the next action. During the computer's turn, human shot input is locked; pause and menu controls remain available. Reduced-motion preferences disable hand tremble and coin-arrival animation.

## Run and build

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. To test on a phone connected to the same network:

```sh
npm run dev -- --host 0.0.0.0
```

```sh
npm test
npm run validate:levels
npm run build
npm run preview
```

`dist/` is the static game build. Upload its contents, with `index.html` at the archive root. Assets use relative paths; the AI Worker and bundled Rapier WASM are included. The build also emits `dist/version.json`.

## Version management

- **One source of truth:** `package.json.version`; the lockfile root and package entry must match.
- **Patch:** fixes and compatible polish. **Minor:** new features. **Major:** incompatible public/game behavior changes.
- Before preparing a new candidate, update the version and add its changes to [CHANGELOG.md](CHANGELOG.md). The game version is independent of save, level and physics compatibility versions; do not bump those automatically.

```sh
npm version patch --no-git-tag-version
# Use minor or major instead when appropriate.
npm run build
```

`version.json` records the game version, Git branch/revision, UTC build time and whether build inputs differ from the recorded commit. `sourceDirty: true` identifies a working-tree candidate; missing Git metadata is represented by `null`, not a fabricated revision. It does not indicate platform approval. Local tool configuration and documentation-only changes are excluded from the build-input change check.

Use versioned upload filenames such as `FlickChain-v0.2.0-dev_en.zip`, paired with a SHA-256 manifest. Earlier ZIPs remain historical candidates. On Windows, package the completed build with:

```powershell
$gameVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
Compress-Archive -Path dist/* -DestinationPath "artifacts/crazygames/FlickChain-v$gameVersion-dev_en.zip" -Force
```

Commit the source changes and version metadata before tagging a finalized release. Rebuild from that commit and verify the manifest before uploading. Platform submission and publication are separate from local builds and Git pushes.

## Release readiness

The latest gameplay validation passed 393 tests with one optional test skipped; type checking and production builds passed. Desktop browser checks include the visible computer charge, turn prompts and the opening overhang distance regression. Real-device touch/performance and CrazyGames Portal Preview remain pending.

CrazyGames SDK v3 handles loading, gameplay start/stop and platform mute, with local/offline fallback. Ads, accounts, cloud saves and leaderboards are not integrated. Three covers and English submission copy are ready; the two preview videos and platform review are still outstanding. See the [upload checklist](artifacts/crazygames/UPLOAD-CHECKLIST.md).

## Implementation and assets

TypeScript + Vite + Three.js + Rapier 3D WASM, with HTML/CSS UI, Pointer Events and Web Audio. The Game Core is independent of Three.js and the DOM. AI searches replay production physics in a Worker; runtime play does not call an LLM.

The default round table is 1.6 m across. Rendering, input boundaries, level validation and physical support share its geometry. Physics runs at fixed 120 Hz with two Rapier integration substeps per step. Moving beyond the rim permits natural tipping; an actual fall and the opening-specific resting-overhang check remain separate. The material/config version is `campaign-materials-v4`.

The animated hand uses the user's edited [Blender source](blender/pointing-hand-rigged.blend), [game adaptation](assets/flick-hand.blend) and [runtime GLB](public/models/flick-hand.glb). Export details and fingerprints are in the [asset documentation](assets/README.md). Coin sounds are edited CC0 recordings; background accompaniment is composed procedurally. Provenance is in [audio sources](assets/audio-sources.md).

Random rounds preserve the survivor and use recipe, geometry and real-physics initial-settlement checks. The five authored layouts retain complete solution replay tests; this does not prove that every random layout can be fully cleared. See [level validation](tests/levels/README.md).

## Documentation and deployment

- [Product requirements](docs/PRD.md)
- [Architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [Task plan](docs/TASK_PLAN.md)
- [Progress and evidence](docs/PROGRESS.md)
- [Sources and decisions](docs/SOURCES_AND_DECISIONS.md)
- [Agent instructions](AGENTS.override.md)

The [GitHub Pages workflow](.github/workflows/deploy-pages.yml) tests and builds `main`, then publishes only `dist/`. This does not publish the English branch or submit the game to CrazyGames. Check [Actions](https://github.com/ljq61/FlickChain/actions/workflows/deploy-pages.yml) for individual deployment results.
