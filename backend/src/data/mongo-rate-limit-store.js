'use strict';

const { getDatabase } = require('./mongodb');

class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.windowMs = 60_000;
    this.indexPromise = null;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async collection() {
    const collection = (await getDatabase()).collection('rateLimits');
    if (!this.indexPromise) {
      this.indexPromise = Promise.all([
        collection.createIndex({ key: 1 }, { unique: true }),
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      ]);
    }
    await this.indexPromise;
    return collection;
  }

  async increment(key) {
    const collection = await this.collection();
    const now = new Date();
    const record = await collection.findOneAndUpdate(
      { key: `${this.prefix}:${key}` },
      [{ $set: {
        hits: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1] },
        expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', new Date(now.getTime() + this.windowMs)] }
      } }],
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    );
    return { totalHits: record.hits, resetTime: record.expiresAt };
  }

  async decrement(key) {
    await (await this.collection()).updateOne(
      { key: `${this.prefix}:${key}`, hits: { $gt: 0 } },
      { $inc: { hits: -1 } }
    );
  }

  async resetKey(key) {
    await (await this.collection()).deleteOne({ key: `${this.prefix}:${key}` });
  }

  async shutdown() {}
}

module.exports = { MongoRateLimitStore };
