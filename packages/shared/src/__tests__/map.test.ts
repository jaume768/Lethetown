import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TILE_INDEX,
  findPath,
  parseTiledMap,
  pathLength,
  pointAlong,
  remapTiledMap,
  toWaypoints,
  positionAt,
  TiledMap,
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

  it("remapTiledMap traduce baldosas por nombre a otro tileset", () => {
    const map = TiledMap.parse(tmj);
    const to = { grass: 100, wall: 7 };
    const out = remapTiledMap(map, TILE_INDEX, to, {
      name: "vendor",
      image: "x.png",
      imagewidth: 16,
      imageheight: 16,
      tilewidth: 16,
      tileheight: 16,
      tilecount: 200,
      columns: 10,
      margin: 0,
      spacing: 0,
    });
    const ground = out.layers.find((l) => l.name === "ground");
    expect(ground?.type === "tilelayer" && ground.data[0]).toBe(101);
    const buildings = out.layers.find((l) => l.name === "buildings");
    expect(
      buildings?.type === "tilelayer" && buildings.data.filter((g) => g === 8).length,
    ).toBeGreaterThan(0);
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
