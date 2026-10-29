# Acciones de los agentes

Principio: **la IA decide, el motor valida y ejecuta**. El LLM nunca cambia estado: elige una
acción de un catálogo cerrado con parámetros que el motor comprueba; si no es posible, el agente
recibe el motivo como percepción y lo recuerda.

- **Tres capas por acción**, unidas por el `type`: esquema y texto del prompt en shared
  (`actions/catalog.ts`), manejador en el motor (`sim/actions/`: disponibilidad, precondiciones,
  ejecución, efectos) y regla del mock (`agent/mock/`). Un test exige que coincidan.
- **La respuesta de `decide`** es `{"choice":"continue"|"act","action":{"type":…},"reason":…}` en la
  misma llamada (sin llamadas extra). El formato antiguo (`react`/`talk`) se acepta y se traduce.
- **Solo se ofrecen las acciones posibles** en ese momento (ahorra tokens y errores).
- **Si no se puede**: percepción "No pude …: motivo" y evento con `meta.ok = false`.
- **Citas** (`propose_meeting`, `accept_meeting`, `decline_meeting`, `cancel_meeting`): en el
  runtime y en `commitments`; hueco en el plan; la memoria prospectiva de cada uno (con su perfil)
  decide si se acuerda de ir; plantones y tardanzas afectan a la afinidad, la confianza y el ánimo.
  Con un menor y algún adulto, solo en sitios públicos (o en la casa del menor).
