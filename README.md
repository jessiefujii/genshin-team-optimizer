# Genshin Team Optimizer

Suggests the strongest 4-character teams in Genshin Impact based on character roles, elemental synergy, and (eventually) a player's real character stats.

> Fan-made project. Not affiliated with or endorsed by HoYoverse. Genshin Impact and all related assets are trademarks and copyrights of HoYoverse.

## Planned features

1. **Pick your roster** — choose the characters you own and get a ranked list of team suggestions (rule-based synergy score).
2. **Import by UID** — fetch real character stats from the [Enka.Network](https://enka.network) API and factor them into scoring.
3. **Damage-aware scoring** — use the in-game damage formula, and later [gcsim](https://gcsim.app) simulations for the top candidates.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS
- [`genshin-db`](https://www.npmjs.com/package/genshin-db) for static game data (planned)
- Enka.Network API for player showcase data (planned)

## Getting started

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).
