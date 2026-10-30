/**
 * Carga todos los sistemas. El orden de los imports es el de registro: el orden en que corren
 * sus revisiones periódicas (y el del test dorado). Un sistema nuevo se añade al final.
 */
import "./meetings";
import "./items";
import "./objects";
import "./company";
import "./notes";
import "./norms";
import "./places";

export * from "./registry";
export * from "./types";
