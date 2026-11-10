# Hoja de ruta

[English](ROADMAP.en.md)

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

Los estudios de cada etapa están en [Investigación](docs/investigacion/README.md).

## Siguiente

- **E4 · Partida de estudio con control.** Una semana con dos semillas y un mundo de control
  (sin olvido ni vaguedad, `MEMORY_ABLATION`; o sin la cognición de la 3.6, `SIM_COGNITION=off`)
  para poner a prueba la hipótesis, no solo observar. Lo que hay que mirar está en
  [PROGRESS-CORRECCION-3-5.md](PROGRESS-CORRECCION-3-5.md#a-revisar-en-la-partida-real-e4).
- **Economía.** Euros, comprar y vender (`Item.value` ya existe), recursos limitados de verdad
  (el huerto produce tanto, el lago tiene peces finitos), oficios y deudas que se pueden saldar.
  Métricas: riqueza, desigualdad, oficios, quiebras.
- **Aprendizaje abierto.** Que un vecino proponga algo que no existía (una receta, un producto,
  una norma, una fiesta), el motor lo traduzca a piezas que sabe ejecutar y una institución del
  pueblo lo apruebe; si funciona, otros lo imitan. Cultura que nadie programó una a una.
- **Construcción.** Levantar, arreglar o cambiar lugares del pueblo con lo mismo: el vecino
  propone, el motor lo valida con las normas del mapa.
- **Ciclo de vida.** Envejecer (un reloj de la vida aparte del del día), parejas solo entre
  adultos, nacimientos con herencia de personalidad y de historias familiares (que se deforman
  de generación en generación), muerte y legado, tratados con tacto. Con tope de población y
  revisando la protección de menores.

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
