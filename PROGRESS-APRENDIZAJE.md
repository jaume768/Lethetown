# Fase 3: desarrollo y aprendizaje

Rama `feat/aprendizaje` (desde `main` en `3a882f7`, con la corrección 2.5). Léelo al retomar.
Catálogo de acciones cerrado (opción A), ampliado; todo nuevo como `SimSystem` (`skills`,
`lore`, `personality`).

## Checklist

- [x] A. Habilidades en agent-core: catálogo (14), práctica con rendimientos decrecientes, maestro,
      olvido con su curva, éxito y calidad (lógica pura, `SkillsConfig`)
- [x] B. Sistema `skills`: tabla, almacén, semillas (`tools/derive-skills.ts`, revisadas), práctica
      por actividad/objeto/lugar, olvido nocturno, auditoría, prompt compacto, métricas
- [x] C. Que importe: `use_object` según habilidad, calidad de resultados (lo percibe quien lo
      recibe), criterio de metas `skill_level`
- [x] D. Acciones: `practice`, `ask_to_learn`/`teach`/`accept_teaching`/`decline_teaching`
      (sesiones), `help`, `show_result`; acuerdos `teach` y `help`
- [x] E. Sistema `lore`: tablas, semillas, transmisión con deformación sin LLM, uso y olvido,
      saberes perdidos, `share_lore` (y acuerdo), vista Rashomon
- [x] F. Deriva lenta de la personalidad (sistema `personality`)
- [x] G. Interfaz y métricas: pestaña del inspector, panel de saberes, Evolución, dramas, i18n
- [x] H. README, CLAUDE.md, decisiones (skills.md, lore.md, acciones.md), coste, entrevistas, PR

## Coste (`cost:report 48`, mock, `SIM_SEED=7`)

| Tarea       | Antes (`3a882f7`) |   Después | Notas                                                 |
| ----------- | ----------------: | --------: | ----------------------------------------------------- |
| decide      |             1.242 |     1.258 | 623 → 684 tokens no cacheados por decisión            |
| importance  |               827 |       710 |                                                       |
| social      |               585 |       590 | una ficha por charla acabada                          |
| plan        |                40 |        40 | «LO QUE SABES HACER» en el plan                       |
| consolidate |                40 |        40 | igual                                                 |
| **total**   |         **3.525** | **3.442** | ≈ 0,742 $ → ≈ 0,786 $ (precios de Haiku y Sonnet 5.5) |

- Sin enfriar los saberes en la decisión (salían con alguien delante, siempre): 4.667 llamadas y
  ≈ 0,919 $, con 759 tokens por decisión. Con 3 h de enfriamiento, lo de arriba.
- Respuestas en conversación: 384 → 495 (más motivos para hablar: sesiones, ayudas, regalos).
- 48 h de mock: unas 170 h de práctica, 7 sesiones de enseñanza, 3 ayudas, 24 resultados
  (pan, verduras, fotos), 3 saberes contados (en el mock solo se cuentan cuando sale la sección),
  0 saberes perdidos (hace falta más de una semana sin usarlos) y 0 cambios de personalidad (es
  semanal). Registro de conocimiento: 0 (antes del arreglo, «Ngozi» salía como referencia externa).
- Ninguna tarea nueva del LLM: todo va en la decisión, el plan y la ficha social que ya había.

## Entrevistas (`pnpm interview --advance 48`, mock, `EMBEDDINGS=hash`)

Antes y después, Julián, Inés y Tomás responden con el recuerdo que más se recupera: Tomás, «Leo
me pregunta siempre por el pez gigante» a todo; Julián, después, «Me he propuesto: que Inés y yo
volvamos a entendernos» y lo de Palma (antes, una frase de Inés); Inés, frases de su padre. Se
añadió a la batería «¿Qué sabes hacer bien y quién te enseñó? ¿Qué te han contado o enseñado estos
días?», pero con el mock y los embeddings `hash` la recuperación no da con los recuerdos de lo
aprendido («Valentina Ríos me enseñó fotografía», «Julián Ortega me contó Las magdalenas de
Francisca: …»), que sí se guardan (tests). Para verlo hace falta la partida real.

## Medidas de partida (`main` en `3a882f7`, mock, `SIM_SEED=7`)

- `cost:report 48`: 3.525 llamadas, ≈ 0,742 $; respuestas en conversación 384 (espera media 1,9
  min de juego).
