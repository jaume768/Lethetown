import { expect, test, type Page } from "@playwright/test";

const SRC = "/replay?src=/replays/e2e.replay.json.gz";

test("repetición: carga sin servidor, da play, salta a un momento y salen los subtítulos", async ({
  page,
}) => {
  // La repetición no abre el WebSocket ni llama a la API.
  const calls: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws"))
      calls.push(url.pathname);
  });
  await page.goto(SRC);
  const play = page.getByTestId("replay-play");
  await expect(play).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.getByText("Repetición", { exact: true })).toBeVisible();

  // Play y pausa: el reloj avanza.
  const before = await page.getByTestId("replay-time").textContent();
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("replay-time")).not.toHaveText(before ?? "", { timeout: 10_000 });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");

  // Una conversación larga: salta a ella, play y aparece lo que se dice.
  await page.getByRole("combobox", { name: "Tipo de momento" }).selectOption("conversation");
  await page.getByTestId("moment").first().click();
  await play.click();
  await expect(page.locator(".subtitle").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".subtitle-name").first()).toHaveText(/\S+:/);

  // Sin director, admin ni costes.
  await expect(page.getByText("Coste LLM")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Director" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Evolución" })).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("modo cine: marco, marca de la partida real y vuelta", async ({ page }) => {
  await page.goto(`${SRC}&cine=1`);
  await expect(page.getByTestId("replay-play")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".replay.cine")).toHaveCount(1);
  await expect(page.locator(".cine-mark")).toContainText("Repetición de una partida real · mock");
  await expect(page.locator(".cine-mark")).toContainText("lethetown.com");
  // Formatos y zona segura.
  await page.getByRole("radio", { name: "16:9" }).click();
  const box = await page.locator(".replay-frame").boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  await page.getByRole("button", { name: "Marca" }).click();
  await expect(page.locator(".cine-mark")).toHaveCount(0);
  await page.getByRole("button", { name: "Salir del modo cine" }).click();
  await expect(page.locator(".replay.cine")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Momentos" })).toBeVisible();
});

test("repetición: solo paquetes de /replays/", async ({ page }) => {
  await page.goto("/replay?src=https://example.com/x.replay.json.gz");
  await expect(page.getByRole("alert")).toContainText("/replays/");
});

/** Lo que la escena del mapa sabe de la cámara (solo en desarrollo: `window.__town`). */
const camera = (page: Page) =>
  page.evaluate(() => {
    const town = (window as unknown as { __town?: Record<string, unknown> }).__town;
    const mm = town?.minimap as { visible: boolean } | null | undefined;
    return {
      ready: Boolean(town?.ready),
      directed: (town?.directed as string[] | null) ?? null,
      minimap: mm ? mm.visible : null,
    };
  });

test("modo cine con &agent=: hay lienzo y marca (no se queda en blanco), sin minimapa", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${SRC}&cine=1&agent=aurora`);
  await expect(page.locator(".replay-frame canvas")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator(".cine-mark")).toContainText("lethetown.com");
  await expect.poll(async () => (await camera(page)).ready, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await camera(page)).directed).toEqual(["aurora"]);
  expect((await camera(page)).minimap).toBe(false);
  expect(errors).toEqual([]);
});

for (const cine of [false, true]) {
  test(`&t= y &agent= juntos ${cine ? "en el modo cine" : "sin modo cine"}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${SRC}&t=500&agent=valentina${cine ? "&cine=1" : ""}`);
    await expect(page.getByTestId("replay-play")).toBeVisible({ timeout: 30_000 });
    // Minuto 500 = día 0, 08:20.
    await expect(page.getByTestId("replay-time")).toContainText("08:20");
    await expect.poll(async () => (await camera(page)).ready, { timeout: 30_000 }).toBe(true);
    if (cine) {
      await expect.poll(async () => (await camera(page)).directed).toEqual(["valentina"]);
      await expect(page.getByRole("combobox", { name: "Cámara" })).toHaveValue("valentina");
    } else {
      await expect(page.getByRole("tab", { name: "Agente" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.locator(".side")).toContainText("Valentina");
      expect((await camera(page)).minimap).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
