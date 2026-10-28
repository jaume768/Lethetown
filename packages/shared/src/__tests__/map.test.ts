import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AssetManifest,
  REQUIRED_STAMPS,
  activePack,
  characterFor,
  findPath,
  parseTiledMap,
  pathLength,
  pointAlong,
  toWaypoints,
  positionAt,
  type Grid,
} from "../index";

const tmj = JSON.parse(
  readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8"),
);

function gridFrom(rows: string[]): Grid {
  return {
    width: rows[0]!.length,
    height: rows.length,
    collision: rows.flatMap((r) => [...r].map((c) => (c === "#" ? 1 : 0))),
  };
}

describe("A*", () => {
  it("encuentra el camino más corto rodeando obstáculos", () => {
    const grid = gridFrom(["....", ".##.", "...."]);
    const path = findPath(grid, { x: 0, y: 1 }, { x: 3, y: 1 })!;
    expect(path[0]).toEqual({ x: 0, y: 1 });
    expect(path.at(-1)).toEqual({ x: 3, y: 1 });
    expect(path.length - 1).toBe(5);
    for (const p of path) expect(grid.collision[p.y * grid.width + p.x]).toBe(0);
  });

  it("es determinista", () => {
    const grid = gridFrom(["......", "......", "......"]);
    const a = findPath(grid, { x: 0, y: 0 }, { x: 5, y: 2 });
    const b = findPath(grid, { x: 0, y: 0 }, { x: 5, y: 2 });
    expect(a).toEqual(b);
  });

  it("devuelve null si no hay camino o el destino está bloqueado", () => {
    const grid = gridFrom([".#.", ".#.", ".#."]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("waypoints, longitud y posición a lo largo del camino", () => {
    const wp = toWaypoints([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(wp).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    expect(pathLength(wp)).toBe(4);
    expect(pointAlong(wp, 1)).toEqual({ x: 1, y: 0, facing: "right" });
    expect(pointAlong(wp, 3)).toEqual({ x: 2, y: 1, facing: "down" });
    expect(pointAlong(wp, 99)).toMatchObject({ x: 2, y: 2 });
  });
});

describe("mapa del pueblo (seeds/town.tmj)", () => {
  const world = parseTiledMap(tmj);

  it("tiene los 5 lugares con sus ids y nombres", () => {
    expect(world.places.map((p) => p.id).sort()).toEqual(
      ["cafe_ola", "casa_azul", "casa_roja", "parque", "tienda"].sort(),
    );
    expect(world.places.find((p) => p.id === "cafe_ola")?.name).toBe("Café La Ola");
    expect(world.width).toBe(60);
    expect(world.height).toBe(40);
  });

  it("los spots tienen pose y las camas dueño", () => {
    const spots = world.places.flatMap((p) => p.objects);
    expect(spots.find((s) => s.id === "cama_azul")).toMatchObject({
      pose: "sleep",
      owner: "lucia",
    });
    expect(spots.find((s) => s.id === "banco")?.pose).toBe("sit");
    expect(world.windows.length).toBeGreaterThan(0);
    expect(world.lights.length).toBeGreaterThan(0);
  });

  it("todos los spots y anclas son alcanzables entre sí", () => {
    const targets = world.places.flatMap((p) => [p.anchor, ...p.objects.map((o) => o.tile)]);
    const from = world.places[0]!.anchor;
    for (const t of targets) expect(findPath(world, from, t), JSON.stringify(t)).not.toBeNull();
  });
});

describe("manifest de assets", () => {
  const manifest = AssetManifest.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../../apps/web/public/assets/manifest.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const { pack } = activePack(manifest);

  it("el pack activo tiene todos los sellos que necesita el generador", () => {
    for (const s of REQUIRED_STAMPS) expect(pack.stamps[s], s).toBeDefined();
  });

  it("el mapa usa exactamente los tilesets del pack activo", () => {
    expect(tmj.tilesets.map((t: { name: string }) => t.name)).toEqual(
      pack.tilesets.map((t) => t.name),
    );
  });

  it("asigna un personaje a cada agente y cae en uno válido si no hay asignación", () => {
    expect(pack.characters[characterFor(pack, "lucia")]).toBeDefined();
    expect(characterFor(pack, "desconocido", "no-existe")).toBe(Object.keys(pack.characters)[0]);
    const walk = pack.characters[characterFor(pack, "mateo")]!.animations["walk_down"];
    expect(walk?.count).toBeGreaterThan(1);
  });
});

describe("positionAt", () => {
  const movement = {
    waypoints: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
    ],
    startTime: 100,
    endTime: 106,
  };
  const state = { tile: { x: 0, y: 0 }, facing: "down" as const, movement };

  it("interpola a lo largo de la ruta según el tiempo de juego", () => {
    expect(positionAt(state, 100)).toMatchObject({ x: 0, y: 0, moving: true });
    expect(positionAt(state, 103)).toMatchObject({ x: 3, y: 0, facing: "right", distance: 3 });
    expect(positionAt(state, 105.5)).toMatchObject({ x: 4, y: 1.5, facing: "down" });
  });

  it("se queda al final cuando acaba el viaje y en su baldosa si no se mueve", () => {
    expect(positionAt(state, 200)).toMatchObject({ x: 4, y: 2, moving: false });
    expect(positionAt({ ...state, movement: null, tile: { x: 7, y: 8 } }, 0)).toMatchObject({
      x: 7,
      y: 8,
      moving: false,
    });
  });
});
