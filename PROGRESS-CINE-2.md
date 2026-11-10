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

## Decisiones

- **Cámara antes de la escena:** cola de órdenes en `TownMap` (no un `try` en `TownScene`): la
  orden no se pierde, se aplica al crear la escena.
- **Recuerdos con historia en el paquete** aunque sean poco importantes (`STORY_ACTIONS`) y su
  borrado: s7 pasa de 6,3 a 6,4 MB. Sin ellos, 1.178 filas de auditoría de s7 apuntaban a
  recuerdos que no estaban (Aurora y Alma, entre ellos).
- **Pantalla partida sin tocar el store:** la segunda partida tiene su propio estado
  (`LocalGame`) con el mismo reductor; los paneles laterales y las tarjetas son de la primera.
- **Escenas con planos** (`shots`) en vez de un minuto: varias escenas de los guiones son dos
  momentos (745 y 1215); al acabar un plano salta al siguiente y al acabar el último, pausa. Los
  planos se ajustaron para que cada escena quepa en un clip de 60 s (salvo
  `aniversario-partido`, dos clips), comprobando cada frase con `pnpm replay:scenes`.
- **Arcos aparte:** `findArcs` no pasa por `topMoments`; en `moments.md` tienen su sección y en
  el reproductor, su filtro.

## Cómo grabar cada escena

### Antes

1. Paquetes de E3 con su semilla (para la etiqueta «Semilla 7 / 13» de la pantalla partida):

   ```bash
   pnpm replay:pack estudio/semana-fase3/s7  --seed 7  --out apps/web/public/replays/s7.replay.json.gz
   pnpm replay:pack estudio/semana-fase3/s13 --seed 13 --out apps/web/public/replays/s13.replay.json.gz
   pnpm replay:scenes          # las 13 con ✓
   ```

2. La web: `pnpm --filter @lethetown/web dev` (no hace falta el servidor de simulación).
3. Abrir `http://localhost:5173/replay?scene=<id>`. Se abre **en pausa** al principio del primer
   plano, en modo cine, con el vecino, el formato y la velocidad de la escena. Al acabar cada
   plano salta al siguiente y, tras el último, se para.

### Escenas del mapa (con «Crear clip»)

1. Pulsar **⏺ Crear clip**, dejar el formato que propone (el de la escena) y elegir la duración
   de la tabla.
2. Pulsar **Grabar** y, enseguida, **K** (reproducir). No cierres la ventana del clip mientras
   graba: al cerrarla, se para. El clip lleva el mapa, los subtítulos, la marca y el contador de
   días (sin las guías ni los botones); la ventana del clip no sale en el vídeo.
3. Al acabar, **Descargar** (`.webm`). Si sobra el final (la escena ya pausada), se recorta al
   editar.
4. Para otro formato, la misma URL con `&t=` del plano y otra elección en «Crear clip».

### Escenas con tarjeta (con «Grabar la pestaña»)

La tarjeta «así muere un recuerdo» es parte de la página, no del mapa: el clip normal no la lleva.

1. Pulsar **⏺ Crear clip → Grabar la pestaña**; el navegador pide permiso: elegir **esta
   pestaña**. Graba lo que se ve, recortado al marco (la tarjeta cabe en él).
2. Con **G** se quitan las guías de la zona segura antes (en la pestaña sí salen).
3. A x1 la escena casi no avanza: la tarjeta queda quieta para leerla. 10–20 s bastan.

### Escena por escena

| Escena                | URL                                        | Cómo                   | Duración del clip                                   |
| --------------------- | ------------------------------------------ | ---------------------- | --------------------------------------------------- |
| `alma-pregunta`       | `/replay?scene=alma-pregunta`              | Crear clip             | 20 s (18 s de escena)                               |
| `alma-cara`           | `/replay?scene=alma-cara`                  | Grabar la pestaña      | 10–20 s (tarjeta: las dos reescrituras)             |
| `alma-pura-risa`      | `/replay?scene=alma-pura-risa`             | Crear clip             | 30 s (24 s)                                         |
| `alma-foto`           | `/replay?scene=alma-foto`                  | Crear clip             | 60 s (57 s: dos planos, la foto y «De Alma ya no…») |
| `alma-olvido`         | `/replay?scene=alma-olvido`                | Grabar la pestaña      | 10–20 s (tarjeta: vago el día 3, olvidado el 6)     |
| `aniversario-si`      | `/replay?scene=aniversario-si`             | Crear clip             | 60 s (39 s: dos planos)                             |
| `aniversario-no`      | `/replay?scene=aniversario-no`             | Crear clip             | 60 s (39 s: 745 y 1215)                             |
| `aniversario-partido` | `/replay?scene=aniversario-partido`        | Crear clip (compuesto) | 60 s (48 s, cena del día 0)                         |
|                       | `/replay?scene=aniversario-partido&t=2641` | Crear clip (compuesto) | 60 s (54 s, cena del día 1)                         |
| `aniversario-falso`   | `/replay?scene=aniversario-falso`          | Grabar la pestaña      | 10–20 s (tarjeta: el falso recuerdo de Pilar)       |
| `julian-1`            | `/replay?scene=julian-1`                   | Crear clip             | 20 s (15 s)                                         |
| `julian-2`            | `/replay?scene=julian-2`                   | Crear clip             | 30 s (27 s)                                         |
| `julian-3`            | `/replay?scene=julian-3`                   | Crear clip             | 60 s (45 s: dos planos)                             |
| `julian-final`        | `/replay?scene=julian-final`               | Crear clip             | 60 s (33 s: dos planos, hasta «Yo estoy aquí»)      |

- En `aniversario-no`, «se le pasa felicitar a Pilar» (745,5) es un recuerdo, no una frase: no
  sale en los subtítulos. Se ve en el registro de eventos (fuera del modo cine) o se pone en el
  montaje.
- En `aniversario-partido`, arriba s7 y abajo s13 (9:16), cada una con su etiqueta; la cámara
  sigue a Tomás en las dos.
- El contador de días sale 2,6 s al empezar (es un salto): **D** lo quita si no se quiere.
- A MP4: `ffmpeg -i clip.webm -c:v libx264 -pix_fmt yuv420p -crf 18 clip.mp4` (y ver
  `PROGRESS-REPETICION.md`).
