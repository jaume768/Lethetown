# Modo repetición y modo cine

Rama `feat/modo-repeticion`. Objetivo: reproducir en la web una partida grabada (`record` +
`world:export`) sin servidor de simulación, sin LLM y sin coste, con un «modo cine» para grabar
vídeos de redes. Todo lo que se ve es real (frases, dramas, crónicas tal cual); nada se inventa.

Al retomar: leer este fichero, `docs/decisiones/repeticion.md` y `git log --oneline main..`.

## Checklist

- [x] 1a. Esquema `ReplayBundle` (shared, con versión y lista blanca), interpolación, vistas en
      un minuto y momentos (lógica pura con tests)
- [ ] 1b. `pnpm replay:pack` (servidor) y test de la lista blanca
- [ ] 5. `record --track` (`positions.jsonl`)
- [ ] 4. `pnpm replay:moments` (`moments.md` y `moments.json`)
- [ ] 2. Reproductor `/replay` (mismo reductor que el WebSocket, controles, momentos, atajos)
- [ ] 3. Modo cine (cámara, subtítulos, marcos, tarjetas, marca, clips 9:16, 4:5 y 16:9)
- [ ] Pruebas e2e (paquete pequeño generado en mock)
- [ ] Docs (decisión, CLAUDE.md, README) y pasos para E3 s7/s13 y para grabar un clip

## Decisiones

(ver también `docs/decisiones/repeticion.md`)
