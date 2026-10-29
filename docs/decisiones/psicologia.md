# Psicología

Toda la lógica es pura (agent-core) y sus parámetros están en `MemoryConfig`; nada de lógica
psicológica en los prompts si se puede calcular en código.

- **Perfil de memoria = semilla × edad × personalidad** (`resolveProfile`): estabilidad episódica
  y semántica, confusión de fuente, olvido de fechas e intenciones, sugestionabilidad, pico de
  reminiscencia (mayores) y congruencia con el ánimo (neuroticismo). Lo recibe el `MemorySystem`
  de cada proceso (también el api, para que el inspector puntúe igual).
- **Personalidades revisadas a mano** (`pnpm personality:derive` solo propone; se equivoca, p. ej.,
  atribuyendo a Pilar lo de "desastre con las fechas" que su descripción dice de Tomás). Un test
  comprueba que encajan con las descripciones.
- **Ánimo circumplejo**: valencia y activación con etiqueta; base 0.2 ± extraversión ∓
  neuroticismo; vuelve con vida media de 4 h (valencia) y 1 h (activación). Hambre → irritable,
  cansancio → apagado, soledad → triste (más en extravertidos). Calibrado con el mock.
- **Necesidades por personalidad**: la social baja × (0.5 + extraversión); un introvertido solo en
  algo tranquilo recupera energía y social.
- **Codificación**: fuerza inicial por Yerkes-Dodson (pico 0.55), energía, atención y deuda de
  sueño; con activación ≥ 0.9 solo se guarda la esencia (sin LLM).
- **Sueño**: la tensión y la preocupación bajan la calidad, que es el techo de la energía que se
  recupera; la deuda de sueño baja el ánimo y la codificación del día. Se consolida antes lo
  emocional.
- **Sesgos**: negatividad (lo malo dura más), desvanecimiento afectivo (lo malo se suaviza antes,
  a saltos de 0.1 con versión y auditoría), intrusivos (se tira el dado antes de leer la memoria;
  no llaman al LLM).
- **Falsos recuerdos** solo desde el código (tarea `confabulate`), 0.015 × sugestionabilidad ×
  (1 − fuerza), sobre todo al volverse vago en el mantenimiento (la recuperación casi nunca elige
  recuerdos desvaídos). Marcados en `meta.falseMemory`; el agente no lo sabe.
- **Memoria prospectiva**: intenciones con pistas (persona, lugar, hora); solo cuenta cuando la
  pista _aparece_ (nace activa); probabilidad 0.7 × claridad ÷ olvido de intenciones; tras 2
  fallos se olvida y puede caer en la cuenta después. Se detectan en la ficha social de fin de
  charla y en la decisión (sin llamadas nuevas).
