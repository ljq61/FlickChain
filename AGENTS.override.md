# FlickChain《一弹到底》— project agents

## Workspace and evidence

- This workspace is the new FlickChain game project at /Users/jackie/FlickChain. At migration time it contains configuration and planning documents only, with no game implementation. Source project mirror files remain read-only; do not edit, rename, move or delete them.
- These local agent settings were migrated from the source project mirror. Verify configuration loading in this workspace; a different directory does not automatically inherit project settings. Product scope is docs/PRD.md, architecture is docs/TECHNICAL_ARCHITECTURE.md, and execution order is docs/TASK_PLAN.md.
- Direction comes from the project chat 「小游戏玩法设计」, latest Web 3D PRD V0.1 (conversation 6ac608a3-e828-83ec-96ed-47813b5fad49), together with the user's corrections: all coins are public and Challenge fails on any foul. Technical choices and tuning numbers in the PRD are planning defaults, not measurements.

## Development gate and search

- Before implement/fix/refactor work, read ~/.codex/rules/gates/dev-gate.md, then call rule_search and vault_search. Main agent completes the routing and pre-code receipts before delegation and injects the applicable constraints into each task. Load HMIRP Stable constraints only on a strong HMIRP signal.
- Use codegraph_explore before ordinary code searches when .codegraph/ exists. Do not create an index unless requested.
- Never independently Approve an MR or change its description without explicit permission.

## Product direction and rule contract

- Build a mobile-first Web 3D physics game with TypeScript + Vite + Three.js + Rapier 3D WASM. Use HTML/CSS UI, Pointer Events and Web Audio. Early play is offline; CrazyGames and possible networking belong to later phases.
- Visual direction: refined miniature tabletop/toy photography. Start with wood and standard coins. Support phone portrait 9:16 and adaptive desktop 16:9 by changing camera/UI, not world rules.
- All coins are public. For one complete shot, exactly one target B with no foul yields +1, removes source A after settlement, and transfers control to B at its final physical position; the same player continues. Repeated A-B contact is one target. A directly hitting B and C is a foul; B subsequently hitting C is legal. Ordinary wall/obstacle rebounds are legal.
- Miss, additional coin contact or any coin falling fails Challenge and ends the current player's Battle turn. Lock input and show failure immediately once certain; settle/clean up safely before the next action. Battle retains the resulting board. If the active coin falls, the next player selects among remaining coins after settlement. Battle uses random wood/marble, 1–5 cups and 9 mixed coins, an opening distance contest, PVP/PVE, and first to 5 points. Below 5 points, 0–1 surviving coins trigger refill to 9 while preserving the board and score. Challenge succeeds only via its valid objective, not a fall-induced reduction.
- Keep Game Core free of Three.js/DOM dependencies. Use fixed physics steps, stable IDs and one material registry. AI/prediction must reuse production physics and shot evaluation; do not promise unconditional cross-device determinism. 120 Hz is an initial candidate subject to mobile validation.
- Sequence work: (1) physics/input prototype, (2) full-shot relay rules, (3) Challenge and local Battle, (4) Worker AI, (5) materials, verified levels and polish, (6) platform publishing. Roles for later phases remain available but are not a mandate to develop those features early.

## Delegation and model settings

For substantive implementation, fixes or reviews with separable work, use the relevant specialized subagents and wait for their results before integration. Keep small dependent tasks in the main agent. After substantive changes, request independent test-reviewer verification.

| Role | Model / reasoning | Scope |
|---|---|---|
| Main coordinator | gpt-6.1-sol / high | Requirements, architecture, shared interfaces, integration and delivery |
| physics-gameplay-engineer | gpt-6.1-sol / high | Rapier, full-shot rules, scoring, state and modes |
| presentation-engineer | gpt-6.1-sol / xhigh | Three.js, input, HTML/CSS UI, camera, effects and audio |
| ai-level-engineer | gpt-6.1-sol / high | Worker AI, level data, material data and solution replay |
| platform-engineer | gpt-6.1-sol / high | Persistence, static packaging, compatibility and later CrazyGames |
| test-reviewer | gpt-6.1-sol / xhigh | Independent read-only acceptance review |
| repo-scanner | gpt-6.1-sol / low | Read-only exploration and caller mapping |
| escalation-engineer | gpt-6-astra / high | Repeated failures or difficult cross-system diagnosis only |

- At most three subagents concurrently, plus the main agent. No nested delegation. Default subagents use gpt-6.1-sol/high; custom role files set their own model and effort.
- Select the named role using the client's custom-agent support. If the available spawn tool exposes only task/model/effort fields, explicitly supply the role instructions, model and effort, and fork only the relevant context; full-history forks inherit parent settings and must not be assumed to apply the role model.
- Before every write delegation, assign non-overlapping files and the shared API contract. Planned directories in role files are ownership guidance until those files exist.
- Main owns src/app/, src/types/, package/lockfiles, entrypoint, build/CI configuration and cross-module integration unless explicitly handed off. Other agents propose shared edits; one writer applies them. Serialize browser sessions, deployment actions and other shared mutable tools.
- Scanner and reviewer stay read-only. Escalation starts with established evidence and failed attempts. Agents return changed files, behavior, checks, risks and evidence boundaries.
- Verify rules/physics with targeted regressions and UI with actual browser interaction. Keep automated simulation, browser mouse, simulated touch, real touch/device performance, deployed site, CrazyGames Preview and actual publication distinct.
