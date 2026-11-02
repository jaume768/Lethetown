# Corrección 2.5 (a partir de la segunda partida de estudio)

Rama `fix/correccion-2-5`. Fuente: `estudio/partida-3dias-mundo-metas/estudio2.md` (los datos de
esa partida no están en esta máquina: solo el informe; lo del registro se prueba con sus ejemplos).
Léelo al retomar: lo hecho, lo que falta y las decisiones.

## Checklist

- [x] 1. Metas que puedan avanzar (pasos huérfanos, siguiente proyecto, relación más exigente,
      rendimientos decrecientes)
- [x] 2. «Conseguir» no es «contar» (palabras clave del tema, criterio comprobado en la noche)
- [x] 3. Frustración y abandonos
- [x] 4. Inflación de intenciones
- [x] 5. Ni vecinos ni personas inventados (`offstagePeople`, `PersonGuard`)
- [x] 6. Ruido del registro de conocimiento y de la protección de menores
- [x] 7. Coste (Batch por defecto, `.env.study.example`)
- [x] Final: README, CLAUDE.md, decisiones, coste antes/después, PR

## Coste (`cost:report 48`, mock, `SIM_SEED=7`)

| Tarea         | Antes (`0f711e7`) |   Después | Notas                                                    |
| ------------- | ----------------: | --------: | -------------------------------------------------------- |
| decide        |             1.464 |     1.242 | menos charlas en el mock (fichas que suben más despacio) |
| importance    |               910 |       827 |                                                          |
| social        |               680 |       585 | una ficha por charla acabada                             |
| gist          |               460 |       380 |                                                          |
| reconsolidate |               446 |       383 |                                                          |
| summarize     |                89 |        26 |                                                          |
| plan          |                40 |        40 | igual (prompt fijo algo más largo: gente de fuera)       |
| consolidate   |                40 |        40 | igual: la comprobación de metas va en la misma llamada   |
| chronicle     |                 2 |         2 |                                                          |
| **total**     |         **4.131** | **3.525** | ≈ 0,788 $ → ≈ 0,742 $ (precios de Haiku y Sonnet 5.5)    |

- Respuestas en conversación: 524 → 384; espera media 1,4 → 1,9 min de juego (p90 1,0 en los
  dos casos: la media la suben unas pocas esperas largas).
- Metas en 48 h: 9 conseguidas → 3 (con tema, el mock no cumple proyectos con cualquier charla);
  progreso medio 0,33 → 0,22; frustración media 0,04 → 0,09; abandonos, 0 (hace falta más de 2
  días). En el dorado (3 días): 16 → 11 conseguidas.
- Intenciones al final (48 h): 65 abiertas (3,3 por agente, 7 como mucho), 33 cumplidas, 4
  olvidadas; ninguna fusionada ni descartada por el tope en el mock (en la partida real se
  proponían 199 al día: ahí se verá).
- Personas inventadas en mock: 0 (el mock no inventa a nadie). Ninguna tarea nueva: el
  `PersonGuard` solo añade una llamada `decide` cuando hay que repetir.

## Decisiones

- **Pasos huérfanos** (`placeProposal` en `sim/goals.ts`): encaje por la misma persona o lugar en
  el criterio del proyecto o de sus pasos (+2), la persona del paso nombrada en el proyecto (+2) y
  cada palabra con contenido en común (+1). Colgado de la vital → proyecto, siempre.
- **Siguiente proyecto**: el aviso sale si se cumplió un proyecto en el último día o si la vital no
  tiene proyectos activos (`nextProjectNudge`). Sin llamadas nuevas.
- **Relación**: +0,3 y 3 conversaciones (`GoalsConfig.relationshipMinGain`/`MinConversations`);
  las conversaciones las cuenta el motor en la meta (`measured`).
- **Rendimientos decrecientes** (`SocialConfig.affinityGainDamping` 0,9, `familiarity…` 0,6,
  `gainFloor` 0,1): de 0 a 0,8 a +0,08 por charla, de 10 a ~18 charlas.
- **`confirmed`** envuelve un criterio medible: candidata al 0,95; las frases (12 como mucho) se
  guardan en el estado del sistema (instantánea goals v2), no en la tabla. Solo se presenta con
  frases nuevas (o si su medida no es de charlas). El mock confirma con 3 frases o más.
  A revisar: si con el LLM real confirma demasiado fácil.
- **Frustración** 0,2 al día: un proyecto parado una semana se abandona con un 53 % de media
  (32–81 %); con avances cada dos días, < 5 %.
- **Intenciones**: importancia por reglas (hora 7, persona/lugar 6, nada 4; citas 8, préstamos 7);
  tope 8 con la menos importante fuera; fusión con la misma persona o lugar y ≥ 0,5 de palabras
  en común (sobre el texto más largo); las de importancia ≤ 4 caducan a los 2 días sin pista.
- **PersonGuard**: se engancha a MinorGuard como reescritor y todo es síncrono (sin `await` de
  más: el dorado no cambió). «la X» sin nombre de pila solo se registra (podría ser un sitio).
  A revisar: **Alma** es a la vez la amiga de Aurora y la abuela de Valentina (las semillas lo
  sugerían: «nadie parece recordarla», «se marchó y nunca volvió», cartas de Madrid); nombres
  dados a los familiares sin nombre (Bartomeu, Francisca, Joana, Toni, Montse, Ngozi, Chidi,
  Catalina).
- **Registro de conocimiento**: en las listas (plan y textos que recuerdan o resumen) la coma
  abre elemento; los ids del principio de lo que revisa una decisión se saltan. Referencias
  culturales de 1996 con año y fuente (`culturalReferences`, aparte de `commonReferences` para no
  cambiar su forma). Sin los datos de la partida 2 en esta máquina: tests con los ejemplos del
  informe.
- **Menores**: «acostarse», «atracción», «desnudo» y «amante» a la moderación; «me atrae» y
  «acostarse con» siguen en la lista fuerte (con un menor, casi siempre romántico).
- **Batch**: ya estaba activa por defecto (`LLM_BATCH=on` en `config.ts` y `.env.example`); el
  `.env` de esta máquina no la apaga. Documentado que solo se usa a ≤ x10.

## A revisar con una partida real

1. Que la regla del prompt baste y el `PersonGuard` casi no tenga que repetir decisiones (cada
   reintento es una llamada `decide` más), y los falsos positivos de la lista de nombres de pila.
2. Si la comprobación nocturna (`confirmed`) confirma demasiado fácil o demasiado poco.
3. Que haya abandonos y cambios de rumbo en una semana, pero no masivos (frustración 0,2).
4. Cuántas intenciones se fusionan, se descartan por el tope y caducan (sistema `intentions`).
5. Si las fichas que suben más despacio dejan menos conversaciones también con el LLM real (en
   el mock, 524 → 384 respuestas en 48 h).
6. Alma como amiga de Aurora y abuela de Valentina; los nombres de los familiares.

Para eso: `.env.study.example` (7 días, dos semillas).
