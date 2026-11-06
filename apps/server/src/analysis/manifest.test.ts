import { describe, expect, it } from "vitest";
import { buildManifest, manifestMarkdown, StudyManifest } from "./manifest";

describe("manifiesto de una partida", () => {
  const m = buildManifest({
    env: {
      SIM_SEED: "7",
      SIM_SPEED: "10",
      SIM_NIGHT_SPEED: "360",
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_MODEL_FAST: "claude-haiku-5-5",
      ANTHROPIC_MODEL_REFLECTION: "claude-sonnet-5-5",
      MEMORY_ABLATION: "noForgetting, noVagueness",
      ANTHROPIC_API_KEY: "sk-secreto",
      DATABASE_URL: "postgres://u:p@h/db",
    },
    git: { sha: "abc123", dirty: false },
    routing: { tasks: { plan: { kind: "reflection" } } },
    pricing: { "claude-haiku-5-5": { input: 0.1 } },
    now: new Date("2026-11-05T10:00:00Z"),
  });

  it("SHA, semilla, velocidad, modelos, enrutado, precios, ablación y fecha; valida con zod", () => {
    expect(StudyManifest.parse(m)).toEqual(m);
    expect(m).toMatchObject({
      sha: "abc123",
      seed: 7,
      speed: 10,
      nightSpeed: 360,
      models: { fast: "claude-haiku-5-5", reflection: "claude-sonnet-5-5" },
      ablation: ["noForgetting", "noVagueness"],
      cognition: "on",
      createdAt: "2026-11-05T10:00:00.000Z",
    });
  });

  it("apunta la cognición en movimiento (el mundo de control de la 3.6, con SIM_COGNITION=off)", () => {
    const off = buildManifest({
      env: { SIM_COGNITION: "off" },
      git: { sha: null, dirty: null },
      routing: null,
      pricing: null,
      now: new Date(0),
    });
    expect(off.cognition).toBe("off");
    expect(manifestMarkdown(off)).toContain("apagada (mundo de control)");
    // Un manifiesto de antes de la 3.6 (sin el campo) sigue valiendo.
    const { cognition: _c, ...old } = off;
    expect(StudyManifest.parse(old).cognition).toBe("on");
  });

  it("nunca guarda secretos", () => {
    const text = JSON.stringify(m);
    expect(text).not.toContain("sk-secreto");
    expect(text).not.toContain("postgres://");
  });

  it("su sección de analysis.md", () => {
    const md = manifestMarkdown(m);
    expect(md).toContain("## Manifiesto");
    expect(md).toContain("Código: abc123");
    expect(md).toContain("Semilla 7, velocidad x10, noche x360");
    expect(md).toContain("noForgetting, noVagueness");
  });
});
