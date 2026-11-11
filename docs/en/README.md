# Lethetown (English)

The only page in English: what Lethetown is, what has been found, what comes next and how to
help. Everything else is in Spanish (code comments, UI, docs); issues and discussions in English
are welcome. [Español](../../README.md)

## What it is

A village of 20 neighbours driven by an LLM, with a memory that **works like a human one**: it
forgets, turns vague, is rewritten when recalled and mixes up who said what. It is a pixel-art
game in the browser and a test bench: every forgotten memory, every change and every goal is
audited with its reason. It runs **without API keys** with a mock provider (`pnpm install &&
pnpm dev`, see [desarrollo](../desarrollo.md)).

The question: **what happens in a village when its inhabitants' memory stops being a reliable,
unlimited record?** The hypothesis is that forgetting, memory reconstruction and psychological
differences produce more varied and believable stories. It is still open: the studies below are
observations without the control world that would test it.

All the psychology is code with parameters (`MemoryConfig` in `packages/agent-core`), not
instructions to the model: the LLM talks, proposes and writes; the engine decides what is
remembered, forgotten or achieved. So every phenomenon can be counted, compared across seeds and
switched off.

| Topic                           | What the engine does                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| **Forgetting**                  | Each memory's strength decays with game time; under a threshold (0.05) it is lost        |
| **Vagueness**                   | Under another threshold (0.3) only the gist remains                                      |
| **Reconsolidation**             | Recalling rewrites a memory a little, depending on mood; versions are kept               |
| **Source confusion**            | "X told me" can become "I lived it"                                                      |
| **False (and shared) memories** | Vague memories get filled in; what is told and repeated is fixed overnight as a fact     |
| **Prospective memory**          | Intentions that are kept, missed or forgotten ("congratulate Pilar on our anniversary")  |
| **Goals**                       | Life goal, projects and steps measured by the engine; motivation, frustration, giving up |
| **Learning**                    | Skills that grow with practice and rust; lore that is passed on and distorted            |

## Research

Real runs (Anthropic: decisions with `claude-haiku-5-5`, plans and consolidation with
`claude-sonnet-5-5`), analysed with `pnpm study:analyze`. Full reports, in Spanish, in
[Investigación](../investigacion/README.md).

- **E1, 48 hours.** A shared false memory grows out of a catchphrase: Hugo's "I'll pay you back,
  really" becomes a debt to Valentina that nobody seeded, fixed as a fact by reconsolidation and
  consolidation. 197 intentions kept vs 30 missed. $3.65 for 48 game hours.
- **E2, 72 hours, Mallorca and goals.** The two village gossips invent "la Pepa" and keep her
  alive (23 memories, each learnt from the other). Julián "achieves" a real talk with Inés that
  never happens, hence qualitative goals checked at night. 0 anachronisms in 1,596 lines.
- **E3, one week, two seeds.** Similar numbers, different stories: Julián tells Inés he is afraid
  of being alone in one seed and dodges it in the other; Tomás forgets the anniversary in one
  and remembers it in the other. Aurora loses her childhood friend Alma over the week (the
  memory drops below the threshold on day 6, strength 0.049). Intentions kept rise from 46 % to
  73–78 %. **$1.31 per world and day.**

E3 can be watched for free in the browser (`/replay`, see [vídeos](../videos/README.md)). The
paper: [Lethetown-paper.pdf](../investigacion/paper/Lethetown-paper.pdf).

## Roadmap

Done: human-like memory, psychology, actions validated by the engine, a 2D village, production
(multi-world, Docker), and by phases: systems as modules, Mallorca in 2002, measured goals,
skills and village lore, cognition on the move, and replays of recorded runs with a cinema mode
for clips. Next ([hoja de ruta](../roadmap.md)):

- **E4, a study run with a control world** (no forgetting or vagueness, or no cognition on the
  move) to test the hypothesis, not just observe.
- **Economy** (euros, buying and selling, limited resources, trades), **open-ended learning**
  (neighbours propose recipes, products or festivals the engine can run), **building** and a
  **life cycle** (ageing, births, legacy, with child protection reviewed).

Open questions: does forgetting make stories more varied or just noisier? Are shared false
memories about memory or about language? How much does a village converge with one model behind
everyone? Is measuring achieving? How much of a story is chance and how much design? Is culture
passed on? How much does a life cost (about $480 per game year)?

## How to help

Details, in Spanish, in [CONTRIBUTING.md](../../CONTRIBUTING.md); first tasks in
[Por dónde empezar](../../CONTRIBUTING.md#por-dónde-empezar).

- **Propose an experiment** (issue template "Propuesta de experimento"): a falsifiable
  hypothesis; what changes and only that (the seed, a switch such as
  `MEMORY_ABLATION=noForgetting,noVagueness` or `SIM_COGNITION=off`, or a `MemoryConfig`
  parameter in `config/memory.json`); what is measured (`pnpm study:analyze`); a control world;
  and a duration (3 game days for memory, a week for goals).
- **Run tests.** A mock run is free and needs no keys:
  `pnpm --filter @lethetown/server replay:demo --hours 72 --seed 7 --rec <dir>` and
  `pnpm study:analyze <dir>`. The mock tests code and switches, not behaviour. Share results
  with the "Resultado de una prueba" template.
- **Contribute code.** `pnpm install && pnpm dev`; before every commit,
  `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm docs:check`.
  Conventions in [CLAUDE.md](../../CLAUDE.md). Child protection comes first: changes that weaken
  it are not accepted.
- **Support the project.** A world costs $1.31 per game day; a 7-day study with a control world,
  about $28. API or compute credits, universities and labs, sponsorship or investment. Contact:
  see [CONTRIBUTING.md](../../CONTRIBUTING.md#apoyar-el-proyecto).

**Never share** `.env` or `.env.*`, a run's `.record-pass`, API keys, cookies, the whole `bd/`
folder or anything from `apps/web/public/assets/vendor/` (licensed third-party art, not even in
screenshots).
