/**
 * Mock de objetos e inventario: devolver lo prestado si el dueño está delante (a veces se le
 * pasa), arreglar lo roto, usar la cafetera o la cocina con hambre, recoger lo suyo y, muy de vez
 * en cuando, prestar algo a quien tiene delante.
 */
import { sectionLines, type DecideCtx } from "./context";
import { registerDecideRule, type DecideReply } from "./registry";

const act = (action: Record<string, unknown>, reason: string): DecideReply => ({
  response: { choice: "act", action },
  reason,
});

function returnItem(c: DecideCtx): DecideReply | null {
  if (!c.available.has("return_item") || c.h % 3 === 0) return null;
  const line = sectionLines(c.p, "LLEVAS").find((l) => l.includes("te lo prestó"));
  const m = line && /^(\S+) (.+?) \(de (\S+)/.exec(line);
  if (!m) return null;
  return act({ type: "return_item", itemId: m[1] }, `Ya tocaba devolverle a ${m[3]} ${m[2]}.`);
}

function repair(c: DecideCtx): DecideReply | null {
  if (!c.available.has("use_object") || c.h % 2 !== 0) return null;
  const line = sectionLines(c.p, "PUEDES USAR").find((l) => l.includes(": arreglar "));
  if (!line) return null;
  const id = line.slice(0, line.indexOf(":"));
  return act({ type: "use_object", objectId: id, verb: "arreglar" }, `Voy a ver si arreglo ${id}.`);
}

function useAppliance(c: DecideCtx): DecideReply | null {
  if (!c.available.has("use_object") || c.speaker || c.h % 5 !== 0) return null;
  const hunger = Number(/hambre (\d\.\d+)/.exec(c.p)?.[1] ?? 0);
  if (hunger < 0.6) return null;
  const line = sectionLines(c.p, "PUEDES USAR").find((l) => /: (preparar_cafe|cocinar) /.test(l));
  if (!line) return null;
  const [id, rest] = line.split(": ") as [string, string];
  return act(
    { type: "use_object", objectId: id, verb: rest.split(" ")[0] },
    "Tengo hambre: me preparo algo.",
  );
}

function takeOwn(c: DecideCtx): DecideReply | null {
  if (!c.available.has("take_item")) return null;
  const line = sectionLines(c.p, "AQUÍ HAY").find((l) => l.endsWith("(tuyo)"));
  if (!line) return null;
  return act({ type: "take_item", itemId: line.split(" ")[0] }, "Esto es mío, me lo llevo.");
}

function lend(c: DecideCtx): DecideReply | null {
  if (!c.available.has("lend_item") || !c.someone || c.speaker || c.h % 37 !== 0) return null;
  const line = sectionLines(c.p, "LLEVAS").find((l) => l.includes("(tuyo)"));
  if (!line) return null;
  const [id] = line.split(" ");
  return act(
    { type: "lend_item", itemId: id, to: c.someone, days: 2 },
    "Se lo dejo un par de días; seguro que lo cuida.",
  );
}

registerDecideRule({ name: "return-item", respond: returnItem }, { before: "reply" });
registerDecideRule({ name: "repair-object", respond: repair }, { before: "broken-object" });
registerDecideRule({ name: "take-own-item", respond: takeOwn }, { before: "ponder" });
registerDecideRule({ name: "use-appliance", respond: useAppliance }, { before: "ponder" });
registerDecideRule({ name: "lend-item", respond: lend }, { before: "greet" });
