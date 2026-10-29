const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { initializeDatabase } = require('./database');
const { withTransaction } = require('./mongodb');

const sessionDays = 14;
const resetMinutes = 10;
const maxResetAttempts = 5;
const scryptParameters = { N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 };

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 128) throw new Error('Password must be between 8 and 128 characters.');
  return value;
}

function createAuthError(message, { statusCode = 401, logLabel = 'auth_error', cause = undefined } = {}) {
  const error = new Error(message);
  error.name = 'AuthError';
  error.statusCode = statusCode;
  error.logLabel = logLabel;
  if (cause) error.cause = cause;
  return error;
}

function isDatabaseConnectivityError(error) {
  const value = `${error?.name || ''} ${error?.message || ''}`;
  return Boolean(error) && (
    ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNotConnectedError', 'MongoTimeoutError', 'MongoError'].includes(error.name) ||
    /SSL|TLS|CERT|certificate|ECONNREFUSED|ECONNRESET|ENOTFOUND|server selection|timed out|network|connection.*failed|unable to connect/i.test(value)
  );
}

function classifyAuthenticationFailure(error, { defaultStatusCode = 503 } = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error || 'Authentication failed.'));
  if (isDatabaseConnectivityError(normalized)) {
    return {
      statusCode: 503,
      publicError: 'Database temporarily unavailable. Please try again shortly.',
      logLabel: normalized.logLabel || 'database_unavailable',
      cause: normalized
    };
  }
  const isInvalidCredentials = normalized?.statusCode === 401 || /invalid email or password|invalid credentials|incorrect password|enter your email|enter your password|no account found/i.test(normalized.message || '');
  if (isInvalidCredentials) {
    const logLabel = normalized.logLabel && normalized.logLabel !== 'auth_error' ? normalized.logLabel : 'invalid_credentials';
    return {
      statusCode: 401,
      publicError: 'Invalid credentials.',
      logLabel,
      cause: normalized
    };
  }
  return {
    statusCode: defaultStatusCode,
    publicError: 'Authentication service temporarily unavailable. Please try again shortly.',
    logLabel: normalized.logLabel || 'service_error',
    cause: normalized
  };
}

function buildLoginFailureMessage({ identity, password, user } = {}) {
  const value = String(identity ?? '').trim();
  if (!value) return 'Enter your email or phone number.';
  if (value.includes('@') && !/^\S+@\S+\.\S+$/.test(value.toLowerCase())) return 'Enter a valid email address.';
  if (!user) return 'No account found for this email or phone number. Create an account first.';
  if (String(password ?? '').length === 0) return 'Enter your password.';
  return 'Incorrect password. Please try again.';
}

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function scryptAsync(password, salt, keyLength, options) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, keyLength, options, (error, key) => error ? reject(error) : resolve(key)));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keyLength, maxmem } = scryptParameters;
  const derivedKey = await scryptAsync(String(password), salt, keyLength, { N, r, p, maxmem });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  if (/^\$2[aby]\$/.test(storedHash)) return bcrypt.compare(String(password), storedHash);
  const [scheme, rawN, rawR, rawP, saltHex, keyHex] = storedHash.split('$');
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (scheme !== 'scrypt' || !Number.isSafeInteger(N) || N < 16384 || N > 131072 || (N & (N - 1)) !== 0
    || r !== 8 || p !== 1 || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(keyHex || '')) return false;
  const actual = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, Buffer.from(keyHex, 'hex'));
}

function needsPasswordRehash(storedHash) {
  return !String(storedHash || '').startsWith('scrypt$');
}

async function upgradePasswordHash(databaseCollections, user, password) {
  if (!needsPasswordRehash(user.passwordHash)) return;
  const passwordHash = await hashPassword(password);
  await databaseCollections.users.updateOne({ _id: user._id, passwordHash: user.passwordHash }, { $set: { passwordHash, updatedAt: new Date() } });
  user.passwordHash = passwordHash;
}

