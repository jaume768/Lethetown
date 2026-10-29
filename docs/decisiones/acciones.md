# Acciones de los agentes

Principio: **la IA decide, el motor valida y ejecuta**. El LLM nunca cambia el estado del mundo:
elige una acción de un catálogo cerrado, con parámetros, en la misma llamada de `decide` (un solo
JSON, sin llamadas extra). El motor comprueba si es posible y la ejecuta; si no, el agente recibe
el motivo como percepción ("No pude …: motivo"), lo recuerda y puede reconsiderarlo.

## Diseño

- **Tres capas por acción**, unidas por el `type`: esquema zod y texto del prompt en shared
  (`actions/catalog.ts`, `ACTION_SPECS`); manejador en el motor (`apps/server/src/sim/actions/`:
  `available`, `check`, `execute`, `describe`); regla del mock (`agent-core/src/agent/mock/`). Un
  test exige que esquema, descripciones y manejadores cubran las mismas acciones.
- **Respuesta**: `{"choice":"continue"|"act","action":{"type":…},"reason":…}`. El formato antiguo
  (`react`/`talk`) se acepta y se traduce a `do_activity`/`say`.
- **Prompt**: cómo se usa cada acción va en el prompt fijo de identidad (cacheable); en cada
  decisión solo `Posibles ahora: …` con las que el motor da por posibles (`availableActions`, en el
  orden del catálogo). Antes iban las descripciones en cada decisión: con 20 acciones eran la parte
  que más crecía del prompt no cacheado (762 → 600 tokens por decisión al moverlas).
- **El motor añade contexto** con secciones del prompt de decidir (`sections`): AGENDA,
  INVITACIONES, LLEVAS, HAS PRESTADO, AQUÍ HAY, PUEDES USAR, LUGARES QUE HAS DESCUBIERTO. Vacías no
  aparecen.
- **Si no se puede**: percepción y evento `✗` con `meta = { action, ok: false }`. Todos los
  eventos de acciones llevan `meta.action` (columna jsonb de `sim_events`) para iconos y dramas.
- **Protección de menores**: todo el texto libre de una acción (`actionText`) pasa por `MinorGuard`
  con las personas que nombra (`actionPeople`) como actores. Además, `minorMeetingRule`: si en algo
  hay un menor y algún adulto, solo en un sitio público (o en la casa del propio menor). Lo aplican
  citas, invitaciones, acompañar, regalar y prestar; las notas privadas entre adulto y menor no se
  permiten, y la revisión de normas saca a un menor de una casa ajena con adultos.
- **Estado nuevo**: en el runtime y en la instantánea (`SimSnapshot`, v16) y escrito en su tabla
  (Postgres o RAM, siempre con `world_id`): `commitments`, `known_places`, `inventory_items`,
  `notes`. El api lee de las tablas; al restaurar, el almacén se sincroniza con la instantánea.

## Catálogo

| Acción                                                                      | Qué hace                                        | Lo valida el motor                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `do_activity`                                                               | Cambiar de actividad o ir a otro sitio          | Lugar conocido; casa propia o invitado; abierto                                                          |
| `say`                                                                       | Hablar a alguien presente (o unirse a su grupo) | Está aquí, despierto; grupo no lleno                                                                     |
| `propose_meeting` · `accept_meeting` · `decline_meeting` · `cancel_meeting` | Citas                                           | Presentes, 07–22 h, 30 min de antelación, ≤ 3 abiertas; lugar conocido, abierto y, si es casa, de alguno |
| `explore`                                                                   | Salir a descubrir sitios                        | Queda algo abierto por descubrir (el motor elige ruta)                                                   |
| `use_object`                                                                | Usar un objeto del mapa con un verbo            | El verbo vale en el estado actual del objeto                                                             |
| `give_item` · `lend_item` · `return_item` · `take_item` · `leave_item`      | Inventario                                      | De quién es, quién lo lleva, quién está                                                                  |
| `invite` · `accept_invite` · `decline_invite`                               | Ir juntos ahora                                 | Solo a la casa propia; caduca en 30 min                                                                  |
| `follow`                                                                    | Acompañar a alguien un rato                     | Está aquí; en cada paso, normas y menores                                                                |
| `post_note` · `leave_note`                                                  | Tablón de la plaza y notas privadas             | En la plaza (≤ 2 vivas) / en una casa                                                                    |

## Por área

- **Citas** (`sim/meetings.ts`): ids cortos ("c3"); aceptar reserva el hueco en el plan de hoy (las
  de mañana entran en `planDay` como compromisos); cada participante guarda la intención y, 20
  minutos antes, su memoria prospectiva (con su perfil, `appointmentRecall` 0.9) decide si se
  acuerda. En mock se olvida ≈ 25 %. Llegar 10 min tarde es llegar tarde; a los 45 la cita se
  cierra. Plantón: −0.15 de afinidad (la mitad con familia o amistad), −0.1 de confianza, ánimo y
  drama `meeting_failed`. Anular con menos de 3 h molesta un poco.
