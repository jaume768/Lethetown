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
- [ ] 2. Reproductor `/replay` (mismo reductor que el WebSocket, controles, momentos, atajos)
- [ ] 3. Modo cine (cámara, subtítulos, marcos, tarjetas, marca, clips 9:16, 4:5 y 16:9)
- [ ] Pruebas e2e (paquete pequeño generado en mock)
- [ ] Docs (decisión, CLAUDE.md, README) y pasos para E3 s7/s13 y para grabar un clip

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