function hashSessionToken(value) {
  return process.env.SESSION_SECRET
    ? crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex')
    : hashToken(value);
}

function hashResetCode(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'isuka-local-reset-code').update(value).digest('hex');
}

function normalizeProfileUpdate(source = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const nextProfile = {};
  const assignString = (key, value) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    const candidate = String(value ?? '').trim();
    if (candidate.length > 0) nextProfile[key] = candidate;
  };
  assignString('firstName', input.firstName);
  assignString('lastName', input.lastName);
  assignString('district', input.district);
  if (Object.prototype.hasOwnProperty.call(input, 'smsAlerts') && typeof input.smsAlerts === 'boolean') nextProfile.smsAlerts = input.smsAlerts;
  if (Object.prototype.hasOwnProperty.call(input, 'language') && String(input.language ?? '').trim()) nextProfile.language = String(input.language).trim();
  return nextProfile;
}

function publicUser(user) {
  const profile = user.profile || {};
  const firstName = profile.firstName || profile.first_name || '';
  const lastName = profile.lastName || profile.last_name || '';
  return {
    id: user._id.toString(),
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    firstName,
    lastName,
    district: profile.district || null,
    profile
  };
}

async function createSession(user) {
  const databaseCollections = await initializeDatabase();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDays * 24 * 60 * 60 * 1000);
  await databaseCollections.sessions.insertOne({ userId: user._id, userSnapshot: { email: user.email, role: user.role }, tokenHash: hashSessionToken(token), expiresAt, createdAt: now });
  return { token, expiresAt };
}

async function registerAccount({ email, phone, password, profile = {} }) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  const normalizedPhone = phone ? String(phone).trim() : undefined;
  const passwordHash = await hashPassword(validatePassword(password));
  const databaseCollections = await initializeDatabase();
  const now = new Date();
  try {
    const result = await databaseCollections.users.insertOne({ email: normalizedEmail, ...(normalizedPhone ? { phone: normalizedPhone } : {}), role: 'farmer', passwordHash, profile, createdAt: now, updatedAt: now });
    const user = { _id: result.insertedId, email: normalizedEmail, ...(normalizedPhone ? { phone: normalizedPhone } : {}), role: 'farmer', passwordHash, profile, createdAt: now, updatedAt: now };
    return { user, session: await createSession(user) };
  } catch (error) {
    if (error.code === 11000) throw new Error('An account with that email or phone already exists.');
    throw error;
  }
}

async function loginAccount({ identity, password, roles }) {
  const value = String(identity || '').trim();
  if (!value) throw new Error(buildLoginFailureMessage({ identity: value }));
  if (value.includes('@') && !/^\S+@\S+\.\S+$/.test(value.toLowerCase())) throw new Error(buildLoginFailureMessage({ identity: value }));
  const normalizedValue = value.toLowerCase();
  const passwordValue = String(password || '');
  if (!passwordValue) throw new Error(buildLoginFailureMessage({ identity: value, password: '', user: null }));
  const databaseCollections = await initializeDatabase();
  const user = await databaseCollections.users.findOne({ $or: [{ email: normalizedValue }, { phone: String(identity || '').trim() }], ...(roles ? { role: { $in: roles } } : {}) });
  if (!user) throw new Error(buildLoginFailureMessage({ identity: value, password: passwordValue, user: null }));
  if (!(await verifyPassword(passwordValue, user.passwordHash))) throw new Error(buildLoginFailureMessage({ identity: value, password: passwordValue, user }));
  await upgradePasswordHash(databaseCollections, user, passwordValue);
  return { user, session: await createSession(user) };
}

