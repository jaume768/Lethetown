# Historial

Una sección por fase, en orden: rama, commit de la fusión, fecha y qué cambió, con su decisión.
El avance paso a paso de cada una (casillas, coste por paso, entrevistas) era un `PROGRESS-*.md`
en la raíz; sigue en git, en el commit de su fusión (enlace «avance» de cada fase). Lo que
quedó por validar está en la [hoja de ruta](roadmap.md#pendiente-de-validar-con-partida-real-e4).
Coste: `cost:report 48` (mock, 48 h, `SIM_SEED=7`), salvo que se diga otra cosa; la tabla
completa, en [LLM y coste](decisiones/llm.md#historial-de-coste-mock-48-h-20-agentes).

Avance de una fase: `git show <merge>:PROGRESS-<FASE>.md`.

## Base

- **Pixel art y memoria humana** · `feat/pixel-art-y-memoria` · `365289d` (PR #1) · 2026-10-28.
  Mapa Tiled generado, A\* que prefiere los caminos, assets por manifest y memoria humana
  completa (olvido, esencia, reconsolidación, confusión de fuente, fichas, rumores, presupuesto).
  Ver [memoria](decisiones/memoria.md) y [mundo](decisiones/mundo.md).
- **Producción** · `feat/produccion` · `6586d9c` (PR #2) · 2026-10-28. Multi-mundo con
  instantáneas, api + sim-workers con leases, seguridad, observabilidad, Docker con Caddy y la
  interfaz de espectador, director y overlay. Ver [producción](decisiones/produccion.md) e
  [interfaz](decisiones/interfaz.md).
- **Psicología** · `feat/psicologia` · `c710c3c` (PR #7) · 2026-10-29. Protección de menores,
  hábitos, perfiles de memoria, ánimo, sueño, sesgos, memoria prospectiva y relaciones visibles.
  Ver [psicología](decisiones/psicologia.md), [social](decisiones/social.md) y
  [menores](decisiones/menores.md).

## Acciones

`feat/acciones` · `d2432a9` (PR #8) · 2026-10-29 ·
[avance](https://github.com/jaume768/Lethetown/blob/d2432a9/PROGRESS-ACCIONES.md)

- Saneamiento previo: `agent.ts` como fachada de módulos, mock declarativo
  (`registerDecideRule`), factorías, `listActive` sin vectores y retención por tabla.
- Catálogo cerrado que la IA elige y el motor valida (`do_activity`, `say`…); lo que no se puede
  llega como «No pude…» y se recuerda.
- Citas (plantones, agenda), lugares conocidos y `explore`, grupos de hasta 5, objetos e
  inventario con préstamos (el libro de Carmen), invitar y acompañar, notas y normas (casas
  privadas, horarios).
- Coste: 3.613 → 3.289 llamadas; ninguna acción añade llamadas (van en la decisión).

Ver [acciones](decisiones/acciones.md).

## Ritmo y habla

`fix/ritmo-y-habla` · `7eb8343` · 2026-10-30 ·
[avance](https://github.com/jaume768/Lethetown/blob/7eb8343/PROGRESS-RITMO.md)

- Turnos reactivos (`SIM_REPLY_DELAY_MINUTES`): quien recibe una frase contesta al minuto.
- Importancia por reglas dentro de la charla y reconsolidación después de contestar; cola del
  LLM con dos prioridades.
- Habla oral (réplicas cortas, recorte en código) y las 4 últimas frases en `decide`; a más de
  x10, el reloj va a x10 con conversaciones.
- Primera partida de estudio real (E1, 48 h): 3,65 $ y 10,1 s de espera media entre frases.
- Coste: 3.289 → 4.420 llamadas (más conversación); espera de 6,2 a 1,7 min de juego.

Ver [ritmo](decisiones/ritmo.md).

## Cimientos (fase 0)

`feat/cimientos` · `da22e57` · 2026-10-31 ·
[avance](https://github.com/jaume768/Lethetown/blob/da22e57/PROGRESS-CIMIENTOS.md)

- Registro de sistemas (`SimSystem`) sin cambiar el dorado: lo nuevo entra como módulo.
- Puente de lo hablado a la acción (`agreements` de la tarea `social`).
- Coste: enrutado por tarea (`config/llm-routing.json`), resumir menos, Batch API y caché larga;
  tope de turnos por interés y muletillas.
- Métricas de evolución (pestaña) y `pnpm study:analyze`.
- Coste: 4.420 llamadas y ≈ 0,94 $ → 3.791 y ≈ 0,65 $.

Ver [sistemas](decisiones/sistemas.md), [LLM y coste](decisiones/llm.md) y
[evolución](decisiones/evolucion.md).

## Mundo y metas (fases 1 y 2)

`feat/mundo-y-metas` · `6b2ce01` (PR #10) · 2026-10-31 ·
[avance](https://github.com/jaume768/Lethetown/blob/6b2ce01/PROGRESS-MUNDO-METAS.md)

- Biblia del mundo (`config/world.json`, entonces 1996; desde el 2026-11-04, 2002), sistema
  `world` con fecha y clima.
- Perfil de conocimiento por semilla, aprender de otros y `ExternalKnowledgeGuard` (registro de
  anacronismos).
- Metas: sistema `goals` con criterios medibles, metas iniciales revisadas a mano, motivación,
  frustración, conflictos y marcharse del pueblo; pestaña «Metas».
- Coste: 3.791 llamadas y ≈ 0,65 $ → 4.131 y ≈ 0,79 $ (sin tareas nuevas).

Ver [mundo](decisiones/mundo.md) y [metas](decisiones/metas.md).

## Corrección 2.5

`fix/correccion-2-5` · `3a882f7` · 2026-11-02 ·
[avance](https://github.com/jaume768/Lethetown/blob/3a882f7/PROGRESS-CORRECCION-2-5.md)

A partir de la segunda partida de estudio
([E2](investigacion/estudios/e2-partida-3dias-metas/ESTUDIO.md)):

- Metas que pueden avanzar (pasos huérfanos, siguiente proyecto) y «conseguir» no es «contar»:
  lo cualitativo lo comprueba la consolidación (`confirmed`).
- Frustración que lleva a abandonos en una semana; intenciones sin inflación.
- Nadie inventa vecinos ni personas (`offstagePeople`, `PersonGuard`); menos ruido en los
  registros de conocimiento y de menores. Batch por defecto y `.env.study.example`.
- Coste: 4.131 llamadas y ≈ 0,79 $ → 3.525 y ≈ 0,74 $.

Ver [personas](decisiones/personas.md) y [metas](decisiones/metas.md).

## Desarrollo y aprendizaje (fase 3)

`feat/aprendizaje` · `18368f2` · 2026-11-02 ·
[avance](https://github.com/jaume768/Lethetown/blob/18368f2/PROGRESS-APRENDIZAJE.md)

- 14 habilidades (sistema `skills`): práctica con rendimientos decrecientes, maestro, olvido;
  cambian lo que sale (arreglar, calidad del café o del pan) y valen como criterio de metas.
- Acciones `practice`, `ask_to_learn`/`teach` (sesiones), `help`, `show_result`.
- 24 saberes del pueblo (sistema `lore`) que se cuentan, se deforman sin LLM y se pierden;
  `share_lore`.
- Deriva lenta de la personalidad (sistema `personality`).
- Coste: 3.525 llamadas y ≈ 0,74 $ → 3.442 y ≈ 0,79 $.

Ver [habilidades](decisiones/skills.md) y [saberes](decisiones/lore.md).

## Estudio de la semana (E3)

`chore/estudio-semana` · `93d7cf1` · 2026-11-04

- El pueblo pasa de 1996 a abril de 2002 (el euro, para la economía); ver
  [por qué 2002](arquitectura.md#por-qué-2002-y-no-1996).
- Noche rápida (`SIM_NIGHT_SPEED`), lotes sin el fallback del lado servidor y tope de la
  estabilidad de los recuerdos (`maxStabilityHours`).
- Informe de la partida de 7 días con dos semillas
  ([E3](investigacion/estudios/e3-semana-fase3/ESTUDIO.md)).

## Corrección 3.5

`feat/correccion-3-5` · `382549d` · 2026-11-06 ·
[avance](https://github.com/jaume768/Lethetown/blob/382549d/PROGRESS-CORRECCION-3-5.md)

A partir de E3:

- Menos ruido en el `PersonGuard` (apodos, siglas, listas) y en familia para la protección de
  menores.
- Efecto de espaciado en la memoria; metas vitales confirmadas de noche; habilidades con
  histéresis y práctica rutinaria; enseñanza sin encadenar; deriva de la personalidad con lo
  malo y respecto al pueblo; saberes que no se repiten y se deforman de verdad; comer lo hecho.
- Caché del prefijo común del prompt fijo, rangos en la base de datos y partidas de estudio con
  desfase, control en ablación y manifiesto.
- Coste: 4.028 llamadas y ≈ 0,85 $ → 3.632 y ≈ 0,80 $.

Ver [memoria](decisiones/memoria.md), [LLM y coste](decisiones/llm.md) y
[personas](decisiones/personas.md).

## Cognición en movimiento (3.6)

`feat/cognicion-movimiento` · `c4c0387` · 2026-11-06 ·
[avance](https://github.com/jaume768/Lethetown/blob/c4c0387/PROGRESS-COGNICION.md)

- Posición real y proximidad: quien camina ve y es visto (`presence.ts`).
- Encuentros por el camino con saliencia calculada en código (sistema `encounters`): saludar,
  pararse a charlar o seguir, y retomar el camino.
- Hablar andando y sin dejar la actividad; asociaciones sin LLM (sistema `associations`).
- Interruptores por mundo (`worlds.cognition`, `SIM_COGNITION=off`) para el mundo de control;
  apagada, el dorado `three-days-off.txt` no cambia.
- Coste: +5 % ± 5 % de llamadas en mock (10 semillas).

Ver [cognición](decisiones/cognicion.md).

## Repetición y modo cine

`feat/modo-repeticion` · `46bb85d` · 2026-11-10 ·
[avance](https://github.com/jaume768/Lethetown/blob/46bb85d/PROGRESS-REPETICION.md)

- `pnpm replay:pack`: paquete de repetición con lista blanca y versión; `record --track`.
- `/replay` con el mismo reductor que el WebSocket, sin servidor ni coste; momentos destacados
  (`pnpm replay:moments`).
- Modo cine: cámara que encuadra a quien habla, subtítulos, marcos 9:16, 4:5 y 16:9, tarjetas,
  marca y clips a 30 fps.

Ver [repetición](decisiones/repeticion.md).

## Cine 2

`feat/cine-2` · `4b5712a` · 2026-11-10 ·
[avance](https://github.com/jaume768/Lethetown/blob/4b5712a/PROGRESS-CINE-2.md)

- Arreglo de `&cine=1&agent=<id>` (cola de órdenes de cámara) y error boundary.
- Tarjeta «así muere un recuerdo», pantalla partida con dos semillas y contador de días.
- Escenas guardadas de los guiones (`docs/videos/escenas.json`, `?scene=<id>`,
  `pnpm replay:scenes`); arcos largos en los momentos.
- Documentación para colaborar (investigación, hoja de ruta, plantillas de issues).
- Cómo grabar cada escena: [vídeos](videos/README.md#cómo-grabar-cada-escena).

Ver [repetición](decisiones/repeticion.md#cine-2-planos-de-los-guiones).
