'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { sendPasswordResetEmail, passwordResetEmail, expiryMinutes } = require('../src/data/mailer');

const originalApiKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.RESEND_FROM_EMAIL;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalApiKey;
  if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFrom;
});

test('password-reset email uses Isuka text branding without images or icons', () => {
  const { html, text } = passwordResetEmail('https://isuka.example/account/login#resetToken=abc&x=1', '654321');
  assert.match(html, /ISUKA/);
  assert.match(html, /Reset your password/);
  assert.match(html, /Reset Password/);
  assert.match(html, /654321/);
  assert.match(html, new RegExp(`${expiryMinutes} minutes`));
  assert.match(html, /ignore this email/i);
  assert.match(html, /#1f2e17|#3d6b1f|#6fa83c/i);
  assert.match(html, /resetToken=abc&amp;x=1/);
  assert.doesNotMatch(html, /<img\b|<svg\b|background-image\s*:/i);
  assert.match(text, /https:\/\/isuka\.example/);
  assert.match(text, /10 minutes/);
  assert.match(text, /654321/);
});

test('password-reset send uses the configured sender and abortable Resend API request', async () => {
  process.env.RESEND_API_KEY = 'test-only-key';
  process.env.RESEND_FROM_EMAIL = 'isukaplatform@gmail.com';
  let captured;
  const fakeResend = { emails: { send: async (message, options) => {
    captured = { message, options };
    return { data: { id: 'email-test-id' }, error: null };
  } } };

  await sendPasswordResetEmail('farmer@example.com', 'https://isuka.example/account/login#resetToken=test', '654321', fakeResend);
  assert.equal(captured.message.from, 'Isuka Data Platform <isukaplatform@gmail.com>');
  assert.deepEqual(captured.message.to, ['farmer@example.com']);
  assert.equal(captured.message.subject, 'Reset your Isuka password');
  assert.match(captured.message.html, /Reset Password/);
  assert.match(captured.message.html, /654321/);
  assert.match(captured.message.text, /https:\/\/isuka\.example\/account\/login/);
  assert.match(captured.message.text, /ignore this email/i);
  assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(captured.options.signal.aborted, false);
});

test('password-reset send fails closed when Resend configuration is missing', async () => {
  delete process.env.RESEND_API_KEY;
  process.env.RESEND_FROM_EMAIL = 'isukaplatform@gmail.com';
  await assert.rejects(sendPasswordResetEmail('farmer@example.com', 'https://isuka.example/reset', '654321', { emails: { send: async () => assert.fail('must not send') } }), { code: 'EMAIL_NOT_CONFIGURED' });
});

test('Resend errors are not returned with provider details', async () => {
  process.env.RESEND_API_KEY = 'test-only-key';
  process.env.RESEND_FROM_EMAIL = 'isukaplatform@gmail.com';
  const fakeResend = { emails: { send: async () => ({ data: null, error: { message: 'private provider detail', statusCode: 403 } }) } };
  await assert.rejects(sendPasswordResetEmail('farmer@example.com', 'https://isuka.example/reset', '654321', fakeResend), (error) => {
    assert.equal(error.code, 'EMAIL_DELIVERY_FAILED');
    assert.equal(error.message, 'Resend rejected the password reset email.');
    assert.doesNotMatch(error.message, /private provider detail/);
    return true;
  });
});
