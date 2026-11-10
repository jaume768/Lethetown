# Colabora

[English](CONTRIBUTING.md)

Lethetown es un pueblo de 20 vecinos movidos por un LLM con una memoria que olvida, se reescribe
y se equivoca como la humana, y un banco de pruebas para estudiarla: cada olvido, cada recuerdo
que cambia y cada meta queda auditado con su motivo. Lo que se ha visto hasta ahora está en
[Investigación](docs/investigacion/README.md); lo que viene, en la [hoja de ruta](ROADMAP.md).

Hay cuatro formas de ayudar: **proponer un experimento**, **ejecutar pruebas**, **contribuir
código** y **apoyar el proyecto**. Para empezar, hay una lista de
[primeras tareas](docs/primeros-issues.md).

## Proponer un experimento

Abre un issue con la plantilla «Propuesta de experimento». Lo que hace falta:

1. **Hipótesis**: qué esperas que pase y por qué (una frase que se pueda refutar).
2. **Qué se cambia**, y solo eso:
   - la **semilla** (`SIM_SEED`, o los personajes de `seeds/agents.json`);
   - un **interruptor** que ya existe: `MEMORY_ABLATION=noForgetting,noVagueness` (sin olvido
     ni vaguedad), `SIM_COGNITION=off` (sin la cognición en movimiento de la fase 3.6);
   - un **parámetro** de `MemoryConfig` (umbrales de olvido y vaguedad, decaimiento,
     reconsolidación, confusión de fuente…), de `GoalsConfig`, `SkillsConfig` o `LoreConfig`,
     todos en `packages/agent-core` con su valor por defecto y sus unidades. Los de memoria se
     cambian en `config/memory.json` (si existe, el servidor lo lee al arrancar: un servidor por
     mundo, como en `scripts/estudio-semana.sh`).
3. **Qué se mide**: métricas de `pnpm study:analyze` (coste, espera, frases, red social y Gini,
   intenciones cumplidas o pasadas, metas conseguidas o abandonadas, reconsolidaciones, olvidos,
   archivados, borrados, anacronismos, saberes transmitidos y deformados…) o un recuento sobre la
   exportación de la base de datos (`bd/*.jsonl`).
4. **Mundo de control**: la misma semilla sin el cambio, a la vez (`scripts/estudio-semana.sh`
   lanza varios mundos en paralelo; súmales el coste, porque comparten caché).
5. **Duración**: 3 días de juego bastan para la memoria y la conversación; los abandonos de metas
   y la deriva de la personalidad necesitan una semana.

### Ejemplo completo: ¿el olvido hace las historias más variadas?

- **Hipótesis.** Con olvido y vaguedad, la misma semilla diverge más entre dos partidas que sin
  ellos, porque lo olvidado y lo rellenado cambia lo que cada vecino hace después.
- **Qué se cambia.** Tres mundos a la vez, desfasados 30 min para no repartirse la caché: `s7`
  y `s13` (normales) y `s7a`, la semilla 7 con `MEMORY_ABLATION=noForgetting,noVagueness`:

  ```bash
  STUDY_DIR=estudio/olvido ABLATION=on OFFSET_MINUTES=30 scripts/estudio-semana.sh prepare
  STUDY_DIR=estudio/olvido ABLATION=on OFFSET_MINUTES=30 scripts/estudio-semana.sh start
  STUDY_DIR=estudio/olvido ABLATION=on scripts/estudio-semana.sh record
  # … al acabar:
  STUDY_DIR=estudio/olvido ABLATION=on scripts/estudio-semana.sh export
  pnpm study:analyze estudio/olvido/s7 estudio/olvido/s7a
  ```

- **Qué se mide.** Entre `s7` y `s7a`: frases por día, parejas que hablan y Gini, intenciones
  cumplidas, metas conseguidas y abandonadas, coste; y en la auditoría
  (`bd/memory_audit.jsonl`), los falsos recuerdos (`false_memory`) y las confusiones de fuente
  (`source_changed`), que en `s7a` deberían bajar. Y la divergencia: de `pnpm replay:moments s7 s13` frente a
  `s7a`, cuántas intenciones o metas de la semilla acaban distinto (sección «Las dos semillas»).
- **Control.** `s7a` es el control de `s7`; `s13` dice cuánto cambia solo por el azar.
- **Duración y coste.** 7 días de juego, unas 12,5 h reales; unos 9 $ por mundo (E3: 1,31 $ por
  mundo y día), unos 28 $ los tres.

Otro con lo que ya existe: `COGNITION_CONTROL=on` lanza `s7c` con `SIM_COGNITION=off` para medir
si la cognición en movimiento (saludar, pararse a charlar, asociaciones por el camino) cambia la
red social y el coste (`study:analyze s7 s7c` compara encuentros, saludos, charlas en el camino y
asociaciones).

## Ejecutar pruebas

### Una partida en mock (gratis, sin claves)

```bash
pnpm install
pnpm dev                                         # http://localhost:5173, modo mock y en RAM
pnpm --filter @lethetown/server sim:text 16      # o en texto, sin servidor: 16 h de juego
pnpm --filter @lethetown/server replay:demo      # una partida corta en mock, ya empaquetada
# Una partida en mock grabada con su base de datos (para study:analyze), con un interruptor:
MEMORY_ABLATION=noForgetting,noVagueness \
  pnpm --filter @lethetown/server replay:demo --hours 72 --seed 7 --rec estudio/mock/s7a
```

