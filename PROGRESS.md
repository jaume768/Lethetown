# PROGRESS — feat/pixel-art-y-memoria

Registro de avance de la fase "pixel art + memoria humana completa". Si la sesión se corta,
retomar desde el primer elemento sin marcar.

## Checklist

### Assets

- [x] `pnpm assets:placeholder`: tileset 16×16 y hoja de personaje (4 dir × idle/walk4/sit/sleep) recoloreable (emotes y bocadillo se dibujan por código en el cliente)
- [x] Manifest de assets tipado (zod) con packs `placeholder` / `vendor`
- [x] `apps/web/public/assets/vendor/` en .gitignore; README con instrucciones y crédito a LimeZu

### Fase A — Phaser 4

- [x] Migrar apps/web a Phaser 4.x estable (`pixelArt`, `roundPixels`, zoom entero)

### Fase B — Mapa Tiled

- [x] `pnpm map:generate` → `seeds/town.tmj` (60×40, capas ground/paths/buildings/decor/roofs/collision, objetos places/spots)
- [x] Parser .tmj → `World` en shared (zod) usado por servidor y cliente; eliminar world.json
- [x] Agentes van a spots concretos (prompts, plan, decisión, rutinas)

### Fase C — Movimiento

- [x] A* determinista en shared con tests
- [x] Servidor calcula ruta y duración; envía waypoints
- [x] Cliente interpola por reloj de juego; frames por distancia recorrida

### Fase D — Personajes

- [x] `appearance` en AgentSeed, `activityKind` en AgentState (LLM + rutinas + mock)
- [x] Sprites animados 4 direcciones, pose al llegar al spot, selección con contorno

### Fase E — Mente visible

- [x] Emotes pixel por actividad/ánimo (propios, dibujados por código)
- [x] `thinking` (start/end) por WS + indicador (puntos animados + inspector)
- [x] Bocadillos nine-slice con texto letra a letra
- [x] Efectos de memoria (destello, nube, partículas, bombilla, interrogación)
- [x] Inspector "jardín de recuerdos" con filtros, fichas sociales y auditoría

### Fase F — Ambiente e interfaz

- [x] Ciclo día/noche, ventanas y farolas (+ lluvia)
- [x] Tejados que se desvanecen
- [x] Cámara: zoom entero, arrastre, seguir agente, límites
- [x] UI pixel con fuente OFL incluida (Pixelify Sans)
- [x] Minimapa

### Fase G — Memoria humana completa

- [x] Config tipada de memoria con valores por defecto documentados
- [x] Consolidator (reflexión nocturna con citas)
- [x] SocialProfile + store (RAM y Postgres)
- [x] GistCompressor
- [x] Reconsolidator con historial de versiones
- [x] SourceConfuser
- [x] Olvido por presupuesto + `memory_audit`
- [x] Escuchar a escondidas (rumores)
- [x] Fin de conversación natural

### Fase H — Funciones estrella

- [x] Vista Rashomon (clic en una frase del log)
- [x] Línea de tiempo persistida (pestaña Historial: día + hora)
- [x] `pnpm interview`
- [x] Crónica del día (panel Crónicas)
- [x] Intervención del jugador (voz interior en el inspector, panel Mundo)

### Final

- [ ] README y CLAUDE.md al día
- [ ] Push de la rama y PR

## Decisiones tomadas

- **Phaser 4.2.1**: la migración no requirió cambios de código (solo usamos APIs estables). `roundPixels: true` explícito (en v4 es false por defecto).
- **Sellos (stamps) en vez de paleta 1×1**: los packs de LimeZu usan objetos multi-baldosa (camas 2×3, árboles 3×4, fuentes 4×5, fachadas). El manifest define sellos `fixed` / `pattern` / `nineslice` con ancla y baldosas bloqueantes; `pnpm map:generate` compone el .tmj con los tilesets del pack activo.
- **Edificios estilo LimeZu**: interior con Room Builder (borde de techo + pared de 2 baldosas + suelo) y, en la capa `roofs`, azotea plana (nine-slice) + fachada con la puerta. El cliente oculta el tejado si hay alguien dentro o el ratón encima.
- **Muebles no bloquean** (solo paredes, agua, troncos, farolas y fuente): así los spots siempre son alcanzables. Pendiente: colisión fina de muebles.
- **Ventanas y farolas** como capas de objetos (`windows`, `lights`) en el .tmj, independientes del tileset.
- **Personajes**: el Character Generator NO está en los zips (solo sus addons, que requieren el generador base de Modern Interiors de pago). Se usan los 4 personajes de Modern Interiors Free (16×32): Lucía→Amelia, Mateo→Bob, Carmen→Alex. Layout verificado: fila 1 idle y fila 2 walk (6 frames × derecha/arriba/izquierda/abajo), fila 5 sit (6 derecha + 6 izquierda), fila 6 teléfono (usado para `read`). No hay animación de dormir: se tumba el frame idle_down.
- **Frames por distancia** al andar (0,5 baldosas por frame) → a x360 se saltan frames en vez de trompicones; quieto, por tiempo real (`pickFrame` en shared, con tests).
- **Postgres en 5433** (ya en fase 1). Assets vendor ~11 MB extraídos solo en 16×16.
- **Licencia**: Modern Interiors Free es solo para uso NO comercial.
- **future.ts → human.ts**: las interfaces de fase 2 ahora reciben el contexto del dueño (prompt de identidad), necesario para llamar al LLM. Se añadió `EpisodeSummarizer` (paso 2 del olvido por presupuesto) y `list()` en `SocialProfileStore`.
- **Conversaciones**: id propio (se usa como `eventId` de los recuerdos → Rashomon). Terminan cuando quien recibe una frase decide no contestar, por inactividad (`idleMinutes`) o por el máximo de seguridad (12). Al terminar se actualiza la ficha social de ambos (modelo fast).
- **Escuchar a escondidas**: fragmento contiguo de la frase (60 % de palabras), con fuente "contado por <id>" o "contado por alguien" (50 %). Se guarda con el mismo `eventId`, así aparece en Rashomon.
- **Olvido por presupuesto**: protegidos = planes de las últimas 24 h, conocimiento semántico de importancia ≥ 6 y todo lo que citan. Los resúmenes ARCHIVAN los originales (no se borran, siguen enlazados); el paso 3 sí borra.
- **Entrevistas** usan `inspect` (sin refuerzo ni reconsolidación) para no alterar la memoria al medirla.
- **Mantenimiento** cada hora de juego por agente; consolidación al primer tick dormido de cada noche; crónica a las 23:00.
- **SIM_SEED**: semilla opcional del azar de la memoria para simulaciones reproducibles.

## Bloqueos / pendientes

- Pixelify Sans dibuja «¿» parecido a «ó» (limitación de la fuente).
- El .tmj del repo usa el pack `limezu`; sin la carpeta vendor el cliente cae a formas simples. Para usar el placeholder: `pnpm assets:placeholder && pnpm map:generate --pack placeholder` (el cliente elige el pack por la propiedad `assetPack` del mapa).
- A* no prefiere los caminos (coste uniforme): los agentes cruzan el césped en diagonal escalonada.
- Etiquetas de nombre se solapan cuando hay varios agentes juntos (fase E).
