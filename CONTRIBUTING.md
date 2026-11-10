# Contributing

[Español](COLABORA.md)

Lethetown is a village of 20 neighbours driven by an LLM, with a memory that forgets, rewrites
itself and gets things wrong like a human one, and a test bench to study it: every forgotten
memory, every change and every goal is audited with its reason. What has been seen so far is in
[Research](docs/investigacion/README.en.md); what comes next, in the [roadmap](ROADMAP.en.md).

There are four ways to help: **propose an experiment**, **run tests**, **contribute code** and
**support the project**. To get started, see the [first tasks](docs/primeros-issues.md) (in
Spanish). Code comments, UI texts and commit messages are in Spanish; issues and discussions in
English are welcome.

## Propose an experiment

Open an issue with the "Propuesta de experimento" (experiment proposal) template. It needs:

1. **Hypothesis**: what you expect and why (one falsifiable sentence).
2. **What changes**, and only that:
   - the **seed** (`SIM_SEED`, or the characters in `seeds/agents.json`);
   - an existing **switch**: `MEMORY_ABLATION=noForgetting,noVagueness` (no forgetting or
     vagueness), `SIM_COGNITION=off` (no "cognition on the move", phase 3.6);
   - a **parameter** of `MemoryConfig` (forgetting and vagueness thresholds, decay,
     reconsolidation, source confusion…), `GoalsConfig`, `SkillsConfig` or `LoreConfig`, all in
     `packages/agent-core` with defaults and units. Memory ones go in `config/memory.json` (read
     at start-up if present: one server per world, as in `scripts/estudio-semana.sh`).
3. **What is measured**: `pnpm study:analyze` metrics (cost, latency, lines, social network and
   Gini, intentions kept or missed, goals achieved or abandoned, reconsolidations, forgetting,
   archived and deleted memories, anachronisms, lore passed on and distorted…) or a count over
   the database export (`bd/*.jsonl`).
4. **Control world**: the same seed without the change, at the same time
   (`scripts/estudio-semana.sh` runs several worlds in parallel; add up their cost, since they
   share the prompt cache).
5. **Duration**: 3 game days are enough for memory and conversation; goal abandonment and
   personality drift need a week.

### Full example: does forgetting make stories more varied?

- **Hypothesis.** With forgetting and vagueness, the same seed diverges more between two runs than
  without them, because what is forgotten and filled in changes what each neighbour does next.
- **What changes.** Three worlds at once, 30 min apart so they don't share the cache: `s7` and
  `s13` (normal) and `s7a`, seed 7 with `MEMORY_ABLATION=noForgetting,noVagueness`:

  ```bash
  STUDY_DIR=estudio/olvido ABLATION=on OFFSET_MINUTES=30 scripts/estudio-semana.sh prepare
  STUDY_DIR=estudio/olvido ABLATION=on OFFSET_MINUTES=30 scripts/estudio-semana.sh start
  STUDY_DIR=estudio/olvido ABLATION=on scripts/estudio-semana.sh record
  # … when it ends:
  STUDY_DIR=estudio/olvido ABLATION=on scripts/estudio-semana.sh export
  pnpm study:analyze estudio/olvido/s7 estudio/olvido/s7a
  ```

- **What is measured.** Between `s7` and `s7a`: lines per day, talking pairs and Gini, intentions
  kept, goals achieved and abandoned, cost; and in the audit (`bd/memory_audit.jsonl`), false
  memories (`false_memory`) and source confusions (`source_changed`), which should drop in `s7a`.
  And divergence: from `pnpm replay:moments s7 s13` versus `s7a`, how many seeded intentions or
  goals end differently (section "Las dos semillas").
- **Control.** `s7a` is the control of `s7`; `s13` tells how much changes by chance alone.
- **Duration and cost.** 7 game days, about 12.5 real hours; about $9 per world (E3: $1.31 per
  world and day), about $28 for the three.

Another one with existing switches: `COGNITION_CONTROL=on` runs `s7c` with `SIM_COGNITION=off`
to measure whether cognition on the move (greeting, stopping to chat, associations on the way)
changes the social network and the cost.

## Run tests

### A mock run (free, no keys)

```bash
pnpm install
pnpm dev                                         # http://localhost:5173, mock and in memory
pnpm --filter @lethetown/server sim:text 16      # or text only, no server: 16 game hours
pnpm --filter @lethetown/server replay:demo      # a short mock run, already packed
# A recorded mock run with its database (for study:analyze), with a switch:
MEMORY_ABLATION=noForgetting,noVagueness \
  pnpm --filter @lethetown/server replay:demo --hours 72 --seed 7 --rec estudio/mock/s7a
```

