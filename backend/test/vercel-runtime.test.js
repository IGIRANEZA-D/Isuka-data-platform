const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('serverless backend starts on Vercel without a bundled uploads directory', () => {
  const missingUploadsDirectory = path.join(os.tmpdir(), `isuka-vercel-${randomUUID()}`, 'data', 'uploads');
  const result = spawnSync(process.execPath, ['-e', "require('./src/server')"], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL: '1',
      NODE_ENV: 'production',
      ISUKA_UPLOADS_DIR: missingUploadsDirectory
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'Server module failed to load.');
});
