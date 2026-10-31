/**
 * ExternalKnowledgeGuard: como MinorGuard, sobre todo texto del LLM que entra en el mundo
 * (frases, notas, planes, recuerdos, crónicas), pero solo registra: anacronismos y referencias
 * externas que no encajan con quien escribe. Se engancha a MinorGuard como inspector
 * (`addInspector`), así ve exactamente los mismos textos. Ver docs/decisiones/mundo.md.
 */
import type { AgentSeed } from "@lethetown/shared";
import type { SafetyContext, SafetyKind, TextInspector } from "../agent/minor-safety";
import type { WorldBible } from "./bible";
import { normalizeText, type KnowledgeDetector } from "./knowledge";

export type KnowledgeKind = "anachronism" | "external";

/** Una detección (fila de `knowledge_log`). */
export interface KnowledgeRecord {
  /** Minuto de juego. */
  at: number;
  agentId: string | null;
  kind: KnowledgeKind;
  /** El término o el nombre propio. */
  term: string;
  /** Qué es ("móvil como algo corriente") o, en las externas, "no encaja con su perfil". */
  label: string;
  /** El texto (recortado). */
  text: string;
  /** De dónde viene (speech, memory, plan, chronicle…). */
  source: SafetyKind;
}

export interface KnowledgeGuardStats {
  anachronism: number;
  external: number;
  /** Textos descartados (solo en modo enforce). */
  blocked: number;
}

export interface ExternalKnowledgeGuardOptions {
  detector: KnowledgeDetector;
  mode: WorldBible["knowledgeGuard"]["mode"];
  seedOf: (agentId: string) => Pick<AgentSeed, "knowledge"> | undefined;
  now: () => number;
  onRecord?: (r: KnowledgeRecord) => void;
  /** La misma detección dentro de un texto que ya se registró (lo oído, al recordarlo): una vez. */
  dedupeMinutes?: number;
}

/** Textos que recuerdan o resumen lo de otros (los implicados también cuentan). */
const RETOLD = new Set<SafetyKind>([
  "memory",
  "reflection",
  "reconsolidation",
  "gist",
  "summary",
  "chronicle",
]);
const MAX_TEXT = 300;
const RECENT = 300;

/** El texto sin lo que va entre comillas ("…", «…», “…”). Lineal. */
export function withoutQuotes(text: string): string {
  let out = "";
  let close: string | null = null;
  for (const ch of text) {
    if (close) {
      if (ch === close) close = null;
      continue;
    }
    if (ch === '"') close = '"';
    else if (ch === "«") close = "»";
    else if (ch === "“") close = "”";
    else out += ch;
  }
  return out;
}

export class ExternalKnowledgeGuard {
  private readonly recent: { key: string; norm: string; at: number }[] = [];
  private readonly counts: KnowledgeGuardStats = { anachronism: 0, external: 0, blocked: 0 };

  constructor(private readonly opts: ExternalKnowledgeGuardOptions) {}

  stats(): KnowledgeGuardStats {
    return { ...this.counts };
  }

  /** El inspector para `MinorGuard.addInspector`. */
  readonly inspect: TextInspector = (text, ctx) => {
    const found = this.detect(text, ctx);
    for (const r of found) {
      this.counts[r.kind]++;
      this.opts.onRecord?.(r);
    }
    const anachronism = found.find((r) => r.kind === "anachronism");
    if (this.opts.mode === "enforce" && anachronism) {
      this.counts.blocked++;
      return `anacronismo: ${anachronism.label} («${anachronism.term}»)`;
    }
    return null;
  };

  /** Lo que hay que registrar de este texto (sin lo ya registrado hace poco en otro texto). */
  detect(text: string, ctx: SafetyContext): KnowledgeRecord[] {
    const at = this.opts.now();
    const norm = normalizeText(text);
    this.opts.detector.observe(text);
    const window = this.opts.dedupeMinutes ?? 60;
    while (this.recent.length && at - this.recent[0]!.at > window) this.recent.shift();
    const agentId = ctx.agentId ?? null;
    const base = { at, agentId, text: text.slice(0, MAX_TEXT), source: ctx.kind };
    const out: KnowledgeRecord[] = [];
    const seen = (key: string) =>
      this.recent.some((r) => r.key === key && (norm.includes(r.norm) || r.norm.includes(norm)));
    const push = (r: KnowledgeRecord) => {
      const key = `${r.kind}:${r.term.toLowerCase()}`;
      if (seen(key)) return;
      this.recent.push({ key, norm, at });
      if (this.recent.length > RECENT) this.recent.shift();
      out.push(r);
    };
    const anachronisms = this.opts.detector.anachronisms(text);
    for (const a of anachronisms) {
      push({ ...base, kind: "anachronism", term: a.term, label: a.label });
    }
    // "WhatsApp" ya es un anacronismo: no es además una referencia externa.
    const isAnachronism = (name: string) =>
      anachronisms.some((a) => normalizeText(name).startsWith(normalizeText(a.term)));
    // Externo: lo que dice o planea alguien se mide con su perfil; un recuerdo, con el de todos
    // los implicados (lo de Lagos que cuenta Samuel no es incoherente en quien lo recuerda).
    const retold = RETOLD.has(ctx.kind);
    const actors = [
      ...new Set([...(agentId ? [agentId] : []), ...(retold ? (ctx.actors ?? []) : [])]),
    ];
    // En un recuerdo, lo que va entre comillas lo dijo otro (quizá alguien sin nombre): ya se
    // registró, si tocaba, cuando lo dijo.
    let names = this.opts.detector
      .externalNames(retold ? withoutQuotes(text) : text)
      .filter((n) => !isAnachronism(n));
    for (const id of actors) {
      if (!names.length) break;
      const seed = this.opts.seedOf(id);
      if (!seed) continue;
      const outside = new Set(this.opts.detector.outsideProfile(text, seed));
      names = names.filter((n) => outside.has(n));
    }
    for (const name of names) {
      push({ ...base, kind: "external", term: name, label: "no encaja con su perfil" });
    }
    return out;
  }
}
