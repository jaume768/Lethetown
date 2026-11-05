# Habilidades (desarrollo)

Objetivo: que los vecinos mejoren con la práctica, se oxiden sin ella y se enseñen unos a otros,
y que eso se note en el mundo, sin que el LLM se invente el nivel de nadie. Sistema `skills`
(`apps/server/src/sim/systems/skills.ts`, lógica en `sim/skills.ts`; cuánto sube y baja, en
`packages/agent-core/src/skills/skills.ts`).

## Decisiones

- **Catálogo cerrado y configurable** (`SkillsConfig.catalog`, zod; 14 habilidades de un pueblo
  de Mallorca en 2002): cocina, panadería, café y barra, huerto, pesca, arreglar cosas,
  fotografía, dibujo, música, enseñar, cuidados y primeros auxilios, vender y negociar, contar
  historias e idiomas. Cada una dice con qué se practica: objetos del mapa (la cafetera, el
  horno, los bancales, el botiquín), palabras de la actividad y sitios. Las ids van al prompt
  fijo (cacheable) para `practice`, `teach` y `ask_to_learn`.
- **Lo mide el motor, nunca el LLM.** Cada 5 minutos, quien está despierto y quieto haciendo algo
  que practica una habilidad suma práctica: por el objeto que usa (`spotId`), si no por las
  palabras de su actividad, o por lo que se propuso (`practice`), una sesión de enseñanza o una
  ayuda. Las palabras son de **hacer, no de consumir**: «tomar un café» no practica la barra ni
  «ir al médico» los cuidados (en el primer dorado, Clara y Marta subían en «café y barra»).
- **Práctica rutinaria** (corrección 3.5): las comidas de cada día cuentan con peso reducido
  (`SkillsConfig.routinePracticeWeight`, 0,3). «Rutinario» lo decide el motor con lo que hace:
  una actividad con palabras de las comidas del día (`routineActivities`: desayuno, comida,
  cena, merienda…, al principio de palabra) en una habilidad que no deja resultado. Lo que se
  propone practicar (`practice`), una sesión, una ayuda, algo que deja resultado (el pan, las
  fotos) o cocinar algo que no es la comida del día («un tumbet para la fiesta») cuenta entero.
  En la partida de una semana casi todo el pueblo subía en cocina de 0,30 a 0,55–0,60 con
  unos 1.300 min de desayunos, comidas y cenas; ahora un adulto que solo hace sus tres comidas
  se queda en «se defiende» (0,39 en una semana, test). Las horas de práctica se apuntan
  enteras; solo cuenta menos lo que sube.
- **Rendimientos decrecientes**: por hora, el nivel sube `practiceRate` (0,02) × lo que le falta;
  la curva es exacta (1 − e^(−r·h)), así que no depende de cada cuánto se mida. De 0 a 0,5, unas
  35 h; de 0,5 a 0,75, otras tantas. × 2 con un maestro delante que le saque 0,2 (en una sesión o,
  sin querer, alguien que hace lo mismo y lo hace mejor), × 1,3 de joven (< 18), × 0,7 de mayor
  (> 65), y algo más con apertura. Quien le hizo de maestro queda en `learnedFrom`.
- **Olvido propio**, mucho más lento que el de los recuerdos: tras 3 días sin practicar, cada día
  pierde un 1 % de lo que tiene por encima de un suelo que crece con lo aprendido a fondo
  (pico × (0,3 + 0,5·pico)). En un mes sin practicar se pierde un cuarto de lo que había sobre
  el suelo; lo que se llegó a dominar se queda en buena parte.
- **Niveles sin género**: «principiante» (< 0,2), «se defiende» (< 0,45), «bien» (< 0,7) y «con
  maestría». Los hitos (cambiar de etiqueta, arriba o abajo) van a la auditoría (`skill`), como
  evento (🎓 / 🕸) y como drama («aprende algo»).
- **Histéresis en las etiquetas** (corrección 3.5, `SkillsConfig.labelHysteresis`, 0,02): se
  sube al cruzar el umbral y se baja solo por debajo de umbral − 0,02. El escalón se guarda
  (`tier` en la tabla `skills` y en la instantánea; null = el de su nivel). En la partida de una
  semana, el día 4 a las 00:00 bajaban de etiqueta 8 habilidades por mundo a la vez: valores de
  las semillas justo en 0,20, 0,45 o 0,70 que perdían milésimas al oxidarse. Además, ningún
  nivel de partida está en un umbral (± 0,01): las semillas se subieron 0,03 (con la etiqueta
  que se quería) y `skills:derive` hace lo mismo (`offThreshold`); un test lo comprueba.
