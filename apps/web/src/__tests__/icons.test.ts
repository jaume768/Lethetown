import { ACTION_SPECS } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { ACTION_ICONS, actionBadge, itemIcon, withoutLeadingIcon } from "../ui/icons";

describe("iconos de acciones", () => {
  it("todas las acciones del catálogo tienen icono", () => {
    for (const type of Object.keys(ACTION_SPECS)) expect(ACTION_ICONS[type]).toBeTruthy();
  });

  it("insignia de un evento: icono y si salió bien (o nada si no es una acción)", () => {
    expect(actionBadge({ meta: { action: "lend_item", ok: true } })).toEqual({
      action: "lend_item",
      icon: "🤝",
      ok: true,
    });
    expect(actionBadge({ meta: { action: "say", ok: false } })?.ok).toBe(false);
    expect(actionBadge({})).toBeNull();
    // Lo acordado hablando lleva su propio icono.
    expect(actionBadge({ meta: { action: "propose_meeting", ok: true, agreed: true } })).toEqual({
      action: "propose_meeting",
      icon: "🗣",
      ok: true,
      agreed: true,
    });
  });

  it("no repite el icono si el texto ya empieza por él", () => {
    expect(withoutLeadingIcon("🧭 Valentina descubre el lago", "🧭")).toBe(
      "Valentina descubre el lago",
    );
    expect(withoutLeadingIcon("Lucía: leer", "🧭")).toBe("Lucía: leer");
  });

  it("objetos: icono por tipo, y uno genérico", () => {
    expect(itemIcon("libro")).toBe("📕");
    expect(itemIcon("algo")).toBe("📦");
  });
});
