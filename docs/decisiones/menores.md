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
  La misma regla (`minorMeetingRule`) vale para citas, invitaciones, acompañar, regalar y prestar;
  la revisión de normas saca a un menor de una casa ajena con adultos aunque esté invitado; nada de
  notas privadas entre un adulto y un menor (el tablón, que es público, sí).
- **Si la moderación falla** (error, timeout o respuesta que no se entiende), se repite hasta 2
  veces con espera exponencial (500 ms, 1 s) antes de bloquear; cada llamada lleva además los
  reintentos de `ResilientProvider` en 429/5xx. Si vuelve a fallar, sigue siendo fail-closed. En
  la partida real los 3 bloqueos fueron por no poder moderar (una frase inocente de Sofía a
  Inés). El guardián cuenta los bloqueos por error y por contenido (`stats()`, pestaña
  «Evolución») y el registro de moderación los marca («error de moderación: …»).
- **Acuerdos hablados**: el texto del acuerdo pasa por `MinorGuard` y sus pasos por los mismos
  manejadores (con `minorMeetingRule`) que las acciones formales.