El mock no llama a ningún modelo: sirve para probar el código y los interruptores, no para sacar
conclusiones sobre el comportamiento.

### Una partida real corta

Con una clave de Anthropic en `.env` (`LLM_PROVIDER=anthropic`, ver `.env.example`):

```bash
pnpm --filter @lethetown/server latency:probe 30 10   # 30 min reales a x10: espera y coste
```

Una partida de estudio entera, con Postgres y grabación, está en `.env.study.example` y
`scripts/estudio-semana.sh` (`prepare`, `start`, `record`, `status`, `export`).

### Grabar, analizar, empaquetar y compartir

```bash
RECORD_USER=… RECORD_PASSWORD=… pnpm --filter @lethetown/server record estudio/mia --hours 48 --track
pnpm --filter @lethetown/server world:export ../../estudio/mia/bd --world default
pnpm study:analyze estudio/mia                  # analysis.md y analysis.json
pnpm replay:moments estudio/mia                 # moments.md: momentos y arcos largos
pnpm replay:pack estudio/mia --out apps/web/public/replays/mia.replay.json.gz
```

`/replay?src=/replays/mia.replay.json.gz` la reproduce en la web sin servidor ni coste. Para
compartir los resultados, abre un issue con la plantilla «Resultado de una prueba» con el
`analysis.md` y, si quieres, el `.replay.json.gz` (es una lista blanca: no lleva costes,
usuarios, correos, claves, moderación ni rutas).

**Nunca compartas** `.env` ni `.env.*`, el fichero `.record-pass` de una partida (la contraseña
del usuario que graba), claves de API, cookies, la carpeta `bd/` entera (lleva `llm_calls` y
`moderation_log`) ni nada de `apps/web/public/assets/vendor/` (assets de terceros con licencia:
no se redistribuyen, ni en capturas).

## Contribuir código

```bash
pnpm install && pnpm dev     # funciona sin Postgres ni claves
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test   # antes de cada commit (la CI)
pnpm test:e2e                # Playwright, en mock
```

Las convenciones están en [CLAUDE.md](CLAUDE.md) y el porqué de cada decisión, en
[docs/decisiones](docs/decisiones/README.md). En resumen:

- **Monorepo:** `packages/shared` (esquemas zod, única fuente de verdad de los mensajes),
  `packages/agent-core` (lógica pura: memoria, psicología, metas; sin red ni BD), `apps/server`
  (simulación y todas las llamadas al LLM) y `apps/web` (Phaser pinta, React los paneles; nunca
  llama a un LLM).
- **La psicología se calcula, no se pide al modelo:** todo parámetro en su `Config` con valor
  por defecto y unidades; cada olvido o cambio, auditado con su motivo.
- **Lo nuevo del mundo es un sistema** (`SimSystem`) y **cada acción** pasa por el catálogo del
  motor ([plantilla](docs/decisiones/sistemas.md), [acciones](docs/decisiones/acciones.md)).
- **Azar** solo con el `Rng` sembrado; **tiempo** en minutos de juego; textos de la interfaz en
  `i18n/es.ts` y `en.ts`; accesible.
- **Test dorado** (`sim/golden.test.ts`): un refactor no lo cambia; un cambio de comportamiento
  lo regenera y lo explica en el commit.
- **Commits** pequeños, en español, con prefijo convencional (`feat(agent-core): …`).

**Protección de menores (prioritaria).** Hay menores en el pueblo. Todo texto del LLM que entra
en el mundo pasa por `MinorGuard`: nada romántico con un menor, y las citas e invitaciones de
adultos con menores, solo en lugares públicos. Un cambio que lo debilite no se acepta. Ver
[menores](docs/decisiones/menores.md).

## Apoyar el proyecto

Cada partida real cuesta dinero, y el coste está medido:

| Qué                                                  | Coste                         | De dónde                                                                                    |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| Un mundo, un día de juego                            | **1,31 $** (1,19–1,43)        | [E3](estudio/semana-fase3/ESTUDIO.md), media de dos semillas                                |
| Un estudio de 7 días con dos semillas                | **18,38 $**                   | [E3](estudio/semana-fase3/ESTUDIO.md)                                                       |
| Un estudio de 7 días con mundo de control (3 mundos) | unos **28 $** (estimado)      | 3 × 7 × 1,31 $                                                                              |
| Las partidas anteriores                              | 3,65 $ (48 h) · 4,90 $ (72 h) | [E1](estudio/partida-2dias/ESTUDIO.md), [E2](estudio/partida-3dias-mundo-metas/estudio2.md) |

Además del dinero de las llamadas, una semana de juego son unas 12,5 h reales de máquina.

**A qué va el apoyo:**

- **Más partidas y con control:** cada hipótesis necesita varias semillas, su mundo de control
  y repetirlas; hoy se lanza una partida larga cada vez.
- **Assets:** el pixel art de terceros tiene licencia y no se redistribuye; con apoyo se pueden
  comprar packs completos (personajes, interiores) o encargar arte propio publicable.
- **Tiempo de desarrollo:** economía, ciclo de vida, construcción y la evaluación comparativa.

**Formas de ayudar:**

- **Créditos de API o de computación** (proveedores de LLM o de nube): son lo que más cuesta.
- **Universidades y laboratorios** (psicología de la memoria, ciencias cognitivas, IA): diseñar
  experimentos, revisar métricas, colaborar en publicaciones.
- **Patrocinio** de personas o empresas.
- **Inversión**, para quien quiera hablarlo.

Contacto: `<CONTACTO>`
