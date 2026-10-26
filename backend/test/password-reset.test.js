'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const user = { _id: { toString: () => 'user-1' }, email: 'farmer@example.com', role: 'farmer' };
let resetRecord;
let consumedFilter;
let invalidatedPrevious = false;
let sessionsRevoked = false;
let transactionCalls = 0;
let passwordUpdate;

const collections = {
  users: {
    findOne: async (query) => query._id ? user : user,
    updateOne: async (query, update) => { passwordUpdate = update.$set; return { matchedCount: 1 }; }
  },
  passwordResets: {
    updateMany: async (query) => { invalidatedPrevious = query.userId === user._id; return { modifiedCount: 1 }; },
    insertOne: async (document) => { resetRecord = { ...document, _id: 'reset-1' }; return { insertedId: 'reset-1' }; },
    findOne: async (query) => {
      if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt <= new Date()) return null;
      if (query.tokenHash && query.tokenHash !== resetRecord.tokenHash) return null;
      if (query.userId && query.userId !== resetRecord.userId) return null;
      return resetRecord;
    },
    updateOne: async (query, update) => {
      consumedFilter = query;
      if (query._id !== resetRecord?._id || resetRecord.usedAt || query.tokenHash !== resetRecord.tokenHash) return { modifiedCount: 0 };
      resetRecord = { ...resetRecord, ...update.$set };
      return { modifiedCount: 1 };
    }
  },
  sessions: { deleteMany: async (query) => { sessionsRevoked = query.userId === user._id; return { deletedCount: 1 }; } }
};

const database = require('../src/data/database');
database.initializeDatabase = async () => collections;
const mongodb = require('../src/data/mongodb');
mongodb.withTransaction = async (callback) => { transactionCalls += 1; return callback({}); };
const { requestPasswordReset, resetPassword, verifyPassword } = require('../src/data/auth-service');

test('issues a random hashed token, expires it, replaces prior tokens, then consumes it once', async () => {
  resetRecord = null;
  consumedFilter = null;
  invalidatedPrevious = false;
  sessionsRevoked = false;
  transactionCalls = 0;
  passwordUpdate = null;

  const result = await requestPasswordReset('farmer@example.com');
  assert.equal(result.accepted, true);
  assert.match(result.token, /^[A-Za-z0-9_-]{40,60}$/);
  assert.equal(invalidatedPrevious, true);
  assert.equal(resetRecord.userId, user._id);
  assert.equal(resetRecord.tokenHash, crypto.createHash('sha256').update(result.token).digest('hex'));
  assert.match(result.code, /^\d{6}$/);
  assert.equal(resetRecord.codeHash, crypto.createHmac('sha256', process.env.SESSION_SECRET || 'isuka-local-reset-code').update(result.code).digest('hex'));
  assert.equal(Object.hasOwn(resetRecord, 'token'), false);
  assert.equal(Object.hasOwn(resetRecord, 'code'), false);
  assert.ok(Math.abs((resetRecord.expiresAt.getTime() - resetRecord.createdAt.getTime()) - 10 * 60 * 1000) < 10);

  await resetPassword({ token: result.token, password: 'a-new-secure-password' });
  assert.equal(consumedFilter.tokenHash, resetRecord.tokenHash);
  assert.equal(resetRecord.usedAt instanceof Date, true);
  assert.equal(passwordUpdate.updatedAt instanceof Date, true);
  assert.equal(await verifyPassword('a-new-secure-password', passwordUpdate.passwordHash), true);
  assert.equal(sessionsRevoked, true);
  assert.equal(transactionCalls, 1);
  await assert.rejects(resetPassword({ token: result.token, password: 'another-secure-password' }), /Invalid or expired recovery link/);
});
