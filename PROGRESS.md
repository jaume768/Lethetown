# Orden del repositorio y de la documentación (rama `chore/orden-docs`)

Menos ficheros y un solo sitio para cada cosa, sin perder información y sin cambiar el
comportamiento (dorado, migraciones y código usado intactos). Se borra al fusionar.

Antes: 47 `.md` versionados.

- [x] 4b. `tools/check-links.ts` y `pnpm docs:check` (enlaces, anclas y capturas sin uso), en la CI
- [x] Estudios a `docs/investigacion/estudios/` (y la ruta por defecto de los scripts)
- [x] 1. README corto; `docs/desarrollo.md`, `arquitectura.md`, `assets.md`; investigación
- [ ] 2. `docs/historial.md` y «Pendiente de validar» en `docs/roadmap.md`; fuera los PROGRESS
- [ ] 3. `CONTRIBUTING.md` único, `docs/roadmap.md`, `docs/en/README.md`
- [ ] 4. Enlaces de todo lo movido (docs, plantillas, comentarios)
- [ ] 5. Capturas sin uso
- [ ] 6a. `tools/derive-seeds.ts` (`pnpm seeds:derive <tipo>`), igual byte a byte
- [ ] 6b. Código muerto (knip) y alias de scripts duplicados
- [ ] Final: comprobaciones, `docs/README.md`, fusionar
