export interface WorkingMemoryItem {
  text: string;
  memoryId?: string;
  addedAt: number;
}

/**
 * Memoria de trabajo de capacidad limitada (~7 elementos, Miller 1956).
 * Es lo único de la memoria que entra en el prompt. Al llenarse, sale lo más antiguo.
 */
export class WorkingMemory {
  private items: WorkingMemoryItem[] = [];

  constructor(readonly capacity = 7) {}

  push(item: WorkingMemoryItem): void {
    if (item.memoryId) this.items = this.items.filter((i) => i.memoryId !== item.memoryId);
    this.items.push(item);
    if (this.items.length > this.capacity) this.items = this.items.slice(-this.capacity);
  }

  /** Sustituye el contenido (p. ej. tras una recuperación); respeta la capacidad. */
  replace(items: WorkingMemoryItem[]): void {
    this.items = items.slice(-this.capacity);
  }

  clear(): void {
    this.items = [];
  }

  get contents(): readonly WorkingMemoryItem[] {
    return this.items;
  }

  render(): string {
    return this.items.length ? this.items.map((i) => `- ${i.text}`).join("\n") : "- (nada)";
  }
}
