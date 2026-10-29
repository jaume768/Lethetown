# Protección de menores (prioritaria)

- **Dos defensas**: una regla fija en el prompt de identidad de todos (lista de menores; cacheable)
  y `MinorGuard` sobre todo lo que escribe el LLM y entra en el mundo.
- **Implicar a un menor** = estar entre los actores o ser nombrado (nombre completo o de pila,
  sensible a mayúsculas: "leo" el verbo no cuenta).
- **Léxico claro → descarte directo; ambiguo → moderación `fast`** (`moderate_minor`), fail-closed
  y cacheada por texto: no se paga una llamada por cada frase de un menor.
- **Conservador a propósito**: un menor tampoco guarda recuerdos con léxico romántico claro aunque
  hablen de adultos.
- **Qué pasa con lo descartado**: frase o acción → sigue su plan; bloque de plan → fuera; recuerdo →
  no se guarda (`tryRemember`); ficha → no cambia; crónica → pierde esas frases; entrevista →
  retirada. Todo a `moderation_log` (`minor_safety:<origen>`), nunca a la línea de tiempo.
- **Voz interior** romántica hacia un menor: rechazada en `vetUserText` aunque la moderación esté
  apagada.
- **Relaciones**: nunca `romantic` con un menor. **Acciones** (ver [acciones.md](acciones.md)): un
  adulto no invita a un menor a una casa privada ni queda a solas con él fuera de sitios públicos.
