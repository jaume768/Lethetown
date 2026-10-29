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
