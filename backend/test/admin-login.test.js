'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const database = require('../src/data/database');
let userQuery;
let insertedSession;
let adminUser;
const collections = {
  users: { findOne: async (query) => { userQuery = query; return adminUser; } },
  sessions: { insertOne: async (document) => { insertedSession = document; return { insertedId: 'session-1' }; } }
};
database.initializeDatabase = async () => collections;

const { hashPassword, loginConfiguredAdmin } = require('../src/data/auth-service');

test('admin login accepts the configured email used by the admin form', async () => {
  const previous = {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    seedPhone: process.env.ADMIN_SEED_PHONE,
    seedPassword: process.env.ADMIN_SEED_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET
  };
  process.env.ADMIN_EMAIL = 'Admin@isuka.example';
  process.env.ADMIN_PASSWORD = 'admin-login-test-password';
  delete process.env.ADMIN_SEED_PHONE;
  delete process.env.ADMIN_SEED_PASSWORD;
  process.env.SESSION_SECRET = 'admin-login-test-session-secret';
  adminUser = {
    _id: { toString: () => 'admin-user-1' },
    email: 'admin@isuka.example',
    role: 'admin',
    profile: {},
    passwordHash: await hashPassword(process.env.ADMIN_PASSWORD)
  };

  try {
    const result = await loginConfiguredAdmin({ identity: ' admin@ISUKA.example ', password: process.env.ADMIN_PASSWORD });
    assert.deepEqual(userQuery, { email: 'admin@isuka.example', role: 'admin' });
    assert.equal(result.user, adminUser);
    assert.equal(typeof result.session.token, 'string');
    assert.equal(typeof insertedSession.tokenHash, 'string');
  } finally {
    for (const [name, value] of Object.entries({
      ADMIN_EMAIL: previous.email,
      ADMIN_PASSWORD: previous.password,
      ADMIN_SEED_PHONE: previous.seedPhone,
      ADMIN_SEED_PASSWORD: previous.seedPassword,
      SESSION_SECRET: previous.sessionSecret
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