async function loginConfiguredAdmin({ identity, password }) {
  const normalizedIdentity = normalizeEmail(identity);
  const passwordValue = String(password || '');
  const databaseCollections = await initializeDatabase();
  const user = await databaseCollections.users.findOne({ email: normalizedIdentity, role: 'admin' });
  if (!user || !(await verifyPassword(passwordValue, user.passwordHash))) throw new Error('Invalid email or password.');
  await upgradePasswordHash(databaseCollections, user, passwordValue);
  return { user, session: await createSession(user) };
}

async function findSession(token) {
  if (!token) return null;
  const databaseCollections = await initializeDatabase();
  const session = await databaseCollections.sessions.findOne({ tokenHash: { $in: [hashSessionToken(token), hashToken(token)] }, expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await databaseCollections.users.findOne({ _id: session.userId });
  return user ? { user, session } : null;
}

async function destroySession(token) {
  if (!token) return;
  const databaseCollections = await initializeDatabase();
  await databaseCollections.sessions.deleteOne({ tokenHash: { $in: [hashSessionToken(token), hashToken(token)] } });
}

async function requestPasswordReset(identity) {
  const value = String(identity || '').trim().toLowerCase();
  const databaseCollections = await initializeDatabase();
  const user = await databaseCollections.users.findOne({ $or: [{ email: value }, { phone: String(identity || '').trim() }] });
  if (!user || !user.email || user.email.endsWith('@isuka.invalid')) {
    return { accepted: true, token: crypto.randomBytes(32).toString('base64url'), code: String(crypto.randomInt(100000, 1000000)) };
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(100000, 1000000));
  const now = new Date();
  await databaseCollections.passwordResets.updateMany({ userId: user._id, usedAt: { $exists: false } }, { $set: { usedAt: now } });
  await databaseCollections.passwordResets.insertOne({ userId: user._id, tokenHash: hashToken(token), codeHash: hashResetCode(code), expiresAt: new Date(now.getTime() + resetMinutes * 60 * 1000), attempts: 0, createdAt: now });
  return { accepted: true, token, code, user };
}

async function resetPassword({ identity, token, code, password }) {
  const databaseCollections = await initializeDatabase();
  const tokenValue = String(token || '');
  let reset;
  let user;
  if (tokenValue) {
    reset = await databaseCollections.passwordResets.findOne({ tokenHash: hashToken(tokenValue), expiresAt: { $gt: new Date() }, usedAt: { $exists: false } });
    if (reset) user = await databaseCollections.users.findOne({ _id: reset.userId });
  } else {
    const identityValue = String(identity || '').trim();
    const normalizedIdentity = identityValue.toLowerCase();
    user = await databaseCollections.users.findOne({ $or: [{ email: normalizedIdentity }, { phone: identityValue }] });
    if (user) reset = await databaseCollections.passwordResets.findOne({ userId: user._id, expiresAt: { $gt: new Date() }, usedAt: { $exists: false }, attempts: { $lt: maxResetAttempts } }, { sort: { createdAt: -1 } });
  }
  if (!reset || !user) throw new Error('Invalid or expired recovery link.');
  const codeValue = String(code || '');
  const validCode = reset.codeHash === hashResetCode(codeValue) || reset.codeHash === hashToken(codeValue);
  if (!tokenValue && !validCode) {
    await databaseCollections.passwordResets.updateOne({ _id: reset._id, attempts: { $lt: maxResetAttempts }, usedAt: { $exists: false } }, { $inc: { attempts: 1 } });
    throw new Error('Invalid or expired recovery link.');
  }
  const now = new Date();
  const passwordHash = await hashPassword(validatePassword(password));
  await withTransaction(async (session) => {
    const consumeFilter = { _id: reset._id, usedAt: { $exists: false }, expiresAt: { $gt: now } };
    if (tokenValue) consumeFilter.tokenHash = hashToken(tokenValue);
    else consumeFilter.codeHash = reset.codeHash;
    const consumed = await databaseCollections.passwordResets.updateOne(consumeFilter, { $set: { usedAt: now } }, { session });
    if (consumed.modifiedCount !== 1) throw new Error('Invalid or expired recovery link.');
    await databaseCollections.users.updateOne({ _id: user._id }, { $set: { passwordHash, updatedAt: now } }, { session });
    await databaseCollections.sessions.deleteMany({ userId: user._id }, { session });
  });
}

async function changePassword(user, currentPassword, newPassword) {
  const databaseCollections = await initializeDatabase();
  const storedUser = await databaseCollections.users.findOne({ _id: user._id });
  const currentPasswordValue = String(currentPassword || '');
  if (!storedUser || !(await verifyPassword(currentPasswordValue, storedUser.passwordHash))) throw new Error('Current password is incorrect.');
  if (currentPasswordValue === String(newPassword || '')) throw new Error('New password must be different from your current password.');
  const now = new Date();
  await databaseCollections.users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(validatePassword(newPassword)), updatedAt: now } });
  await databaseCollections.sessions.deleteMany({ userId: user._id });
}

