# Personajes y retratos

## Retratos (Portrait Generator de LimeZu)

El Portrait Generator viene con Modern User Interface. Además del ejecutable, el zip trae las
capas en PNG (`Portrait Pieces/`), así que los retratos se componen por código, sin abrir la
herramienta.

1. Extrae del zip la carpeta `Portrait Pieces` en `apps/web/public/assets/vendor/limezu/portraits/`
   (quedan `Portrait_Generator - 16x16`, `- 32x32` y `- 48x48`). No hace falta el ejecutable.
2. Edita la receta `portrait` de cada agente en `seeds/agents.json`:
   - `skin`: `Skins/Skin N.png` (1–9).
   - `eyes`: `Eyes/Eyes NN.png` (1–7).
   - `hair`: `{ "style": NN, "color": C }` → `Hairstyles/Hairstyle NN C.png`. Colores: 1 pelirrojo,
     2 castaño claro, 3 castaño, 4 castaño oscuro, 5 canoso, 6 gris oscuro, 7 negro azulado.
     Los estilos 27–29 solo tienen 6 colores de fantasía.
   - `accessories`: nombres de `Accessories/` sin `.png`, en orden de dibujo (p. ej.
     `"Accessory 15 Glasses 1"`, `"Accessory 13 Beard 1"`).
3. `pnpm portraits:compose` escribe en `.../portraits/generated/` `<agente>.png` (frames de 64 px,
   para la UI), `<agente>-map.png` (frames de 32 px, junto a los bocadillos) y `preview.png`.

Cada hoja tiene 10 columnas × 3 filas: `talk`, `nod` y `shake`. El inspector usa `talk` mientras
el agente habla y `nod` mientras piensa; el mapa anima `talk` mientras se escribe el bocadillo.
Si faltan los retratos, se muestra la inicial del nombre y el bocadillo va sin retrato.

Recetas actuales:

| Agente | Quién es             | Receta                                              |
| ------ | -------------------- | --------------------------------------------------- |
| Lucía  | 28, ilustradora      | piel 2, ojos 1, melena 09 pelirroja (1)             |
| Mateo  | 34, regenta el café  | piel 4, ojos 2, pelo 02 castaño oscuro (4), barba 1 |
| Carmen | 63, maestra jubilada | piel 2, ojos 3, media melena 04 canosa (5), gafas 1 |

## Personajes del mapa

Ahora se usan los 4 personajes de Modern Interiors **Free** (solo uso no comercial): Lucía →
Amelia, Mateo → Bob, Carmen → Alex (`agentCharacters` del manifest).

Cuando compres Modern Interiors de pago:

1. Genera con el Character Generator un personaje de 16×16 por agente (24 columnas × 7 filas,
   el mismo formato que los de Interiors Free) y guárdalo en
   `apps/web/public/assets/vendor/limezu/interiors/characters/<agente>.png`.
2. En `apps/web/public/assets/manifest.json`, añade una entrada en `characters` por agente
   (copia las animaciones de `amelia`) con `"license": "commercial"` y un `source` nuevo
   (`limezu-interiors`, que también hay que añadir a `credits`), y apunta `agentCharacters` a ellas.
3. Cambia `int_rooms` e `int_furniture` a los tilesets del pack de pago (mismos nombres de
   tileset) y ajusta los sellos si cambian las coordenadas; luego `pnpm map:generate`.
4. `pnpm assets:check` debe decir "Todos los assets en uso permiten uso comercial"
   (`pnpm assets:check --strict` falla si no).

Modern Exteriors trae también personajes completos con licencia comercial en
`Character_Generator_Addons_16x16/Characters_16x16/` (cartero, scout, esqueleto, zombis,
bañistas): sirven de extras, pero no encajan con los protagonistas.
