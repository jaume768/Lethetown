/**
 * Sistema de conocimiento: el registro de conocimiento externo (ExternalKnowledgeGuard, enganchado
 * a la protección de menores: ve los mismos textos) y lo que se aprende de otros (alguien cuenta
 * algo de fuera que quien escucha no sabía → recuerdo semántico con su fuente). Sin LLM. Sin
 * biblia en las dependencias, no hace nada. Ver docs/decisiones/mundo.md.
 */
import {
  ExternalKnowledgeGuard,
  KnowledgeDetector,
  PersonGuard,
  type KnowledgeRecord,
  type PersonRecord,
} from "@lethetown/agent-core";
import type { SimEvent } from "@lethetown/shared";
import { z } from "zod";
import { InMemoryKnowledgeLogStore, type KnowledgeLogStore } from "../../db/knowledge-log";
import { errorMessage, type SimContext } from "../context";
import { registerSystem } from "./registry";

/** Ejemplos recientes que se guardan para la pestaña «Evolución». */
const EXAMPLES = 30;
/** Importancia del recuerdo de lo aprendido de otro. */
const LEARNED_IMPORTANCE = 5;

interface KnowledgeState {
  guard: ExternalKnowledgeGuard | null;
  detector: KnowledgeDetector | null;
  /** Personas inventadas (PersonGuard, reescritor de MinorGuard). */
  people: PersonGuard | null;
  /** Gente de fuera que cada uno conoce por lo que le contaron (de la instantánea, hasta cargar). */
  acquaintances: Record<string, string[]>;
  store: KnowledgeLogStore;
  /** "oyente:nombre": lo que ya aprendió (cada cosa, una vez). */
  learned: Set<string>;
  /** Detecciones por agente y tipo ("lucia:anachronism" → n). */
  counts: Record<string, number>;
  examples: KnowledgeRecord[];
}

export const knowledgeState = (ctx: SimContext) =>
  ctx.state<KnowledgeState>("knowledge", () => ({
    guard: null,
    detector: null,
    people: null,
    acquaintances: {},
    store: ctx.deps.knowledgeLog ?? new InMemoryKnowledgeLogStore(),
    learned: new Set(),
    counts: {},
    examples: [],
  }));

function record(ctx: SimContext, r: KnowledgeRecord): void {
  const s = knowledgeState(ctx);
  const key = `${r.agentId ?? "-"}:${r.kind}`;
  s.counts[key] = (s.counts[key] ?? 0) + 1;
  s.examples = [...s.examples, r].slice(-EXAMPLES);
  ctx.deps.track?.(
    s.store
      .add(r)
      .catch((e: unknown) =>
        ctx.emit("system", null, `⚠ No se pudo registrar el conocimiento: ${errorMessage(e)}`),
      ),
  );
}

const PERSON_LABEL: Record<PersonRecord["outcome"], string> = {
  retried: "persona inventada: se repite la decisión con el aviso",
  replaced: "persona inventada: cambiada por «alguien»",
  dropped: "persona inventada: no se guarda",
  logged: "posible persona inventada (solo se registra)",
};

/** Una persona inventada va al mismo registro (`knowledge_log`, tipo `person`). */
function recordPerson(ctx: SimContext, r: PersonRecord): void {
  record(ctx, {
    at: r.at,
    agentId: r.agentId,
    kind: "person",
    term: r.name,
    label: PERSON_LABEL[r.outcome],
    text: r.text,
    source: r.source,
  });
}

/**
 * Lo que dice alguien a otros con nombres de fuera que el oyente no conoce (y no son del pueblo
 * ni de la época): se lo queda como recuerdo semántico «contado por» quien lo dijo.
 */
function learnFrom(ctx: SimContext, e: SimEvent): void {
  if (e.kind !== "speech" || !e.agentId) return;
  const s = knowledgeState(ctx);
  const speaker = ctx.agents.get(e.agentId);
  const utterance = /: "(.*)"$/s.exec(e.text)?.[1];
  if (!s.detector || !speaker || !utterance) return;
  const listeners = [e.participants[1], ...(e.meta?.group ?? [])].filter(
    (id): id is string => !!id && id !== speaker.id,
  );
  // Una persona inventada no se aprende nunca; la gente de fuera de quien habla, sí (ahora el
  // oyente también la conoce y la puede nombrar).
  const invented = new Set(
    s.people?.find(utterance, { kind: "speech", agentId: speaker.id, actors: listeners }) ?? [],
  );
  for (const id of listeners) s.people?.learn(id, speaker.id, utterance);
  const names = s.detector.externalNames(utterance).filter((n) => !invented.has(n));
  if (!names.length) return;
  for (const id of listeners) {
    const listener = ctx.agents.get(id);
    if (!listener) continue;
    const fresh = new Set(s.detector.outsideProfile(utterance, listener.seed));
    for (const name of names.filter((n) => fresh.has(n) && !s.learned.has(`${id}:${n}`))) {
      s.learned.add(`${id}:${name}`);
      const write = ctx.deps.memory
        .tryRemember(
          {
            agentId: id,
            text: `${speaker.seed.name} me contó algo de ${name}: «${utterance}»`,
            type: "semantic",
            source: `contado por ${speaker.id}`,
            importance: LEARNED_IMPORTANCE,
            people: [speaker.id],
            eventId: e.id,
          },
          e.time,
        )
        .catch((err: unknown) =>
          ctx.emit("system", id, `⚠ No se pudo guardar lo aprendido: ${errorMessage(err)}`),
        );
      ctx.deps.track?.(write);
    }
  }
}

