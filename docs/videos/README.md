# Vídeos: escenas guardadas

`escenas.json` guarda los planos de los guiones de vídeo. `/replay?scene=<id>` abre la
repetición en modo cine en el minuto del primer plano, con el vecino, el formato y la velocidad
de la escena (y la tarjeta, si la lleva). En el reproductor, la pestaña «Escenas» las lista
todas. Solo datos: nada de lo que se ve se redacta; el minuto de cada frase sale de los eventos
de la partida.

Los paquetes (`s7`, `s13`…) van en `apps/web/public/replays/` (fuera de git). Cómo generarlos:
`PROGRESS-REPETICION.md` («Paquetes de E3»). Cómo grabar cada escena: `PROGRESS-CINE-2.md`.

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