- **Semillas** (`skills` en `seeds/agents.json`): `pnpm skills:derive` propone por oficio,
  intereses, idiomas y edad; están revisadas a mano (el script daba «café y barra» a Lucía porque
  dibuja en el café). Un test comprueba que cada oficio es su mejor habilidad, que los menores no
  pasan de 0,4 y que los mayores saben cocinar.
- **Tabla `skills`** (`world_id`, agente, habilidad, nivel, pico, minutos de práctica, último uso,
  de quién aprendió, historial acotado a 40). Se escribe cuando el nivel cambia 0,01 o en un hito,
  no cada 5 minutos.

## Que importe

- **Arreglar** sale con probabilidad 0,35 + 0,6·nivel en «arreglar cosas» (antes, un 70 % fijo:
  ahora, con nivel 0,6). Intentarlo es practicar.
- **Calidad** de lo que se sirve con la cafetera, la cocina, el horno o el botiquín: nivel ×
  (1 − 0,3) + 0,3 × azar. Quien está delante lo percibe («El café de Mateo: muy bueno») con un poco
  de ánimo y de afinidad hacia quien lo hizo (algo en contra si sale mal).
- **Resultados**: 45 minutos seguidos practicando algo que deja resultado (fotos, dibujos, pan,
  verduras) dan un objeto del inventario con su calidad, como mucho 3 a la vez por persona; se
  regalan con `show_result` (quien lo recibe nota la calidad). No hay economía todavía: el pan se
  acumula hasta 3.
- **Metas** `skill_level` {skill, level}: aprender o mejorar en algo, desde el nivel al crearla
  (lo que ya se sabe no es una meta). Inés empieza con «Aprender a hacer buenas fotos con
  Valentina» (0,5).
- **Prompt**: plan, «LO QUE SABES HACER» (lo que se le da bien, con ids, y lo que está aprendiendo,
  en una línea); decisión, lo mismo como mucho cada 3 h, y «ENSEÑAR Y APRENDER» solo si hay algo
  (sesiones pendientes, quién de los presentes sabe claramente más, sus resultados).

## Enseñar, aprender y ayudar

Ver las acciones en [acciones](acciones.md#aprender-y-enseñar).

- **Sesiones**: se piden (`ask_to_learn`) o se ofrecen (`teach`); la otra parte acepta o rechaza
  en 30 minutos. Juntas 60 minutos (`sessionMinutes`): el alumno practica con maestro y el maestro
  practica «enseñar». Si se separan, acaba antes. Al acabar, afinidad y familiaridad para los dos
  (0,05), un recuerdo para cada uno y el drama «maestro y alumno».
- **Sin encadenar sesiones** (corrección 3.5; en la partida de una semana, Mateo y Hugo
  encadenaron 17 eventos de enseñanza de café y barra): la misma pareja y habilidad no tiene más
  de `SkillsConfig.maxSessionsPerPairDay` (2) sesiones al día. Pasado el tope no se ofrece (ni
  «Aquí sabe más que tú», ni `teach`, ni `ask_to_learn`) y, si el LLM lo pide, el motor lo
  rechaza con el motivo. Cada repetición del día deja afinidad y familiaridad ×
  `sessionRepeatDamping`^(n − 1) (0,5) y el evento lleva `meta.repeat`: su drama vale la mitad
  (la segunda ya no llega al mínimo). Las cuentas del día van en la instantánea del sistema.
- **Solo se ofrecen cuando tienen sentido** (cada acción ofrecida cuesta tokens): pedir si alguien
  de aquí sabe claramente más; enseñar si se le saca ventaja a alguien de aquí; ayudar si alguien
  practica algo; practicar con tiempo libre.
- **Menores** (`teachingRule`): sobre `minorMeetingRule` (sitio público, la escuela incluida, o su
  casa), en su casa solo si el adulto es de la familia o hay un adulto de la casa delante.

## Medidas

En 48 h de mock (`SIM_SEED=7`): unas 170 horas de práctica, 7 sesiones, algún resultado regalado; en
3 días casi nadie cambia de etiqueta (se aprende despacio a propósito). Con el LLM real hay que
medir si se piden y ofrecen sesiones con naturalidad o en exceso (ver PROGRESS-APRENDIZAJE.md).
