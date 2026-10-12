export interface DotzukiContext {
  touchConfigure(values: number[]): void;
  touchLayout(): number[];
  touchEvent(kind: number, id: number, x: number, y: number): number;
  start(pack: Uint8Array, save: string): boolean;
  setInput(inputBits: number): void;
  pause(): void;
  resume(): void;
  exportSave(): Uint8Array | undefined;
}
