# Hoja de ruta

## Hecho

Antes de las fases: la base. Agentes con memoria humana (olvido, esencia, reconsolidación,
confusión de fuente, fichas sociales, rumores, presupuesto), psicología (Big Five, ánimo, sueño,
sesgos, memoria prospectiva), acciones validadas por el motor, conversaciones con ritmo, mundo
2D en el navegador y producción (multi-mundo, instantáneas, Docker). Después, por fases:

- **Fase 0 · Cimientos:** sistemas como módulos (`SimSystem`), puente de lo hablado a la acción,
  coste medido por tarea (Batch API, caché) y métricas de evolución (`study:analyze`).
- **Fase 1 · Mundo:** un pueblo inventado de Mallorca en 2002, con biblia del mundo, calendario,
  clima, lo que sabe cada vecino y registro de anacronismos.
- **Fase 2 · Metas:** meta vital, proyectos y pasos medidos por el motor, con motivación,
  frustración, abandono, conflictos entre metas y marcharse del pueblo.
- **Corrección 2.5** (de la partida E2): pasos que no se pierden, metas cualitativas comprobadas
  de noche, intenciones sin inflación y nadie inventa vecinos (`PersonGuard`).
- **Fase 3 · Aprendizaje:** habilidades que se practican, se enseñan y se oxidan; saberes que se
  cuentan, se deforman y se pierden; deriva lenta de la personalidad.
- **Corrección 3.5** (de la partida E3): efecto de espaciado en la memoria, metas vitales
  confirmadas, menos falsos positivos (apodos, familia), saberes que se deforman de verdad.
- **Fase 3.6 · Cognición en movimiento:** encuentros por el camino con saliencia calculada,
  saludar y pararse a charlar, asociaciones sin LLM, con interruptor para el mundo de control.
- **Repetición y modo cine:** cualquier partida grabada se ve en la web sin servidor ni coste,
  con momentos, arcos largos, escenas guardadas, pantalla partida y clips para redes.

Los estudios de cada etapa están en [Investigación](investigacion/README.md); cada fase, con su
rama y su fusión, en el [historial](historial.md).

## Siguiente

