/**
 * Tope de tokens de salida por tarea. Es un techo, no lo que se paga: se cobra lo que de verdad
 * genera el modelo. En la segunda partida de estudio los topes de 200–400 cortaban a media
 * respuesta el ~18 % de las fichas sociales, el ~7 % de las importancias y algunas moderaciones y
 * reconsolidaciones (JSON incompleto → valores por defecto o bloqueo). Por eso van holgados.
 */
export const MAX_TOKENS = {
  /** Decisiones y demás tareas rápidas sin tope propio. */
  fast: 2000,
  /** Plan, consolidación y demás tareas de reflexión sin tope propio. */
  reflection: 4000,
  social: 2000,
  importance: 2000,
  gist: 1000,
  reconsolidate: 1000,
  confabulate: 1000,
  summarize: 1500,
  moderation: 800,
  interview: 1500,
  chronicle: 4000,
} as const;