registerSystem({
  id: "knowledge",
  description:
    "Lo que sabe cada uno: registro de anacronismos y referencias externas, y lo que aprende de otros.",
  snapshot: {
    // 2: gente de fuera que cada uno conoce por lo que le contaron (PersonGuard).
    version: 2,
    schema: z.object({
      learned: z.array(z.string()),
      counts: z.record(z.string(), z.number()),
      acquaintances: z.record(z.string(), z.array(z.string())),
    }),
    save: (ctx) => {
      const s = knowledgeState(ctx);
      return {
        learned: [...s.learned],
        counts: { ...s.counts },
        acquaintances: s.people?.acquaintances() ?? s.acquaintances,
      };
    },
    restore: (ctx, d) => {
      const s = knowledgeState(ctx);
      s.learned = new Set(d.learned);
      s.counts = { ...d.counts };
      s.acquaintances = d.acquaintances;
      s.people?.restore(d.acquaintances);
    },
  },
  load: (ctx) => {
    const bible = ctx.deps.bible;
    const s = knowledgeState(ctx);
    if (!bible || s.guard) return;
    const seeds = [...ctx.agents.values()].map((a) => a.seed);
    s.detector = new KnowledgeDetector(bible, {
      neighbors: seeds,
      places: ctx.world.places.map((p) => p.name),
      // El vocabulario corriente sale de las semillas y la biblia (y de lo que se va leyendo).
      vocabulary: [
        ...seeds.flatMap((x) => [
          x.description,
          ...x.initialMemories,
          ...x.traits,
          ...(x.speechStyle?.catchphrases ?? []),
        ]),
        ...bible.everyday,
        ...bible.outside,
        ...bible.culture,
      ],
    });
    s.guard = new ExternalKnowledgeGuard({
      detector: s.detector,
      mode: bible.knowledgeGuard.mode,
      seedOf: (id) => ctx.agents.get(id)?.seed,
      now: () => ctx.clock.now(),
      onRecord: (r) => record(ctx, r),
    });
    ctx.deps.memory.guard?.addInspector(s.guard.inspect);
    const pg = bible.personGuard;
    s.people = new PersonGuard({
      neighbors: seeds,
      publicFigures: pg.publicFigures,
      extraGivenNames: pg.extraGivenNames,
      known: [
        bible.town,
        bible.city.name,
        ...bible.glossary.map((g) => g.term),
        ...bible.commonReferences,
        ...ctx.world.places.map((p) => p.name),
      ],
      isCommonWord: (w) => s.detector!.isCommonWord(w),
      mode: pg.mode,
      now: () => ctx.clock.now(),
      onRecord: (r) => recordPerson(ctx, r),
    });
    s.people.restore(s.acquaintances);
    ctx.deps.memory.guard?.addRewriter(s.people.rewriter);
    ctx.onEvent((e) => learnFrom(ctx, e));
  },
  retention: { table: "knowledge_log", policy: "knowledgeLog" },
  metrics: (ctx) => {
    const s = knowledgeState(ctx);
    const out: Record<string, number> = {
      anachronism: 0,
      external: 0,
      blocked: s.guard?.stats().blocked ?? 0,
      learned: s.learned.size,
      person: 0,
      "person.retried": s.people?.stats().retried ?? 0,
      "person.replaced": s.people?.stats().replaced ?? 0,
      "person.dropped": s.people?.stats().dropped ?? 0,
    };
    for (const [key, n] of Object.entries(s.counts)) {
      const kind = key.slice(key.lastIndexOf(":") + 1);
      out[kind] = (out[kind] ?? 0) + n;
      out[key.replace(":", ".")] = n;
    }
    return out;
  },
  admin: (ctx) => knowledgeState(ctx).examples,
});
