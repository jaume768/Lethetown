# Roadmap

[Español](ROADMAP.md)

## Done

Before the phases: the base. Agents with human-like memory (forgetting, gist, reconsolidation,
source confusion, social profiles, rumours, memory budget), psychology (Big Five, mood, sleep,
biases, prospective memory), actions validated by the engine, paced conversations, a 2D world in
the browser and production (multiple worlds, snapshots, Docker). Then, by phase:

- **Phase 0 · Foundations:** systems as modules (`SimSystem`), bridge from talk to action, cost
  measured per task (Batch API, caching) and evolution metrics (`study:analyze`).
- **Phase 1 · World:** an invented village in Mallorca in 2002, with a world bible, calendar,
  weather, what each neighbour knows and an anachronism log.
- **Phase 2 · Goals:** life goal, projects and steps measured by the engine, with motivation,
  frustration, giving up, clashing goals and leaving the village.
- **Fix 2.5** (from run E2): steps that aren't lost, qualitative goals checked at night,
  intentions without inflation and nobody invents neighbours (`PersonGuard`).
- **Phase 3 · Learning:** skills that are practised, taught and rust; lore that is told, distorted
  and lost; slow personality drift.
- **Fix 3.5** (from run E3): spacing effect in memory, confirmed life goals, fewer false
  positives (nicknames, family), lore that really gets distorted.
- **Phase 3.6 · Cognition on the move:** encounters on the way with computed salience, greeting
  and stopping to chat, associations without the LLM, with a switch for the control world.
- **Replay and cinema mode:** any recorded run plays in the browser with no server or cost, with
  moments, long arcs, saved scenes, split screen and clips for social media.

Each stage's studies are in [Research](docs/investigacion/README.en.md).

## Next

- **E4 · Study run with a control.** One week with two seeds and a control world (no forgetting
  or vagueness, `MEMORY_ABLATION`; or without phase 3.6 cognition, `SIM_COGNITION=off`) to test
  the hypothesis, not just observe. What to check is in
  [PROGRESS-CORRECCION-3-5.md](PROGRESS-CORRECCION-3-5.md#a-revisar-en-la-partida-real-e4).
- **Economy.** Euros, buying and selling (`Item.value` already exists), truly limited resources
  (the garden yields so much, the lake has finite fish), trades and debts that can be paid.
  Metrics: wealth, inequality, trades, bankruptcies.
- **Open-ended learning.** A neighbour proposes something that didn't exist (a recipe, a product,
  a rule, a festival), the engine translates it into pieces it can run and a village institution
  approves it; if it works, others copy it. Culture nobody programmed one by one.
- **Building.** Raising, repairing or changing places in the village the same way: the neighbour
  proposes, the engine validates it against the map's rules.
- **Life cycle.** Ageing (a life clock separate from the day clock), couples only between adults,
  births inheriting personality and family stories (distorted generation after generation), death
  and legacy, handled with care. With a population cap and a review of child protection.

## Open questions

- **Does forgetting make stories more varied, or just noisier?** It needs the control world (no
  forgetting or vagueness) and a measure of divergence between seeds.
- **Are shared false memories about memory or about language?** Hugo's debt (E1) and "la Pepa"
  (E2) grow from catchphrases and gossip; would they appear without reconsolidation?
- **How much does a village converge with the same model behind everyone?** Personality drift in
  E3 went the same way for almost everyone; is more diversity (models, seeds) needed?
- **Is measuring achieving?** Qualitative goals are confirmed at night from what was said (0 of
  14 and 2 of 9 in E3): too strict, or fair?
- **How much of a story is chance and how much design?** What repeats in both E3 seeds points to
  the design; more seeds can separate them.
- **Is culture passed on?** Lore that is told and distorted: does it outlive whoever knew it? For
  how many generations?
- **How much does a life cost?** At $1.31 per world and day, a game year is about $480: what can
  be made cheaper without changing behaviour?
