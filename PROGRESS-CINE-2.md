# Cine 2 — avance (rama `feat/cine-2`)

## 1. Arreglos del modo cine

- [x] `&cine=1&agent=<id>` ya no deja la página en blanco: `TownMap` encola las órdenes de
      cámara hasta que la escena existe (y las aplica al crearla)
- [x] Error boundary en `ReplayView` (mensaje en vez de página vacía)
- [x] Sin minimapa en el modo cine ni en los clips
- [x] e2e: esa URL exacta (lienzo, marca, cámara en el vecino) y `&t=` + `&agent=` con y sin cine

## 2. Planos de los guiones

- [x] Tarjeta «así muere un recuerdo» (`&memory=<id>` o desde un momento con `memoryId`):
      texto, barra con los umbrales de vaguedad y olvido, curva muestreada y los cambios con el
      motivo de la auditoría (`ReplayViews.story`, `storyStep`)
- [x] Lista blanca de `replay:pack`: entran los recuerdos con historia en la auditoría
      (`STORY_ACTIONS`); el paquete lleva los umbrales (`meta.thresholds`) y `--seed`
- [x] Pantalla partida (`&src2=…&split=1`): un reloj (`ReplayPlayer.follow`), la segunda con su
      estado (`LocalGame`, mismo reductor) y su mapa; etiqueta «Semilla N», cámara y subtítulos por
      mitad (`useDirector`), arriba y abajo en 9:16; clip compuesto (`paint`, `halfRects`)
- [x] Contador de días (tecla D, botón «Días»): al cambiar de día y en los saltos, también en el clip

## 3. Escenas guardadas

- [ ] `docs/videos/escenas.json` + `docs/videos/README.md`
- [ ] `&scene=<id>` y pestaña «Escenas»
- [ ] Minutos verificados contra los eventos de s7 y s13

## 4. Momentos: arcos largos

- [ ] Tipo `arc`: lo mismo repetido en ≥ 3 días, metas confirmadas, recuerdos de la semilla que
      se vuelven vagos u olvidan, y emparejar dos semillas
- [ ] Sección propia en `moments.md`

## 5. Colaboradores y apoyo

- [ ] `docs/investigacion/README.md` y `docs/investigacion/paper/README.md`
- [ ] `COLABORA.md` / `CONTRIBUTING.md`
- [ ] `ROADMAP.md`
- [ ] `.github/ISSUE_TEMPLATE/` y `.github/FUNDING.yml` (comentado)
- [ ] `docs/primeros-issues.md`
- [ ] README: qué es y enlaces arriba

## Pendiente del autor

- Falta `LICENSE`: lo decide el autor.
