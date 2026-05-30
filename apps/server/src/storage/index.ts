import { integrations } from "../config.js";
import { MemoryStorage } from "./memory.js";
import { MongoStorage } from "./mongo.js";
import type { Storage } from "./types.js";

/**
 * Returns a Mongo-backed store when MONGODB_URI is set and reachable, otherwise
 * an in-memory store. A connection failure degrades gracefully to memory so the
 * dashboard never goes down because of the (optional) persistence layer.
 */
export async function createStorage(): Promise<Storage> {
  const uri = integrations.mongoUri;
  if (!uri) {
    console.log("[storage] in-memory (no MONGODB_URI)");
    return new MemoryStorage();
  }
  try {
    const store = await MongoStorage.connect(uri, integrations.mongoDb);
    console.log(`[storage] MongoDB connected (db=${integrations.mongoDb})`);
    return store;
  } catch (err) {
    console.warn(
      "[storage] Mongo connect failed, falling back to in-memory:",
      (err as Error).message,
    );
    return new MemoryStorage();
  }
}

export type { Storage, Subscriber, SubLang } from "./types.js";
