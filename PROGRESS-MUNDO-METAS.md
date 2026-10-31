# Mundo (1996) y metas (fases 1 y 2): progreso

Rama `feat/mundo-y-metas`. Objetivo: un mundo coherente (un pueblo inventado del interior de
Mallorca en 1996) con lo que sabe cada vecino, y metas vitales medibles por el motor que den
trayectoria a cada uno. Al retomar, leer esto primero.

Cada paso: `corepack pnpm -r typecheck && corepack pnpm lint && prettier --check --end-of-line
auto . && corepack pnpm test` (mirando el código de salida) y `pnpm dev` en mock. En esta máquina
pnpm va por `corepack pnpm` (no está en el PATH: `pnpm typecheck` falla porque llama a `pnpm -r`).

## Checklist

### Fase 1 — El mundo y lo que saben

- [x] 1.1 Biblia del mundo (`config/world.json`, zod), sistema `world` (prompt fijo, fecha en el plan, clima)
- [x] 1.2 Semillas, clima, mock y prompts revisados para 1996
- [x] 1.3 Perfil de conocimiento (`knowledge`), `tools/derive-knowledge.ts`, regla del prompt, aprender de otros
- [x] 1.4 `ExternalKnowledgeGuard` (solo registrar), tabla `knowledge_log`, métricas

### Fase 2 — Ambición (metas)

- [x] 2.1 Modelo de metas: sistema `goals`, tabla `goals`, catálogo de criterios medibles
- [x] 2.2 Metas iniciales (`tools/derive-goals.ts`, revisadas a mano)
- [x] 2.3 Plan, decisión, consolidación nocturna, psicología y conflictos
- [x] 2.4 Marcharse del pueblo (ausentes, visitas)
- [x] 2.5 Interfaz: pestaña «Metas», dramas, «Evolución», vecinos que se fueron

### Final

