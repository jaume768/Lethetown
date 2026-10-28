// Crea .env a partir de .env.example si no existe (modo mock, sin API keys).
import { copyFileSync, existsSync } from "node:fs";

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("[lethetown] Creado .env desde .env.example (LLM_PROVIDER=mock).");
}
