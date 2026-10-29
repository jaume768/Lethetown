/**
 * Máquinas de estados de los objetos del mapa (spots). Cada tipo de objeto tiene verbos que
 * llevan de unos estados a otros; algunos duran un rato y luego vuelven solos (la cafetera
 * "en uso" vuelve a "idle"). El motor valida el verbo con el estado actual (`use_object`).
 * Cualquier objeto roto se puede arreglar.
 */

export interface ObjectVerb {
  verb: string;
  /** Para qué sirve, en el prompt ("preparar un café"). */
  label: string;
  /** Estados desde los que se puede. */
  from: string[];
  /** Estado al que pasa. */
  to: string;
  /** Si dura: minutos de juego tras los que pasa a `after`. */
  minutes?: number;
  after?: string;
  /** Actividad del agente mientras lo usa. */
  activity: string;
  activityKind: "eat" | "work" | "idle" | "read";
}

export interface ObjectMachine {
  type: string;
  /** Spots de este tipo (por id). */
  match: RegExp;
  verbs: ObjectVerb[];
}

/** Estados de "roto" (los que pone el jugador o una avería). */
export const BROKEN_STATES = ["rota", "roto", "estropeada", "estropeado", "averiada", "averiado"];

export const REPAIR_VERB: ObjectVerb = {
  verb: "arreglar",
  label: "intentar arreglarlo",
  from: BROKEN_STATES,
  to: "idle",
  activity: "arreglando",
  activityKind: "work",
};

export const OBJECT_MACHINES: ObjectMachine[] = [
  {
    type: "cafetera",
    match: /^cafetera$/,
    verbs: [
      {
        verb: "preparar_cafe",
        label: "preparar un café",
        from: ["idle"],
        to: "en uso",
        minutes: 10,
        after: "idle",
        activity: "preparando un café",
        activityKind: "eat",
      },
    ],
  },
  {
    type: "cocina",
    match: /^cocina_/,
    verbs: [
      {
        verb: "cocinar",
        label: "cocinar algo",
        from: ["idle"],
        to: "en uso",
        minutes: 30,
        after: "idle",
        activity: "cocinando",
        activityKind: "eat",
      },
    ],
  },
  {
    type: "horno",
    match: /^horno$/,
    verbs: [
      {
        verb: "hornear",
        label: "hornear pan",
        from: ["idle"],
        to: "horneando",
        minutes: 45,
        after: "idle",
        activity: "horneando pan",
        activityKind: "work",
      },
    ],
  },
  {
    type: "bancal",
    match: /^(bancal_|invernadero$)/,
    verbs: [
      {
        verb: "regar",
        label: "regarlo",
        from: ["idle", "seco"],
        to: "regado",
        minutes: 360,
        after: "idle",
        activity: "regando el huerto",
        activityKind: "work",
      },
    ],
  },
  {
    type: "botiquin",
    match: /^botiquin$/,
    verbs: [
      {
        verb: "curar",
        label: "curar a alguien",
        from: ["idle"],
        to: "en uso",
        minutes: 20,
        after: "idle",
        activity: "curando a alguien",
        activityKind: "work",
      },
    ],
  },
];

/** La máquina de un spot (por su id), si tiene. */
export function machineOf(spotId: string): ObjectMachine | undefined {
  return OBJECT_MACHINES.find((m) => m.match.test(spotId));
}

/** Verbos posibles ahora con ese objeto en ese estado (arreglar, si está roto). */
export function verbsFor(spotId: string, state: string): ObjectVerb[] {
  const verbs = [...(machineOf(spotId)?.verbs ?? []), REPAIR_VERB];
  return verbs.filter((v) => v.from.includes(state));
}
