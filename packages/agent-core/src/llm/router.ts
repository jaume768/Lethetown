import type { TaskKind } from "./types";

export interface ModelRouterConfig {
  fast: string;
  reflection: string;
}

/** Elige el modelo según el tipo de tarea. Configurable por .env desde el servidor. */
export class ModelRouter {
  constructor(private readonly config: ModelRouterConfig) {
    if (!config.fast || !config.reflection) {
      throw new Error("ModelRouter: hacen falta modelos 'fast' y 'reflection'");
    }
  }

  modelFor(kind: TaskKind): string {
    return this.config[kind];
  }

  get models(): Readonly<ModelRouterConfig> {
    return this.config;
  }
}
