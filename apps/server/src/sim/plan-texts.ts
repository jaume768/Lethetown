/**
 * Avisos del plan que compone el código (percepciones del agente). La etiqueta de la actividad
 * va a media frase con la primera letra en minúscula («ahora toca desayunar»): la mayúscula
 * engañaba al registro de conocimiento y al PersonGuard (corrección 3.5).
 */
import { lowerFirst } from "@lethetown/shared";

/** «Según tu plan ahora toca … en …, pero estás hablando con …». */
export function planClashText(activity: string, placeName: string, others: string): string {
  return `Según tu plan ahora toca ${lowerFirst(activity)} en ${placeName}, pero estás hablando con ${others}.`;
}

/** «Está lloviendo y lo que tenías previsto (…) es al aire libre, en …». */
export function outdoorPlanText(weatherNow: string, activity: string, placeName: string): string {
  return `${weatherNow} y lo que tenías previsto (${lowerFirst(activity)}) es al aire libre, en ${placeName}.`;
}
