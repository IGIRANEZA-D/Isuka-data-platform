const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
  classifyAuthenticationFailure,
  buildLoginFailureMessage,
  createAuthError,
  publicUser,
  normalizeProfileUpdate,
  hashPassword,
  verifyPassword,
  needsPasswordRehash
} = require('../src/data/auth-service');

test('hashes new passwords with scrypt and rejects a different password', async () => {
  const encoded = await hashPassword('correct-horse-battery');
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct-horse-battery', encoded), true);
  assert.equal(await verifyPassword('wrong-password', encoded), false);
  assert.equal(needsPasswordRehash(encoded), false);
});

test('verifies legacy bcrypt hashes and marks them for successful-login rehash', async () => {
  const legacyHash = await bcrypt.hash('legacy-password', 4);
  assert.equal(await verifyPassword('legacy-password', legacyHash), true);
  assert.equal(await verifyPassword('incorrect-password', legacyHash), false);
  assert.equal(needsPasswordRehash(legacyHash), true);
});

test('classifies TLS and Atlas connection errors as a temporary database outage', () => {
  const result = classifyAuthenticationFailure(new Error('SSL alert number 80 while connecting to MongoDB Atlas'));
  assert.equal(result.statusCode, 503);
  assert.equal(result.publicError, 'Database temporarily unavailable. Please try again shortly.');
  assert.equal(result.logLabel, 'database_unavailable');
});

test('classifies invalid credentials as a safe 401 response without disclosing account existence', () => {
  const result = classifyAuthenticationFailure(createAuthError('Invalid email or password.', { statusCode: 401 }));
  assert.equal(result.statusCode, 401);
  assert.equal(result.publicError, 'Invalid credentials.');
  assert.equal(result.logLabel, 'invalid_credentials');
});

test('uses a neutral internal message when a user record is missing', () => {
  const result = buildLoginFailureMessage({ identity: 'missing@example.com', user: null, password: 'badpass' });
  assert.equal(result, 'No account found for this email or phone number. Create an account first.');
});

test('keeps the original error for logs while returning a safe public message for account-only messages', () => {
  const failure = createAuthError('No account found for this email or phone number. Create an account first.', { statusCode: 401, logLabel: 'missing_account' });
  const result = classifyAuthenticationFailure(failure);
  assert.equal(result.statusCode, 401);
  assert.equal(result.publicError, 'Invalid credentials.');
  assert.equal(result.logLabel, 'missing_account');
});

test('keeps the farmer profile details in the public user payload after login', () => {
  const user = {
    _id: { toString: () => 'user-123' },
    email: 'farmer@example.com',
    phone: '+250788123456',
    role: 'farmer',
    profile: { firstName: 'Alice', lastName: 'Mugisha', district: 'Gasabo', smsAlerts: true }
  };

  assert.deepEqual(publicUser(user), {
    id: 'user-123',
    email: 'farmer@example.com',
    phone: '+250788123456',
    role: 'farmer',
    firstName: 'Alice',
    lastName: 'Mugisha',
    district: 'Gasabo',
    profile: { firstName: 'Alice', lastName: 'Mugisha', district: 'Gasabo', smsAlerts: true }
  });
});

test('normalizes profile updates to known user fields only', () => {
  const result = normalizeProfileUpdate({
    firstName: ' Alice ',
    lastName: ' Mugisha ',
    district: 'Gasabo',
    smsAlerts: true,
    password: 'super-secret',
    internalFlag: 'ignored'
  });

  assert.deepEqual(result, {
    firstName: 'Alice',
    lastName: 'Mugisha',
    district: 'Gasabo',
    smsAlerts: true
  });
});
