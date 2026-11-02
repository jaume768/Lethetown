# Personas: ni vecinos ni conocidos inventados

En la segunda partida de estudio, Ernesto le dijo a Rafael «me lo ha dicho la Pepa». En el
pueblo no vive ninguna Pepa, pero desde entonces los dos la trataron como a una vecina más: una
intención («preguntar a la Pepa…»), 23 recuerdos y lo que cada uno «aprendió» del otro. No es
realista: en un pueblo pequeño todo el mundo sabe quién vive y quién no.

## Quién existe

- **Los vecinos** (las 20 semillas).
- **La gente de fuera que justifican las semillas** (`offstagePeople` en cada semilla: nombre,
  relación, dónde está y si vive): el padre de Mateo (Bartomeu), la mujer de Julián (Francisca),
  Alma (la amiga de juventud de Aurora y abuela de Valentina), la hija de Aurora (Joana), el
  padre de Leo (Toni), la editora de Lucía (Montse), la familia de Samuel en Lagos y la abuela
  de Pilar. Va al prompt fijo de cada uno («Gente de fuera del pueblo que conoces: …»).
- **Lo que le contaron**: quien oye a alguien nombrar a su gente de fuera la conoce desde ese
  momento (Samuel, tras oír a Aurora hablar de Alma). Va en la instantánea del sistema
  `knowledge`.
- **Personajes públicos de 1996** (`personGuard.publicFigures` en la biblia, ampliable), más las
  referencias comunes y culturales y los lugares del glosario.

## Decisiones

- **Regla en el prompt fijo** (igual para todos: cacheable): solo conoces y nombras a gente que
  existe; para un rumor de origen incierto, «dicen por ahí», «me lo contó alguien» o un vecino
  de verdad; nunca inventes vecinos, familiares ni conocidos.
- **`PersonGuard`** (`agent-core/src/world/person-guard.ts`), como `MinorGuard`, sin LLM y por
  palabras (lineal). Es una persona:
  - un nombre de pila de la lista (`world/given-names.ts`: castellanos, catalanes y mallorquines,
    con diminutivos; `personGuard.extraGivenNames` para ampliarla). Al empezar una frase, solo
    si no es también una palabra corriente («Rosa de los vientos», «Alma de cántaro»);
  - la palabra en mayúscula tras un parentesco con posesivo («mi primo Biel»), un tratamiento
    («don Ramón») o el artículo personal mallorquín ante un nombre de pila («na Margalida»);
  - «la X» / «el X» con X en mayúscula que no es nada conocido: **solo se registra** (podría ser
    un sitio: «la Seu»).
  - Los nombres de varias palabras que existen cuentan enteros («Lola Flores» no hace que exista
    cualquier «Lola»; «Felipe González», sí). Los apellidos del pueblo también existen.
- **Se engancha a `MinorGuard` como reescritor** (`addRewriter`; `rewrite`, `vet`): ve los
  mismos textos que la protección de menores. La reescritura es síncrona en todos los sitios
  (sin un `await` más que cambie el orden del mock y el test dorado).
- **Qué se hace** (modo `enforce`, `personGuard.mode` en la biblia; `log` solo registra):

  | Dónde                                                              | Qué                                                         |
  | ------------------------------------------------------------------ | ----------------------------------------------------------- |
  | Decisión (frase, nota, acción, motivo)                             | Se repite UNA vez con «X no existe…»; si vuelve, «alguien». |
  | Recuerdos, reflexiones, reconsolidación, fichas, esencias, crónica | El nombre pasa a «alguien» (con mayúscula si abre frase).   |
  | Intención                                                          | Se descarta entera.                                         |
  | Meta propuesta, acuerdo hablado                                    | «alguien» en el texto.                                      |
  | Aprender de otros                                                  | Nunca aprende una persona inventada.                        |

- **Registro**: en `knowledge_log` con el tipo `person` (qué se hizo: reintento, cambiada,
  descartada o solo registrada). «Evolución» y `study:analyze` lo dan por día, por agente y con
  ejemplos; las métricas del sistema `knowledge`, `person.retried`, `person.replaced` y
  `person.dropped`.

## A revisar con una partida real

- Que la regla del prompt baste para que casi no haga falta reintentar (cada reintento es una
  llamada `decide` más).
- Falsos positivos de la lista de nombres de pila (un nombre de pila que es apodo de un vecino,
  una marca): se arreglan ampliando `publicFigures` o `commonReferences`, o con el apodo en la
  semilla.
- Alma es a la vez la amiga de Aurora y la abuela de Valentina: las semillas lo sugerían
  («nadie parece recordarla», «se marchó y nunca volvió», las cartas de Madrid). Es una decisión
  de historia, no técnica.