The mock calls no model: it tests code and switches, not behaviour.

### A short real run

With an Anthropic key in `.env` (`LLM_PROVIDER=anthropic`, see `.env.example`):

```bash
pnpm --filter @lethetown/server latency:probe 30 10   # 30 real minutes at x10: latency and cost
```

A full study run, with Postgres and recording, is described in `.env.study.example` and
`scripts/estudio-semana.sh` (`prepare`, `start`, `record`, `status`, `export`).

### Record, analyse, pack and share

```bash
RECORD_USER=… RECORD_PASSWORD=… pnpm --filter @lethetown/server record estudio/mine --hours 48 --track
pnpm --filter @lethetown/server world:export ../../estudio/mine/bd --world default
pnpm study:analyze estudio/mine                 # analysis.md and analysis.json
pnpm replay:moments estudio/mine                # moments.md: moments and long arcs
pnpm replay:pack estudio/mine --out apps/web/public/replays/mine.replay.json.gz
```

`/replay?src=/replays/mine.replay.json.gz` plays it in the browser with no server or cost. To
share results, open an issue with the "Resultado de una prueba" (test result) template with the
`analysis.md` and, optionally, the `.replay.json.gz` (a whitelist: no costs, users, emails, keys,
moderation or local paths).

**Never share** `.env` or `.env.*`, a run's `.record-pass` file (the recording user's password),
API keys, cookies, the whole `bd/` folder (it has `llm_calls` and `moderation_log`) or anything
from `apps/web/public/assets/vendor/` (licensed third-party assets: not redistributable, not even
in screenshots).

## Contribute code

```bash
pnpm install && pnpm dev     # works without Postgres or keys
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test   # before every commit (CI)
pnpm test:e2e                # Playwright, in mock mode
```

Conventions are in [CLAUDE.md](CLAUDE.md) and the reasons behind each decision in
[docs/decisiones](docs/decisiones/README.md) (Spanish). In short:

- **Monorepo:** `packages/shared` (zod schemas, the single source of truth for messages),
  `packages/agent-core` (pure logic: memory, psychology, goals; no network or DB), `apps/server`
  (simulation and every LLM call) and `apps/web` (Phaser draws, React panels; never calls an LLM).
- **Psychology is computed, not asked of the model:** every parameter in its `Config` with a
  default and units; every forgotten or changed memory audited with its reason.
- **Anything new in the world is a system** (`SimSystem`) and **every action** goes through the
  engine's catalogue.
- **Randomness** only through the seeded `Rng`; **time** in game minutes; UI texts in
  `i18n/es.ts` and `en.ts`; accessible.
- **Golden test** (`sim/golden.test.ts`): a refactor doesn't change it; a behaviour change
  regenerates it and explains why in the commit.
- **Commits** small, in Spanish, with a conventional prefix (`feat(agent-core): …`).

**Child protection (top priority).** There are minors in the village. Every LLM text that enters
the world goes through `MinorGuard`: nothing romantic with a minor, and adults meet minors only
in public places. Changes that weaken this are not accepted. See
[menores](docs/decisiones/menores.md).

## Support the project

Every real run costs money, and the cost is measured:

| What                                          | Cost                        | Source                                                                                      |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| One world, one game day                       | **$1.31** (1.19–1.43)       | [E3](estudio/semana-fase3/ESTUDIO.md), mean of two seeds                                    |
| A 7-day study with two seeds                  | **$18.38**                  | [E3](estudio/semana-fase3/ESTUDIO.md)                                                       |
| A 7-day study with a control world (3 worlds) | about **$28** (estimate)    | 3 × 7 × $1.31                                                                               |
| Earlier runs                                  | $3.65 (48 h) · $4.90 (72 h) | [E1](estudio/partida-2dias/ESTUDIO.md), [E2](estudio/partida-3dias-mundo-metas/estudio2.md) |

Besides API calls, one game week is about 12.5 real hours of machine time.

**What support pays for:**

- **More runs, with controls:** each hypothesis needs several seeds, its control world and
  repetitions; today one long run is launched at a time.
- **Assets:** third-party pixel art is licensed and not redistributable; support can buy full
  packs (characters, interiors) or commission original, publishable art.
- **Development time:** economy, life cycle, building and the comparative evaluation.

**Ways to help:**

- **API or compute credits** (LLM or cloud providers): they are the biggest cost.
- **Universities and labs** (memory psychology, cognitive science, AI): designing experiments,
  reviewing metrics, co-authoring publications.
- **Sponsorship** by people or companies.
- **Investment**, for those who want to talk about it.

Contact: `<CONTACTO>`
