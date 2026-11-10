import { execFileSync } from "node:child_process";

/**
 * Paquete de repetición pequeño para el e2e: 3 h de juego en mock grabadas en el proceso
 * (`replay:demo`). Va a apps/web/public/replays/ (ignorado por git), solo para los tests.
 */
export default function globalSetup() {
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@lethetown/server",
      "-s",
      "replay:demo",
      "--hours",
      "3",
      "--out",
      "apps/web/public/replays/e2e.replay.json.gz",
    ],
    { stdio: "inherit", env: { ...process.env, INIT_CWD: process.cwd() } },
  );
}
