# Mundo, mapa, gráficos y personajes

- **Mapa en Tiled generado por código.** `seeds/town.tmj` es la fuente de verdad; lo compone
  `pnpm map:generate` con _sellos_ del manifest (`fixed`, `pattern`, `nineslice`, con ancla y
  baldosas que bloquean), porque los packs de LimeZu usan objetos de varias baldosas. Retocarlo
  en Tiled se pierde al regenerar.
- **Edificios estilo LimeZu**: interior con Room Builder y, en la capa `roofs`, azotea y fachada.
  El cliente oculta el tejado si hay alguien dentro o el ratón encima.
- **Los muebles no bloquean** (solo paredes, agua, troncos, farolas y fuente): así todos los spots
  son alcanzables (un test lo comprueba). Pendiente: colisión fina de muebles.
- **Ventanas y farolas** son capas de objetos del `.tmj`, independientes del tileset.
- **Personajes**: el Character Generator no viene en los zips gratuitos; se usan los personajes de
  Modern Interiors Free. No hay animación de dormir: se tumba el frame `idle_down`.
- **Frames por distancia** al andar (media baldosa por frame): a ×360 se saltan frames en vez de ir
  a trompicones (`pickFrame` en shared, con tests).
- **Retratos por código**: `pnpm portraits:compose` apila las capas del Portrait Generator según
  la receta de `seeds/agents.json`; el resultado se queda en vendor (ignorado).
- **Licencias**: nada de `assets/vendor/` va al repo ni a las imágenes (Modern Interiors Free es
  solo no comercial). Las capturas de la documentación se hacen sin esos packs (Playwright bloquea
  `assets/vendor/`); el aviso de assets no comerciales se calcula en el cliente.
- **Phaser 4** con `pixelArt` y `roundPixels: true` explícito (en v4 es false por defecto).
- **Normas en el mapa**: las casas llevan `private = true` y los lugares públicos con horario,
  `hours = "HH:MM-HH:MM"` (lo escribe `tools/generate-map.ts`; cierre a medianoche = 24:00). El
  tablón de anuncios es el spot `tablon` de la plaza. Ver [acciones.md](acciones.md).

## Mallorca, 1996: la biblia del mundo y lo que sabe cada uno

- **Biblia** en `config/world.json` (esquema `WorldBible`, `agent-core/src/world/bible.ts`): un
  pueblo inventado del interior de Mallorca en 1996 (año y fecha del día 0 configurables; por
  defecto, lunes 15 de abril de 1996), Palma a una hora, pesetas, tecnología de la época, lo que
  hay fuera, cultura local sin caricaturas, glosario, fiestas y clima. Entra **compacta en el
  prompt fijo** (igual para todos: cacheable) por el sistema `world`; la fecha y la fiesta del día
  van al plan (lo variable). El calendario se calcula con minutos de juego, sin `Date`.
- **Clima de Mallorca** por estación (`climate`): lo usa el modo demostración (nieve casi nunca
  y solo en invierno, calor en verano, lluvias y tormentas en otoño). Fuera de ese modo, el tiempo
  solo lo cambia el director.
- **Datos de la época** comprobables (elecciones de marzo de 1996, Son Dureta, UIB, cadenas de
  tele, festival de Benicàssim, GOB…); se evitan IB3 (2005), Son Espases (2011) y el euro en
  circulación (2002). Las semillas se revisaron: ver PROGRESS-MUNDO-METAS.md.
- **Perfil de conocimiento** (`knowledge` en la semilla): estudios, oficio, idiomas, lugares de
  fuera, intereses y nivel cultural, en el prompt fijo («Lo que sabes: …»), con la regla de
  responder como el personaje a lo que no sabría o no existe en su época. `pnpm knowledge:derive`
  propone; los 20 están revisados a mano y un test comprueba que encajan.
- **Aprender de otros** (sistema `knowledge`): un nombre de fuera que alguien dice y quien lo oye
  no tiene en su perfil queda como recuerdo semántico «X me contó algo de …» con
  `source: contado por X` (una vez por oyente y nombre). Las palabras de otros idiomas aún no se
  detectan (haría falta un diccionario).
- **ExternalKnowledgeGuard** (`agent-core/src/world/knowledge-guard.ts`): se engancha a
  `MinorGuard` como inspector (`addInspector`, síncrono), así ve exactamente los mismos textos que
  la protección de menores. Modo `log` por defecto (`knowledgeGuard.mode` en la biblia): registra
  en `knowledge_log` (con `world_id`, retención `knowledgeLog` de 30 días de juego) anacronismos
  (lista de la biblia, por palabras y prefijos, sin expresiones regulares sobre el texto) y
  referencias externas (nombres propios a media frase que no son vecinos, lugares, glosario,
  referencias comunes ni encajan con el perfil). `enforce` descarta los textos con anacronismos;
  `soften` de momento solo registra. No usa el LLM.
- **Heurística de nombres**: la mayúscula de inicio de frase engaña (lo que revisa la decisión
  empieza por el id del destinatario: «marta Tienes razón»), así que una palabra suelta que se
  haya visto en minúscula no es un nombre (vocabulario aprendido de las semillas, la biblia y lo
  que se lee); los textos recortados («Palm…», «Ern…») cuentan como el principio de una palabra
  conocida y hacen falta 4 letras. En un recuerdo, lo que va entre comillas lo dijo otro (ya se
  registró al decirlo) y los implicados también cuentan para el perfil. Es para revisar con los
  ejemplos de «Evolución», no una verdad.
