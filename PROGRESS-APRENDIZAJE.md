# Fase 3: desarrollo y aprendizaje

Rama `feat/aprendizaje` (desde `main` en `3a882f7`, con la corrección 2.5). Léelo al retomar.
Catálogo de acciones cerrado (opción A), ampliado; todo nuevo como `SimSystem` (`skills`,
`lore`, `personality`).

## Checklist

- [ ] A. Habilidades en agent-core: catálogo (14), práctica con rendimientos decrecientes, maestro,
      olvido con su curva, éxito y calidad (lógica pura, `SkillsConfig`)
- [ ] B. Sistema `skills`: tabla, almacén, semillas (`tools/derive-skills.ts`, revisadas), práctica
      por actividad/objeto/lugar, olvido nocturno, auditoría, prompt compacto, métricas
- [ ] C. Que importe: `use_object` según habilidad, calidad de resultados (lo percibe quien lo
      recibe), criterio de metas `skill_level`
- [ ] D. Acciones: `practice`, `ask_to_learn`/`teach`/`accept_teaching`/`decline_teaching`
      (sesiones), `help`, `show_result`; acuerdos `teach` y `help`
- [ ] E. Sistema `lore`: tablas, semillas, transmisión con deformación sin LLM, uso y olvido,
      saberes perdidos, `share_lore` (y acuerdo), vista Rashomon
- [ ] F. Deriva lenta de la personalidad (sistema `personality`)
- [ ] G. Interfaz y métricas: pestaña del inspector, panel de saberes, Evolución, dramas, i18n
- [ ] H. README, CLAUDE.md, decisiones (skills.md, lore.md, acciones.md), coste, entrevistas, PR

## Medidas de partida (`main` en `3a882f7`, mock, `SIM_SEED=7`)

- `cost:report 48`: 3.525 llamadas, ≈ 0,742 $; respuestas en conversación 384 (espera media 1,9
  min de juego).
- `pnpm interview --advance 48` (mock): Julián, Inés y Tomás responden con el recuerdo más
  recuperado (Tomás: «Leo me pregunta siempre por el pez gigante» a todo; Julián: la frase de
  Inés sobre lo que se cuenta por el pueblo; Inés: el saludo de su padre).

## Decisiones
