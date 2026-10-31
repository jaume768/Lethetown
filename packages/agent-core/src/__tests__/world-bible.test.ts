import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededRng } from "../util/random";
import {
  WorldBible,
  bibleLines,
  formatGameDate,
  gameDate,
  nextWeather,
  todayLine,
} from "../world/bible";

const bible = WorldBible.parse(
  JSON.parse(readFileSync(new URL("../../../../config/world.json", import.meta.url), "utf8")),
);
const DAY = 1440;

describe("biblia del mundo", () => {
  it("config/world.json valida y es de 1996 en Mallorca", () => {
    expect(bible.year).toBe(1996);
    expect(bible.where).toMatch(/Mallorca/);
    expect(bible.city.name).toBe("Palma");
    expect(bible.currency).toMatch(/pesetas/);
  });

  it("calendario sin Date: el día 0 es el 15 de abril de 1996, un lunes", () => {
    expect(formatGameDate(gameDate(bible, 0))).toBe("lunes, 15 de abril de 1996");
    expect(formatGameDate(gameDate(bible, DAY + 60))).toBe("martes, 16 de abril de 1996");
    // Fin de mes y año bisiesto (1996 lo es).
    const feb = { year: 1996, startDate: "02-28" };
    expect(gameDate(feb, DAY).monthDay).toBe("02-29");
    expect(gameDate(feb, 2 * DAY).monthDay).toBe("03-01");
    const dec = { year: 1996, startDate: "12-31" };
    expect(gameDate(dec, DAY)).toMatchObject({ year: 1997, month: 1, day: 1, season: "winter" });
  });

  it("la fecha y la fiesta del día van al plan", () => {
    expect(todayLine(bible, 0)).toBe("Hoy es lunes, 15 de abril de 1996 (primavera).");
    const santJoan = { ...bible, startDate: "06-24" };
    expect(todayLine(santJoan, 0)).toMatch(/Sant Joan/);
  });

  it("clima de Mallorca: nieve casi nunca, calor en verano, lluvia en otoño", () => {
    const count = (startDate: string) => {
      const rng = seededRng(3);
      const b = { ...bible, startDate };
      const n: Record<string, number> = {};
      let w: ReturnType<typeof nextWeather> = "sunny";
      for (let i = 0; i < 4000; i++) {
        w = nextWeather(b, 0, w ?? "sunny", rng);
        n[w ?? "?"] = (n[w ?? "?"] ?? 0) + 1;
      }
      return n;
    };
    const summer = count("07-15");
    const winter = count("01-15");
    const autumn = count("10-15");
    expect(summer.snow ?? 0).toBe(0);
    expect(summer.heat ?? 0).toBeGreaterThan(summer.rain ?? 0);
    expect(winter.snow ?? 0).toBeLessThan(80);
    expect(autumn.rain ?? 0).toBeGreaterThan(count("07-15").rain ?? 0);
  });

  it("las líneas del prompt fijo son compactas y sin nada variable", () => {
    const lines = bibleLines(bible);
    expect(lines.join("\n")).toMatch(/1996/);
    expect(lines.join("\n")).not.toMatch(/Hoy es/);
    expect(lines.join("\n").length).toBeLessThan(3000);
  });
});
