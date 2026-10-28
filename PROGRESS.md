# PROGRESS — feat/pixel-art-y-memoria

Registro de avance de la fase "pixel art + memoria humana completa". Si la sesión se corta,
retomar desde el primer elemento sin marcar.

## Checklist

### Assets

- [ ] `pnpm assets:placeholder`: tileset 16×16, hoja de personaje (4 dir × idle/walk4/sit/sleep), emotes, bocadillo nine-slice
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
- [~] Sprites animados 4 direcciones, pose al llegar al spot, selección con contorno (hecho; falta revisar orden de direcciones en juego)

### Fase E — Mente visible

- [ ] Emotes pixel por actividad/ánimo
- [ ] `thinking_start` / `thinking_end` por WS + indicador
- [ ] Bocadillos nine-slice con texto letra a letra
- [ ] Efectos de memoria (recall / vague / forget) por WS
- [ ] Inspector "jardín de recuerdos" con filtros

### Fase F — Ambiente e interfaz

- [ ] Ciclo día/noche, ventanas y farolas
- [x] Tejados que se desvanecen
- [x] Cámara: zoom entero, arrastre, seguir agente, límites
- [ ] UI pixel con fuente OFL incluida
- [ ] Minimapa (opcional)

### Fase G — Memoria humana completa

- [ ] Config tipada de memoria con valores por defecto documentados
- [ ] Consolidator (reflexión nocturna con citas)
- [ ] SocialProfile + store (RAM y Postgres)
- [ ] GistCompressor
- [ ] Reconsolidator con historial de versiones
- [ ] SourceConfuser
- [ ] Olvido por presupuesto + `memory_audit`
- [ ] Escuchar a escondidas (rumores)
- [ ] Fin de conversación natural

### Fase H — Funciones estrella

- [ ] Vista Rashomon
- [ ] Línea de tiempo persistida
- [ ] `pnpm interview`
- [ ] Crónica del día
- [ ] Intervención del jugador (voz interior, eventos del mundo)

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

## Bloqueos / pendientes

- Placeholder generado por código (`pnpm assets:placeholder`) aplazado: el usuario pidió priorizar lo que no dependía de assets y después aportó los packs vendor. Sigue pendiente para que el proyecto funcione sin ellos (ahora cae a formas simples).
- A* no prefiere los caminos (coste uniforme): los agentes cruzan el césped en diagonal escalonada.
- Etiquetas de nombre se solapan cuando hay varios agentes juntos (fase E).
