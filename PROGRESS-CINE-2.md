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

- [x] `docs/videos/escenas.json` (13 escenas, con planos `shots`) + `docs/videos/README.md`;
      esquema `ReplayScenes` en shared (test que valida el fichero)
- [x] `?scene=<id>` (cine, vecino, minuto, formato, velocidad, tarjeta; al acabar un plano, el
      siguiente) y pestaña «Escenas»; tarjetas del modo cine del ancho del marco
- [x] Minutos verificados contra los eventos de s7 y s13 (`pnpm replay:scenes` lo comprueba);
      la tarjeta de un recuerdo borrado se arma con la auditoría (el borrado entra en el paquete)

## 4. Momentos: arcos largos

- [x] Tipo `arc` (`arcs.ts`): lo mismo de A a B en ≥ 3 días (palabras raras en el pueblo: primero,
      último y cuántas), metas `confirmed` con la frase que lo logró, recuerdos de la semilla que se
      vuelven vagos u olvidan (con el día) y, con dos carpetas, la misma intención o meta en las dos
      semillas y cómo acabó (`pnpm replay:moments s7 s13`: el aniversario sale primero)
- [x] Sección propia en `moments.md` («Arcos largos» y «Las dos semillas»); en el reproductor,
      filtro «Arcos largos» (🧵)

## 5. Colaboradores y apoyo

- [x] `docs/investigacion/README.md` (+ `README.en.md`): qué se estudia y E1–E3 con sus hallazgos
      y cifras; `docs/investigacion/paper/README.md` enlaza `Lethetown-paper.pdf`
- [x] `COLABORA.md` / `CONTRIBUTING.md`: proponer un experimento (ejemplo completo con
      `ABLATION=on` y `COGNITION_CONTROL=on`), ejecutar pruebas (mock gratis con
      `replay:demo --rec`, real corta, grabar, analizar, empaquetar y qué no compartir), código y
      apoyo (coste medido por mundo y día y por estudio de 7 días)
- [x] `ROADMAP.md` (+ `ROADMAP.en.md`): hecho (fases 0–3.6), siguiente y preguntas abiertas
- [x] `.github/ISSUE_TEMPLATE/` (experimento, resultado, idea, error; `config.yml` a Discussions)
      y `.github/FUNDING.yml` comentado con un TODO
- [x] `docs/primeros-issues.md`: 10 tareas (6 experimentos en mock)
- [x] README: qué es y enlaces arriba

## Pendiente del autor

- Falta `LICENSE`: lo decide el autor.
- `<CONTACTO>` en `COLABORA.md` y `CONTRIBUTING.md` (apoyar el proyecto).
- `docs/investigacion/paper/Lethetown-paper.pdf` (el enlace ya está).
- `.github/FUNDING.yml`: las cuentas reales, y descomentar.
- Activar **Discussions** en GitHub (lo enlaza `.github/ISSUE_TEMPLATE/config.yml`) y crear las
  etiquetas `experimento`, `resultado`, `idea` y `error` (las plantillas las ponen si existen).
