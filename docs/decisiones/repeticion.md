# Repetición y modo cine

Ver una partida grabada en la web sin servidor de simulación, sin LLM y sin coste, y sacar
vídeos de redes de ella. Lo que se ve es real: las frases, los dramas, las crónicas y los
recuerdos tal como salieron. Nada se inventa ni se reescribe.

## El paquete (`ReplayBundle`)

- **Un único fichero** `.replay.json.gz` (`pnpm replay:pack`), con versión
  (`REPLAY_VERSION`): el reproductor rechaza la que no entiende. Esquema en
  `packages/shared/src/replay/bundle.ts`.
- **Lista blanca, no lista negra.** Cada parte pasa por su esquema zod, que descarta las claves
  que no conoce, y `replay:pack` solo lee las tablas que usan los paneles (de `llm_calls`, solo
  el nombre del modelo). No hay costes, usuarios, correos, claves, moderación ni rutas locales.
  El test `apps/server/src/replay/pack.test.ts` mete todo eso en una grabación y comprueba que
  no sale. Un campo nuevo en el paquete es una decisión: ¿se puede publicar?
- **Fotos por diferencias de campo** (`AgentPatch`): la primera foto lleva a todos y las demás,
  solo los campos que cambiaron. La semana de E3 s7 pasa de 102 MB a 34 MB (6,3 MB en gzip):
  casi todo era el plan del día repetido en cada foto.
- **El minuto de cada mensaje.** «Pensando», los efectos de memoria y las crónicas no traen
  minuto de juego: se deduce de la hora real con las fotos y los eventos (interpolando). Del
  efecto de memoria se quita el texto (el mapa solo usa quién y cuál, y el texto ya está en los
  recuerdos).
- **El mapa** sale del commit de la partida (`manifest.json`) o, si no hay manifiesto, del
  último commit anterior a la grabación (`git show`): `seeds/town.tmj` cambia entre fases.
- **De la base de datos**, lo que usan las tarjetas: recuerdos (los de importancia ≥ 4, los que
  cambiaron y los de los dramas y conversaciones largas), auditoría sin el ruido de archivar,
  reforzar, debilitar o borrar, versiones, fichas y su historial, metas, habilidades y saberes.
  Agenda, inventario, lugares conocidos y notas no van: el reproductor los da vacíos.

## La fuerza de un recuerdo

La web no tiene psicología (la regla es que viva en agent-core). La fuerza se muestrea al
empaquetar con la misma curva del motor (`currentStrength`, `clarityFor`), cada 6 h de juego
desde la última vez que se recordó y hasta que se olvida. El reproductor interpola en escala
logarítmica. Antes de la última evocación no se sabe (la base de datos no guarda la historia de
la fuerza), así que se muestra la de ese momento. El texto de un recuerdo en un minuto dado es
el de la versión que tenía entonces (`memory_versions`), y una ficha social, la de su último
cambio (el resumen solo existe al final, así que antes no se enseña).

## El reproductor (`/replay`)

- **El mismo reductor.** La web entra en modo repetición (`startReplay` en `store.ts`):
  `ReplaySource` da los mismos mensajes que el WebSocket (`snapshot` al saltar, `tick` y lo que
  pasó en cada paso) y `feed` los mete en `applyMessage`. `api()` responde desde el paquete en
  el minuto actual y rechaza todo POST (solo lectura); `/api/map` y `/api/state` son URLs
  `blob:`. Ningún panel sabe que es una repetición. No hay director, admin ni costes.
- **Movimiento entre fotos** (`agentAt`, en shared): con la pista de posiciones
  (`record --track`), la ruta real minuto a minuto; si no, la ruta real que traía la foto (o la
  siguiente, desde que salió); si no, de un sitio a otro por el pathfinding del juego, llegando
  a la hora de la foto siguiente a su paso de siempre (más deprisa si no da tiempo). Las rutas
  se guardan en caché.
- **Velocidades** x1, x5, x10, x60 y x360 (minutos de juego por minuto real); por defecto x60,
  porque a x10 apenas pasa nada en pantalla. A mucha velocidad, de una ráfaga de mensajes solo
  se emiten los que se verían.
- **`?src`** solo acepta `/replays/<nombre>.json(.gz)` del propio sitio (carpeta
  `apps/web/public/replays/`, fuera de git). También se puede arrastrar el fichero.

## Momentos destacados

`findMoments` (shared) los saca del paquete para la lista del reproductor y para
`pnpm replay:moments` (que además usa todas las frases de la BD y el registro de nombres
externos). Tipos: dramas, crónicas, conversaciones de 6 o más turnos, un mismo hecho recordado
distinto, recuerdos que se transforman, recuerdos falsos, nombres externos, metas conseguidas o
abandonadas, clases y saberes transmitidos y olvidos («ya no me acuerdo»).

- **Puntuación simple y explicada** (`why`): base del tipo + largo (turnos o texto) + carga
  emocional (|afinidad| entre los dos protagonistas, o la valencia del recuerdo) + vecinos
  implicados. Nada de LLM.