async function deleteAccount(user) {
  const databaseCollections = await initializeDatabase();

  const removeAccountData = async (session) => {
    const options = session ? { session } : undefined;
    await databaseCollections.sessions.deleteMany({ userId: user._id }, options);
    await databaseCollections.passwordResets.deleteMany({ userId: user._id }, options);
    await databaseCollections.farmRecords.deleteMany({ userId: user._id }, options);
    await databaseCollections.alerts.deleteMany({ userId: user._id }, options);
    await databaseCollections.assistantMessages.deleteMany({ userId: user._id }, options);
    const deleted = await databaseCollections.users.deleteOne({ _id: user._id }, options);
    if (deleted.deletedCount !== 1) throw new Error('Account could not be deleted.');
  };

  try {
    await withTransaction(removeAccountData);
  } catch (error) {
    const transactionUnsupported = error?.code === 20
      || error?.codeName === 'IllegalOperation'
      || /transaction numbers are only allowed|transactions? (?:are )?not supported|does not support transactions/i.test(error?.message || '');
    if (!transactionUnsupported) throw error;

    // Some MongoDB-compatible deployments accept regular writes but do not
    // support multi-document transactions. Cleanup is ordered and idempotent:
    // remove child data first and delete the user record last, so a retry can
    // safely finish if any write fails partway through.
    await removeAccountData();
  }
}

async function seedAdminUser() {
  const phone = String(process.env.ADMIN_SEED_PHONE || '').trim();
  const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_SEED_PASSWORD || process.env.ADMIN_PASSWORD;
  if ((!phone && !configuredEmail) || !password) return;
  const databaseCollections = await initializeDatabase();
  const email = configuredEmail || `admin-${phone.replace(/\D/g, '')}@isuka.invalid`;
  const now = new Date();
  const identityFilter = phone ? { phone } : { email };
  const existing = await databaseCollections.users.findOne(identityFilter);
  const seedPassword = validatePassword(password);
  const passwordHash = existing && await verifyPassword(seedPassword, existing.passwordHash)
    ? existing.passwordHash
    : await hashPassword(seedPassword);
  await databaseCollections.users.updateOne(
    identityFilter,
    { $set: { role: 'admin', passwordHash, updatedAt: now }, $setOnInsert: { email, ...(phone ? { phone } : {}), createdAt: now, profile: {} } },
    { upsert: true }
  );
}

function toObjectId(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

module.exports = {
  registerAccount,
  loginAccount,
  loginConfiguredAdmin,
  findSession,
  destroySession,
  requestPasswordReset,
  resetPassword,
  changePassword,
  deleteAccount,
  seedAdminUser,
  publicUser,
  normalizeProfileUpdate,
  toObjectId,
  hashPassword,
  verifyPassword,
  needsPasswordRehash,
  buildLoginFailureMessage,
  createAuthError,
  classifyAuthenticationFailure,
  isDatabaseConnectivityError
};
