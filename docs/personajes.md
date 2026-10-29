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

Las recetas de los 20 vecinos están en `seeds/agents.json`. Pieles reales: 1 (la más oscura), 4
(morena), 7 (tostada), 3 (clara) y 2 (muy clara); la 5, 6, 8 y 9 son tonos de fantasía.

| Agente    | Quién es                     | Casa · trabajo                   |
| --------- | ---------------------------- | -------------------------------- |
| Lucía     | 28, ilustradora              | casa_azul                        |
| Mateo     | 34, regenta el café          | casa_roja · cafe_ola             |
| Carmen    | 63, maestra jubilada         | casa_roja                        |
| Julián    | 46, panadero viudo           | casa_amarilla · panaderia        |
| Inés      | 16, hija de Julián           | casa_amarilla · escuela (alumna) |
| Elena     | 52, alcaldesa                | casa_lila · ayuntamiento         |
| Tomás     | 71, pescador jubilado        | casa_ocre · lago                 |
| Pilar     | 68, mujer de Tomás           | casa_ocre · huerto               |
| Andrés    | 39, bibliotecario            | casa_marron · biblioteca         |
| Sofía     | 31, maestra                  | casa_celeste · escuela           |
| Rafael    | 42, tabernero                | casa_granate · taberna           |
| Marta     | 37, tendera, madre de Leo    | casa_naranja · tienda            |
| Leo       | 10, hijo de Marta            | casa_naranja · escuela (alumno)  |
| Nuria     | 27, jardinera                | casa_pino · huerto               |
| Hugo      | 29, músico callejero         | casa_rio · plaza                 |
| Valentina | 25, fotógrafa recién llegada | casa_colina                      |
| Ernesto   | 58, cartero hipocondríaco    | casa_molino                      |
| Aurora    | 82, la más anciana           | casa_jardin                      |
| Clara     | 19, nieta de Aurora          | casa_jardin · mercado            |
| Samuel    | 35, médico                   | casa_faro · consultorio          |

`workId` (opcional) es su lugar de trabajo o estudios: entra en el prompt fijo («Tu trabajo o
estudios») y el mock organiza su día alrededor de él.

## Personajes del mapa

Se usan los 4 personajes de Modern Interiors **Free** (solo uso no comercial) como cuerpos:
Amelia, Alex, Adam y Bob (`agentCharacters` del manifest). Cada hoja lleva una `palette` con los
colores de su piel, pelo, camisa y pantalón, y el cliente los lleva a los colores del
`appearance` de cada agente conservando el sombreado (`recolorPalette` en `packages/shared`).
Así los 20 vecinos se distinguen aunque compartan cuerpo.

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