- [x] README, CLAUDE.md, docs/decisiones (mundo.md, metas.md), coste antes/después
- [x] `pnpm interview --advance 48` antes y después (Inés, Mateo, Aurora)
- [x] Comandos de la partida real corta de validación
- [x] Push y PR (#10)

## Coste (`cost:report 48`, mock, SIM_SEED=7)

| Etapa                     | Llamadas | decide | social | plan | consolidate | Entrada no cacheada |   ≈ $ |
| ------------------------- | -------: | -----: | -----: | ---: | ----------: | ------------------: | ----: |
| `main` (antes de empezar) |    3.791 |  1.362 |    625 |   40 |          40 |           1.434.434 | 0,654 |
| 1.2 (semillas de 1996)    |    4.470 |  1.585 |    747 |   40 |          40 |           1.793.505 | 0,788 |
| Fase 1 (1.4)              |    4.302 |  1.567 |    753 |   40 |          40 |           1.703.086 | 0,768 |
| Fase 2 (final)            |    4.131 |  1.464 |    680 |   40 |          40 |           1.660.740 | 0,788 |

## Decisiones (para revisar en la PR)

### Arquitectura

- Todo lo nuevo es un `SimSystem`: `world` (biblia, fecha, clima), `knowledge` (registro de
  anacronismos y referencias externas; aprender de otros), `goals` (metas, psicología,
  conflictos, marcharse y volver de visita).
- Tres ganchos nuevos en `SimSystem`, genéricos (los usarán economía, oficios o el ciclo vital):
  `planSections` (secciones del prompt del plan), `consolidation` (una sección y un campo de la
  respuesta de la consolidación nocturna: misma llamada) y `holds` (el agente no está en el
  pueblo: no vive ni piensa). `simulation.ts` solo gana la comprobación de `holds` junto a la de
  `travelling`.

### Fase 1

- **Biblia** en `config/world.json` (esquema `WorldBible` en agent-core, `world/bible.ts`): el día 0
  es el lunes 15 de abril de 1996 (configurable: `year`, `startDate`). Entra en el prompt fijo en
  ~10 líneas (≈ 450 tokens, cacheados) con el glosario de fuera del pueblo; los lugares del pueblo
  ya estaban. La fecha y la fiesta del día van al plan (variable). Calendario propio sin `Date`.
- **Datos de 1996 comprobables** usados en la biblia y las semillas: elecciones generales del 3 de
  marzo (ganó el PP de Aznar), Son Dureta (el hospital de Palma; Son Espases es de 2011), la UIB,
  TVE/Antena 3/Telecinco/Canal+, el festival de Benicàssim (desde 1995), el GOB (desde 1973),
  pesetas. Evitado: IB3 (2005), el euro en circulación (2002), Son Espases.
- **Clima de Mallorca** por estación (`climate` de la biblia): el modo demostración sortea con esos
  pesos (nieve 0,05 de ~10 en invierno y nunca en verano; calor en verano; lluvias y tormentas
  —gota fría— en otoño). Sin biblia, la tabla de antes. Fuera del modo demostración el tiempo solo
  lo cambia el director (como antes).
- **Semillas** (1.2), cambios uno a uno:
  - Lucía: «ilustradora freelance» → trabaja por encargo para una editorial de Barcelona y manda
    los dibujos por correo (certificado).
  - Inés: «la ciudad» → Palma (descripción, recuerdo, tema); muletilla «literal» (jerga posterior)
    → «me flipa»; recuerdo nuevo: aprende a fotografiar con carrete en blanco y negro.
  - Julián: «a estudiar a la ciudad» → a Palma.
  - Elena: la empresa es Promociones Llevant, de Palma (inventada, en el glosario); «las
    elecciones son dentro de un año» → las municipales quedan lejos (fueron en mayo de 1995).
  - Hugo: pegatina del festival de Benicàssim; recuerdo nuevo: grabó una maqueta en casete.
  - Valentina: «cámara analógica» (retrónimo) → réflex de carrete; recuerdo nuevo: lleva los
    carretes a revelar a Palma.
  - Ernesto: las cartas de Valentina llegan con matasellos de Madrid.
  - Samuel: llama a Lagos desde la cabina de la plaza los domingos.
  - Clara: enfermería en Palma; recuerdo nuevo: tendría que coger el autobús o irse a vivir allí.
  - Marta: el pedido se hace llamando al almacén.
  - Nuria: socia del GOB.
  - Sin tocar: Mateo, Carmen, Tomás, Pilar, Andrés, Sofía, Rafael, Leo, Aurora (ya encajaban). El
    mapa (objetos), las frases del mock y los prompts no asumían tecnología moderna.
- **El mock es muy sensible a los textos de las semillas**: solo cambiar recuerdos iniciales subió
  48 h de 3.791 a 4.470 llamadas (más charlas, no tareas nuevas). La fase 1 entera queda en 4.302
  (≈ +13 % frente a `main`); el aumento de tokens de entrada por llamada es la biblia y el perfil
  en el prompt fijo, casi todo leído de caché.
- **Perfil de conocimiento** (`knowledge` en `AgentSeed`, esquema en shared): estudios, oficio,
  idiomas, lugares de fuera, intereses y nivel cultural; va al prompt fijo como «Lo que sabes: …».
  `pnpm knowledge:derive` propone (heurística por edad, trabajo, descripción y recuerdos); los 20
  del repo están revisados a mano (p. ej. Samuel: inglés, igbo, yoruba y castellano —Okafor es un
  apellido igbo—; Aurora: escuela de monjas hasta los diez, la guerra y la posguerra; Leo: cuarto
  de EGB, Los Simpson y Dragon Ball, que ya se emitían). Test: todos tienen perfil, el oficio sale
  de la descripción, los menores en EGB/BUP, nada posterior a 1996.
- **Aprender de otros**: si alguien dice un nombre de fuera (no del pueblo, del glosario ni de las
  referencias comunes) que quien escucha no tiene en su perfil, este lo guarda como recuerdo
  semántico «X me contó algo de Lagos: «…»» con `source: contado por X` (una vez por oyente y
  nombre). En 48 h de mock: 4 (lo de Lagos de Samuel). Las palabras de otro idioma no se detectan
  (haría falta un diccionario): queda para más adelante.
- **ExternalKnowledgeGuard** (agent-core, `world/knowledge-guard.ts`): se engancha a `MinorGuard`
  como inspector (`addInspector`, síncrono para no añadir `await`), así ve exactamente los mismos
  textos (frases, acciones, planes, recuerdos, reflexiones, notas, crónica). Modo `log` por
  defecto (`knowledgeGuard.mode` en la biblia); `enforce` descarta los textos con anacronismos
  (con el motivo, en `moderation_log` como los de menores); `soften` de momento solo registra.
  Heurística sin LLM: anacronismos por lista (palabras y prefijos, sin expresiones regulares sobre
  el texto) y nombres propios a media frase que no son vecinos, lugares, glosario, referencias
  comunes ni encajan con el perfil. Para no confundir palabras con mayúscula al empezar una frase
  (lo que revisa la decisión empieza por el id del destinatario: «marta Tienes razón»), una sola
  palabra que se haya visto en minúscula no es un nombre: el vocabulario se aprende de las
  semillas, la biblia y lo que se va leyendo. En un recuerdo, lo que va entre comillas lo dijo
  otro y no se vuelve a contar; lo mismo dentro de un texto ya registrado hace poco, tampoco.
  En 48 h de mock: 0 anacronismos y 0 referencias externas (con el LLM real habrá que mirar los
  ejemplos de «Evolución» para afinar la lista y la heurística).
- Tabla `knowledge_log` (migración 0016), política de retención `knowledgeLog` (30 días de juego),
  en RAM y Postgres; «Evolución» y `study:analyze` la muestran por tipo, por agente, por día y
  con ejemplos.

### Fase 2

- **Ganchos nuevos en el núcleo**, genéricos: `planSections`, `consolidation` (la parte de un
  sistema en la consolidación nocturna: su texto y su campo en la misma respuesta) y `holds`.
  `simulation.ts` solo cambia en una línea (no ejecutar el tick de quien un sistema retiene) y en
  pasar las secciones al plan; `memory-routines.ts`, en pasar las partes a la consolidación.
  Es la excepción consciente a «nada nuevo en simulation.ts»: marcharse del pueblo necesita que
  el bucle sepa que alguien no está.
- **Ausentes** sin estado nuevo en el núcleo: quien se va pasa a `locationId: "fuera"`
  (`AWAY_LOCATION`, no es un lugar del mapa), así las comprobaciones de «está aquí» ya lo excluyen;
  el mapa no lo pinta. `SIM_SNAPSHOT_VERSION` no cambia (el sistema `goals` lleva su versión).
- **Metas demasiado fáciles en mock** al principio: 27 logros y 5 metas vitales en 72 h. Se
  subieron los objetivos (más conversaciones y horas) y la vital pide 2 proyectos más de los
  sembrados (los propondrá al repasar sus días). Ahora, en 72 h, 11 proyectos y ninguna vital.
- **Objetivos de relación** calibrados sobre la ficha inicial (Mateo y Andrés ya tenían 0,6 de
  afinidad con Lucía y Sofía: la meta nacía cumplida). En código, una meta que ya se cumple al
  crearla se descarta (auditado).
- **Recuerdo de la meta** con importancia 6/5: con 8 acaparaba la recuperación (en la entrevista,
  Inés y Mateo contestaban a todo con su meta).
- **Mock**: la consolidación propone un paso si un proyecto frustra (≥ 0,5) y no tiene pasos, y
  un proyecto nuevo si la vital se queda sin proyectos; el plan dedica la franja de la tarde a su
  primer proyecto (horas haciendo algo o en un sitio). Sin expresiones regulares que retrocedan.
- **Dorado**: regenerado en cada paso que cambia el comportamiento (72 h: 5.868 en `main` →
  6.289 al final). Con las metas, 11 proyectos conseguidos en 3 días.
- **Coste** (48 h de mock): 4.131 llamadas y ≈ 0,788 $ frente a 3.791 y 0,654 $ de `main`
  (+9 % llamadas, +20 % $). No hay tareas nuevas: plan y consolidación (Sonnet) llevan las metas
  (+≈ 300 tokens de entrada por llamada), el prompt fijo, la biblia y el perfil (≈ 600 tokens,
  leídos de caché casi siempre) y el resto es la trayectoria distinta del mock.

## Entrevista antes y después (`pnpm interview --advance 48`, mock, `SIM_SEED=7`)

`main` en un worktree aparte; la rama al final. En mock cada respuesta es el recuerdo más
relevante para la pregunta, así que la entrevista dice qué tiene presente cada uno (no cómo lo
diría el LLM real). La rama añade la pregunta «¿Qué te has propuesto en la vida y cómo lo llevas?».

- **Inés** (16). Antes: casi todo era «Sofía me dijo: ¿te has enterado…?» y, para mañana, «quiero
  estudiar fotografía en la ciudad». Después: lo más presente es que Valentina le enseña a hacer
  fotos con carrete (recuerdo nuevo de 1996), y para mañana y su vida, «me he propuesto:
  prepararme para estudiar fotografía en Palma cuando sea mayor de edad». A las 48 h lleva el 60 %
  de «aprender a fotografiar con Valentina» y nada de «hacer fotos con carrete»; su meta vital
  sigue activa (no puede irse: aplazada cuando la cumpla).
- **Mateo** (34). Antes: todas las respuestas eran la misma frase de Carmen. Después: su madre,
  quedar con Carmen y, sobre su vida, «Rafael dice que le robo clientes por las tardes» (su meta
  del café choca con la de Rafael). A las 48 h ha conseguido llenar el café de vecinos distintos y
  acercarse a Lucía: su vital va por el 50 % (necesita dos proyectos más), ánimo 0,34.
- **Aurora** (82). Igual antes y después: «nací en Lethetown hace ochenta y dos años, cuando el
  lago era más grande» (la reminiscencia de los mayores pesa más que todo lo demás). Sus metas
  avanzan igualmente: 80 % de «contarle a Clara mi juventud», 25 % de ir al Jardín del Recuerdo.
- Con importancia 8, el recuerdo de la meta dominaba (Inés contestaba a 6 de 9 preguntas con su
  meta): de ahí que se bajara a 6/5.

## Validar con una partida real corta

Lo que el mock no puede decir: si el LLM respeta 1996 (anacronismos), si las metas avanzan con
sentido y si alguien abandona. Unas 16 h de juego (para pasar una noche: la consolidación revisa
las metas) a x10, unos 100 min reales. En PowerShell:

```powershell
# 1) .env: LLM_PROVIDER=anthropic, SIM_SPEED=10. Base de datos nueva para no mezclar partidas:
#    cambia el nombre de la base en DATABASE_URL (p. ej. …:5433/lethetown_mundo) y migra.
pnpm db:up
pnpm db:migrate
pnpm dev

# 2) En otra terminal (usuario director para pausar al acabar):
$env:RECORD_USER = "…"; $env:RECORD_PASSWORD = "…"
pnpm --filter @lethetown/server record ../../estudio/corta-mundo-metas --hours 16

# 3) Volcar la BD del mundo y analizar.
pnpm --filter @lethetown/server world:export ../../estudio/corta-mundo-metas/bd
pnpm study:analyze estudio/corta-mundo-metas
```

Qué mirar en `estudio/corta-mundo-metas/analysis.md` (y en `bd/`):

- **Anacronismos**: tabla «Conocimiento externo» y sus ejemplos (`bd/knowledge_log.jsonl`). Lo
  esperable es casi cero anacronismos; las referencias externas, revisarlas a mano: si son
  falsos positivos, ampliar `commonReferences` o el glosario de la biblia; si son de verdad
  incoherentes, valorar el modo `enforce`.
- **Metas que avanzan**: tabla «Metas» y filas por día (activas, conseguidas, progreso medio) y
  `bd/goals.jsonl` (historial de cada meta con su motivo). Comprobar que la consolidación propone
  proyectos medibles (`bd/memory_audit.jsonl`, `action: "goal"`: las descartadas y por qué).
- **Abandonos y frustración**: con 16 h casi seguro que ninguno (la frustración tarda días);
  para verlos, una partida de 3–4 días de juego. Mirar la frustración media por agente.
- **Coste**: plan y consolidación por llamada (`llm_calls`) frente a la partida de estudio.
