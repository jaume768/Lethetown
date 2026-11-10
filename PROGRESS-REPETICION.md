# Modo repetición y modo cine

Rama `feat/modo-repeticion`. Objetivo: reproducir en la web una partida grabada (`record` +
`world:export`) sin servidor de simulación, sin LLM y sin coste, con un «modo cine» para grabar
vídeos de redes. Todo lo que se ve es real (frases, dramas, crónicas tal cual); nada se inventa.

Al retomar: leer este fichero, `docs/decisiones/repeticion.md` y `git log --oneline main..`.

## Checklist

- [x] 1a. Esquema `ReplayBundle` (shared, con versión y lista blanca), interpolación, vistas en
      un minuto y momentos (lógica pura con tests)
- [x] 1b. `pnpm replay:pack` (servidor) y test de la lista blanca
- [x] 5. `record --track` (`positions.jsonl`)
- [x] 4. `pnpm replay:moments` (`moments.md` y `moments.json`)
- [x] Extra: `replay:demo` (partida corta en mock grabada en el proceso, para el e2e)
- [x] 2. Reproductor `/replay` (mismo reductor que el WebSocket, controles, momentos, atajos)
- [x] 3. Modo cine (cámara, subtítulos, marcos, tarjetas, marca, clips 9:16, 4:5 y 16:9)
- [x] Pruebas e2e (paquete pequeño generado en mock)
- [x] Docs (decisión, CLAUDE.md, README) y pasos para E3 s7/s13 y para grabar un clip
- ~~6. Repo abierto a colaborar~~ (descartado a petición: no hace falta)

## Decisiones

(ver también `docs/decisiones/repeticion.md`)

- **Lista blanca, no lista negra**: el paquete solo lleva lo que tiene esquema en
  `ReplayBundle` (zod descarta el resto) y `replay:pack` solo lee las tablas que usan los paneles
  (de `llm_calls`, solo el nombre del modelo). Ni costes, ni usuarios, ni moderación, ni rutas.
- **Fotos por diferencias de campo** (`AgentPatch`): la grabación de E3 s7 (87 h) pasaba de
  102 MB a 34 MB sin comprimir (6,3 MB en gzip); casi todo era el plan del día repetido en cada
  foto.
- **El minuto de lo que no lo trae** («pensando», efectos de memoria, crónicas) se deduce de la
  hora real con las fotos y los eventos (interpolando). Del efecto de memoria se quita el texto
  (el mapa solo usa quién y cuál; el texto está en los recuerdos).
- **La fuerza de un recuerdo** se muestrea al empaquetar con la curva del motor
  (`currentStrength`, `clarityFor`) cada 6 h desde que se recordó por última vez; antes no se
  sabe (no se guarda su historia) y se muestra la de ese momento. Así no hay psicología en la web.
- **El mapa** es el del commit de la partida (manifiesto) o el último anterior a la grabación
  (`git show`), porque `seeds/town.tmj` cambia entre fases.
- **Momentos**: un drama por conversación y tipo; la carga emocional, entre los dos
  protagonistas; un mínimo de 5 por tipo antes de llenar por puntuación (si no, los dramas de
  escuchar a escondidas, que son cientos, lo copaban todo). En s7, «lo recuerdan distinto» exige
  que alguno se reescribiera al recordarlo o valencias opuestas (≥ 0,8 de diferencia).
- **La web en modo repetición** (`startReplay` en `store.ts`): `feed` mete los mensajes en el
  mismo `applyMessage`, `api()` responde desde el paquete en el minuto actual (y rechaza todo
  POST: solo lectura), `apiPath` da URLs `blob:` para `/api/map` y `/api/state`, y
  `gameTimeNow` es el reloj de la repetición. Ningún componente sabe que es una repetición
  (salvo que `canIntervene` es falso y no hay pestañas de director ni evolución).
- **Agenda, inventario, lugares conocidos, notas y salidas** no están en el paquete (no los usan
  las tarjetas): la API de la repetición los da vacíos.
- **Velocidad por defecto x60** (un minuto de juego por segundo): a x10 no pasa nada en pantalla.
- **Cámara del modo cine**: en automático se queda en una conversación hasta que lleva 5 min
  callada (si no, saltaba de una a otra en cada frase); lejos, corta en vez de panear por medio
  pueblo; los encuadrados quedan por encima del centro (abajo van los subtítulos).
- **Clips**: el lienzo del mapa con los subtítulos y la marca dibujados encima (mismo diseño
  que en pantalla, `drawCineOverlay`); las tarjetas son DOM, así que para grabarlas está
  «Grabar la pestaña» (`getDisplayMedia` recortado al marco).
- **`?src`** solo acepta `/replays/<nombre>.json(.gz)` del propio sitio.

## Paquetes de E3 (s7 y s13), paso a paso

Las grabaciones de la tercera partida de estudio están en `estudio/semana-fase3/s7` y `s13`
(con la exportación de la BD en `bd/`). No tienen `manifest.json` (son anteriores a él): el
paquete dice los modelos por `llm_calls`, la fecha por `meta.json` y la semilla queda como «?».

1. Empaquetar (unos 5 s cada una; ~6 MB en gzip, 7 días de juego):
   ```sh
   pnpm replay:pack estudio/semana-fase3/s7  --out apps/web/public/replays/s7.replay.json.gz
   pnpm replay:pack estudio/semana-fase3/s13 --out apps/web/public/replays/s13.replay.json.gz
   ```
   Para un trozo, `--from <min> --to <min>` (minutos de juego). El mapa sale solo del commit
   anterior a la grabación (`9e87684`).
2. Momentos (candidatos a clip, a `moments.md` y `moments.json` en la carpeta de la grabación):
   ```sh
   pnpm replay:moments estudio/semana-fase3/s7
   pnpm replay:moments estudio/semana-fase3/s13
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

## A revisar

- El paquete de 7 días ocupa ~33 MB en memoria del navegador (carga en ~1,5 s en escritorio);
  en móviles modestos, mejor recortar con `--from/--to`.
- Sin `record --track`, la ruta entre dos fotos es la del pathfinding del juego, llegando a la
  hora de la foto siguiente: puede no coincidir con la que hizo (las fotos son cada 10 min).
- La fuerza de un recuerdo antes de su última evocación es la de ese momento (la BD no guarda la
  historia de la fuerza).
- Los dramas de escuchar a escondidas siguen siendo los primeros por puntuación (muchos vecinos
  y mucha carga); la lista del reproductor se puede filtrar por tipo.
- En mock, los recuerdos «que cambian» son triviales (la reconsolidación del mock añade una
  coletilla); con una partida real son los interesantes.
