/**
 * `pnpm assets:check`: lista los assets que usa el mapa actual (seeds/town.tmj) y los agentes
 * (seeds/agents.json), con su licencia, y marca los no comerciales.
 * Con `--strict` termina con código 1 si hay alguno (útil en CI de una versión comercial).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AssetManifest, activePack, assetsInUse, mapAssetPack } from "@lethetown/shared";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "apps/web/public");
const strict = process.argv.includes("--strict");

const manifest = AssetManifest.parse(
  JSON.parse(readFileSync(path.join(PUBLIC, "assets/manifest.json"), "utf8")),
);
const tmj = JSON.parse(readFileSync(path.join(ROOT, "seeds/town.tmj"), "utf8")) as {
  tilesets: { name: string }[];
};
const agents = JSON.parse(readFileSync(path.join(ROOT, "seeds/agents.json"), "utf8")) as {
  id: string;
  appearance?: { sheet?: string };
}[];

const { name, pack } = activePack(manifest, mapAssetPack(tmj));
const used = assetsInUse(pack, {
  tilesets: tmj.tilesets.map((t) => t.name),
  agents: agents.map((a) => ({ id: a.id, sheet: a.appearance?.sheet })),
});
const credits = new Map(manifest.credits.map((c) => [c.id, c]));

console.log(`Pack del mapa: ${name}\n`);
for (const a of used) {
  const file = a.kind === "portraits" ? path.dirname(a.image) : a.image;
  const present = existsSync(path.join(PUBLIC, file)) ? "" : "  (falta el archivo)";
  const flag = a.license === "non-commercial" ? "NO COMERCIAL" : "comercial   ";
  const who = a.usedBy ? ` → ${a.usedBy.join(", ")}` : "";
  const src = a.source ? (credits.get(a.source)?.name ?? a.source) : "?";
  console.log(`${flag}  ${a.kind.padEnd(10)} ${a.name.padEnd(16)} [${src}]${who}${present}`);
}

const nc = used.filter((a) => a.license === "non-commercial");
console.log(
  nc.length === 0
    ? "\nTodos los assets en uso permiten uso comercial."
    : `\n${nc.length} asset(s) no comerciales en uso: ${nc.map((a) => a.name).join(", ")}.`,
);
if (strict && nc.length > 0) process.exit(1);
