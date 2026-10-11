# MVP level evidence

Single-player content now comes from src/content/CampaignGenerator.ts: randomized
continuous rounds, one retained coin, recipe-specific new coins/cups and revival
replenishment. The five JSON layouts exported by src/content/levels.ts are retained
for local Battle and fixed-layout production regression, not a single-player menu.
validateLevel is invoked by PhysicsWorld.create/reconfigure. Schema 1 uses metres,
standard/iron coins, wood/marble tables and CLEAR_ALL. The circular table diameter
is 1.6 m. New coins require full-radius clearance; retained real terminal coins
only require their centre to remain inside. Glass obstacles use circular footprints.
Omitting `shape` preserves legacy rectangular fixtures. The shared pure-math
`TableGeometry` checks radial clearance for circles; production Rapier uses a
real cylinder with its top at Y=0. Coins require their full radius and initial
clearance inside the boundary, and all four rotated obstacle corners must fit.
Adding other units or
objectives requires a schema upgrade.

`solutions.json` contains one complete semantic input sequence for each level.
It records stable source/target coin IDs, unit direction, normalized power,
schema and physics versions, and a SHA-256 fingerprint of the level, material
registry, physics configuration and coin dimensions. It contains no runtime
session IDs. Acceptance tests replay recorded inputs; they never discover new
expected results automatically.

Run acceptance:

```sh
npm run validate:levels
```

After intentional configuration changes, explicitly regenerate, inspect the
complete inputs and rerun acceptance:

```sh
FLICKCHAIN_GENERATE_SOLUTIONS=1 npx vitest run tests/levels/generate.test.ts --reporter=verbose
npm run validate:levels
```

The bounded offline search uses the production `GameSession`, full settlement
and Rapier physics for every candidate. It reconstructs branches from previous
inputs and frees every world. It searches nearby straight-line angles and powers,
with normalized powers from 0.3 to 1 and a 500-candidate limit per level; this is
a content verification tool rather than production AI.

On 2026-10-11, the five circular levels passed all 24 schema/replay checks; the one
opt-in generator test was skipped in normal acceptance. Complete solutions used
1, 1, 2, 3 and 4 shots respectively, with powers from 0.4 to 0.5. Candidate counts
were 3, 5, 9, 15 and 18; search took about 1.25 seconds in the local Node run.
The complete inputs and configuration fingerprints were explicitly regenerated
through production Rapier for `campaign-materials-v3`: maximum impulse 0.048 N·s,
120 Hz fixed gameplay steps and two 240 Hz integration substeps per fixed step.
The level layouts were unchanged. Every submitted stage also
passed the production 90-step initial stabilization. These figures describe this
local run only. Browser mouse/touch control, phone performance, perceived
difficulty and cross-device replay behavior require separate acceptance.

Later on 2026-10-11, the whiskey-glass change moved the shared configuration to
`campaign-materials-v4`: glass height is 0.12 m, with the collider's hidden base
extended into the tabletop to close the high-speed cap seam. The visible radius
and top height stay unchanged. Explicit production regeneration took about
1.33 seconds; all five complete semantic input sequences and candidate counts
were unchanged. The new version and fingerprints are recorded in solutions.json.

Random campaign acceptance is in campaign-generator.test.ts: 1000 recipe/geometry
layouts, 50 stabilized production worlds, bounded unusual RNGs, near-edge retained
iron, exact revival replacement counts and a fixed production opening replay for
the formerly unreachable edge-iron seed. The first new target is 0.20–0.55 m from
the carry coin and its corridor stays clear. This is not a proof that every
randomized complete chain is solvable. Tests accept an injected RNG; no persistent
runtime seed or whole-run replay is currently recorded.
