// Crea .env a partir de .env.example si no existe (modo mock, sin API keys), con una
// contraseña aleatoria para el Postgres de docker-compose.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync(".env")) {
  const password = randomBytes(18).toString("base64url");
  const env = readFileSync(".env.example", "utf8").replaceAll("cambia-esta-contraseña", password);
  writeFileSync(".env", env, { mode: 0o600 });
  console.log("[lethetown] Creado .env desde .env.example (LLM_PROVIDER=mock).");
}
