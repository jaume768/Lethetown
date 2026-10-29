/** Lectura de archivos del repo (semillas, precios, configuración) validados con zod. */
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { fromRoot } from "../paths";

export async function readJson<T>(schema: z.ZodType<T>, file: string): Promise<T> {
  return schema.parse(JSON.parse(await readFile(fromRoot(file), "utf8")));
}
