/**
 * Comprueba los enlaces de la documentación: recorre todos los `.md` del repositorio (los de git,
 * sin node_modules ni lo ignorado) y falla si un enlace relativo apunta a un fichero que no existe
 * o a un `#ancla` que no es un encabezado del fichero. Avisa también (y falla) si una captura de
 * `docs/capturas/` no la usa ningún `.md`.
 *
 * Uso: pnpm docs:check
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURES = "docs/capturas/";
/** Ficheros que se enlazan pero los pone el autor a mano (solo avisa). */
const PENDING = new Set<string>();

function gitFiles(...patterns: string[]): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...patterns],
    { cwd: ROOT, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("node_modules/") && existsSync(join(ROOT, f)));
}

/** Ancla de un encabezado como la genera GitHub (minúsculas, sin puntuación, espacios → «-»). */
function slug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Quita los bloques de código (``` y ~~~), para no mirar enlaces ni encabezados de ejemplo. */
function stripFences(text: string): string {
  return text.replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, "");
}

const anchorCache = new Map<string, Set<string>>();

function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  const text = stripFences(readFileSync(file, "utf8"));
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(m[1]!);
  anchorCache.set(file, anchors);
  return anchors;
}

/** Enlaces de un `.md`: `[texto](destino)`, `![alt](destino)` y `src`/`href` de HTML. */
function linksOf(text: string): string[] {
  const body = stripFences(text).replace(/`[^`\n]*`/g, "");
  const links: string[] = [];
  for (const m of body.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    links.push(m[1]!);
  }
  for (const m of body.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) links.push(m[1]!);
  for (const m of body.matchAll(/\s(?:src|href)="([^"]+)"/g)) links.push(m[1]!);
  return links;
}

function check(): string[] {
  const problems: string[] = [];
  const used = new Set<string>();
  for (const md of gitFiles("*.md")) {
    const file = join(ROOT, md);
    for (const raw of linksOf(readFileSync(file, "utf8"))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
      const [pathPart, anchor] = raw.split("#", 2) as [string, string | undefined];
      const path = decodeURI(pathPart);
      const target = path === "" ? file : resolve(dirname(file), path);
      const rel = relative(ROOT, target);
      if (rel.startsWith("..")) {
        problems.push(`${md}: ${raw} sale del repositorio`);
        continue;
      }
      if (!existsSync(target)) {
        if (PENDING.has(rel)) {
          console.warn(`${md}: ${raw} falta (lo pone el autor)`);
          continue;
        }
        problems.push(`${md}: ${raw} no existe`);
        continue;
      }
      used.add(rel);
      if (anchor && target.endsWith(".md") && statSync(target).isFile()) {
        if (!anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase())) {
          problems.push(`${md}: ${raw}: el ancla #${anchor} no es un encabezado`);
        }
      }
    }
  }
  for (const capture of gitFiles(`${CAPTURES}*`)) {
    if (!used.has(capture)) problems.push(`${capture}: ninguna página la usa`);
  }
  return problems;
}

const problems = check();
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} enlace(s) roto(s) o captura(s) sin uso.`);
  process.exit(1);
}
console.log("Enlaces de la documentación: todo bien.");
