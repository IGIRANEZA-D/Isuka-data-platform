const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchAIProvider } = require('../src/data/providers');

test('retries one transient AI provider network failure without leaking URL secrets', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    const error = new Error('connection reset');
    error.cause = { code: 'ECONNRESET' };
    throw error;
  };

  try {
    await assert.rejects(
      fetchAIProvider('https://example.test/generate?key=private-value', {}, 'Gemini'),
      (error) => {
        assert.equal(error.code, 'AI_PROVIDER_NETWORK_ERROR');
        assert.match(error.message, /ECONNRESET/);
        assert.doesNotMatch(error.message, /private-value/);
        return true;
      }
    );
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('retries one transient AI provider server response', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return {
      status: attempts === 1 ? 503 : 200,
      body: { cancel: async () => {} }
    };
  };

  try {
    const response = await fetchAIProvider('https://example.test/generate', {}, 'Gemini');
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('does not retry non-transient AI provider responses', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return { status: 401 };
  };

  try {
    const response = await fetchAIProvider('https://example.test/generate', {}, 'Gemini');
    assert.equal(response.status, 401);
    assert.equal(attempts, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
