'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const user = { _id: { id: 'farmer-1' }, role: 'farmer' };
const sequence = [];
let activeOperation = false;
let overlapDetected = false;
const session = { id: 'transaction-session' };

function removeMany(name) {
  return async (_filter, options) => {
    assert.equal(options.session, session);
    if (activeOperation) overlapDetected = true;
    activeOperation = true;
    sequence.push(name);
    await Promise.resolve();
    activeOperation = false;
    return { deletedCount: 1 };
  };
}

const collections = {
  sessions: { deleteMany: removeMany('sessions') },
  passwordResets: { deleteMany: removeMany('passwordResets') },
  farmRecords: { deleteMany: removeMany('farmRecords') },
  alerts: { deleteMany: removeMany('alerts') },
  assistantMessages: { deleteMany: removeMany('assistantMessages') },
  users: {
    deleteOne: async (_filter, options) => {
      assert.equal(options.session, session);
      sequence.push('users');
      return { deletedCount: 1 };
    }
  }
};

require('../src/data/database').initializeDatabase = async () => collections;
require('../src/data/mongodb').withTransaction = async (work) => work(session);
const { deleteAccount } = require('../src/data/auth-service');

test('deletes account records sequentially within one Mongo transaction', async () => {
  sequence.length = 0;
  activeOperation = false;
  overlapDetected = false;

  await deleteAccount(user);

  assert.deepEqual(sequence, ['sessions', 'passwordResets', 'farmRecords', 'alerts', 'assistantMessages', 'users']);
  assert.equal(overlapDetected, false);
});
