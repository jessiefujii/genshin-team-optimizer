# Genshin Team Optimizer

Suggests the strongest 4-character teams in Genshin Impact from the characters you own, scored from each character's kit and, when you have them, your real builds.

> Fan-made project. Not affiliated with or endorsed by HoYoverse. Genshin Impact and all related assets are trademarks and copyrights of HoYoverse.

## What it does

- **Roster:** tick the characters you own (and their constellations, and the Witch's Homework / Witch's Revelation quests that unlock Hexerei and Stellar Glimmer). The best teams update as you go, with a line-by-line score breakdown, a generated rotation and an energy check for each. You can require or exclude characters.
- **Import by UID:** fetches your in-game showcase from [Enka.Network](https://enka.network) (level, ascension, talents, weapon, artifact sets, constellations and final stats). Or enter a build by hand in the build editor, copying final stats from the in-game Attributes screen.
- **Worth building:** suggests which unbuilt characters would most improve your best teams.
- **Reference pages:** `/tags` lists each character's hand-written tags, and `/effects` lists the weapon, artifact set and constellation effects the scorer uses.

The roster is saved in your browser (localStorage).

## How scoring works

Each team gets points for one on-field carry, the carry's main reaction and partners, buffers, resonance, survivability, energy, team preferences and item effects, minus conflicts. Point values live in `POINTS` in `src/lib/scoring/score.ts`.

The inputs come from each character's kit, not from tier lists:

- **Buffers** score by the damage their buff adds to the carry, read from the talent tables (value at talent level 9, uptime = duration ÷ cooldown): +20% damage = 10 points. A bonus to one reaction only counts on the share of the carry's damage that is that reaction.
- **Family mechanics** come from the kit text: Moonsign's Ascendant Gleam, Hexerei's Secret Rite, Natlan's Nightsoul Bursts and Stellar Glimmer's Radiance, plus which characters convert which reactions.
- **Builds:** with an imported or entered build, the scorer uses its stats (crit value, ER, EM, base ATK, talent levels). Without one, the character is scored at benchmark stats and the team says so.

`npm run compare` checks the results against the teams build guides recommend (`src/lib/scoring/known-teams.ts`).

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
| `npm run compare` | Report: where guide-recommended teams rank among the scorer's top 100 per carry |
| `npm run bench` | Team search timing for a 50-character roster |
| `npm run kit` | Regenerates `data/kit.json` from genshin-db plus `data/kit-overrides.json` |
| `npm run lint` | ESLint |

Add `--silent=false` to see the compare report, e.g. `npx vitest run src/lib/scoring/known-teams.compare.test.ts --silent=false`.

## Data files

| File | Contents | How it's made |
| --- | --- | --- |
| `data/tags.json` | Each character's roles, reactions, rotation, families and preferences | Hand-written |
| `data/kit.json` | Buff values and uptimes, Ascendant Gleam, Secret Rite, Nightsoul Burst and Stellar effects | `npm run kit` |
| `data/kit-overrides.json` | Kit text genshin-db doesn't have yet (Witch's Eve Rite and Witch's Revelation passives, new characters), with sources | Hand-filled |
| `data/effects.json` | Weapon, artifact set and constellation effects | `node scripts/draft-effects.mjs`, then reviewed |
| `data/enka-skill-order.json` | Which Enka skill ID is which talent | `node scripts/update-enka-skill-order.mjs` |

After a genshin-db update, run `npm run kit` (it fails if a kit sentence it reads has changed, or a new character needs an entry), then `npm test` and `npm run compare`.
