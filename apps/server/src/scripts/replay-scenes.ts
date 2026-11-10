/**
 * Comprueba las escenas guardadas (`docs/videos/escenas.json`) contra sus paquetes de
 * repetición: que cada frase (`quote`) exista en la partida y caiga dentro de un plano, y que el
 * recuerdo de la tarjeta esté en el paquete. Solo lee; avisa de lo que hay que ajustar.
 * Uso: pnpm replay:scenes [--dir apps/web/public/replays]
 */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ReplayBundle, ReplayScenes, splitSpeech, type ReplayScene } from "@lethetown/shared";
import { fromRoot } from "../paths";

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const dir = dirFlag >= 0 ? args[dirFlag + 1]! : fromRoot("apps/web/public/replays");
const { scenes } = ReplayScenes.parse(
  JSON.parse(readFileSync(fromRoot("docs/videos/escenas.json"), "utf8")),
);

const bundles = new Map<string, ReplayBundle | null>();
function bundle(name: string): ReplayBundle | null {
  if (!bundles.has(name)) {
    const file = `${dir}/${name}.replay.json.gz`;
    bundles.set(
      name,
      existsSync(file)
        ? ReplayBundle.parse(JSON.parse(gunzipSync(readFileSync(file)).toString()))
        : null,
    );
  }
  return bundles.get(name)!;
}

/** Dónde aparece la frase: en lo que se dice, en los recuerdos o en la auditoría. */
function find(b: ReplayBundle, quote: string): number[] {
  const at: number[] = [];
  for (const { msg } of b.messages) {
    if (msg.type === "event" && splitSpeech(msg.event.text).line.includes(quote))
      at.push(msg.event.time);
  }
  for (const a of b.data?.audit ?? [])
    if (`${a.memoryText} ${a.reason}`.includes(quote)) at.push(a.at);
  return at;
}

let problems = 0;
const fmt = (n: number) => n.toFixed(1);
for (const s of scenes as ReplayScene[]) {
  const b = bundle(s.src);
  if (!b) {
    console.log(`·  ${s.id}: no está ${s.src}.replay.json.gz (no se comprueba)`);
    continue;
  }
  const notes: string[] = [];
  if (s.quote) {
    const at = find(b, s.quote);
    // Con la tarjeta de un recuerdo, la frase puede ser de antes (la tarjeta cuenta su historia).
    const end = s.shots.at(-1)!.to;
    const inShot = at.filter((t) =>
      s.memory ? t <= end : s.shots.some((x) => t >= x.from && t <= x.to),
    );
    if (!at.length) notes.push("la frase no está en la partida");
    else if (!inShot.length)
      notes.push(`la frase está en ${at.map(fmt).join(", ")}, fuera de los planos`);
    else notes.push(`frase en ${inShot.map(fmt).join(", ")}`);
  }
  // La tarjeta necesita el recuerdo o, si se borró, su auditoría.
  if (
    s.memory &&
    !b.data?.memories.some((m) => m.id === s.memory) &&
    !b.data?.audit.some((a) => a.memoryId === s.memory)
  ) {
    notes.push("el paquete no sabe nada del recuerdo de la tarjeta");
  }
  if (s.src2 && !bundle(s.src2)) notes.push(`no está ${s.src2}.replay.json.gz`);
  const bad = notes.some((n) => !n.startsWith("frase en"));
  if (bad) problems++;
  console.log(`${bad ? "✗" : "✓"}  ${s.id}: ${notes.join("; ") || "sin frase que comprobar"}`);
}
if (problems) process.exitCode = 1;
