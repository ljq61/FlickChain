# MVP level evidence

The production entrypoint is `src/content/levels.ts`; its only layout sources are
the five JSON files in `public/levels/`. `validateLevel` is also invoked by
`PhysicsWorld.create` before simulation. Schema 1 implicitly uses metres, wood,
standard coins and the Challenge CLEAR_ALL objective. Adding other units or
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
with a 500-candidate limit per level; this is a content verification tool rather
than production AI.

On 2026-10-09, the first five levels passed all 21 schema/replay checks; the one
opt-in generator test was skipped in normal acceptance. Complete solutions used
1, 1, 2, 3 and 4 shots respectively. Candidate counts were 2, 6, 9, 15 and 18;
search took about 0.6 seconds in the local Node run. Every submitted stage also
passed the production 90-step initial stabilization. These figures describe this
local run only. Browser mouse/touch control, phone performance, perceived
difficulty and cross-device replay behavior require separate acceptance.