- `pnpm interview --advance 48` (mock): Julián, Inés y Tomás responden con el recuerdo más
  recuperado (Tomás: «Leo me pregunta siempre por el pez gigante» a todo; Julián: la frase de
  Inés sobre lo que se cuenta por el pueblo; Inés: el saludo de su padre).

## Partida real de validación (7 días, Batch, dos semillas)

Con `.env.study.example` (capa sobre `.env`: x10, Batch, sin pausar cuando nadie mira):

```bash
pnpm db:up
docker exec lethetown-db createdb -U lethetown lethetown_aprendizaje_s7
# .env.study: SIM_SEED=7 y DATABASE_URL=…/lethetown_aprendizaje_s7
set -a; . ./.env.study; set +a; pnpm db:migrate && pnpm dev
# en otra terminal (con un usuario director para pausar al acabar):
set -a; . ./.env.study; set +a
RECORD_USER=grabador RECORD_PASSWORD=… pnpm --filter @lethetown/server record ../../estudio/aprendizaje-s7 --hours 168
pnpm --filter @lethetown/server world:export ../../estudio/aprendizaje-s7/bd
# lo mismo con SIM_SEED=13 en lethetown_aprendizaje_s13 (estudio/aprendizaje-s13), y:
pnpm study:analyze estudio/aprendizaje-s7 estudio/aprendizaje-s13
pnpm interview --advance 0   # con el mundo de la partida, para Julián, Inés y Tomás
```

Qué mirar (en `analysis.md`, «Evolución» y `bd/skills.jsonl`, `bd/lore.jsonl`,
`bd/lore_holders.jsonl`):

- Sesiones de enseñanza y ayudas por día: que salgan con naturalidad (no en cada charla).
- Si alguien cambia de etiqueta en una semana (Inés en fotografía con Valentina; Ernesto en
  cuidados con Samuel), y cuántas habilidades se oxidan.
- Saberes contados y cómo llegan cambiados (versión de cada uno en «Saberes del pueblo»); si
  alguno se pierde en 7 días (con 5 de gracia y 0,012 al día, solo lo que nadie usa).
- La deriva de la personalidad en la primera semana (como mucho 0,02 por rasgo) y su motivo.
- Coste por día: en el mock, ≈ +6 % (más contexto por decisión).

## Decisiones

- **Catálogo de 14 habilidades** en agent-core (configurable con zod); ids en el prompt fijo.
- **Práctica por lo que se hace** (objeto, palabras de hacer, `practice`, sesión, ayuda); curva
  exacta con `practiceRate` 0,02/h; maestro ×2 si saca 0,2. **Olvido** tras 3 días, 1 %/día sobre
  un suelo que crece con lo aprendido a fondo.
- **Niveles sin género** («con maestría» en vez de «experto»).
- **Arreglar** 0,35 + 0,6·nivel; **calidad** de lo servido y **resultados** (≤ 3 por persona; no
  hay economía, el pan se acumula).
- **Sesiones** de 60 min, propuesta de 30; acciones que solo se ofrecen si tienen sentido.
  `work_together` del enunciado se cubre con `help` (una sola acción para no inflar el catálogo).
- **Saberes**: 24 en las semillas; deformación sin LLM (variantes o números); origen vecino o
  gente de fuera de la semilla; fidelidad 0,9 al empezar; perdido si nadie llega a 0,25; en la
  decisión, cada 3 h.
- **Personalidad**: semanal, ≤ 0,02 por rasgo y semana, ≤ 0,15 desde la semilla; `refreshIdentity`
  solo si cambia el texto del prompt; el perfil de memoria no sigue a la deriva todavía.

## A revisar

1. Si con el LLM real las sesiones y ayudas salen con naturalidad o en exceso (las acciones solo se
   ofrecen cuando tienen sentido, pero el modelo puede abusar).
2. El ritmo de aprendizaje (35 h de 0 a 0,5) y de olvido (un cuarto en un mes): en 7 días casi
   nadie cambiará de etiqueta salvo con maestro.
3. Que los resultados (pan, verduras) se acumulan sin economía: ¿hace falta consumirlos?
4. La deformación de los saberes: ¿las variantes bastan o hace falta más variedad?
5. El perfil de memoria (y el ánimo base) no siguen a la deriva de la personalidad.
6. Valentina aprende de Aurora «La canción de las segadoras», que viene de Alma, su abuela (sale
   solo en el mock): es la historia que sugerían las semillas.
