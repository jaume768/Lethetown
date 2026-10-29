# Interfaz

- **Phaser solo pinta; React para los paneles.** La lógica no visual (frames, emotes, luz, color,
  interpolación, red de relaciones) vive en `packages/shared` con tests.
- **Modos** Espectador / Director / Overlay; costes solo para admin.
- **Piel de Modern UI** recortada en el cliente a variables CSS (sin generar archivos derivados de
  vendor); sin la hoja, CSS propio. Textos oscuros sobre el pergamino para el contraste.
- **Clips** en el navegador (MediaRecorder sobre el lienzo con `preserveDrawingBuffer`).
- **i18n es/en** (`apps/web/src/i18n`), nunca literales en componentes; las etiquetas que llegan
  del servidor (ánimo) se traducen si se conocen.
- **Relaciones**: sub-pestaña del inspector con la recíproca y la asimetría destacada; «Red del
  pueblo» en SVG propio (20 nodos no justifican una librería), layout de fuerzas determinista
  calculado una vez con la red de ahora y deslizador de tiempo sobre el historial; afinidad sobre
  el mapa con emotes propios.
- **Accesibilidad**: roles y `aria-*`, teclado, alternativa en texto para el grafo y respeto de
  `prefers-reduced-motion`. `localStorage` siempre con try/catch.