- **Variedad.** Un drama por conversación y tipo; antes de llenar por puntuación entran los 5
  mejores de cada tipo (si no, los cientos de dramas de escuchar a escondidas lo copaban todo).
- **«Lo recuerdan distinto»** exige que alguna versión se reescribiera al recordarla o que lo
  vivieran con ánimo opuesto (valencias a ≥ 0,8), y el momento es cuando ya existen las dos
  versiones citadas (para que la tarjeta Rashomon las enseñe).
- La cita es la frase literal; si no la hay (un olvido, una meta), no se repite el título.

## Modo cine

- **Marcos** 9:16 (1080×1920), 4:5 (1080×1350) y 16:9 (1920×1080), con **zona segura** que se
  puede ocultar: en 9:16, arriba el menú de la red, abajo la descripción y a la derecha los
  botones (`SAFE_ZONE`).
- **Cámara.** Sigue a un vecino (y a con quién habla) o, en automático, a quien habla. En
  automático se queda en una conversación hasta que lleva 5 min de juego callada (si no,
  saltaba de una a otra en cada frase). Lejos, corta en vez de panear por medio pueblo; los
  encuadrados quedan por encima del centro, porque abajo van los subtítulos. Sin animación con
  `prefers-reduced-motion`.
- **Subtítulos grandes** (nombre en el color de su ropa + la frase), proporcionales al alto del
  marco, el tiempo justo para leerlos.
- **Marca** fija, activada por defecto: «Repetición de una partida real · modelo · fecha» y
  `lethetown.com`.
- **Tarjetas**: los componentes de siempre en solo lectura (jardín de recuerdos, Rashomon, red
  con su deslizador, metas, maestro y alumno), en el minuto de la repetición.
- **Clips** a 30 fps en los tres formatos: el lienzo del mapa con los subtítulos y la marca
  dibujados encima (`drawCineOverlay`, el mismo diseño que en pantalla). Las tarjetas son DOM:
  para grabarlas, «Grabar la pestaña» (`getDisplayMedia` recortado al marco).

## Cine 2: planos de los guiones

- **Órdenes de cámara antes de la escena.** `TownMap` encola `direct`, `focusAgent`… hasta que
  Phaser crea la escena (con `&cine=1&agent=` se llamaba a la cámara antes y la página quedaba
  en blanco), y `ReplayView` va dentro de una error boundary.
- **«Así muere un recuerdo»** (`ReplayViews.story`): el texto en el minuto, la fuerza con los
  umbrales del paquete (`meta.thresholds`), la curva ya muestreada y lo que le pasó en orden con
  el motivo de la auditoría, leído sin redactar («olvidado (fuerza 0,049 < 0,05)», «la fuente
  cambia: contado por Valentina → vivido»). Para eso `replay:pack` mete los recuerdos con
  historia (`STORY_ACTIONS`: reconsolidado, esencia, fuente, falso, olvidado) aunque sean poco
  importantes, y su borrado. Un recuerdo borrado no está en la base de datos: la tarjeta lo arma
  con la auditoría (sin fuerza, que no se sabe).
- **Pantalla partida** (`&src2=…&split=1`): un solo reloj (`ReplayPlayer.follow`); la segunda
  partida tiene su estado (`LocalGame`, el MISMO reductor) y su mapa, fuera del store global.
  Cámara y subtítulos por mitad (`useDirector`), con la zona segura de cada mitad (`halfSafe`):
  arriba y abajo en 9:16, lado a lado en los demás. El clip compone los dos lienzos (`paint`).
- **Contador de días** (tecla D): al cambiar de día y en cada salto, también en el clip.
- **Escenas guardadas** (`docs/videos/escenas.json`, esquema `ReplayScenes`): solo datos, con
  planos (`shots`) que se encadenan; `?scene=<id>` y la pestaña «Escenas». `pnpm replay:scenes`
  busca cada frase en su paquete: el minuto de una escena se comprueba, no se supone.
- **Arcos largos** (`arcs.ts`, tipo `arc`, aparte de los momentos): lo dicho de A a B en ≥ 3
  días (palabras raras en el resto del pueblo, sin nombres ni formas de llamarse), metas
  `confirmed` con la frase que lo logró, recuerdos de la semilla que se apagan y, con dos
  carpetas, la misma intención o meta en las dos semillas (por vecino y primera frase).

## Herramientas

- `record --track` guarda `positions.jsonl`: cada minuto, la posición de quien anda.
- `replay:demo` graba en el propio proceso una partida corta en mock (sin servidor ni BD) y la
  empaqueta: la usa el e2e (`e2e/global-setup.ts`, semillas 7 y 13) y sirve para probar sin
  grabación real; con `--rec`, deja también la grabación (para `study:analyze`).
- `replay:scenes` comprueba las escenas guardadas contra sus paquetes.
