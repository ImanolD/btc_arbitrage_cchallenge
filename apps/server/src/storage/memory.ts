import type { Storage, Subscriber } from "./types.js";

/** Clean-room default: subscribers live in-process (lost on restart). */
export class MemoryStorage implements Storage {
  private subs = new Map<string, Subscriber>();

  async loadSubscribers(): Promise<Subscriber[]> {
    return [...this.subs.values()];
  }

  async saveSubscriber(sub: Subscriber): Promise<void> {
    this.subs.set(sub.phone, { ...sub });
  }

  async close(): Promise<void> {}
}
