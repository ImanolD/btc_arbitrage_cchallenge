import { MongoClient, type Collection } from "mongodb";
import type { Storage, Subscriber } from "./types.js";

/** Durable subscriber storage backed by MongoDB. Phone is the unique key. */
export class MongoStorage implements Storage {
  private constructor(
    private readonly client: MongoClient,
    private readonly col: Collection<Subscriber>,
  ) {}

  static async connect(uri: string, dbName: string): Promise<MongoStorage> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const col = client.db(dbName).collection<Subscriber>("subscribers");
    await col.createIndex({ phone: 1 }, { unique: true }).catch(() => {});
    return new MongoStorage(client, col);
  }

  async loadSubscribers(): Promise<Subscriber[]> {
    const rows = await this.col.find({}).toArray();
    // Drop Mongo's _id; the domain model is keyed by phone.
    return rows.map(({ phone, lang, active, createdAt, lastInboundAt, lastPushAt }) => ({
      phone,
      lang,
      active,
      createdAt,
      lastInboundAt,
      lastPushAt,
    }));
  }

  async saveSubscriber(sub: Subscriber): Promise<void> {
    await this.col.replaceOne({ phone: sub.phone }, sub, { upsert: true });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
