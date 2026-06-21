export type EventsDefine = Record<string, any[]>

export class EventBus<Events extends EventsDefine> {
  private listeners: Map<keyof Events, ((...args: any[]) => void | Promise<void>)[]> = new Map();
  rpcs: ((...args: any[]) => any)[] = [];
  
  async emit<K extends keyof Events>(event: K, ...args: Events[K]): Promise<void> {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers.values()) {
        try {
          await handler(...args)
        } catch (e) {
          console.error("An error occurred when event ", event, " triggers with ", args, ": ", e)
        }
      }
    }
    this.rpcs.forEach(rpc => {
      try {
        rpc(event, ...args)
      } catch (e) {
        console.error("An error occurred when RPC ", rpc, " triggers with ", event, " and ", args, ": ", e)
      }
    });
  }
  on<K extends keyof Events>(event: K, handler: (...args: Events[K]) => void | Promise<void>): () => void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.push(handler);
    } else {
      this.listeners.set(event, [handler]);
    }
    return () => {
      const list = this.listeners.get(event)!
      if (list.indexOf(handler) == -1) return;
      list.splice(list.indexOf(handler), 1)
    }
  }

  updater<K extends keyof Events>(event: K, handler: () => void): () => void {
    handler()
    return this.on(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: any): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index === -1) return;
    list.splice(index, 1);
  }
}
