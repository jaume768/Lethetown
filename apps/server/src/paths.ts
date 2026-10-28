import { fileURLToPath } from "node:url";
import path from "node:path";

/** Raíz del monorepo (apps/server/src → ../../..). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SERVER_ROOT = path.join(REPO_ROOT, "apps/server");
export const fromRoot = (...parts: string[]) => path.join(REPO_ROOT, ...parts);
