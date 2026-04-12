declare module "invariant" {
  function invariant(condition: unknown, message?: string): asserts condition;
  export default invariant;
}

declare module "shallowequal" {
  function shallowEqual(a: unknown, b: unknown): boolean;
  export default shallowEqual;
}

declare module "eventemitter3" {
  export default class EventEmitter<Events extends Record<string, (...args: any[]) => void> = Record<string, (...args: any[]) => void>> {
    emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean;
    on<K extends keyof Events>(event: K, listener: Events[K]): this;
    once<K extends keyof Events>(event: K, listener: Events[K]): this;
  }
}

declare module "*.wav?url" {
  const src: string;
  export default src;
}

declare module "*.flac?url" {
    const src: string;
    export default src;
}

interface ImportMetaEnv {
  readonly VITE_ELEMAUDIO_RESOURCES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
