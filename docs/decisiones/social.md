# Relaciones

- **Fichas no recíprocas**: afinidad, confianza, familiaridad, tipo de relación, vínculo de base
  (semillas: familia, pareja, trabajo) y rencor. Cada cambio pasa por `applySocialUpdate` y deja
  historial con motivo y evento (`social_profile_history`).
- **El tipo lo calcula el código** (`classifyRelationship`): el vínculo manda; si no, rivalidad
  (afinidad ≤ −0.35), amistad (≥ 0.35 con familiaridad ≥ 0.35), trabajo o vecindad. Romántica solo
  por las semillas o si surge entre adultos con afinidad y familiaridad altas y una opinión con
  léxico romántico claro; con un menor, nunca.
- **Credibilidad de los rumores**: confianza en quien lo cuenta (× 0.7 si es chismoso); por
  debajo de 0.35 se guarda "(no sé si creérmelo)".
- **Mera exposición y perdón al dormirse**, sin escrituras por tick: se suman los minutos juntos y
  la afinidad negativa vuelve hacia −rencor con vida media 6 días ÷ (0.5 + amabilidad).
- **Estilo de habla propio** (`speechStyle`) y personalidad en el prompt fijo; pueden discrepar,
  negarse o no tener ganas de hablar.
- **Dramas** al cambiar el tipo de relación (amistad, rivalidad, romance).