- **E4 · Partida de estudio con control.** Una semana con dos semillas y un mundo de control
  (sin olvido ni vaguedad, `MEMORY_ABLATION`; o sin la cognición de la 3.6, `SIM_COGNITION=off`)
  para poner a prueba la hipótesis, no solo observar. Lo que hay que mirar está en
  [pendiente de validar](#pendiente-de-validar-con-partida-real-e4).
- **Economía.** Euros, comprar y vender (`Item.value` ya existe), recursos limitados de verdad
  (el huerto produce tanto, el lago tiene peces finitos), oficios y deudas que se pueden saldar.
  Métricas: riqueza, desigualdad, oficios, quiebras.
- **Aprendizaje abierto.** Que un vecino proponga algo que no existía (una receta, un producto,
  una norma, una fiesta), el motor lo traduzca a piezas que sabe ejecutar y una institución del
  pueblo lo apruebe; si funciona, otros lo imitan. Cultura que nadie programó una a una.
- **Construcción.** Levantar, arreglar o cambiar lugares del pueblo con lo mismo: el vecino
  propone, el motor lo valida con las normas del mapa.
- **Mensajes a distancia.** Teléfonos fijos y cabinas, cartas: encajarían como un `leave_note`
  sin lugar (`send_message { to, text }` a un buzón que se lee en la siguiente decisión, con
  retraso y coste, y la misma regla de menores); falta decidir cuántos al día para que no
  sustituyan a hablar en persona.
- **Ciclo de vida.** Envejecer (un reloj de la vida aparte del del día), parejas solo entre
  adultos, nacimientos con herencia de personalidad y de historias familiares (que se deforman
  de generación en generación), muerte y legado, tratados con tacto. Con tope de población y
  revisando la protección de menores (y las metas aplazadas de los menores).
- **Evaluación comparativa** con varias semillas y al menos dos modelos reales, y evaluación
  humana ciega (ver [evaluación y coste](investigacion/README.md#evaluación-y-coste)).
- **Otros:** una conversación completa por llamada (charlas en lote, `CONVERSATION_BATCH`:
  diseñado, no implementado); colisión de muebles y animaciones con el Character Generator
  completo (al comprar Modern Interiors); OAuth; editor de mundos y agentes desde la web;
  traducción de los prompts (hoy se pide al modelo que responda en el idioma del mundo);
  detectar palabras de otro idioma al aprender de otros (haría falta un diccionario).

## Preguntas abiertas

- **¿El olvido hace las historias más variadas o solo más ruidosas?** Hace falta el mundo de
  control (sin olvido ni vaguedad) y una medida de divergencia entre semillas.
- **¿Los falsos recuerdos colectivos son de la memoria o del lenguaje?** La deuda de Hugo (E1) y
  «la Pepa» (E2) nacen de muletillas y chismes; ¿aparecen igual sin reconsolidación?
- **¿Cuánto converge un pueblo con un mismo modelo detrás de todos?** La deriva de personalidad
  de E3 fue igual para casi todos; ¿hace falta más diversidad (de modelos, de semillas)?
- **¿Medir es conseguir?** Las metas cualitativas se confirman de noche con lo que se dijo
  (0 de 14 y 2 de 9 en E3): ¿son demasiado exigentes o justas?
- **¿Qué parte de una historia es azar y qué parte diseño?** Lo que se repite en las dos semillas
  de E3 apunta al diseño; con más semillas se puede separar.
- **¿Se transmite la cultura?** Saberes que se cuentan y se deforman: ¿sobreviven a quien los
  sabía? ¿Cuántas generaciones?
- **¿Cuánto cuesta una vida?** Con 1,31 $ por mundo y día, un año de juego son unos 480 $: ¿qué
  se puede abaratar sin cambiar el comportamiento?

## Pendiente de validar con partida real (E4)

Lo que cada fase dejó por comprobar con el LLM real, sin duplicados y por tema (entre
paréntesis, la fase de la que sale; su detalle, en el [historial](historial.md)). Se mira en
`analysis.md` de `pnpm study:analyze`, la pestaña «Evolución» y la exportación `bd/*.jsonl`.

### Metas e intenciones

- La comprobación nocturna de lo cualitativo (`confirmed`): que no confirme demasiado fácil ni
  demasiado poco (0 de 14 y 2 de 9 metas vitales en E3); ninguna vital «conseguida» que se siga
  persiguiendo al día siguiente (auditoría `goal`, «sin confirmar: sus proyectos se cumplen…»).
  (2.5, 3.5)
- Abandonos y cambios de rumbo en una semana, pero no masivos (frustración 0,2): frustración
  media por agente; con 16 h casi seguro que ninguno. (1-2, 2.5)
- Que las metas avancen con sentido y la consolidación proponga proyectos medibles (`bd/goals.jsonl`;
  descartadas en `bd/memory_audit.jsonl`, `action: "goal"`, con el motivo). (1-2)
- Cuántas intenciones se fusionan, se descartan por el tope y caducan (sistema `intentions`).
  (2.5)

### Memoria

- Estabilidades sin acumulación en el tope (`memories.stability`: cuántas en 87.600 h). (3.5)

### Personas, menores y mundo

- `PersonGuard`: que la regla del prompt baste (≤ 2 repeticiones de `decide` por semana,
  `person.retried` en «Evolución»), pocos falsos positivos con los nombres de pila y que las
  personas inventadas de verdad se sigan detectando (`knowledge_log` tipo `person`). (2.5, 3.5)
- Alma como amiga de Aurora y abuela de Valentina, y los nombres de los familiares. (2.5)
- Menores: 0 falsos positivos en familia, ningún contenido inapropiado y «error de moderación»
  solo si fallaron también las repeticiones (`moderation_log`, `minor_safety:*`: leer cada
  bloqueo y cada texto permitido en familia). (0, 3.5)
- Anacronismos: casi cero; las referencias externas, revisarlas a mano (falsos positivos →
  `commonReferences` o el glosario; incoherencias de verdad → valorar el modo `enforce`). (1-2)

### Aprendizaje y personalidad

- Que las sesiones de enseñanza y las ayudas salgan con naturalidad, no en cada charla (el
  modelo puede abusar aunque solo se ofrezcan cuando tienen sentido). (3)
- El ritmo de aprendizaje (35 h de 0 a 0,5) y de olvido (un cuarto en un mes): si alguien cambia
  de etiqueta en una semana (Inés en fotografía con Valentina; Ernesto en cuidados con Samuel) y
  cuántas habilidades se oxidan. (3)
- Habilidades sin bajadas simultáneas por umbral y cada oficio, la mejor habilidad de cada uno
  (auditoría `skill` a las 00:00). (3.5)
- Lo que se hace (pan, verduras) se acumula sin economía: si comer de lo que se lleva tiene
  sentido con el LLM real e inventarios acotados (métricas `eaten` y `carriedMax`). (3, 3.5)
- Saberes: ≤ 2 repeticiones por pareja y saber, 10–20 % de transmisiones deformadas, si las
  variantes bastan o hace falta más variedad y si alguno se pierde en 7 días (con 5 de gracia y
  0,012 al día, solo lo que nadie usa). (3, 3.5)
- Si sale con el LLM real que Valentina aprenda de Aurora «La canción de las segadoras», que
  viene de Alma, su abuela (en el mock sí: es la historia que sugerían las semillas). (3)
- La deriva de la personalidad: como mucho 0,02 por rasgo la primera semana, con su motivo, y
  con varianza entre vecinos y signos distintos (auditoría `personality` del día 7). (3, 3.5)
- El perfil de memoria y el ánimo base no siguen a la deriva de la personalidad. (3)

### Conversación

- Si las fichas que suben más despacio dejan menos conversaciones también con el LLM real (en el
  mock, 524 → 384 respuestas en 48 h). (2.5)
- Cómo acaban las charlas (cuántas por «ya no aportaba nada» o «se estaban repitiendo» frente a
  «máximo absoluto») y si bajan las muletillas repetidas. (0)
- El puente de lo hablado: «… acordadas hablando» en Acciones, los eventos 🗣 y los descartes con
  su motivo (`agreement_discarded`). (0)

### Cognición en movimiento (3.6)

- La latencia real frente a `decisionLeadMinutes` (1,5): cuántas decisiones andando llegan tarde
  (`lateDiscarded`) y cuántas se hacen al cruzarse.
- El umbral de saliencia (0,5) y el tope (2 decisiones por hora): ¿piensa lo bastante por el
  camino o demasiado? ¿Los saludos al pasar son cortos y naturales?
- Cuánto duran las paradas a charlar y si alguien llega tarde a sus citas o a trabajar por ellas
  (el viaje se retoma, pero la charla no tiene tope propio).
- Si las asociaciones (≈ 2 por agente y día en mock, casi todas al ver a alguien) cambian las
  decisiones o son ruido; si las de lugares y objetos son pocas.
- El coste real: en mock +5 % ± 5 % de llamadas; con el LLM, las charlas del camino cuestan
  `social` e `importance` como cualquier otra.
- El efecto frente al mundo de control (`study:analyze s7 s7c`): parejas nuevas en el camino,
  intenciones cumplidas al cruzarse, reencuentros.
- Quien está quieto no piensa por ver pasar a alguien (decisión de coste): ¿se echa de menos que
  quien está en la terraza llame a quien pasa?

### Coste y estudio

- Ahorro y caché con el LLM real: `summarize` con Haiku y pocas llamadas; consolidación y crónica
  a mitad de precio por lote; el prefijo común del prompt fijo leído de caché en `decide` y `plan`
  (≥ 1.500 tokens por llamada desde la segunda, también entre agentes; `latency:probe 10 10`
  escribe una línea «caché …» por tarea) en las dos semillas. (0, 3.5)
- Coste por día frente a E3 (en el mock, ≈ +6 % con el aprendizaje), con plan y consolidación por
  llamada (`llm_calls`). (1-2, 3)
- El mundo de control en ablación (`ABLATION=on`), si se lanza. (3.5)

### Repetición

Límites conocidos, para tenerlos en cuenta al grabar:

- El paquete de 7 días ocupa ~33 MB en memoria del navegador (carga en ~1,5 s en escritorio); en
  móviles modestos, mejor recortar con `--from/--to`.
- Sin `record --track`, la ruta entre dos fotos es la del pathfinding del juego, llegando a la
  hora de la foto siguiente: puede no coincidir con la que hizo (las fotos son cada 10 min).
- La fuerza de un recuerdo antes de su última evocación es la de ese momento (la BD no guarda la
  historia de la fuerza).
- Los dramas de escuchar a escondidas siguen siendo los primeros por puntuación; la lista del
  reproductor se puede filtrar por tipo.
- En mock, los recuerdos «que cambian» son triviales (la reconsolidación del mock añade una
  coletilla); con una partida real son los interesantes.

### Pendiente del autor

- Falta `LICENSE`: lo decide el autor.
- `<CONTACTO>` en [CONTRIBUTING.md](../CONTRIBUTING.md#apoyar-el-proyecto).
- `.github/FUNDING.yml`: las cuentas reales, y descomentar.
- Activar **Discussions** en GitHub (lo enlaza `.github/ISSUE_TEMPLATE/config.yml`) y crear las
  etiquetas `experimento`, `resultado`, `idea` y `error` (las plantillas las ponen si existen).
