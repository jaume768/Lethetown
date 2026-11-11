# Research

[Español](README.md)

Lethetown is a village of 20 neighbours driven by an LLM, with a memory that **works like a human
one**: it forgets, turns vague, is rewritten when recalled and mixes up who said what. The
question: **what happens in a village when its inhabitants' memory stops being a reliable,
unlimited record?** The hypothesis is that forgetting, memory reconstruction and psychological
differences produce more varied and believable individual stories and social dynamics. It is an
open hypothesis: the studies below are observations, still without the control world that would
test it (see [open questions](../../ROADMAP.en.md#open-questions)).

All the psychology is code with parameters (`MemoryConfig` in `packages/agent-core`), not
instructions to the model: the LLM talks, proposes and writes; the engine decides what is
remembered, what is forgotten and what has been achieved, and audits it with a reason. So every
phenomenon can be counted, compared across seeds and switched off to get a control.

## What is studied

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

Design notes (in Spanish) are in [docs/decisiones](../decisiones/README.md).

## Studies

Real runs (Anthropic: decisions with `claude-haiku-5-5`, plans and consolidation with
`claude-sonnet-5-5`), recorded and analysed with `pnpm study:analyze`. Reports are in Spanish.

### E1 — 48 hours ([report](estudios/e1-partida-2dias/ESTUDIO.md))

- **A shared false memory grows out of a catchphrase.** Hugo's ("I'll pay you back, really")
  becomes a debt to Valentina that nobody seeded: intentions, reconsolidation ("it's been two
  days…", after one hour) and consolidation fix it as a fact. Final social profiles are
  asymmetric: he sees her as a friend (+0.76); she sees someone who never pays (−0.20).
- **Prospective memory:** 197 intentions kept vs 30 missed (13 %).
- **Cost:** $3.65 for 48 game hours; 75 % went to three Sonnet tasks outside conversation.

### E2 — 72 hours, Mallorca and goals ([report](estudios/e2-partida-3dias-metas/ESTUDIO.md))

- **A neighbour who doesn't exist:** the two village gossips invent "la Pepa" and keep her alive
  with the same machinery: 23 memories about her, each learnt from the other with its source.
- **Measuring is not achieving:** Julián "achieves" a real talk with Inés because the criterion
  counted conversations, but the talk never happens ("We'll talk about Palma tomorrow…"). Hence
  qualitative goals checked by the nightly consolidation.
- **0 anachronisms** in 1,596 lines; 27 goals achieved; $1.63 per game day.

### E3 — one week, two seeds in parallel ([report](estudios/e3-semana-fase3/ESTUDIO.md))

- **Similar numbers, different stories.** With the same character seeds, in s13 Julián tells Inés
  he is afraid of being left alone (and consolidation confirms it); in s7 he dodges it. Tomás
  forgets the anniversary in s13 and remembers it in s7. What happens in both (Hugo's debt, Nuria
  vs Elena, Aurora telling about Alma) points to the design.
- **Visible forgetting:** Aurora loses her childhood friend over the week: "Alma was pure
  laughter… where was I?" (day 3), "I don't remember that about Alma any more" (day 4), and the
  memory drops below the threshold on day 6 (strength 0.049 < 0.05).
- **Intentions kept rise from 46 % to 73–78 %**; 56 and 45 new projects; 2 and 4 meaningful
  abandonments. **$1.31 per world and day** ($18.38 for both seeds, one week).

E3 can be watched for free in the browser (`/replay`, see [videos](../videos/README.md)).

## Paper

In [`paper/`](paper/README.md).

## Propose or run an experiment

See [CONTRIBUTING.md](../../CONTRIBUTING.md#propose-an-experiment).