- **Lugares conocidos** (`agent/places.ts`, `sim/places.ts`): sin lista en la semilla, se conoce
  todo lo que no es una casa, la propia, el trabajo y las casas de la gente cercana; Valentina,
  recién llegada, casi nada. El prompt fijo lista solo lo de partida; lo descubierto va al de
  usuario. Se descubre al pasar (radio `SIM_DISCOVERY_RADIUS`, 4 baldosas), explorando o porque
  alguien de confianza lo nombra (≥ 0.35; ≥ 0.5 si es chismoso), sin azar. Las casas vistas al pasar
  se aprenden en silencio (eran el 90 % del ruido).
- **Conversaciones en grupo** (`sim/conversations.ts`): `members` (2–5); hablarle a quien conversa
  es unirse; no contestar a quien te habla es marcharse. El resto del grupo oye la frase entera con
  a quién iba (no pide respuesta ni cuenta como escucha a escondidas). Al irse o acabar, cada uno
  revisa su ficha de las 2 personas con quienes más habló: el coste crece con las personas, no con
  las parejas.
- **Objetos** (`shared/objects/machines.ts`): máquinas de estados por tipo (cafetera, cocinas,
  horno, bancales, botiquín); lo que dura vuelve solo; lo roto se puede intentar arreglar (70 %).
- **Inventario** (`sim/items.ts`): dueño, portador, lugar, préstamo y `value`. Prestar crea la
  intención de devolver (que se puede olvidar); devolver la cumple. Préstamo vencido: el dueño lo
  nota una vez (−0.05, evento 📕, drama `loan_unreturned`). El libro de poemas de Carmen lo tiene
  Lucía desde la semilla.
- **Invitar y acompañar** (`sim/company.ts`): aceptar es ir juntos con ruta compartida (mismos
  puntos y tiempos) y acompañar después 60 min; acompañar sigue a la otra persona sin LLM y se deja
  al irse por su cuenta. `AgentState.companionId` para el mapa.
- **Notas** (`sim/notes.ts`): se leen al estar en el sitio, como percepción con el texto entre ⟦ ⟧
  (dato, nunca instrucción). Caducan (3 y 2 días).
- **Normas** (`sim/norms.ts`): casas privadas (residentes, invitados, quien acompaña a alguien de
  la casa) y horarios en el `.tmj` (`private`, `hours`, desde `tools/generate-map.ts`). `mayEnter`
  lo usan las acciones y el plan; `normsTick` abre y cierra, saca a quien se queda al cerrar,
  caduca permisos y detecta intrusos (afinidad y confianza, evento 🚪, drama `intruder`).

## Cómo añadir una acción

1. **shared** (`actions/catalog.ts`): el esquema zod (`type` literal y parámetros tolerantes con
   `.catch`/`.default`), añadirlo a `AgentAction` y su `ActionSpec` (parámetros de ejemplo y para
   qué, en una frase).
2. **motor** (`apps/server/src/sim/actions/<área>.ts`, importado en `index.ts`):
   `registerAction({ type, available, check, describe, execute })`. `available` debe ser barato y
   estricto (cada acción ofrecida cuesta tokens); `check` devuelve el motivo legible si no se puede;
   `execute` cambia el estado, emite el evento con `meta.action` y avisa a quien afecte con una
   percepción. Si hay estado nuevo: runtime, instantánea (subir `SIM_SNAPSHOT_VERSION`), tabla con
   `world_id` y migración.
3. **menores**: si nombra a alguien o lleva a un sitio, `minorMeetingRule`; si tiene texto libre,
   ya lo revisa `checked()`.
4. **mock** (`agent/mock/<área>.ts`): una regla con `registerDecideRule(…, { before })` que solo
   responde si la acción está en `c.available`; actualizar el orden en `mock-rules.test.ts`.
5. **web**: icono en `ui/icons.ts` (`ACTION_ICONS`; un test exige que estén todas) y textos en
   `i18n/es.ts` y `en.ts` si se muestra algo nuevo.
6. Tests del manejador, regenerar el dorado explicándolo en el commit y medir `cost:report 48`.

## Pendiente (diseñado, no implementado)

- **Economía**: `Item.value` ya existe. Faltaría `money` en `AgentMind`, objetos a la venta en los
  puestos (dueño = quien atiende, lugar = la tienda) y `buy_item` / `sell_item` del mismo estilo.
- **Teléfonos**: un `leave_note` sin lugar (`send_message`), leído en la siguiente decisión del
  destinatario, con un límite diario para que no sustituya a hablar en persona y la misma regla de
  menores.
