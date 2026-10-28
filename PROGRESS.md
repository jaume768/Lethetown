# PROGRESS — feat/pixel-art-y-memoria

Registro de avance de la fase "pixel art + memoria humana completa". Si la sesión se corta,
retomar desde el primer elemento sin marcar.

## Checklist

### Assets
- [ ] `pnpm assets:placeholder`: tileset 16×16, hoja de personaje (4 dir × idle/walk4/sit/sleep), emotes, bocadillo nine-slice
- [ ] Manifest de assets tipado (zod) con packs `placeholder` / `vendor`
- [ ] `apps/web/public/assets/vendor/` en .gitignore; README con instrucciones y crédito a LimeZu

### Fase A — Phaser 4
- [ ] Migrar apps/web a Phaser 4.x estable (`pixelArt`, `roundPixels`, zoom entero)

### Fase B — Mapa Tiled
- [ ] `pnpm map:generate` → `seeds/town.tmj` (60×40, capas ground/paths/buildings/decor/roofs/collision, objetos places/spots)
- [ ] Parser .tmj → `World` en shared (zod) usado por servidor y cliente; eliminar world.json
- [ ] Agentes van a spots concretos (prompts, plan, decisión, rutinas)

### Fase C — Movimiento
- [ ] A* determinista en shared con tests
- [ ] Servidor calcula ruta y duración; envía waypoints
- [ ] Cliente interpola por reloj de juego; frames por distancia recorrida

### Fase D — Personajes
- [ ] `appearance` en AgentSeed, `activityKind` en AgentState (LLM + rutinas + mock)
- [ ] Sprites animados 4 direcciones, pose al llegar al spot, selección con contorno

### Fase E — Mente visible
- [ ] Emotes pixel por actividad/ánimo
- [ ] `thinking_start` / `thinking_end` por WS + indicador
- [ ] Bocadillos nine-slice con texto letra a letra
- [ ] Efectos de memoria (recall / vague / forget) por WS
- [ ] Inspector "jardín de recuerdos" con filtros

### Fase F — Ambiente e interfaz
- [ ] Ciclo día/noche, ventanas y farolas
- [ ] Tejados que se desvanecen
- [ ] Cámara: zoom entero, arrastre, seguir agente, límites
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

(se van añadiendo)

## Bloqueos / pendientes

(ninguno todavía)
