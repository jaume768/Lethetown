import { execFileSync } from "node:child_process";

/**
 * Paquetes de repetición pequeños para el e2e: 3 h de juego en mock grabadas en el proceso
 * (`replay:demo`). Va a apps/web/public/replays/ (ignorado por git), solo para los tests.
 */
export default function globalSetup() {
  // Dos semillas: la segunda, para la pantalla partida.
  for (const [seed, out] of [
    ["7", "e2e.replay.json.gz"],
    ["13", "e2e-13.replay.json.gz"],
  ] as const) {
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@lethetown/server",
        "-s",
        "replay:demo",
        "--hours",
        "3",
        "--seed",
        seed,
        "--out",
        `apps/web/public/replays/${out}`,
      ],
      { stdio: "inherit", env: { ...process.env, INIT_CWD: process.cwd() } },
    );
  }
}
