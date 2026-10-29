# Genshin Team Optimizer

Suggests the strongest 4-character teams in Genshin Impact from the characters you own, scored from each character's kit and, when you have them, your real builds.

> Fan-made project. Not affiliated with or endorsed by HoYoverse. Genshin Impact and all related assets are trademarks and copyrights of HoYoverse.

## Highlights

- **Validated against experts:** for 14 of 16 main characters, a team recommended by expert
  build guides ranks in the app's top 100, up from 3 of 16 on the first run. For current
  meta teams it's 10 of 13.
- **Automated model checks:** rules every team must obey (scores stay in realistic ranges,
  never drop when a character gets stronger, don't depend on member order, and outliers
  get flagged), tested on 600 randomly sampled teams plus every guide team.
- **Data from several sources:** 129 characters merged from genshin-db, the live
  Enka.Network API, and hand-written tags, each hand-filled value with its source.
- **Tested:** 300 unit tests (Vitest).

## What it does

- **Planner (`/`):** tick the characters you own (and their constellations, and the Witch's Homework / Witch's Revelation quests that unlock Hexerei and Stellar Glimmer). The best teams update as you go, each with its damage per second, a line-by-line breakdown, a generated rotation and an energy check. You can require or exclude characters.
- **Import by UID:** fetches your in-game showcase from [Enka.Network](https://enka.network) (level, ascension, talents, weapon, artifact sets, constellations and final stats). Or enter a build by hand in the build editor, copying final stats from the in-game Attributes screen; a Traveler's build editor also asks whether the Traveler's two Base ATK quests are done.
- **Worth building:** suggests which unbuilt characters would most improve your best teams. A team counts for a character only when they are its one unbuilt member.
- **Reference pages:** `/tags` lists each character's hand-written tags, and `/effects` lists the weapon, artifact set and constellation effects the scorer uses.

Character, weapon and artifact set icons come from Enka. A top bar links the three pages. The roster is saved in your browser (localStorage).

## How scoring works

A team scores by the damage all four members deal over one rotation, against one shared reference:

- **Team damage:** every member's hits (the carry's on-field combo, sub-DPS and support Skills and Bursts) go through the wiki's damage formula at talent level 9, with every buff, RES/DEF shred, weapon passive and artifact set that reaches them. Reactions come from one shared aura budget: Vaporize and Melt amplify hits, Spread and Aggravate add flat damage, Lunar and transformative reactions deal their own damage. Bursts count only in the share of rotations Energy funds.
- **Score:** team damage per second ÷ the median guide team's, × 100, so a team at the median scores 100. Each team also shows its ratio to its carry's best guide team. The reference lives in `data/team-reference.json` (`npm run reference`).
- **Remaining point lines:** what the damage model doesn't cover yet (survival against an Abyss hit, starved Bursts, constellations, some EM and Energy gear, conflicts) still scores as points, turned into a multiplier on team damage at 2% per point. Point values live in `POINTS` in `src/lib/scoring/score.ts`.
- **Builds:** with an imported or entered build, the scorer uses its stats, weapon, sets and talent levels. Without one, the character (carry or support) gets a KeqingMains benchmark build with their guide's weapon and set (genshin-builds' where KQM has no guide), and the team says so.

Inputs come from each character's kit (genshin-db plus sourced overrides), not from tier lists. Guide teams are only a check: `npm run compare` reports where they rank (`src/lib/scoring/known-teams.ts`: KeqingMains quick guides plus genshin-builds' team pages), and `npm run meta` does the same for current meta teams.

Known gaps: single target only (AoE: #211); Manekin and Manekina have no damage profile yet (#203); constellations change kits, combos and buffs in damage (#106), but the other constellation effects in `effects.json` still score as points; some weapon passives and 4-star sets aren't modeled yet (#384, #385). Open work is tracked in the GitHub issues.

The search runs in Web Workers (up to 4). From 25 characters it scores each carry's likely teams rather than every combination.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS
- [`genshin-db`](https://www.npmjs.com/package/genshin-db) for game data (server side only; it's large)
- [Enka.Network API](https://github.com/EnkaNetwork/API-docs) for player showcases, through a server route that sets a User-Agent and caches
- [Vitest](https://vitest.dev) for tests

## Getting started

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests (without the timing and compare runs) |
| `npm run compare` | Report: where guide-recommended teams rank among the scorer's top 100 per carry (~45 min, 8 parts on 4 workers) |
| `npm run meta` | Report: where current meta teams rank, plus the roster check (~20 min, 8 parts on 4 workers) |
| `npm run roster` | Quick check on `data/test-rosters/jessie.json`: Zibai Premium's rank and score, the #20 score and the top 5 (seconds) |
| `npm run reference` | Rewrites `data/team-reference.json` (the guide-team reference scores are measured against) and prints the diff |
| `npm run bench` | Team search timing for a 50-character roster |
| `npm run kit` | Regenerates `data/kit.json` from genshin-db plus `data/kit-overrides.json` |
| `npm run roles` | Refetches in-game Character Roles from the wiki into `data/wiki-roles.json` and `data/tags.json` |
| `npm run lint` | ESLint |
| `npm run build` / `npm start` | Production build and server |

## Data files

| File | Contents | How it's made |
| --- | --- | --- |
| `data/tags.json` | Each character's roles, reactions, rotation, families and preferences | Hand-written |
| `data/kit.json` | Buff values and uptimes, Ascendant Gleam, Secret Rite, Nightsoul Burst and Stellar effects | `npm run kit` |
| `data/kit-overrides.json` | Kit text genshin-db doesn't have yet (Witch's Eve Rite and Witch's Revelation passives, new characters), with sources | Hand-filled |
| `data/effects.json` | Weapon, artifact set and constellation effects | `node scripts/draft-effects.mjs`, then reviewed |
| `data/particles.json` | Energy particles per Skill and Skill cooldowns | Wiki, hand-edited |
| `data/subdps-builds.json` | Benchmark substat priorities for sub-DPS without a build | KeqingMains quick guides, hand-written |
| `data/wiki-roles.json` | In-game Character Roles (main DPS, sub-DPS, field time) | `npm run roles` |
| `data/role-overrides.json` | Roles changed from the wiki's, with the reason | Hand-written |
| `data/team-reference.json` | Median guide team damage and each carry's best guide team | `npm run reference` |
| `data/test-rosters/jessie.json` | Jessie's roster (86 owned, 35 built) for `npm run roster` and `npm run meta` | Hand-made, builds from her Enka showcases |
| `data/enka-skill-order.json` | Which Enka skill ID is which talent | `node scripts/update-enka-skill-order.mjs` |

After a genshin-db update, run `npm run kit` (it fails if a kit sentence it reads has changed, or a new character needs an entry), then `npm test` and `npm run reference`. Run `npm run compare` and `npm run meta` once at the end of a big model change.
