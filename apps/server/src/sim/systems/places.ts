/**
 * Sistema de lugares conocidos (sim/places.ts y sim/actions/places.ts; mock en agent/mock/places.ts).
 * Lo que conoce cada agente vive en su `AgentMind` (viaja con él en la instantánea).
 */
import { syncKnownPlaces } from "../places";
import { registerSystem } from "./registry";

registerSystem({
  id: "places",
  description: "Qué sitios conoce cada uno: al pasar, explorando o porque se lo cuentan.",
  actions: ["explore"],
  // Guarda lo que conoce cada agente (lo de la semilla o lo restaurado).
  load: (ctx) => syncKnownPlaces(ctx),
  retention: { table: "known_places", keep: "una fila por agente y lugar: no crece sin límite" },
  metrics: (ctx) => {
    const known = [...ctx.agents.values()].map((a) => Object.values(a.mind.knownPlaces));
    return {
      known: known.reduce((n, k) => n + k.length, 0),
      discovered: known.reduce((n, k) => n + k.filter((p) => p.source !== "seed").length, 0),
    };
  },
});
