/**
 * Vercel serverless function entry point.
 *
 * The Express app is imported from the backend; on Vercel it is exported
 * directly (no app.listen). When run locally via `node src/server.js` the
 * original listen path still fires because require.main === module is true
 * in server.js.
 *
 * Vercel calls this file as a standard Node.js HTTP handler:
 *   module.exports = (req, res) => app(req, res)
 *
 * Path resolution note: __dirname here is <repo>/api/, so paths like
 * ../../backend/... correctly reach the backend source.
 */

// The server module exports the Express `app` and guards `app.listen` behind
// `if (require.main === module)`, so importing it here is safe.
const app = require('../backend/src/server');

module.exports = app;
