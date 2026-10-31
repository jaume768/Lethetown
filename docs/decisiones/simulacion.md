# Simulación

- **Tiempo en minutos de juego** desde el día 0; nada de `Date` en la lógica de agentes.
- **Rutinas sin LLM** (dormir, desplazarse, seguir el plan sin novedades). El LLM solo decide si
  hay algo saliente (percepciones).
- **Conversaciones** con id propio, que es el `eventId` de los recuerdos (vista Rashomon); las
  frases tienen id `<conversación>:<turno>`. Terminan cuando quien recibe una frase no contesta,
  por inactividad, si se repiten o, pasados 12 turnos, si ya no aportan (máximo absoluto 30; ver
  [ritmo](ritmo.md)); al terminar se actualiza la ficha social.
- **Escuchar a escondidas**: un fragmento contiguo (60 %), reconociendo o no a quien habla; se
  guarda con el mismo `eventId`.
- **Mantenimiento** de memoria cada hora de juego por agente; **consolidación** en el primer tick
  dormido; **crónica** a las 23:00. `lastConsolidation = now + 1` para que lo creado al consolidar
  no vuelva a entrar la noche siguiente.
- **Módulos que comparten `SimContext`** (percepción, conversaciones, rutinas, memoria,
  intervención); `simulation.ts` solo orquesta. **`Agent` es una fachada** sobre módulos
  (`agent-body`, `agent-planning`, `agent-perception`, `agent-decision`, `agent-intentions`,
  `agent-social`) que reciben el agente; sus métodos devuelven la promesa sin `async` para no
  añadir ticks de microtareas (el orden de los eventos depende de ello).
- **Instantáneas** síncronas cada hora de juego y al apagar (la escritura va en segundo plano).
  Todo estado del runtime o del agente va en `SimSnapshot`; si cambia su forma se sube
  `SIM_SNAPSHOT_VERSION` y las antiguas se ignoran (arranque limpio del runtime). El estado de
  cada sistema va en `SimSnapshot.systems` con su propia versión (ver [sistemas](sistemas.md)). El estado
  interno del agente que no viaja al cliente va en `AgentMind`.
- **Test dorado** (`sim/golden.test.ts`): 3 días en mock con `SIM_SEED=7`. Un refactor no lo
  cambia; un cambio de comportamiento lo regenera a propósito y lo dice en el commit. Ojo con
  añadir `await`: reordenan las tareas asíncronas del mock.
- **Azar** siempre por el `Rng` inyectado (`seededRng`), nunca `Math.random()`.
- **Modo demostración** (`SIM_DEMO`): lluvia, averías e ideas de la voz interior para ver
  reaccionar a los agentes sin director.
- **Conversaciones de dos o más** (grupos de hasta 5): unirse es hablarle a quien conversa;
  marcharse, no contestar. Las fichas sociales se revisan con las 2 personas con quienes más se
  habló. Ver [acciones.md](acciones.md).
- **Revisiones periódicas sin LLM** cada 5 min de juego, una por sistema y en su orden de
  registro: citas, préstamos vencidos, objetos que vuelven a su estado, acompañar e invitaciones,
  notas caducadas y normas (abrir y cerrar, intrusos, menores). Ver [sistemas](sistemas.md). Las llegadas programadas solo se ejecutan si siguen vigentes.
