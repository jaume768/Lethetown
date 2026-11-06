# Saberes del pueblo (lore)

Objetivo: que el pueblo tenga saberes propios (recetas, técnicas, sitios, historias, canciones)
que se transmiten de boca en boca, se deforman al contarse y pueden perderse, sin LLM y sin
personas inventadas. Sistema `lore` (`apps/server/src/sim/systems/lore.ts`, lógica en
`sim/lore.ts`; la deformación y el olvido, en `packages/agent-core/src/lore/lore.ts`).

## Decisiones

- **Un saber tiene elementos** (ingredientes, pasos, detalles) y, para cada uno, las variantes
  con que se suele deformar («la ralladura de un limón» → «de una naranja»). Cada vecino que lo
  sabe tiene **su versión** (`lore_holders`: los elementos que conserva, cuáles cambió, su
  fidelidad 0..1, de quién lo aprendió y cuándo lo usó).
- **Deformación sin LLM**: al contarlo (`share_lore`), cada elemento se pierde con probabilidad
  (0,03 + 0,3·(1 − fidelidad de quien lo cuenta)) × (1 − 0,6·su habilidad en eso) × lo que olvida
  quien escucha (1 ÷ estabilidad semántica de su perfil de memoria), y cambia con una parecida
  (0,04 + 0,25·(1 − fidelidad)). El cambio sale de las variantes del saber o de un número
  («cuatro huevos» → «cinco»); nunca se inventa texto. Quien escucha no pasa de la fidelidad de
  quien lo cuenta × 0,95. Contarlo también es usarlo.
- **Deformación suficiente** (corrección 3.5): en la partida de una semana solo se deformó 1
  de 37 transmisiones, porque casi ningún elemento tenía variantes y sin variante (ni número) no
  hay cambio posible. Ahora cada elemento de las semillas tiene al menos una, escrita a mano
  (sin personas ni texto del LLM: «de claro a oscuro» → «de oscuro a claro», «sale cuando
  llueve» → «sale cuando hace sol»), y `alterBase` pasa de 0,04 a 0,05. Contados por quien los
  sabe de partida, un 16 % de las transmisiones llega con algún cambio (test con las semillas:
  10–20 %).
- **Uso y olvido**: practicar su habilidad o estar en su sitio lo refuerza (+0,05, como mucho cada
  hora). Sin usarlo, tras 5 días de gracia la fidelidad baja 0,012 al día (la mitad con mucha
  habilidad en eso) y, cuando ya no sostiene todos los elementos, se le olvida uno (auditado).
  Por debajo de 0,25 ya no recuerda cómo era (🕸, drama «ya no recuerda cómo se hacía»); si nadie
  llega a 0,25, el saber **se pierde para el pueblo** (🕯, drama «un saber que se pierde»).
- **Semillas**: 24 saberes, 1–2 por vecino, coherentes con su vida (`lore` en cada semilla):
  las magdalenas de Francisca (Julián), el sitio de pesca y el pez gigante (Tomás), plantar según
  la luna y la tisana para la tos de la abuela Catalina (Pilar), la mezcla de café de Bartomeu
  (Mateo), la canción de las segadoras que Aurora aprendió de Alma, cómo revelar un carrete
  (Valentina), la canción del lago (Hugo)… El mismo título en dos semillas es el mismo saber.
- **Sin personas inventadas** ([personas](personas.md)): el origen (`from`) es un vecino o
  alguien de la gente de fuera de esa semilla; si no, quien lo sabe. Un test lo comprueba. Lo
  aprendido queda como recuerdo («X me contó Las magdalenas de Francisca: …») que pasa por
  `MinorGuard` y `PersonGuard`.
- **Vista Rashomon**: `GET /api/lore` da cada saber con la versión de cada uno; en la web, «Saberes
  del pueblo» (Crónicas) y, por persona, la pestaña «Habilidades y saberes».
- **Prompt**: con alguien delante, «SABERES QUE PUEDES CONTAR» (ids para `share_lore`), como mucho
  cada 3 h por vecino: en cada decisión con alguien delante subía el coste del mock de ≈ 0,74 a
  ≈ 0,92 $ en 48 h.
- **No se cuenta otra vez a quien ya lo sabe** (corrección 3.5; Aurora le contó a Clara «El
  verano en que Alma se fue» 6 y 11 veces, y Clara ya lo sabía entero): un saber no sale en
  «SABERES QUE PUEDES CONTAR» ni se ofrece `share_lore` si todos los presentes ya lo tienen con
  todos sus elementos y lo oyeron o usaron hace menos de `LoreConfig.retellCooldownDays` (3);
  si el LLM lo pide igual (o lo acuerdan hablando), el motor lo rechaza con el motivo. A
  alguien que lo sabe a medias o hace días, sí.
- **Acordado hablando**: el acuerdo `share_lore` (con su `loreId`) pasa por la acción formal.

- **La pérdida no se ve en una semana** (corrección 3.5): con 5 días de gracia y 0,012 al día,
  un saber que nadie usa tarda unos 60–70 días en caer por debajo de 0,25 en todos sus
  portadores (test en agent-core, `knownByTown`). En la partida de 7 días no se perdió ninguno, y
  es lo esperado: los parámetros de olvido no se tocan; para verla hace falta una partida de más
  de dos meses de juego.

## A revisar

- Con el LLM real, cuántos saberes se cuentan de verdad (en el mock, pocos: solo cuando sale la
  sección) y si las variantes bastan para que la deformación sea interesante.
- Si hace falta que un saber se pueda «reconstruir» entre varios (hoy, quien escucha se queda con la
  versión mejor de las que le cuentan).
