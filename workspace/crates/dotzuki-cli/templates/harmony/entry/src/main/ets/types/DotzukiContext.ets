export default interface DotzukiContext {
  start(pack: Uint8Array, save: string): boolean;
  setInput(inputBits: number): void;
  pause(): void;
  resume(): void;
  exportSave(): Uint8Array | undefined;
}
