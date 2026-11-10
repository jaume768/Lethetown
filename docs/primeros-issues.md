# Primeras tareas

Para empezar a colaborar. Casi todas son experimentos pequeños que se pueden hacer **en mock,
gratis y sin claves**: la memoria, el olvido, las metas y la red los calcula el motor, así que el
mock ya los mueve (lo que dicen los vecinos, no). Una partida en mock grabada, con su base de
datos, sin servidor:

```bash
pnpm --filter @lethetown/server replay:demo --hours 72 --seed 7 --rec estudio/mock/s7
MEMORY_ABLATION=noForgetting,noVagueness \
  pnpm --filter @lethetown/server replay:demo --hours 72 --seed 7 --rec estudio/mock/s7a
pnpm study:analyze estudio/mock/s7 estudio/mock/s7a
```

Respeta `MEMORY_ABLATION`, `SIM_COGNITION` y `config/memory.json`. Cómo plantear y compartir
cada experimento: [COLABORA.md](../COLABORA.md). Al coger una tarea, abre un issue con su
plantilla.

## Experimentos

1. **Umbral de olvido.** Con `config/memory.json` → `retrieval.forgetThreshold` a 0,05 (por
   defecto) y a 0,10, dos partidas en mock de 3 días con la semilla 7. ¿Cuántos olvidos,
   archivados y borrados más? ¿Cambian las intenciones cumplidas? Mide con `study:analyze` y
   `bd/memory_audit.jsonl`.
2. **Ablación en mock.** Lo mismo con `MEMORY_ABLATION=noForgetting,noVagueness` frente a
   normal: es el ensayo barato del mundo de control de E4 (¿funciona el interruptor? ¿qué
   métricas se mueven ya en mock?).
3. **Cognición en movimiento.** `SIM_COGNITION=off` frente a `on`, un día en mock: encuentros,
   saludos, charlas en el camino y asociaciones (`study:analyze A B` los compara). ¿Cambia la
   red (parejas que hablan, Gini)?
4. **Reconsolidación.** `reconsolidation.probability` a 0,1 (por defecto) y a 0,3: ¿cuántas
   versiones por recuerdo y cuántos «lo recuerdan distinto» (`replay:moments`, tipo
   `rashomon`)? En mock el texto no cambia de verdad; lo que se mide es la frecuencia.
5. **Azar frente a diseño.** Tres semillas en mock (7, 13, 21), 3 días: con
   `pnpm replay:moments A B` por parejas, ¿cuántas intenciones o metas de la semilla acaban
   distinto («Las dos semillas»)? Es la línea base para saber cuánto diverge un pueblo solo por
   el azar.
6. **Espaciado.** `decay.recallStabilityGrowth` a 1,8 (por defecto) y a 1,4: ¿cuántos recuerdos
   acaban con la estabilidad en el tope (`memories.stability` = `maxStabilityHours`)?

## Análisis y repetición

7. **Una escena nueva.** Con los paquetes de E3 (ver `PROGRESS-REPETICION.md`), busca un
   momento en `moments.md` (o en la lista del reproductor), añádelo a
   `docs/videos/escenas.json` y compruébalo con `pnpm replay:scenes` ([cómo](videos/README.md)).
8. **Divergencia entre semillas.** Un script (en `apps/server/src/scripts/`) que, a partir de
   dos grabaciones, dé una cifra de cuánto divergen: intenciones y metas emparejadas que acaban
   distinto (`pairArcs`), parejas que hablan en una y no en la otra, afinidades finales. Es la
   medida que pide la primera [pregunta abierta](../ROADMAP.md#preguntas-abiertas).
9. **Una partida real corta.** Con una clave propia, `latency:probe 30 10` y el informe de coste
   por tarea (`cost:report 48`): ¿cuadra con los 1,31 $ por mundo y día de E3? Compártelo con la
   plantilla «Resultado de una prueba».

## Documentación

10. **Decisiones en inglés.** Traducir el índice de [docs/decisiones](decisiones/README.md) y
    [memoria](decisiones/memoria.md) (las dos más leídas) a `*.en.md`, como
    [Investigación](investigacion/README.en.md).
