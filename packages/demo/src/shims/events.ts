// `EventEmitter` aus `node:events`, so weit der Kern ihn braucht.

type Listener = (...args: any[]) => void;

export class EventEmitter {
  private readonly listeners = new Map<string | symbol, Set<Listener>>();

  on(name: string | symbol, listener: Listener): this {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
    return this;
  }

  addListener(name: string | symbol, listener: Listener): this {
    return this.on(name, listener);
  }

  off(name: string | symbol, listener: Listener): this {
    this.listeners.get(name)?.delete(listener);
    return this;
  }

  removeListener(name: string | symbol, listener: Listener): this {
    return this.off(name, listener);
  }

  once(name: string | symbol, listener: Listener): this {
    const once = (...args: unknown[]) => {
      this.off(name, once);
      listener(...args);
    };
    return this.on(name, once);
  }

  emit(name: string | symbol, ...args: unknown[]): boolean {
    const listeners = this.listeners.get(name);
    if (!listeners?.size) return false;
    for (const listener of [...listeners]) listener(...args);
    return true;
  }
}

export default { EventEmitter };
