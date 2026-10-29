import { expect, test, type Page } from "@playwright/test";

/** Salta el onboarding como si ya se hubiera visto. */
async function open(page: Page, path = "/") {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("lethetown.onboarding.v1", "done");
    } catch {
      /* sin almacenamiento */
    }
  });
  await page.goto(path);
  await expect(page.getByRole("status").filter({ hasText: "Cargando" })).toHaveCount(0, {
    timeout: 20_000,
  });
}

test("el onboarding aparece la primera vez y se cierra en 3 pasos", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Bienvenida a Lethetown" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Empezar" }).click();
  await expect(dialog).toHaveCount(0);
});

test("modo espectador: mapa, reloj y sin costes ni intervención", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("application", { name: "Mapa del pueblo" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator(".header .clock")).toContainText(/Día \d+/);
  await expect(page.getByRole("button", { name: "Espectador" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Coste LLM")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Director" })).toHaveCount(0);
});

test("seleccionar un agente abre el inspector con su jardín de recuerdos", async ({ page }) => {
  await open(page);
  await page.getByRole("combobox", { name: "Elegir agente" }).selectOption("lucia");
  await expect(page.getByRole("tab", { name: "Agente" })).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "Lucía Ferrer" })).toBeVisible();
  await expect(panel.getByText("Jardín de recuerdos")).toBeVisible();
  await expect(panel.locator(".garden .card").first()).toBeVisible({ timeout: 15_000 });
  // El espectador no tiene voz interior.
  await expect(panel.getByLabel("Voz interior")).toHaveCount(0);
});

test("las pestañas se manejan con el teclado", async ({ page }, info) => {
  await open(page);
  if (info.project.name === "movil") await page.locator(".sheet-handle").click();
  const first = page.getByRole("tab", { name: /Dramas/ });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Agente" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Agente" })).toHaveAttribute("aria-selected", "true");
});

test("modo director tras iniciar sesión", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Director" }).click();
  const dialog = page.getByRole("dialog", { name: "Entrar como director" });
  await dialog.getByLabel("Usuario").fill("admin");
  await dialog.getByLabel("Contraseña").fill("e2e-admin-password");
  await dialog.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Director" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("group", { name: "Velocidad" })).toBeVisible();
});

test("vista móvil: los paneles van en una hoja inferior", async ({ page }, info) => {
  test.skip(info.project.name !== "movil", "solo en móvil");
  await open(page);
  const handle = page.locator(".sheet-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await handle.click();
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("tab", { name: "Eventos" })).toBeVisible();
  // Sin scroll horizontal a 375 px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("overlay para OBS: fondo transparente, reloj y dramas", async ({ page }) => {
  await page.goto("/overlay");
  await expect(page.locator(".overlay-clock")).toContainText(/Día \d+/, { timeout: 20_000 });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgba(0, 0, 0, 0)");
});

test("relaciones: pestaña del inspector, recíproca y red del pueblo", async ({ page }) => {
  await open(page, "/?agent=rafael");
  // En móvil los paneles van en una hoja inferior que hay que abrir.
  const handle = page.locator(".sheet-handle");
  if (await handle.isVisible()) await handle.click();
  await page.getByRole("tab", { name: "Agente" }).click();
  await page.getByRole("tab", { name: "Relaciones" }).click();
  const mateo = page.locator(".rel-head", { hasText: "Mateo" });
  await expect(mateo).toBeVisible();
  await expect(page.getByRole("meter", { name: "afinidad" }).first()).toBeVisible();
  await mateo.click();
  await expect(mateo).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Lo que Mateo piensa de Rafael/)).toBeVisible();
  await page.getByRole("button", { name: /Red del pueblo/ }).click();
  const dialog = page.getByRole("dialog", { name: "Red del pueblo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Marta Gil" })).toBeVisible();
  await expect(dialog.getByRole("slider")).toBeVisible();
});
