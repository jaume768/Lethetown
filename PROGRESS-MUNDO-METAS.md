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

- [ ] 2.1 Modelo de metas: sistema `goals`, tabla `goals`, catálogo de criterios medibles
- [ ] 2.2 Metas iniciales (`tools/derive-goals.ts`, revisadas a mano)
- [ ] 2.3 Plan, decisión, consolidación nocturna, psicología y conflictos
- [ ] 2.4 Marcharse del pueblo (ausentes, visitas)
- [ ] 2.5 Interfaz: pestaña «Metas», dramas, «Evolución», vecinos que se fueron

### Final

- [ ] README, CLAUDE.md, docs/decisiones (mundo.md, metas.md), coste antes/después
- [ ] `pnpm interview --advance 48` antes y después (Inés, Mateo, Aurora)
- [ ] Comandos de la partida real corta de validación
- [ ] Push y PR

## Coste (`cost:report 48`, mock, SIM_SEED=7)

| Etapa                     | Llamadas | decide | social | plan | consolidate | Entrada no cacheada |   ≈ $ |
| ------------------------- | -------: | -----: | -----: | ---: | ----------: | ------------------: | ----: |
| `main` (antes de empezar) |    3.791 |  1.362 |    625 |   40 |          40 |           1.434.434 | 0,654 |
| 1.2 (semillas de 1996)    |    4.470 |  1.585 |    747 |   40 |          40 |           1.793.505 | 0,788 |
| Fase 1 (1.4)              |    4.302 |  1.567 |    753 |   40 |          40 |           1.703.086 | 0,768 |

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
