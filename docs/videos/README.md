# Vídeos: escenas guardadas

`escenas.json` guarda los planos de los guiones de vídeo. `/replay?scene=<id>` abre la
repetición en modo cine en el minuto del primer plano, con el vecino, el formato y la velocidad
de la escena (y la tarjeta, si la lleva). En el reproductor, la pestaña «Escenas» las lista
todas. Solo datos: nada de lo que se ve se redacta; el minuto de cada frase sale de los eventos
de la partida.

Los paquetes (`s7`, `s13`…) van en `apps/web/public/replays/` (fuera de git): cómo generarlos,
en [paquetes de E3](#paquetes-de-e3-s7-y-s13-paso-a-paso); cómo grabar,
[un clip](#grabar-un-clip-paso-a-paso) y [cada escena](#cómo-grabar-cada-escena).

## Formato

```jsonc
{
  "version": 1,
  "scenes": [
    {
      "id": "alma-foto", // [a-z0-9-], único: /replay?scene=alma-foto
      "title": "La foto: …", // para la lista
      "src": "s7", // paquete: /replays/s7.replay.json.gz
      "src2": "s13", // opcional: pantalla partida (s7 | s13)
      "agent": "aurora", // a quién sigue la cámara (null: automática, quien habla)
      "format": "9:16", // 9:16 | 4:5 | 16:9
      "speed": 10, // 1 | 5 | 10 | 60 | 360 (minutos de juego por minuto real)
      "shots": [
        // planos en minutos de juego absolutos; al acabar uno, salta al siguiente; al
        // acabar el último, pausa
        { "from": 6757.5, "to": 6766.5, "note": "«Curiosidad, nada más» (6762,4)…" },
        { "from": 6794, "to": 6796 },
      ],
      "memory": "9ce68bc4-…", // opcional: abre «así muere un recuerdo» de ese recuerdo
      "quote": "De Alma ya no me acuerdo de eso.", // opcional: la frase literal que se busca
    },
  ],
}
```

- Lo que venga en la URL manda sobre la escena (`/replay?scene=alma-foto&t=6700`,
  `&src=/replays/otro.replay.json.gz`…).
- Velocidad: x10 para diálogos (cada turno dura ~1,5 min de juego: ~9 s reales); x1 para las
  tarjetas de memoria (se queda quieto en el minuto).
- `note` es para quien graba (qué pasa y en qué minuto); no sale en el vídeo.

## Añadir una escena

1. Buscar el momento: la lista de momentos del reproductor, `pnpm replay:moments <grabación>`
   (`moments.md`) o el registro de eventos.
2. Añadir la entrada a `escenas.json` con la frase en `quote` y los planos un poco antes y
   después de lo que se quiere ver.
3. Comprobarla: `pnpm replay:scenes` busca cada `quote` en su paquete (frases, recuerdos y
   auditoría) y avisa si cae fuera de los planos o si el paquete no sabe nada del recuerdo de la
   tarjeta. Con una tarjeta, la frase puede ser de antes (la tarjeta cuenta la historia).
4. El test de shared valida el fichero (ids únicos, planos en orden).

## Paquetes de E3 (s7 y s13), paso a paso

Las grabaciones de la tercera partida de estudio están en
`docs/investigacion/estudios/e3-semana-fase3/s7` y `s13` (con la exportación de la BD en `bd/`).
No tienen `manifest.json` (son anteriores a él): el paquete dice los modelos por `llm_calls` y la
fecha por `meta.json`; la semilla, con `--seed` (si no, queda como «?»).

1. Empaquetar (unos 5 s cada una; ~6 MB en gzip, 7 días de juego):
   ```sh
   pnpm replay:pack docs/investigacion/estudios/e3-semana-fase3/s7  --seed 7  --out apps/web/public/replays/s7.replay.json.gz
   pnpm replay:pack docs/investigacion/estudios/e3-semana-fase3/s13 --seed 13 --out apps/web/public/replays/s13.replay.json.gz
   ```
   Para un trozo, `--from <min> --to <min>` (minutos de juego). El mapa sale solo del commit
   anterior a la grabación (`9e87684`).
2. Momentos (candidatos a clip, a `moments.md` y `moments.json` en la carpeta de la grabación):
   ```sh
   pnpm replay:moments docs/investigacion/estudios/e3-semana-fase3/s7
   pnpm replay:moments docs/investigacion/estudios/e3-semana-fase3/s13
   ```
3. Verlo: `pnpm dev` (o solo la web: `pnpm --filter @lethetown/web dev`; la repetición no
   necesita el servidor) y abrir `http://localhost:5173/replay?src=/replays/s7.replay.json.gz`.
   Un momento concreto: `&t=<minuto>` (el de `moments.md`) y `&agent=<id>`.

En una partida nueva, grabar con `record --track` para que la repetición siga las rutas reales
minuto a minuto (si no, interpola entre fotos por el camino del juego).

## Grabar un clip, paso a paso

1. Abrir la repetición en modo cine: `/replay?src=/replays/s7.replay.json.gz&cine=1&t=<minuto>`
   (o el botón «Modo cine», o la tecla C). Mejor en una ventana grande del navegador de
   escritorio (Chrome o Firefox).
2. Elegir el formato (9:16 para TikTok y Reels, 4:5 para el feed de Instagram, 16:9 para
   LinkedIn y YouTube) y la cámara: «Automática (quien habla)» o un vecino.
3. Con la zona segura activada (tecla G), comprobar que lo importante queda fuera de las franjas
   rayadas; luego se puede ocultar (no sale en el clip de todos modos).
4. Ir al momento (lista de momentos o `&t=`), velocidad x5 o x10 para una conversación (x60 para
   un día que pasa), y play.
5. «Crear clip»: formato, duración (10–60 s) y «Grabar». Sale el lienzo del mapa a 30 fps con
   los subtítulos y la marca dibujados encima. Para grabar también una tarjeta (jardín de
   recuerdos, Rashomon, red…), abrirla y usar «Grabar la pestaña» (el navegador pide permiso;
   elegir esta pestaña): graba lo que se ve, recortado al marco.
6. «Descargar»: un `.webm`. Para subirlo a redes que no lo admiten, convertir a MP4, p. ej.
   `ffmpeg -i clip.webm -c:v libx264 -pix_fmt yuv420p -r 30 clip.mp4`.

La marca «Repetición de una partida real · modelo · fecha» y `lethetown.com` va activada por
defecto (tecla M para ocultarla).

## Cómo grabar cada escena

### Antes

1. Los paquetes de E3 con su semilla ([arriba](#paquetes-de-e3-s7-y-s13-paso-a-paso)) y
   `pnpm replay:scenes` (las 13 con ✓).
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
  [grabar un clip](#grabar-un-clip-paso-a-paso)).
